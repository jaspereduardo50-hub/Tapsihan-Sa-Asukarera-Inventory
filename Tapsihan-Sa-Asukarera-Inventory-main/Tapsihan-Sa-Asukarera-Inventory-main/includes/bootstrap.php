<?php
declare(strict_types=1);

/*
 * Shared foundation for every PHP endpoint:
 * config, database, secure sessions, JSON helpers, CSRF, audit log.
 */

const APP_TIMEZONE          = 'Asia/Manila';
const DB_TIMEZONE_OFFSET    = '+08:00';          // Philippines has no daylight saving
const SESSION_IDLE_SECONDS  = 8 * 60 * 60;       // matches the 8-hour timeout in dashboard.js
const LOGIN_MAX_FAILS       = 5;                 // failed passwords before an account is locked
const LOGIN_LOCK_MINUTES    = 15;
const LOGIN_IP_MAX_FAILS    = 10;                // failed attempts per IP in 15 minutes

date_default_timezone_set(APP_TIMEZONE);

function config(string $key, mixed $default = null): mixed
{
    static $cfg = null;
    if ($cfg === null) {
        $cfg = require dirname(__DIR__) . '/config/config.php';
    }
    return $cfg[$key] ?? $default;
}

ini_set('display_errors', config('debug') ? '1' : '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

set_exception_handler(function (Throwable $e): void {
    error_log('Tapsihan error: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
    if (!headers_sent()) {
        json_out(['ok' => false, 'error' => 'Server error. Please try again.'], 500);
    }
    exit;
});

/* ---------- Database ---------- */

function db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        $dsn = 'mysql:host=' . config('db_host') . ';dbname=' . config('db_name') . ';charset=utf8mb4';
        $pdo = new PDO($dsn, (string) config('db_user'), (string) config('db_pass'), [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
        // Make NOW() and TIMESTAMP columns agree with Philippine time
        $pdo->exec("SET time_zone = '" . DB_TIMEZONE_OFFSET . "'");
    }
    return $pdo;
}

/* ---------- Requests & responses ---------- */

function json_out(array $data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    exit;
}

function require_method(string $method): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== $method) {
        header('Allow: ' . $method);
        json_out(['ok' => false, 'error' => 'Method not allowed.'], 405);
    }
}

function read_json_body(): array
{
    $raw = file_get_contents('php://input', false, null, 0, 65536);
    $data = json_decode($raw === false ? '' : $raw, true);
    if (!is_array($data)) {
        json_out(['ok' => false, 'error' => 'Invalid request.'], 400);
    }
    return $data;
}

function client_ip(): string
{
    // REMOTE_ADDR only. Forwarded headers can be faked by the visitor.
    return substr((string) ($_SERVER['REMOTE_ADDR'] ?? ''), 0, 45);
}

/* ---------- Sessions ---------- */

function is_https(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
}

function start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.gc_maxlifetime', (string) SESSION_IDLE_SECONDS);
    session_name('tapsihan_sid');
    session_set_cookie_params([
        'lifetime' => 0,               // cookie disappears when the browser closes
        'path'     => '/',
        'secure'   => is_https(),
        'httponly' => true,            // JavaScript cannot read the session cookie
        'samesite' => 'Lax',
    ]);
    session_start();
}

function destroy_session(): void
{
    start_session();
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', [
            'expires'  => time() - 3600,
            'path'     => $p['path'],
            'secure'   => $p['secure'],
            'httponly' => $p['httponly'],
            'samesite' => $p['samesite'] ?: 'Lax',
        ]);
    }
    session_destroy();
}

/**
 * The logged-in user, read fresh from the database on every request,
 * so a deactivated account or a changed role takes effect immediately.
 */
function current_user(): ?array
{
    start_session();
    $id = $_SESSION['user_id'] ?? null;
    if (!$id) {
        return null;
    }
    if (time() - (int) ($_SESSION['last_activity'] ?? 0) > SESSION_IDLE_SECONDS) {
        destroy_session();
        return null;
    }
    $stmt = db()->prepare('SELECT id, username, email, full_name, role, active FROM users WHERE id = ?');
    $stmt->execute([$id]);
    $user = $stmt->fetch();
    if (!$user || !(int) $user['active']) {
        destroy_session();
        return null;
    }
    $_SESSION['last_activity'] = time();
    return $user;
}

function require_login(): array
{
    $user = current_user();
    if ($user === null) {
        json_out(['ok' => false, 'error' => 'Please log in.'], 401);
    }
    return $user;
}

/* ---------- Request forgery protection ---------- */

function csrf_token(): string
{
    start_session();
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf'];
}

/** Every logged-in POST/PUT/DELETE must send the session's token in X-CSRF-Token. */
function require_csrf(): void
{
    start_session();
    $sent = (string) ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? '');
    $real = (string) ($_SESSION['csrf'] ?? '');
    if ($real === '' || !hash_equals($real, $sent)) {
        json_out(['ok' => false, 'error' => 'Security check failed. Please refresh the page.'], 403);
    }
}

/** Rejects browser requests that come from a different website. */
function require_same_origin(): void
{
    $origin = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
    if ($origin === '') {
        return;   // not a cross-site browser request
    }
    $parts = parse_url($origin);
    $originHost = strtolower(($parts['host'] ?? '') . (isset($parts['port']) ? ':' . $parts['port'] : ''));
    $ownHost    = strtolower((string) ($_SERVER['HTTP_HOST'] ?? ''));
    if ($originHost === '' || $originHost !== $ownHost) {
        json_out(['ok' => false, 'error' => 'Request blocked.'], 403);
    }
}

/* ---------- Audit log (always written by PHP, never by the browser) ---------- */

function audit_log(string $module, string $action, string $target, string $details, array $user): void
{
    $stmt = db()->prepare(
        'INSERT INTO audit_logs (module, action, target, details, user_id, user_name, user_role, ip_address)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $stmt->execute([
        $module, $action, $target, $details,
        $user['id'], $user['full_name'], $user['role'], client_ip(),
    ]);
}
