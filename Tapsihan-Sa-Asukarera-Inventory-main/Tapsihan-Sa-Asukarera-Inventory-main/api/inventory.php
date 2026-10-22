<?php
declare(strict_types=1);

require __DIR__ . '/../includes/bootstrap.php';
require __DIR__ . '/../includes/ledger.php';

/*
 * Inventory catalog
 *   GET     inventory.php                 all items: {"items": [...active], "archived": [...]}
 *   GET     inventory.php?id=RM-001       one item (active or archived): {"item": {...}}
 *   POST    inventory.php                 {"item": {name, category?, unit?, minimum, stock?, suppliers?}}  create
 *   PUT     inventory.php?id=RM-001       {"item": {name?, category?, unit?, minimum?, suppliers?}}        change details
 *   POST    inventory.php?id=RM-001&action=archive   {"reason"?: "..."}                                    archive
 *   POST    inventory.php?id=RM-001&action=restore                                                          restore
 *
 * The server assigns the item code (RM-###). "stock" is accepted only when creating an item (the
 * starting quantity, default 0); after that stock changes only through restocks, waste and stock
 * counts, so a phone saving an item can never overwrite stock the server has been tracking.
 * Items are archived, never deleted, so old records stay valid.
 *
 * The old POST {"items": [...], "archived": [...]} (save the whole catalog, stock included) is kept
 * only for the current website. Token (mobile) requests cannot use it.
 */

/* ---------- Reading ---------- */

/** Supplier slots [primary, secondary, backup] for the given item ids (all items when null). */
function inventory_supplier_map(PDO $pdo, ?int $onlyItemId = null): array
{
    $sql = 'SELECT isup.item_id, isup.priority, s.name, s.contact
            FROM item_suppliers isup
            INNER JOIN suppliers s ON s.id = isup.supplier_id
            WHERE s.archived_at IS NULL';
    $q = $pdo->prepare($sql . ($onlyItemId !== null ? ' AND isup.item_id = ?' : ''));
    $q->execute($onlyItemId !== null ? [$onlyItemId] : []);
    $map = [];
    foreach ($q->fetchAll() as $row) {
        $map[(int) $row['item_id']][$row['priority']] = ['name' => $row['name'], 'contact' => $row['contact']];
    }
    return $map;
}

function inventory_item_json(array $row, array $suppliers): array
{
    $item = [
        'id'         => (string) $row['code'],
        'databaseId' => (int) $row['id'],
        'name'       => (string) $row['name'],
        'category'   => (string) $row['category'],
        'unit'       => (string) $row['unit'],
        'stock'      => (float) $row['stock'],
        'minimum'    => (float) $row['minimum_stock'],
        'suppliers'  => [$suppliers['primary'] ?? null, $suppliers['secondary'] ?? null, $suppliers['backup'] ?? null],
    ];
    if ($row['archived_at'] !== null) {
        $item['archivedAt']     = str_replace(' ', 'T', (string) $row['archived_at']);
        $item['archivedBy']     = '';
        $item['archivedReason'] = 'Archived in database';
    }
    return $item;
}

function inventory_load(PDO $pdo, string $code): array
{
    $q = $pdo->prepare('SELECT id, code, name, category, unit, stock, minimum_stock, archived_at FROM inventory_items WHERE code = ?');
    $q->execute([$code]);
    $row = $q->fetch();
    if (!$row) {
        ledger_fail('That inventory item was not found.', 404);
    }
    return inventory_item_json($row, inventory_supplier_map($pdo, (int) $row['id'])[(int) $row['id']] ?? []);
}

/* ---------- Validation helpers ---------- */

/** ?id=RM-001 -> "RM-001" (422 if it is not an item code). */
function inventory_code_param(): string
{
    $code = strtoupper(trim((string) ($_GET['id'] ?? '')));
    if (!preg_match('/^RM-[0-9]{3,}$/', $code)) {
        ledger_fail('A valid item id (RM-###) is required.');
    }
    return $code;
}

