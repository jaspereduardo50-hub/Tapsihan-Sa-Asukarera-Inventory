<?php
declare(strict_types=1);
require dirname(__DIR__) . '/includes/bootstrap.php';
require dirname(__DIR__) . '/includes/ledger.php';

/*
 * Stock counts (one record per shift + item)
 *   GET    stock-counts.php[?shiftId=SHIFT-CODE]   list
 *   POST   stock-counts.php   {"stockCount": {itemId, closing, opening?, shiftId?}}   save one (create or update)
 *   POST   stock-counts.php   {"counts": [ {itemId, closing, opening?}, ... ], "shiftId"?: "..."}   save several, all or nothing
 *   PUT    stock-counts.php   same bodies as POST (saving is idempotent: same shift + item updates the record)
 *   DELETE stock-counts.php?shiftId=SHIFT-CODE&itemId=ITEM-CODE   remove one
 * The app sends only what a person types (opening, closing). Restock totals, waste totals,
 * consumed amount and the item's new stock level are calculated here.
 * The old POST {"stockCounts": [...]} (replace the whole table) is RETIRED and now answers 410.
 */

function stockcount_save(PDO $pdo, array $user, array $entries, string $sentShiftId): never
{
    if (count($entries) < 1 || count($entries) > 500) {
        ledger_fail('Send between 1 and 500 stock counts.');
    }
    $saved = [];
    $stocks = [];
    try {
        $pdo->beginTransaction();
        $shift = ledger_resolve_shift($pdo, ['shiftId' => $sentShiftId], true);   // counts only go into the open shift
        $shiftId = (int) $shift['id'];

        $found = [];
        foreach ($entries as $i => $e) {
            if (!is_array($e)) {
                ledger_fail('Stock count #' . ($i + 1) . ' is not valid.');
            }
            $found[$i] = ledger_find_item($pdo, (string) ($e['itemId'] ?? ''));
        }
        $locked = ledger_lock_items($pdo, array_map(fn($it) => (int) $it['id'], $found));

        $get    = $pdo->prepare('SELECT * FROM stock_counts WHERE shift_id = ? AND item_id = ? FOR UPDATE');
        $shiftOpening = $pdo->prepare('SELECT quantity FROM shift_opening_stocks WHERE shift_id = ? AND item_id = ?');
        $upsert = $pdo->prepare(
            'INSERT INTO stock_counts (shift_id, item_id, count_date, opening, restocks, spoilage, closing, consumed, recorded_by, recorded_role, recorded_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
             ON DUPLICATE KEY UPDATE count_date = VALUES(count_date), opening = VALUES(opening), restocks = VALUES(restocks),
                 spoilage = VALUES(spoilage), closing = VALUES(closing), consumed = VALUES(consumed),
                 recorded_by = VALUES(recorded_by), recorded_role = VALUES(recorded_role), recorded_at = NOW()'
        );
        $setStock = $pdo->prepare('UPDATE inventory_items SET stock = ? WHERE id = ?');

        foreach ($entries as $i => $e) {
            $item   = $locked[(int) $found[$i]['id']];
            $itemId = (int) $item['id'];
            $name   = (string) $item['name'];

            $get->execute([$shiftId, $itemId]);
            $existing = $get->fetch();

            // Opening: what the person typed, else the existing count, else the stock recorded when the shift started.
            if (array_key_exists('opening', $e) && $e['opening'] !== null && $e['opening'] !== '') {
                $opening = ledger_quantity($e['opening'], $name . ' opening stock', true);
            } elseif ($existing) {
                $opening = (float) $existing['opening'];
            } else {
                $shiftOpening->execute([$shiftId, $itemId]);
                $fromShift = $shiftOpening->fetchColumn();
                $opening = $fromShift !== false ? (float) $fromShift : max(0.0, (float) $item['stock']);
            }
            $closing = ledger_quantity($e['closing'] ?? null, $name . ' closing stock', true);

            $totals = ledger_shift_totals($pdo, $shiftId, $itemId);
            if ($totals['spoilage'] > $opening + $totals['restocks']) {
                ledger_fail($name . ' waste cannot exceed opening stock plus restocks.');
            }
            $available = $opening + $totals['restocks'] - $totals['spoilage'];
            if ($closing > $available) {
                ledger_fail(sprintf(
                    '%s closing stock cannot be greater than its available stock. Opening: %s, Restocks: %s, Waste: %s, Available: %s, Closing: %s.',
                    $name, $opening + 0, $totals['restocks'] + 0, $totals['spoilage'] + 0, $available + 0, $closing
                ));
            }
            $consumed = $available - $closing;   // (opening + restocks) - waste - closing

            $upsert->execute([
                $shiftId, $itemId, $shift['shift_date'], $opening, $totals['restocks'], $totals['spoilage'],
                $closing, $consumed, $user['id'], ledger_role_label($user),
            ]);
            $setStock->execute([$closing, $itemId]);    // the counted closing stock becomes the item's stock

            $target = $item['code'] . ' - ' . $name;
            if (!$existing) {
                audit_log('Stock Count', 'Stock Count Saved', $target,
                    sprintf('Saved stock count. Opening: %s, Closing: %s.', $opening + 0, $closing), $user);
            } elseif ((float) $existing['opening'] !== (float) $opening || (float) $existing['closing'] !== (float) $closing) {
                audit_log('Stock Count', 'Stock Count Updated', $target,
                    sprintf('Updated stock count from Opening: %s, Closing: %s to Opening: %s, Closing: %s.',
                        (float) $existing['opening'] + 0, (float) $existing['closing'] + 0, $opening + 0, $closing), $user);
            }
            $stocks[$item['code']] = (float) $closing;
            $saved[] = [$shiftId, $itemId];
        }
        $pdo->commit();
    } catch (Throwable $ex) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $ex;
    }
    $out = [];
    foreach ($saved as [$sid, $iid]) {
        $out[] = ledger_count_by_keys($pdo, $sid, $iid);
    }
    json_out(['ok' => true, 'stockCounts' => $out, 'itemStock' => $stocks]);
}

