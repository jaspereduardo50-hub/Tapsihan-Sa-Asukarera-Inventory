<?php
declare(strict_types=1);

require __DIR__ . '/../includes/bootstrap.php';

$user = require_login();

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
    $stmt = db()->query(
        'SELECT i.code, isup.priority, s.name, s.contact
         FROM item_suppliers isup
         INNER JOIN inventory_items i ON i.id = isup.item_id
         INNER JOIN suppliers s ON s.id = isup.supplier_id
         WHERE i.archived_at IS NULL AND s.archived_at IS NULL
         ORDER BY i.id, FIELD(isup.priority, \'primary\', \'secondary\', \'backup\')'
    );

    $assignments = [];
    foreach ($stmt->fetchAll() as $row) {
        $code = (string) $row['code'];
        if (!isset($assignments[$code])) {
            $assignments[$code] = [null, null, null];
        }
        $index = ['primary' => 0, 'secondary' => 1, 'backup' => 2][$row['priority']] ?? null;
        if ($index !== null) {
            $assignments[$code][$index] = [
                'name' => (string) $row['name'],
                'contact' => (string) $row['contact'],
            ];
        }
    }

    json_out(['ok' => true, 'assignments' => $assignments]);
}

require_method('POST');
require_same_origin();
require_csrf();

$body = read_json_body();
$itemCode = strtoupper(trim((string) ($body['itemId'] ?? '')));
$suppliers = $body['suppliers'] ?? null;

if (!preg_match('/^RM-[0-9]{3,}$/', $itemCode) || !is_array($suppliers) || count($suppliers) > 3) {
    json_out(['ok' => false, 'error' => 'Invalid supplier assignment data.'], 422);
}

$normalized = [];
$priorities = ['primary', 'secondary', 'backup'];
for ($index = 0; $index < 3; $index++) {
    $supplier = $suppliers[$index] ?? null;
    if ($supplier === null || $supplier === '') {
        $normalized[] = null;
        continue;
    }
    if (!is_array($supplier)) {
        json_out(['ok' => false, 'error' => 'Invalid supplier details.'], 422);
    }
    $name = trim((string) ($supplier['name'] ?? ''));
    $contact = trim((string) ($supplier['contact'] ?? ''));
    if ($name === '') {
        if ($contact !== '') {
            json_out(['ok' => false, 'error' => 'A supplier contact requires a supplier name.'], 422);
        }
        $normalized[] = null;
        continue;
    }
    if (mb_strlen($name) > 100 || mb_strlen($contact) > 100) {
        json_out(['ok' => false, 'error' => 'Supplier details are too long.'], 422);
    }
    $normalized[] = ['name' => $name, 'contact' => $contact];
}

$pdo = db();
try {
    $pdo->beginTransaction();

    $itemStmt = $pdo->prepare('SELECT id FROM inventory_items WHERE code = ? AND archived_at IS NULL FOR UPDATE');
    $itemStmt->execute([$itemCode]);
    $itemId = $itemStmt->fetchColumn();
    if ($itemId === false) {
        $pdo->rollBack();
        json_out(['ok' => false, 'error' => 'The selected inventory item was not found in MySQL. Save the inventory item first.'], 404);
    }

    $delete = $pdo->prepare('DELETE FROM item_suppliers WHERE item_id = ?');
    $delete->execute([(int) $itemId]);

    $upsertSupplier = $pdo->prepare(
        'INSERT INTO suppliers (name, contact, archived_at)
         VALUES (?, ?, NULL)
         ON DUPLICATE KEY UPDATE contact = VALUES(contact), archived_at = NULL'
    );
    $findSupplier = $pdo->prepare('SELECT id FROM suppliers WHERE name = ?');
    $assign = $pdo->prepare('INSERT INTO item_suppliers (item_id, supplier_id, priority) VALUES (?, ?, ?)');

    foreach ($normalized as $index => $supplier) {
        if ($supplier === null) {
            continue;
        }
        $upsertSupplier->execute([$supplier['name'], $supplier['contact']]);
        $findSupplier->execute([$supplier['name']]);
        $supplierId = $findSupplier->fetchColumn();
        if ($supplierId === false) {
            throw new RuntimeException('Unable to find the saved supplier.');
        }
        $assign->execute([(int) $itemId, (int) $supplierId, $priorities[$index]]);
    }

    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    throw $e;
}

json_out(['ok' => true, 'itemId' => $itemCode, 'suppliers' => $normalized]);
