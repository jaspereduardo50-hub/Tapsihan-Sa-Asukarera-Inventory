<?php
declare(strict_types=1);
require dirname(__DIR__) . '/includes/bootstrap.php';
require dirname(__DIR__) . '/includes/ledger.php';

/*
 * Restocks
 *   GET    restocks.php[?shiftId=SHIFT-CODE]   list
 *   POST   restocks.php   {"restock": {itemId, quantity, supplier?, shiftId?}}   add one
 *   PUT    restocks.php?id=RESTOCK-12   {"restock": {itemId?, quantity?, supplier?}}   change one
 *   DELETE restocks.php?id=RESTOCK-12   remove one
 * Stock levels, shift, date, lock rules and audit entries are all handled here.
 *
 * The old POST {"restocks": [...]} (replace the whole table) is kept only so the current website
 * keeps working until its pages move to the calls above. Token (mobile) requests cannot use it.
 */

function restock_create(PDO $pdo, array $user, array $body): never
{
    $e = $body['restock'] ?? null;
    if (!is_array($e)) {
        ledger_fail('Send the restock as {"restock": {...}}.');
    }
    $qty      = ledger_quantity($e['quantity'] ?? null, 'Restock quantity');
    $supplier = mb_substr(trim((string) ($e['supplier'] ?? '')), 0, 100);
    $item     = ledger_find_item($pdo, (string) ($e['itemId'] ?? ''));

    try {
        $pdo->beginTransaction();
        $shift = ledger_resolve_shift($pdo, $e, false);      // restocks are allowed before a shift starts
        ledger_lock_items($pdo, [(int) $item['id']]);
        $pdo->prepare(
            'INSERT INTO restocks (shift_id, item_id, restock_date, quantity, supplier_name, recorded_by, recorded_role, recorded_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, NOW())'
        )->execute([
            $shift ? (int) $shift['id'] : null,
            (int) $item['id'],
            $shift ? $shift['shift_date'] : date('Y-m-d'),
            $qty,
            $supplier,
            $user['id'],
            ledger_role_label($user),
        ]);
        $id = (int) $pdo->lastInsertId();
        ledger_add_stock($pdo, (int) $item['id'], $qty);
        audit_log('Restock', 'Restock Added', $item['code'] . ' - ' . $item['name'],
            sprintf('Added restock of %d %s. Supplier: %s.', $qty, $item['unit'], $supplier !== '' ? $supplier : 'Not specified'),
            $user);
        $pdo->commit();
    } catch (Throwable $ex) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $ex;
    }
    json_out(['ok' => true, 'restock' => ledger_restock_by_id($pdo, $id), 'itemStock' => ledger_item_stock($pdo, (int) $item['id'])], 201);
}

function restock_update(PDO $pdo, array $user, int $id, array $body): never
{
    $e = $body['restock'] ?? null;
    if (!is_array($e)) {
        ledger_fail('Send the changes as {"restock": {...}}.');
    }
    try {
        $pdo->beginTransaction();
        $q = $pdo->prepare('SELECT * FROM restocks WHERE id = ? FOR UPDATE');
        $q->execute([$id]);
        $old = $q->fetch();
        if (!$old) {
            ledger_fail('Restock not found.', 404);
        }
        if (ledger_entry_locked($pdo, $old['shift_id'] === null ? null : (int) $old['shift_id'], (string) $old['recorded_at'])) {
            ledger_fail(LEDGER_LOCKED_MESSAGE, 409);
        }

        $oldItemId = (int) $old['item_id'];
        $oldQty    = (float) $old['quantity'];
        $newItemId = array_key_exists('itemId', $e) ? (int) ledger_find_item($pdo, (string) $e['itemId'])['id'] : $oldItemId;
        $newQty    = array_key_exists('quantity', $e) ? ledger_quantity($e['quantity'], 'Restock quantity') : $oldQty;
        $supplier  = array_key_exists('supplier', $e) ? mb_substr(trim((string) $e['supplier']), 0, 100) : (string) $old['supplier_name'];

        $items = ledger_lock_items($pdo, [$oldItemId, $newItemId]);
        if (!isset($items[$newItemId])) {
            ledger_fail('That inventory item was not found.', 404);
        }
        if ($newItemId === $oldItemId) {
            ledger_add_stock($pdo, $newItemId, $newQty - $oldQty);
        } else {
            ledger_add_stock($pdo, $oldItemId, -$oldQty);
            ledger_add_stock($pdo, $newItemId, $newQty);
        }
        $pdo->prepare('UPDATE restocks SET item_id = ?, quantity = ?, supplier_name = ? WHERE id = ?')
            ->execute([$newItemId, $newQty, $supplier, $id]);

        $item = $items[$newItemId];
        audit_log('Restock', 'Restock Updated', $item['code'] . ' - ' . $item['name'],
            sprintf('Updated restock quantity from %s to %s %s. Supplier: %s.', $oldQty + 0, $newQty + 0, $item['unit'], $supplier !== '' ? $supplier : 'Not specified'),
            $user);
        $pdo->commit();
    } catch (Throwable $ex) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $ex;
    }
    json_out(['ok' => true, 'restock' => ledger_restock_by_id($pdo, $id), 'itemStock' => ledger_item_stock($pdo, $newItemId)]);
}

