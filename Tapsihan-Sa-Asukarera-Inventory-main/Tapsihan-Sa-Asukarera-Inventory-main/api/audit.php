<?php
declare(strict_types=1);

require __DIR__ . '/../includes/bootstrap.php';

$user = require_login();

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
    $limit = max(1, min(1000, (int) ($_GET['limit'] ?? 500)));
    $stmt = db()->prepare(
        'SELECT id, module, action, target, details, user_id, user_name, user_role, ip_address, created_at
         FROM audit_logs
         ORDER BY created_at DESC, id DESC
         LIMIT ?'
    );
    $stmt->bindValue(1, $limit, PDO::PARAM_INT);
    $stmt->execute();
    json_out(['ok' => true, 'logs' => $stmt->fetchAll()]);
}

require_method('POST');
require_same_origin();
require_csrf();

$body = read_json_body();
$module = trim((string) ($body['module'] ?? ''));
$action = trim((string) ($body['action'] ?? ''));
$target = trim((string) ($body['target'] ?? ''));
$details = trim((string) ($body['details'] ?? ''));

if ($module === '' || $action === '' || mb_strlen($module) > 50 || mb_strlen($action) > 80 || mb_strlen($target) > 255) {
    json_out(['ok' => false, 'error' => 'Invalid audit log details.'], 422);
}

audit_log($module, $action, $target, $details, $user);
json_out(['ok' => true]);
