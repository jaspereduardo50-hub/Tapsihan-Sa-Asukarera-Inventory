<?php
declare(strict_types=1);
require __DIR__ . '/../../includes/bootstrap.php';

require_method('GET');

$user = current_user();
if ($user === null) {
    json_out(['ok' => false, 'error' => 'Please log in.'], 401);
}

json_out([
    'ok'   => true,
    'csrf' => csrf_token(),
    'user' => [
        'username' => $user['username'],
        'name'     => $user['full_name'],
        'email'    => $user['email'],
        'role'     => $user['role'],
    ],
]);
