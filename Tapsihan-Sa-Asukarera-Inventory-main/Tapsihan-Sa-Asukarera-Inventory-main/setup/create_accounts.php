<?php
declare(strict_types=1);
/*
 * ONE-TIME SETUP: creates the Owner account and the shared Staff account
 * with properly hashed passwords.
 *
 * Open:  /setup/create_accounts.php?key=YOUR_SETUP_KEY   (from config/config.php)
 * Then DELETE the whole "setup" folder from the server.
 */
require __DIR__ . '/../includes/bootstrap.php';

header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function h(string $s): string { return htmlspecialchars($s, ENT_QUOTES, 'UTF-8'); }

function page(string $title, string $body): never
{
    echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
       . '<title>' . h($title) . '</title>'
       . '<style>body{font-family:system-ui,sans-serif;max-width:520px;margin:40px auto;padding:0 16px;color:#222}'
       . 'label{display:block;margin-top:14px;font-weight:600}input{width:100%;padding:8px;margin-top:4px;box-sizing:border-box}'
       . 'button{margin-top:20px;padding:10px 18px}.err{background:#fde8e8;padding:10px;border-radius:6px}.ok{background:#e6f6e9;padding:10px;border-radius:6px}</style>'
       . '</head><body><h2>' . h($title) . '</h2>' . $body . '</body></html>';
    exit;
}

$configured = (string) config('setup_key', '');
$given      = (string) ($_GET['key'] ?? $_POST['key'] ?? '');

if ($configured === '' || $configured === 'CHANGE-ME-TO-A-LONG-RANDOM-PHRASE' || strlen($configured) < 16) {
    http_response_code(403);
    page('Setup locked', '<p class="err">Set a long random <code>setup_key</code> (16+ characters) in <code>config/config.php</code> first.</p>');
}
if (!hash_equals($configured, $given)) {
    http_response_code(403);
    page('Forbidden', '<p class="err">Wrong or missing setup key.</p>');
}

$pdo = db();
if ((int) $pdo->query('SELECT COUNT(*) FROM users')->fetchColumn() > 0) {
    page('Already set up', '<p class="ok">Accounts already exist. Delete the <code>setup</code> folder from the server now.</p>');
}

$error = '';
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    $ownerPw = (string) ($_POST['owner_password'] ?? '');
    $staffPw = (string) ($_POST['staff_password'] ?? '');
    $banned  = ['owner123', 'staff123', 'password', '1234567890'];

    if (strlen($ownerPw) < 10 || strlen($staffPw) < 10) {
        $error = 'Each password must be at least 10 characters.';
    } elseif (strlen($ownerPw) > 128 || strlen($staffPw) > 128) {
        $error = 'Passwords can be at most 128 characters.';
    } elseif ($ownerPw === $staffPw) {
        $error = 'The Owner and Staff passwords must be different.';
    } elseif (in_array(strtolower($ownerPw), $banned, true) || in_array(strtolower($staffPw), $banned, true)) {
        $error = 'That password is too common. Choose something else.';
    } else {
        $insert = $pdo->prepare(
            'INSERT INTO users (username, email, full_name, role, password_hash) VALUES (?, ?, ?, ?, ?)'
        );
        $pdo->beginTransaction();
        $insert->execute(['owner', 'owner@tapsihan.local', 'Owner', 'owner', password_hash($ownerPw, PASSWORD_DEFAULT)]);
        $insert->execute(['staff', 'staff@tapsihan.local', 'Staff', 'staff', password_hash($staffPw, PASSWORD_DEFAULT)]);
        $pdo->commit();
        page('Accounts created',
            '<p class="ok">Done. You can log in as <b>owner</b> and <b>staff</b> with the passwords you just chose.</p>'
          . '<p><b>Now delete the <code>setup</code> folder from the server.</b></p>');
    }
}

page('Create accounts', ($error ? '<p class="err">' . h($error) . '</p>' : '')
    . '<form method="post" autocomplete="off">'
    . '<input type="hidden" name="key" value="' . h($given) . '">'
    . '<label>Owner password (min 10 characters)<input type="password" name="owner_password" required minlength="10" maxlength="128"></label>'
    . '<label>Shared Staff password (min 10 characters)<input type="password" name="staff_password" required minlength="10" maxlength="128"></label>'
    . '<button type="submit">Create accounts</button></form>');