function restock_delete(PDO $pdo, array $user, int $id): never
{
    try {
        $pdo->beginTransaction();
        $q = $pdo->prepare('SELECT * FROM restocks WHERE id = ? FOR UPDATE');
        $q->execute([$id]);
        $old = $q->fetch();
        if (!$old) {
            ledger_fail('Restock not found.', 404);
        }
        if (ledger_entry_locked($pdo, $old['shift_id'] === null ? null : (int) $old['shift_id'], (string) $old['recorded_at'])) {
            ledger_fail(LEDGER_LOCKED_MESSAGE, 409);
        }
        $itemId = (int) $old['item_id'];
        $items  = ledger_lock_items($pdo, [$itemId]);
        $item   = $items[$itemId];
        ledger_add_stock($pdo, $itemId, -((float) $old['quantity']));   // removing a restock lowers stock (never below 0)
        $pdo->prepare('DELETE FROM restocks WHERE id = ?')->execute([$id]);
        audit_log('Restock', 'Restock Deleted', $item['code'] . ' - ' . $item['name'],
            sprintf('Deleted restock of %s %s. Supplier: %s.', (float) $old['quantity'] + 0, $item['unit'], $old['supplier_name'] !== '' ? $old['supplier_name'] : 'Not specified'),
            $user);
        $pdo->commit();
    } catch (Throwable $ex) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $ex;
    }
    json_out(['ok' => true, 'deleted' => 'RESTOCK-' . $id, 'itemStock' => ledger_item_stock($pdo, $itemId)]);
}

/** OLD behaviour, website only: wipes the table and re-inserts whatever the browser sends. */
function restocks_replace_all(array $body, array $user): never
{
    if (auth_via_token()) {
        ledger_fail('Replace-all saving is not available to mobile clients. Use per-record requests.', 403);
    }
    $pdo = db();
    $inventorySnapshot = $body['inventory'] ?? null;
    $entries=$body['restocks']??null;if(!is_array($entries)||count($entries)>10000)json_out(['ok'=>false,'error'=>'Invalid restock data.'],422);
    try{$pdo->beginTransaction();$pdo->exec('DELETE FROM restocks');$findItem=$pdo->prepare('SELECT id FROM inventory_items WHERE code=?');$findShift=$pdo->prepare('SELECT id FROM shifts WHERE code=?');$ins=$pdo->prepare('INSERT INTO restocks (shift_id,item_id,restock_date,quantity,supplier_name,recorded_by,recorded_role,recorded_at) VALUES (?,?,?,?,?,?,?,?)');foreach($entries as $e){if(!is_array($e))continue;$findItem->execute([(string)($e['itemId']??'')]);$iid=$findItem->fetchColumn();if(!$iid)continue;$shiftId=null;if(!empty($e['shiftId'])){$findShift->execute([(string)$e['shiftId']]);$shiftId=$findShift->fetchColumn()?:null;}$qty=(float)($e['quantity']??0);if($qty<=0)continue;$ins->execute([$shiftId,$iid,(string)($e['date']??date('Y-m-d')),$qty,substr((string)($e['supplier']??''),0,100),$user['id'],(string)($e['recordedRole']??$user['role']),recorded_at_value($e['recordedAt']??null)]);}if (is_array($inventorySnapshot)) { $stockUpdate=$pdo->prepare('UPDATE inventory_items SET stock=? WHERE code=?'); foreach($inventorySnapshot as $it){ if(is_array($it) && isset($it['id']) && is_numeric($it['stock']??null) && (float)$it['stock']>=0) $stockUpdate->execute([(float)$it['stock'],(string)$it['id']]); } }
     $pdo->commit();json_out(['ok'=>true,'saved'=>count($entries)]);}catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
}

/* ---------- Routing ---------- */

$user   = require_login();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    $sql  = LEDGER_RESTOCK_SELECT;
    $args = [];
    $shiftCode = trim((string) ($_GET['shiftId'] ?? ''));
    if ($shiftCode !== '') {
        $sql .= ' WHERE s.code = ?';
        $args[] = $shiftCode;
    }
    $q = db()->prepare($sql . ' ORDER BY r.id');
    $q->execute($args);
    json_out(['ok' => true, 'restocks' => array_map('ledger_restock_json', $q->fetchAll())]);
}

if (!in_array($method, ['POST', 'PUT', 'DELETE'], true)) {
    header('Allow: GET, POST, PUT, DELETE');
    json_out(['ok' => false, 'error' => 'Method not allowed.'], 405);
}
require_same_origin();
require_csrf();
$pdo = db();

if ($method === 'DELETE') {
    restock_delete($pdo, $user, ledger_record_id('RESTOCK'));
}
$body = read_json_body();
if ($method === 'PUT') {
    restock_update($pdo, $user, ledger_record_id('RESTOCK'), $body);
}
if (array_key_exists('restocks', $body)) {
    restocks_replace_all($body, $user);
}
restock_create($pdo, $user, $body);
