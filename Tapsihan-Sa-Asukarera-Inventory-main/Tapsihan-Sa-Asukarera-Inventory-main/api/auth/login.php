<?php
declare(strict_types=1);
require __DIR__ . '/../../includes/bootstrap.php';

require_method('POST');
require_same_origin();

$body       = read_json_body();
$identifier = mb_strtolower(trim((string) ($body['identifier'] ?? '')));
$password   = (string) ($body['password'] ?? '');

if ($identifier === '' || $password === '' || mb_strlen($identifier) > 120 || strlen($password) > 128) {
    json_out(['ok' => false, 'error' => 'Invalid username or password.'], 401);
}

$pdo = db();
$ip  = client_ip();

/* --- Throttle: too many recent failures from this IP or for this name --- */
$tooMany = function () use ($pdo, $identifier, $ip): bool {
    $q = $pdo->prepare(
        'SELECT
            COALESCE(SUM(ip_address = ?), 0) AS ip_fails,
            COALESCE(SUM(identifier = ?), 0) AS id_fails
         FROM login_attempts
         WHERE success = 0 AND attempted_at > (NOW() - INTERVAL 15 MINUTE)'
    );
    $q->execute([$ip, $identifier]);
    $r = $q->fetch();
    return (int) $r['ip_fails'] >= LOGIN_IP_MAX_FAILS || (int) $r['id_fails'] >= LOGIN_MAX_FAILS;
};

$blocked = function (): never {
    json_out(['ok' => false, 'error' => 'Too many failed attempts. Please wait 15 minutes and try again.'], 429);
};

if ($tooMany()) {
    $blocked();
}

/* --- Find the account --- */
$stmt = $pdo->prepare(
    'SELECT id, username, email, full_name, role, active, password_hash,
            (locked_until IS NOT NULL AND locked_until > NOW()) AS is_locked
     FROM users WHERE username = ? OR email = ? LIMIT 1'
);
$stmt->execute([$identifier, $identifier]);
$user = $stmt->fetch();

if ($user && (int) $user['is_locked'] === 1) {
    $blocked();   // same answer whether or not the password is right
}

/* --- Check the password (do equal work for unknown names so timing doesn't reveal them) --- */
if ($user) {
    $passwordOk = password_verify($password, $user['password_hash']);
} else {
    password_hash($password, PASSWORD_DEFAULT);
    $passwordOk = false;
}

if (!$passwordOk) {
    $pdo->prepare('INSERT INTO login_attempts (identifier, ip_address, success) VALUES (?, ?, 0)')
        ->execute([$identifier, $ip]);

    if ($user) {
        $pdo->prepare('UPDATE users SET failed_attempts = failed_attempts + 1 WHERE id = ?')
            ->execute([$user['id']]);
        $pdo->prepare(
            'UPDATE users
             SET locked_until = DATE_ADD(NOW(), INTERVAL ' . LOGIN_LOCK_MINUTES . ' MINUTE), failed_attempts = 0
             WHERE id = ? AND failed_attempts >= ' . LOGIN_MAX_FAILS
        )->execute([$user['id']]);
    }
    json_out(['ok' => false, 'error' => 'Invalid username or password.'], 401);
}

if (!(int) $user['active']) {
    json_out(['ok' => false, 'error' => 'This account is inactive. Please contact the administrator.'], 403);
}

/* --- Success: new session id (prevents session fixation) --- */
start_session();
session_regenerate_id(true);
$_SESSION = [
    'user_id'       => (int) $user['id'],
    'last_activity' => time(),
];
$csrf = csrf_token();

$pdo->prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = NOW() WHERE id = ?')
    ->execute([$user['id']]);
$pdo->prepare('DELETE FROM login_attempts WHERE identifier = ? AND success = 0')->execute([$identifier]);
$pdo->prepare('INSERT INTO login_attempts (identifier, ip_address, success) VALUES (?, ?, 1)')
    ->execute([$identifier, $ip]);
$pdo->exec('DELETE FROM login_attempts WHERE attempted_at < (NOW() - INTERVAL 30 DAY)');

if (password_needs_rehash($user['password_hash'], PASSWORD_DEFAULT)) {
    $pdo->prepare('UPDATE users SET password_hash = ? WHERE id = ?')
        ->execute([password_hash($password, PASSWORD_DEFAULT), $user['id']]);
}

audit_log('Authentication', 'Login', $user['username'], 'User logged in.', $user);

json_out([
    'ok'   => true,
    'csrf' => $csrf,
    'user' => [
        'username' => $user['username'],
        'name'     => $user['full_name'],
        'email'    => $user['email'],
        'role'     => $user['role'],
    ],
]);