function stockcount_delete(PDO $pdo, array $user, string $shiftCode, string $itemCode): never
{
    if ($shiftCode === '' || $itemCode === '') {
        ledger_fail('shiftId and itemId are required.');
    }
    try {
        $pdo->beginTransaction();
        $q = $pdo->prepare('SELECT id, status FROM shifts WHERE code = ? FOR UPDATE');
        $q->execute([$shiftCode]);
        $shift = $q->fetch();
        if (!$shift) {
            ledger_fail('Shift not found.', 404);
        }
        if ($shift['status'] !== 'OPEN') {
            ledger_fail('This stock count belongs to a shift that has already ended, so it can no longer be removed.', 409);
        }
        $q = $pdo->prepare('SELECT id FROM inventory_items WHERE code = ?');
        $q->execute([trim($itemCode)]);
        $itemId = (int) $q->fetchColumn();
        if ($itemId === 0) {
            ledger_fail('That inventory item was not found.', 404);
        }
        $items = ledger_lock_items($pdo, [$itemId]);
        $item  = $items[$itemId];

        $q = $pdo->prepare('SELECT * FROM stock_counts WHERE shift_id = ? AND item_id = ? FOR UPDATE');
        $q->execute([(int) $shift['id'], $itemId]);
        $old = $q->fetch();
        if (!$old) {
            ledger_fail('Stock count not found.', 404);
        }
        // Without the count, the book balance is opening + restocks - waste.
        $totals   = ledger_shift_totals($pdo, (int) $shift['id'], $itemId);
        $expected = max(0.0, (float) $old['opening'] + $totals['restocks'] - $totals['spoilage']);
        $pdo->prepare('DELETE FROM stock_counts WHERE id = ?')->execute([$old['id']]);
        $pdo->prepare('UPDATE inventory_items SET stock = ? WHERE id = ?')->execute([$expected, $itemId]);
        audit_log('Stock Count', 'Stock Count Deleted', $item['code'] . ' - ' . $item['name'],
            sprintf('Deleted stock count (Opening: %s, Closing: %s). Stock set back to %s %s.',
                (float) $old['opening'] + 0, $old['closing'] === null ? '-' : (float) $old['closing'] + 0, $expected + 0, $item['unit']), $user);
        $pdo->commit();
    } catch (Throwable $ex) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $ex;
    }
    json_out(['ok' => true, 'deleted' => ['shiftId' => $shiftCode, 'itemId' => $itemCode], 'itemStock' => $expected]);
}

/** RETIRED. The website used to send its whole list and this replaced the table, which could erase data saved
 *  from another device. Pages now save one record at a time, so an old cached page is told to refresh. */
function stockcounts_replace_all(array $body, array $user): never
{
    ledger_fail('This page is out of date. Refresh it (Ctrl+F5) and try again.', 410);
}

/* ---------- Routing ---------- */

$user   = require_page_access('stock');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    $sql  = LEDGER_COUNT_SELECT;
    $args = [];
    $shiftCode = trim((string) ($_GET['shiftId'] ?? ''));
    if ($shiftCode !== '') {
        $sql .= ' WHERE s.code = ?';
        $args[] = $shiftCode;
    }
    $q = db()->prepare($sql . ' ORDER BY c.id');
    $q->execute($args);
    json_out(['ok' => true, 'stockCounts' => array_map('ledger_count_json', $q->fetchAll())]);
}

if (!in_array($method, ['POST', 'PUT', 'DELETE'], true)) {
    header('Allow: GET, POST, PUT, DELETE');
    json_out(['ok' => false, 'error' => 'Method not allowed.'], 405);
}
require_same_origin();
require_csrf();
$pdo = db();

if ($method === 'DELETE') {
    stockcount_delete($pdo, $user, trim((string) ($_GET['shiftId'] ?? '')), trim((string) ($_GET['itemId'] ?? '')));
}
$body = read_json_body();
if (array_key_exists('stockCounts', $body)) {
    stockcounts_replace_all($body, $user);
}
if (isset($body['stockCount']) && is_array($body['stockCount'])) {
    $one = $body['stockCount'];
    stockcount_save($pdo, $user, [$one], trim((string) ($one['shiftId'] ?? $body['shiftId'] ?? '')));
}
if (isset($body['counts']) && is_array($body['counts'])) {
    stockcount_save($pdo, $user, array_values($body['counts']), trim((string) ($body['shiftId'] ?? '')));
}
ledger_fail('Send {"stockCount": {...}} or {"counts": [...]}.');
