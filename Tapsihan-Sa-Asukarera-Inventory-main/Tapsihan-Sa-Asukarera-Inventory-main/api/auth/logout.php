<?php
declare(strict_types=1);
require __DIR__ . '/../../includes/bootstrap.php';

require_method('POST');
require_same_origin();

$user = current_user();
if ($user !== null) {
    require_csrf();
    audit_log('Authentication', 'Logout', $user['username'], 'User logged out.', $user);
}
destroy_session();
json_out(['ok' => true]);