function inventory_text(mixed $value, string $label, int $max, bool $required): string
{
    if ($value !== null && !is_scalar($value)) {
        ledger_fail($label . ' is not valid.');
    }
    $text = trim((string) ($value ?? ''));
    if ($required && $text === '') {
        ledger_fail($label . ' is required.');
    }
    if (mb_strlen($text) > $max) {
        ledger_fail($label . ' must be ' . $max . ' characters or fewer.');
    }
    return $text;
}

/** Same rule as the website: no two active items may share a name (ignoring upper/lower case). */
function inventory_assert_name_free(PDO $pdo, string $name, int $exceptId): void
{
    $q = $pdo->prepare('SELECT COUNT(*) FROM inventory_items WHERE archived_at IS NULL AND LOWER(name) = LOWER(?) AND id <> ?');
    $q->execute([$name, $exceptId]);
    if ((int) $q->fetchColumn() > 0) {
        ledger_fail('An item with this name already exists.', 409);
    }
}

/** [{name, contact}|null x3] -> normalised list of exactly 3 (primary, secondary, backup). */
function inventory_suppliers_normalize(mixed $raw): array
{
    if (!is_array($raw) || count($raw) > 3) {
        ledger_fail('Suppliers must be a list of up to 3 entries (primary, secondary, backup).');
    }
    $raw = array_values($raw);
    $out = [];
    for ($i = 0; $i < 3; $i++) {
        $s = $raw[$i] ?? null;
        if ($s === null || $s === '') {
            $out[] = null;
            continue;
        }
        if (!is_array($s)) {
            ledger_fail('Invalid supplier details.');
        }
        $name    = inventory_text($s['name'] ?? '', 'Supplier name', 100, false);
        $contact = inventory_text($s['contact'] ?? '', 'Supplier contact', 100, false);
        if ($name === '') {
            if ($contact !== '') {
                ledger_fail('A supplier contact requires a supplier name.');
            }
            $out[] = null;
            continue;
        }
        $out[] = ['name' => $name, 'contact' => $contact];
    }
    return $out;
}

/** Replaces the item's supplier assignments (same behaviour as Supplier/suppliers.php). */
function inventory_suppliers_save(PDO $pdo, int $itemId, array $suppliers): void
{
    $pdo->prepare('DELETE FROM item_suppliers WHERE item_id = ?')->execute([$itemId]);
    $upsert = $pdo->prepare(
        'INSERT INTO suppliers (name, contact, archived_at) VALUES (?, ?, NULL)
         ON DUPLICATE KEY UPDATE contact = VALUES(contact), archived_at = NULL'
    );
    $find   = $pdo->prepare('SELECT id FROM suppliers WHERE name = ?');
    $assign = $pdo->prepare('INSERT INTO item_suppliers (item_id, supplier_id, priority) VALUES (?, ?, ?)');
    foreach (['primary', 'secondary', 'backup'] as $i => $priority) {
        $s = $suppliers[$i] ?? null;
        if ($s === null) {
            continue;
        }
        $upsert->execute([$s['name'], $s['contact']]);
        $find->execute([$s['name']]);
        $assign->execute([$itemId, (int) $find->fetchColumn(), $priority]);
    }
}

/* ---------- Writing ---------- */

