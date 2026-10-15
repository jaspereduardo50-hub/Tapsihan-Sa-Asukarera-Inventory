<?php
declare(strict_types=1);

require __DIR__ . '/../includes/bootstrap.php';

$user = require_login();

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
    $items = db()->query(
        'SELECT id, code, name, category, unit, stock, minimum_stock, archived_at
         FROM inventory_items
         ORDER BY id'
    )->fetchAll();

    $supplierStmt = db()->query(
        'SELECT isup.item_id, isup.priority, s.name, s.contact
         FROM item_suppliers isup
         INNER JOIN suppliers s ON s.id = isup.supplier_id
         WHERE s.archived_at IS NULL'
    );

    $supplierMap = [];
    foreach ($supplierStmt->fetchAll() as $row) {
        $supplierMap[(int) $row['item_id']][$row['priority']] = [
            'name' => $row['name'],
            'contact' => $row['contact'],
        ];
    }

    $active = [];
    $archived = [];
    foreach ($items as $row) {
        $suppliers = $supplierMap[(int) $row['id']] ?? [];
        $mappedSuppliers = [
            $suppliers['primary'] ?? null,
            $suppliers['secondary'] ?? null,
            $suppliers['backup'] ?? null,
        ];

        $item = [
            'id' => (string) $row['code'],
            'databaseId' => (int) $row['id'],
            'name' => (string) $row['name'],
            'category' => (string) $row['category'],
            'unit' => (string) $row['unit'],
            'stock' => (float) $row['stock'],
            'minimum' => (float) $row['minimum_stock'],
            'suppliers' => $mappedSuppliers,
        ];

        if ($row['archived_at'] !== null) {
            $item['archivedAt'] = str_replace(' ', 'T', (string) $row['archived_at']);
            $item['archivedBy'] = '';
            $item['archivedReason'] = 'Archived in database';
            $archived[] = $item;
        } else {
            $active[] = $item;
        }
    }

    json_out(['ok' => true, 'items' => $active, 'archived' => $archived]);
}

require_method('POST');
require_same_origin();
require_csrf();

$body = read_json_body();
$activeItems = $body['items'] ?? null;
$archivedItems = $body['archived'] ?? [];

if (!is_array($activeItems) || !is_array($archivedItems)) {
    json_out(['ok' => false, 'error' => 'Invalid inventory data.'], 400);
}

if (count($activeItems) + count($archivedItems) > 1000) {
    json_out(['ok' => false, 'error' => 'Too many inventory items.'], 413);
}

$pdo = db();
$seenCodes = [];
$validItems = [];

$normalizeItem = static function (mixed $raw, bool $isArchived) use (&$seenCodes, &$validItems): array {
    if (!is_array($raw)) {
        json_out(['ok' => false, 'error' => 'Invalid inventory item.'], 400);
    }

    $code = strtoupper(trim((string) ($raw['id'] ?? $raw['code'] ?? '')));
    $name = trim((string) ($raw['name'] ?? ''));
    $category = trim((string) ($raw['category'] ?? 'Other'));
    $unit = trim((string) ($raw['unit'] ?? 'pieces'));
    $stock = $raw['stock'] ?? 0;
    $minimum = $raw['minimum'] ?? $raw['minimum_stock'] ?? 1;

    if (!preg_match('/^RM-[0-9]{3,}$/', $code)) {
        json_out(['ok' => false, 'error' => 'Inventory code must use the RM-### format.'], 422);
    }
    if ($name === '' || mb_strlen($name) > 100 || mb_strlen($category) > 50 || mb_strlen($unit) > 30) {
        json_out(['ok' => false, 'error' => 'Enter valid inventory item details.'], 422);
    }
    if (!is_numeric($stock) || (float) $stock < 0 || !is_numeric($minimum) || (float) $minimum < 1) {
        json_out(['ok' => false, 'error' => 'Stock must be zero or greater and minimum stock must be at least one.'], 422);
    }
    if (isset($seenCodes[$code])) {
        json_out(['ok' => false, 'error' => 'Duplicate inventory code: ' . $code], 422);
    }
    $seenCodes[$code] = true;

    $suppliers = $raw['suppliers'] ?? [];
    if (!is_array($suppliers)) {
        $suppliers = [];
    }

    $archivedAt = null;
    if ($isArchived) {
        $rawDate = trim((string) ($raw['archivedAt'] ?? ''));
        if ($rawDate !== '') {
            try {
                $archivedAt = (new DateTimeImmutable($rawDate))->format('Y-m-d H:i:s');
            } catch (Throwable) {
                $archivedAt = date('Y-m-d H:i:s');
            }
        } else {
            $archivedAt = date('Y-m-d H:i:s');
        }
    }

    return [
        'code' => $code,
        'name' => $name,
        'category' => $category,
        'unit' => $unit,
        'stock' => (float) $stock,
        'minimum' => (float) $minimum,
        'suppliers' => array_slice($suppliers, 0, 3),
        'archived_at' => $archivedAt,
    ];
};

foreach ($activeItems as $raw) {
    $validItems[] = $normalizeItem($raw, false);
}
foreach ($archivedItems as $raw) {
    $validItems[] = $normalizeItem($raw, true);
}

try {
    $pdo->beginTransaction();

    $upsertItem = $pdo->prepare(
        'INSERT INTO inventory_items (code, name, category, unit, stock, minimum_stock, archived_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            name = VALUES(name),
            category = VALUES(category),
            unit = VALUES(unit),
            stock = VALUES(stock),
            minimum_stock = VALUES(minimum_stock),
            archived_at = VALUES(archived_at)'
    );

    $findItem = $pdo->prepare('SELECT id FROM inventory_items WHERE code = ?');
    $deleteAssignments = $pdo->prepare('DELETE FROM item_suppliers WHERE item_id = ?');
    $findSupplier = $pdo->prepare('SELECT id FROM suppliers WHERE name = ?');
    $insertSupplier = $pdo->prepare(
        'INSERT INTO suppliers (name, contact, archived_at)
         VALUES (?, ?, NULL)
         ON DUPLICATE KEY UPDATE contact = VALUES(contact), archived_at = NULL'
    );
    $insertAssignment = $pdo->prepare(
        'INSERT INTO item_suppliers (item_id, supplier_id, priority) VALUES (?, ?, ?)'
    );

    foreach ($validItems as $item) {
        $upsertItem->execute([
            $item['code'], $item['name'], $item['category'], $item['unit'],
            $item['stock'], $item['minimum'], $item['archived_at'],
        ]);

        $findItem->execute([$item['code']]);
        $databaseId = (int) $findItem->fetchColumn();
        $deleteAssignments->execute([$databaseId]);

        $priorities = ['primary', 'secondary', 'backup'];
        foreach ($priorities as $index => $priority) {
            $supplier = $item['suppliers'][$index] ?? null;
            if (!is_array($supplier)) {
                continue;
            }

            $supplierName = trim((string) ($supplier['name'] ?? ''));
            $supplierContact = trim((string) ($supplier['contact'] ?? ''));
            if ($supplierName === '') {
                continue;
            }
            if (mb_strlen($supplierName) > 100 || mb_strlen($supplierContact) > 100) {
                throw new RuntimeException('Supplier details are too long.');
            }

            $insertSupplier->execute([$supplierName, $supplierContact]);
            $findSupplier->execute([$supplierName]);
            $supplierId = (int) $findSupplier->fetchColumn();
            $insertAssignment->execute([$databaseId, $supplierId, $priority]);
        }
    }

    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    throw $e;
}

json_out([
    'ok' => true,
    'saved' => count($validItems),
]);
