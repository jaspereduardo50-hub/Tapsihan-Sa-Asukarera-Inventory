<?php
declare(strict_types=1);
require __DIR__ . '/../../includes/bootstrap.php';

require_method('POST');
require_same_origin();

$authorization = (string) ($_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
$isBearer = preg_match('/^Bearer\s+([A-Fa-f0-9]{64})$/', trim($authorization), $matches) === 1;
$user = current_user();
if ($user !== null) {
    if ($isBearer) {
        db()->prepare('UPDATE api_tokens SET revoked_at = NOW() WHERE token_hash = ? AND revoked_at IS NULL')->execute([hash('sha256', $matches[1])]);
    } else {
        require_csrf();
    }
    audit_log('Authentication', 'Logout', $user['username'], 'User logged out.', $user);
}
destroy_session();
json_out(['ok' => true]);
