<?php
declare(strict_types=1);
require dirname(__DIR__) . '/includes/bootstrap.php';
require dirname(__DIR__) . '/includes/ledger.php';

/*
 * Waste / spoilage
 *   GET    waste_spoilage.php[?shiftId=SHIFT-CODE]   list
 *   POST   waste_spoilage.php   {"waste": {itemId, quantity, reason, shiftId?}}   log one (needs an open shift)
 *   PUT    waste_spoilage.php?id=WASTE-4   {"waste": {itemId?, quantity?, reason?}}   change one
 *   DELETE waste_spoilage.php?id=WASTE-4   remove one (stock is restored)
 * The old POST {"wastes": [...]} (replace the whole table) is RETIRED and now answers 410.
 */

function waste_reason(mixed $value): string
{
    $reason = mb_substr(trim((string) $value), 0, 255);
    if ($reason === '') {
        ledger_fail('Please choose a reason.');
    }
    return $reason;
}

function waste_create(PDO $pdo, array $user, array $body): never
{
    $e = $body['waste'] ?? null;
    if (!is_array($e)) {
        ledger_fail('Send the waste entry as {"waste": {...}}.');
    }
    $qty    = ledger_quantity($e['quantity'] ?? null, 'Waste quantity');
    $reason = waste_reason($e['reason'] ?? '');
    $item   = ledger_find_item($pdo, (string) ($e['itemId'] ?? ''));

    try {
        $pdo->beginTransaction();
        $shift = ledger_resolve_shift($pdo, $e, true);        // waste always belongs to the open shift
        $items = ledger_lock_items($pdo, [(int) $item['id']]);
        $stock = (float) $items[(int) $item['id']]['stock'];
        if ($qty > $stock) {
            ledger_fail(sprintf('Cannot log waste. Available stock for %s is only %s %s.', $item['name'], $stock + 0, $item['unit']));
        }
        $pdo->prepare(
            'INSERT INTO wastes (shift_id, item_id, waste_date, quantity, reason, recorded_by, recorded_role, recorded_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, NOW())'
        )->execute([(int) $shift['id'], (int) $item['id'], $shift['shift_date'], $qty, $reason, $user['id'], ledger_role_label($user)]);
        $id = (int) $pdo->lastInsertId();
        ledger_add_stock($pdo, (int) $item['id'], -$qty);
        audit_log('Waste / Spoilage', 'Waste Logged', $item['code'] . ' - ' . $item['name'],
            sprintf('Logged %d %s as waste with reason: %s', $qty, $item['unit'], $reason), $user);
        $pdo->commit();
    } catch (Throwable $ex) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $ex;
    }
    json_out(['ok' => true, 'waste' => ledger_waste_by_id($pdo, $id), 'itemStock' => ledger_item_stock($pdo, (int) $item['id'])], 201);
}

function waste_update(PDO $pdo, array $user, int $id, array $body): never
{
    $e = $body['waste'] ?? null;
    if (!is_array($e)) {
        ledger_fail('Send the changes as {"waste": {...}}.');
    }
    try {
        $pdo->beginTransaction();
        $q = $pdo->prepare('SELECT * FROM wastes WHERE id = ? FOR UPDATE');
        $q->execute([$id]);
        $old = $q->fetch();
        if (!$old) {
            ledger_fail('Waste record not found.', 404);
        }
        if (ledger_entry_locked($pdo, (int) $old['shift_id'], (string) $old['recorded_at'])) {
            ledger_fail(LEDGER_LOCKED_MESSAGE, 409);
        }

        $oldItemId = (int) $old['item_id'];
        $oldQty    = (float) $old['quantity'];
        $newItemId = array_key_exists('itemId', $e) ? (int) ledger_find_item($pdo, (string) $e['itemId'])['id'] : $oldItemId;
        $newQty    = array_key_exists('quantity', $e) ? ledger_quantity($e['quantity'], 'Waste quantity') : $oldQty;
        $reason    = array_key_exists('reason', $e) ? waste_reason($e['reason']) : (string) $old['reason'];

        $items = ledger_lock_items($pdo, [$oldItemId, $newItemId]);
        if (!isset($items[$newItemId])) {
            ledger_fail('That inventory item was not found.', 404);
        }
        $item = $items[$newItemId];

        // Stock available to this entry = what is on hand, plus what this entry already took (same item).
        $available = (float) $item['stock'] + ($newItemId === $oldItemId ? $oldQty : 0);
        if ($newQty > $available) {
            ledger_fail(sprintf('Cannot update waste for %s. Available stock is %s %s.', $item['name'], $available + 0, $item['unit']));
        }
        if ($newItemId === $oldItemId) {
            ledger_add_stock($pdo, $newItemId, $oldQty - $newQty);
        } else {
            ledger_add_stock($pdo, $oldItemId, $oldQty);
            ledger_add_stock($pdo, $newItemId, -$newQty);
        }
        $pdo->prepare('UPDATE wastes SET item_id = ?, quantity = ?, reason = ? WHERE id = ?')
            ->execute([$newItemId, $newQty, $reason, $id]);
        audit_log('Waste / Spoilage', 'Waste Updated', $item['code'] . ' - ' . $item['name'],
            sprintf('Updated waste quantity from %s to %s %s', $oldQty + 0, $newQty + 0, $item['unit']), $user);
        $pdo->commit();
    } catch (Throwable $ex) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $ex;
    }
    json_out(['ok' => true, 'waste' => ledger_waste_by_id($pdo, $id), 'itemStock' => ledger_item_stock($pdo, $newItemId)]);
}