function inventory_create(PDO $pdo, array $user, array $body): never
{
    $e = $body['item'] ?? null;
    if (!is_array($e)) {
        ledger_fail('Send the item as {"item": {...}}.');
    }
    $name     = inventory_text($e['name'] ?? null, 'Item name', 100, true);
    $category = inventory_text($e['category'] ?? 'Other', 'Category', 50, false) ?: 'Other';
    $unit     = inventory_text($e['unit'] ?? 'pieces', 'Unit', 30, false) ?: 'pieces';
    $minimum  = ledger_quantity($e['minimum'] ?? null, 'Minimum stock');                       // whole number, at least 1
    $stock    = array_key_exists('stock', $e) ? ledger_quantity($e['stock'], 'Starting stock', true) : 0;
    $suppliers = array_key_exists('suppliers', $e) ? inventory_suppliers_normalize($e['suppliers']) : [];

    $lock = 'item-code';
    ledger_app_lock($pdo, $lock);   // one request at a time hands out the next RM-### code
    try {
        $pdo->beginTransaction();
        inventory_assert_name_free($pdo, $name, 0);

        $max  = (int) $pdo->query("SELECT COALESCE(MAX(CAST(SUBSTRING(code, 4) AS UNSIGNED)), 0) FROM inventory_items WHERE code REGEXP '^RM-[0-9]+$'")->fetchColumn();
        $code = 'RM-' . str_pad((string) ($max + 1), 3, '0', STR_PAD_LEFT);

        $pdo->prepare('INSERT INTO inventory_items (code, name, category, unit, stock, minimum_stock, archived_at) VALUES (?, ?, ?, ?, ?, ?, NULL)')
            ->execute([$code, $name, $category, $unit, $stock, $minimum]);
        $itemId = (int) $pdo->lastInsertId();

        // An item added during a shift gets its opening stock fixed now, so later restocks are not counted as opening stock.
        $shift = ledger_open_shift($pdo);
        if ($shift !== null) {
            $pdo->prepare('INSERT INTO shift_opening_stocks (shift_id, item_id, quantity) VALUES (?, ?, ?)')
                ->execute([(int) $shift['id'], $itemId, $stock]);
        }
        if ($suppliers) {
            inventory_suppliers_save($pdo, $itemId, $suppliers);
        }
        audit_log('Inventory Catalog', 'Item Added', $code . ' - ' . $name,
            sprintf('Added item with minimum threshold of %d. Starting stock: %d %s.', $minimum, $stock, $unit), $user);
        $pdo->commit();
    } catch (Throwable $ex) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        ledger_app_unlock($pdo, $lock);
        throw $ex;
    }
    ledger_app_unlock($pdo, $lock);
    json_out(['ok' => true, 'item' => inventory_load($pdo, $code)], 201);
}