function waste_delete(PDO $pdo, array $user, int $id): never
{
    try {
        $pdo->beginTransaction();
        $q = $pdo->prepare('SELECT * FROM wastes WHERE id = ? FOR UPDATE');
        $q->execute([$id]);
        $old = $q->fetch();
        if (!$old) {
            ledger_fail('Waste record not found.', 404);
        }
        if (ledger_entry_locked($pdo, (int) $old['shift_id'], (string) $old['recorded_at'])) {
            ledger_fail(LEDGER_LOCKED_MESSAGE, 409);
        }
        $itemId = (int) $old['item_id'];
        $items  = ledger_lock_items($pdo, [$itemId]);
        $item   = $items[$itemId];
        ledger_add_stock($pdo, $itemId, (float) $old['quantity']);       // deleting waste puts the stock back
        $pdo->prepare('DELETE FROM wastes WHERE id = ?')->execute([$id]);
        audit_log('Waste / Spoilage', 'Waste Deleted', $item['code'] . ' - ' . $item['name'],
            sprintf('Removed waste record for %s (%s %s) and restored stock.', $item['name'], (float) $old['quantity'] + 0, $item['unit']), $user);
        $pdo->commit();
    } catch (Throwable $ex) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $ex;
    }
    json_out(['ok' => true, 'deleted' => 'WASTE-' . $id, 'itemStock' => ledger_item_stock($pdo, $itemId)]);
}

/** RETIRED. The website used to send its whole list and this replaced the table, which could erase data saved
 *  from another device. Pages now save one record at a time, so an old cached page is told to refresh. */
function wastes_replace_all(array $body, array $user): never
{
    ledger_fail('This page is out of date. Refresh it (Ctrl+F5) and try again.', 410);
}

/* ---------- Routing ---------- */

$user   = require_page_access('waste');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    $sql  = LEDGER_WASTE_SELECT;
    $args = [];
    $shiftCode = trim((string) ($_GET['shiftId'] ?? ''));
    if ($shiftCode !== '') {
        $sql .= ' WHERE s.code = ?';
        $args[] = $shiftCode;
    }
    $q = db()->prepare($sql . ' ORDER BY w.id');
    $q->execute($args);
    json_out(['ok' => true, 'wastes' => array_map('ledger_waste_json', $q->fetchAll())]);
}

if (!in_array($method, ['POST', 'PUT', 'DELETE'], true)) {
    header('Allow: GET, POST, PUT, DELETE');
    json_out(['ok' => false, 'error' => 'Method not allowed.'], 405);
}
require_same_origin();
require_csrf();
$pdo = db();

if ($method === 'DELETE') {
    waste_delete($pdo, $user, ledger_record_id('WASTE'));
}
$body = read_json_body();
if ($method === 'PUT') {
    waste_update($pdo, $user, ledger_record_id('WASTE'), $body);
}
if (array_key_exists('wastes', $body)) {
    wastes_replace_all($body, $user);
}
waste_create($pdo, $user, $body);