function inventory_update(PDO $pdo, array $user, string $code, array $body): never
{
    $e = $body['item'] ?? null;
    if (!is_array($e)) {
        ledger_fail('Send the changes as {"item": {...}}.');
    }
    if (array_key_exists('stock', $e)) {
        ledger_fail('Stock cannot be set here. It changes through restocks, waste and stock counts.');
    }
    $fields = array_intersect(['name', 'category', 'unit', 'minimum', 'suppliers'], array_keys($e));
    if (!$fields) {
        ledger_fail('Send at least one of: name, category, unit, minimum, suppliers.');
    }
    $new = [];
    if (array_key_exists('name', $e))     $new['name']     = inventory_text($e['name'], 'Item name', 100, true);
    if (array_key_exists('category', $e)) $new['category'] = inventory_text($e['category'], 'Category', 50, false) ?: 'Other';
    if (array_key_exists('unit', $e))     $new['unit']     = inventory_text($e['unit'], 'Unit', 30, false) ?: 'pieces';
    if (array_key_exists('minimum', $e))  $new['minimum']  = ledger_quantity($e['minimum'], 'Minimum stock');
    $suppliers = array_key_exists('suppliers', $e) ? inventory_suppliers_normalize($e['suppliers']) : null;

    try {
        $pdo->beginTransaction();
        $q = $pdo->prepare('SELECT id, code, name, category, unit, minimum_stock, archived_at FROM inventory_items WHERE code = ? FOR UPDATE');
        $q->execute([$code]);
        $old = $q->fetch();
        if (!$old) {
            ledger_fail('That inventory item was not found.', 404);
        }
        if ($old['archived_at'] !== null) {
            ledger_fail('This item is archived. Restore it before editing.', 409);
        }
        $itemId = (int) $old['id'];
        if (isset($new['name'])) {
            inventory_assert_name_free($pdo, $new['name'], $itemId);
        }

        $changes = [];
        if (isset($new['name'])     && $new['name'] !== $old['name'])         $changes[] = 'name "' . $old['name'] . '" to "' . $new['name'] . '"';
        if (isset($new['category']) && $new['category'] !== $old['category']) $changes[] = 'category "' . $old['category'] . '" to "' . $new['category'] . '"';
        if (isset($new['unit'])     && $new['unit'] !== $old['unit'])         $changes[] = 'unit "' . $old['unit'] . '" to "' . $new['unit'] . '"';
        if (isset($new['minimum'])  && (float) $new['minimum'] !== (float) $old['minimum_stock']) {
            $changes[] = 'minimum ' . ((float) $old['minimum_stock'] + 0) . ' to ' . $new['minimum'];
        }

        $set = [
            'name'          => $new['name']     ?? $old['name'],
            'category'      => $new['category'] ?? $old['category'],
            'unit'          => $new['unit']     ?? $old['unit'],
            'minimum_stock' => $new['minimum']  ?? $old['minimum_stock'],
        ];
        // Stock is deliberately left out of this statement.
        $pdo->prepare('UPDATE inventory_items SET name = ?, category = ?, unit = ?, minimum_stock = ? WHERE id = ?')
            ->execute([$set['name'], $set['category'], $set['unit'], $set['minimum_stock'], $itemId]);
        if ($suppliers !== null) {
            inventory_suppliers_save($pdo, $itemId, $suppliers);
            $changes[] = 'suppliers';
        }
        if ($changes) {
            audit_log('Inventory Catalog', 'Item Updated', $code . ' - ' . $set['name'], 'Updated ' . implode(', ', $changes) . '.', $user);
        }
        $pdo->commit();
    } catch (Throwable $ex) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $ex;
    }
    json_out(['ok' => true, 'item' => inventory_load($pdo, $code)]);
}

function inventory_archive(PDO $pdo, array $user, string $code, array $body): never
{
    $reason = inventory_text($body['reason'] ?? '', 'Reason', 200, false);
    try {
        $pdo->beginTransaction();
        $q = $pdo->prepare('SELECT id, code, name, archived_at FROM inventory_items WHERE code = ? FOR UPDATE');
        $q->execute([$code]);
        $row = $q->fetch();
        if (!$row) {
            ledger_fail('That inventory item was not found.', 404);
        }
        if ($row['archived_at'] !== null) {
            ledger_fail('This item is already archived.', 409);
        }
        $pdo->prepare('UPDATE inventory_items SET archived_at = ? WHERE id = ?')->execute([date('Y-m-d H:i:s'), (int) $row['id']]);

        $h = $pdo->prepare('SELECT (SELECT COUNT(*) FROM restocks WHERE item_id = ?) + (SELECT COUNT(*) FROM wastes WHERE item_id = ?) + (SELECT COUNT(*) FROM stock_counts WHERE item_id = ?)');
        $h->execute([(int) $row['id'], (int) $row['id'], (int) $row['id']]);
        $hasHistory = (int) $h->fetchColumn() > 0;
        audit_log('Inventory Catalog', 'Item Archived', (string) $row['name'],
            ($hasHistory
                ? 'Archived raw material ' . $code . ' while preserving historical movement logs.'
                : 'Archived raw material ' . $code . '.') . ($reason !== '' ? ' Reason: ' . $reason . '.' : ''),
            $user);
        $pdo->commit();
    } catch (Throwable $ex) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $ex;
    }
    json_out(['ok' => true, 'item' => inventory_load($pdo, $code)]);
}

function inventory_restore(PDO $pdo, array $user, string $code): never
{
    try {
        $pdo->beginTransaction();
        $shift = ledger_open_shift($pdo);   // shift first, then the item: the same lock order stock counts use
        $q = $pdo->prepare('SELECT id, code, name, stock, archived_at FROM inventory_items WHERE code = ? FOR UPDATE');
        $q->execute([$code]);
        $row = $q->fetch();
        if (!$row) {
            ledger_fail('That inventory item was not found.', 404);
        }
        if ($row['archived_at'] === null) {
            ledger_fail('This item is not archived.', 409);
        }
        inventory_assert_name_free($pdo, (string) $row['name'], (int) $row['id']);
        $pdo->prepare('UPDATE inventory_items SET archived_at = NULL WHERE id = ?')->execute([(int) $row['id']]);

        // Restored during a shift: fix its opening stock now (stock was frozen while it was archived).
        if ($shift !== null) {
            $has = $pdo->prepare('SELECT COUNT(*) FROM shift_opening_stocks WHERE shift_id = ? AND item_id = ?');
            $has->execute([(int) $shift['id'], (int) $row['id']]);
            if ((int) $has->fetchColumn() === 0) {
                $pdo->prepare('INSERT INTO shift_opening_stocks (shift_id, item_id, quantity) VALUES (?, ?, ?)')
                    ->execute([(int) $shift['id'], (int) $row['id'], max(0.0, (float) $row['stock'])]);
            }
        }
        audit_log('Inventory Catalog', 'Item Restored', (string) $row['name'], 'Restored raw material ' . $code . '.', $user);
        $pdo->commit();
    } catch (Throwable $ex) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $ex;
    }
    json_out(['ok' => true, 'item' => inventory_load($pdo, $code)]);
}

/* ---------- Routing ---------- */

$user   = require_login();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    if (($_GET['id'] ?? '') !== '') {
        json_out(['ok' => true, 'item' => inventory_load(db(), inventory_code_param())]);
    }
    $items = db()->query(
        'SELECT id, code, name, category, unit, stock, minimum_stock, archived_at
         FROM inventory_items
         ORDER BY id'
    )->fetchAll();
    $supplierMap = inventory_supplier_map(db());

    $active = [];
    $archived = [];
    foreach ($items as $row) {
        $item = inventory_item_json($row, $supplierMap[(int) $row['id']] ?? []);
        if ($row['archived_at'] !== null) {
            $archived[] = $item;
        } else {
            $active[] = $item;
        }
    }
    json_out(['ok' => true, 'items' => $active, 'archived' => $archived]);
}

if (!in_array($method, ['POST', 'PUT'], true)) {
    header('Allow: GET, POST, PUT');
    json_out(['ok' => false, 'error' => 'Method not allowed.'], 405);
}
require_same_origin();
require_csrf();
$pdo = db();

$action = trim((string) ($_GET['action'] ?? ''));
if ($method === 'PUT') {
    inventory_update($pdo, $user, inventory_code_param(), read_json_body());
}
if ($action === 'archive' || $action === 'restore') {
    $code = inventory_code_param();
    if ($action === 'archive') {
        $raw = file_get_contents('php://input', false, null, 0, 65536);
        $opt = ($raw === false || trim($raw) === '') ? [] : json_decode($raw, true);
        inventory_archive($pdo, $user, $code, is_array($opt) ? $opt : []);
    }
    inventory_restore($pdo, $user, $code);
}
if ($action !== '') {
    ledger_fail('Unknown action. Use ?action=archive or ?action=restore.', 400);
}

$body = read_json_body();
if (isset($body['item']) && is_array($body['item'])) {
    inventory_create($pdo, $user, $body);
}

/* ---------- OLD behaviour, website only: save the whole catalog ---------- */
if (!array_key_exists('items', $body)) {
    ledger_fail('Send {"item": {...}} to add an item.');
}
if (auth_via_token()) {
    ledger_fail('Saving the whole catalog is not available to mobile clients. Use the per-item requests.', 403);
}
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
