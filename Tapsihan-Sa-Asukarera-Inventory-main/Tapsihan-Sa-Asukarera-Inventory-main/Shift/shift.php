<?php
declare(strict_types=1);
require dirname(__DIR__) . '/includes/bootstrap.php';
require dirname(__DIR__) . '/includes/ledger.php';

/*
 * Shifts
 *   GET   shift.php               all shifts, newest first (each with its opening stock per item)
 *   GET   shift.php?current=1     {"shift": {...}} for the open shift, or {"shift": null}
 *   POST  shift.php?action=start  start a shift. Body is optional ({}).
 *   POST  shift.php?action=end    end the open shift. Body optional: {"shiftId": "SHIFT-..."}
 *
 * start: the server refuses if a shift is already open, takes each active item's opening stock from
 *        the current inventory, and sets the date and start time itself.
 * end:   the server refuses unless every active item has a saved closing count for this shift, those
 *        counts still match the shift's restocks and waste, and a reconciliation has been saved.
 *        It then closes the shift, stamps the end time and writes the audit entry.
 * The app never sends stock numbers, times or a shift code. "shiftId" on end only means
 * "the shift my app thinks is open": if it is not the open one, the request gets 409.
 *
 * The old POST {"shifts": [...]} (save the whole list, written from the browser) is RETIRED and now
 * answers 410. The website starts and ends shifts with the two calls above, like the mobile app.
 */

function shift_json(array $row, array $opening): array
{
    return [
        'id'            => $row['code'],
        'databaseId'    => (int) $row['id'],
        'date'          => $row['shift_date'],
        'startTime'     => str_replace(' ', 'T', (string) $row['start_time']),
        'endTime'       => $row['end_time'] ? str_replace(' ', 'T', (string) $row['end_time']) : null,
        'status'        => $row['status'],
        'openingStocks' => (object) $opening,   // {} (not []) when empty, so apps always get an object
    ];
}

function shift_opening_map(PDO $pdo, ?int $shiftId = null): array
{
    $sql = 'SELECT so.shift_id, i.code, so.quantity FROM shift_opening_stocks so JOIN inventory_items i ON i.id = so.item_id';
    $q = $pdo->prepare($sql . ($shiftId !== null ? ' WHERE so.shift_id = ?' : ''));
    $q->execute($shiftId !== null ? [$shiftId] : []);
    $map = [];
    foreach ($q->fetchAll() as $r) {
        $map[(int) $r['shift_id']][$r['code']] = (float) $r['quantity'];
    }
    return $map;
}

function shift_by_id(PDO $pdo, int $id): array
{
    $q = $pdo->prepare('SELECT id, code, shift_date, start_time, end_time, status FROM shifts WHERE id = ?');
    $q->execute([$id]);
    return shift_json($q->fetch(), shift_opening_map($pdo, $id)[$id] ?? []);
}

/** Body for start/end is optional: an empty body means {}. */
function shift_optional_body(): array
{
    $raw = file_get_contents('php://input', false, null, 0, 65536);
    if ($raw === false || trim($raw) === '') {
        return [];
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        ledger_fail('Invalid request.', 400);
    }
    return $data;
}

function shift_start(PDO $pdo, array $user): never
{
    $lock = 'shift';
    ledger_app_lock($pdo, $lock);   // there is no OPEN row to lock yet, so two phones starting at once need this
    try {
        $pdo->beginTransaction();
        $open = ledger_open_shift($pdo);
        if ($open !== null) {
            $pdo->rollBack();
            ledger_app_unlock($pdo, $lock);
            ledger_fail('A shift is already open (' . $open['code'] . '). End it before starting a new one.', 409);
        }

        // Lock every active item, in id order, so no restock or count can slip in while opening stock is read.
        $items = $pdo->query('SELECT id, code, stock FROM inventory_items WHERE archived_at IS NULL ORDER BY id FOR UPDATE')->fetchAll();

        $code = 'SHIFT-' . (int) round(microtime(true) * 1000);
        $pdo->prepare(
            "INSERT INTO shifts (code, shift_date, start_time, end_time, status, opened_by, closed_by)
             VALUES (?, ?, ?, NULL, 'OPEN', ?, NULL)"
        )->execute([$code, date('Y-m-d'), date('Y-m-d H:i:s'), $user['id']]);
        $shiftId = (int) $pdo->lastInsertId();

        $ins = $pdo->prepare('INSERT INTO shift_opening_stocks (shift_id, item_id, quantity) VALUES (?, ?, ?)');
        foreach ($items as $it) {
            $ins->execute([$shiftId, (int) $it['id'], max(0.0, (float) $it['stock'])]);
        }

        $date = date('Y-m-d');
        audit_log('Shift', 'Shift Started', $code, 'Started shift for ' . $date . '.', $user);
        $pdo->commit();
    } catch (Throwable $ex) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        ledger_app_unlock($pdo, $lock);
        throw $ex;
    }
    ledger_app_unlock($pdo, $lock);
    json_out(['ok' => true, 'shift' => shift_by_id($pdo, $shiftId)], 201);
}

function shift_end(PDO $pdo, array $user, array $body): never
{
    $sent = trim((string) ($body['shiftId'] ?? ''));
    try {
        $pdo->beginTransaction();
        $shift = ledger_open_shift($pdo);   // locks the open shift row: restocks, waste and counts wait for this to finish
        if ($shift === null) {
            ledger_fail('There is no active shift to end.', 409);
        }
        if ($sent !== '' && $sent !== $shift['code']) {
            ledger_fail('That shift is no longer open. Reload the data and try again.', 409);
        }
        $shiftId = (int) $shift['id'];

        // 1. Every active item needs a saved closing count for this shift.
        $q = $pdo->prepare(
            'SELECT i.code, i.name FROM inventory_items i
             WHERE i.archived_at IS NULL
               AND NOT EXISTS (SELECT 1 FROM stock_counts c WHERE c.shift_id = ? AND c.item_id = i.id AND c.closing IS NOT NULL)
             ORDER BY i.id'
        );
        $q->execute([$shiftId]);
        $missing = $q->fetchAll();
        if ($missing) {
            $names = array_map(fn($m) => $m['name'], array_slice($missing, 0, 10));
            $more  = count($missing) > 10 ? ' and ' . (count($missing) - 10) . ' more' : '';
            $pdo->rollBack();
            json_out([
                'ok'            => false,
                'error'         => 'Record a closing stock count for every inventory item before ending the shift: ' . implode(', ', $names) . $more . '.',
                'missingCounts' => array_map(fn($m) => ['itemId' => $m['code'], 'item' => $m['name']], $missing),
            ], 422);
        }

        // 2. The saved counts must still match this shift's restocks and waste.
        //    (A restock or waste entry changed after counting would make "consumed" wrong.)
        $q = $pdo->prepare(
            'SELECT i.code, i.name
             FROM stock_counts c
             JOIN inventory_items i ON i.id = c.item_id
             WHERE c.shift_id = ? AND i.archived_at IS NULL
               AND (c.restocks <> (SELECT COALESCE(SUM(r.quantity), 0) FROM restocks r WHERE r.shift_id = c.shift_id AND r.item_id = c.item_id)
                 OR c.spoilage <> (SELECT COALESCE(SUM(w.quantity), 0) FROM wastes w WHERE w.shift_id = c.shift_id AND w.item_id = c.item_id))
             ORDER BY i.id'
        );
        $q->execute([$shiftId]);
        $stale = $q->fetchAll();
        if ($stale) {
            $names = array_map(fn($m) => $m['name'], array_slice($stale, 0, 10));
            $pdo->rollBack();
            json_out([
                'ok'          => false,
                'error'       => 'Restocks or waste changed after these items were counted. Save their closing counts again: ' . implode(', ', $names) . '.',
                'staleCounts' => array_map(fn($m) => ['itemId' => $m['code'], 'item' => $m['name']], $stale),
            ], 422);
        }

        // 3. A reconciliation must have been saved for this shift.
        $q = $pdo->prepare('SELECT expected_revenue, total_collected, variance FROM reconciliations WHERE shift_id = ?');
        $q->execute([$shiftId]);
        $rc = $q->fetch();
        if (!$rc) {
            $pdo->rollBack();
            json_out(['ok' => false, 'error' => 'Please complete reconciliation before ending the shift.', 'needsReconciliation' => true], 422);
        }

        // Close it. The end time is the server's clock.
        $pdo->prepare("UPDATE shifts SET status = 'CLOSED', end_time = ?, closed_by = ? WHERE id = ? AND status = 'OPEN'")
            ->execute([date('Y-m-d H:i:s'), $user['id'], $shiftId]);
        $extra = sprintf(' Expected revenue: ₱%.2f | Total collected: ₱%.2f | Variance: ₱%.2f.',
            $rc['expected_revenue'], $rc['total_collected'], $rc['variance']);
        audit_log('Shift', 'Shift Ended', $shift['code'], 'Ended shift for ' . $shift['shift_date'] . '.' . $extra, $user);
        $pdo->commit();
    } catch (Throwable $ex) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $ex;
    }
    json_out([
        'ok'             => true,
        'shift'          => shift_by_id($pdo, $shiftId),
        'reconciliation' => [
            'expectedRevenue' => (float) $rc['expected_revenue'],
            'totalCollected'  => (float) $rc['total_collected'],
            'variance'        => (float) $rc['variance'],
        ],
    ]);
}

/* ---------- Routing ---------- */

$user   = require_page_access('shift');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'GET') {
    if (($_GET['current'] ?? '') !== '') {
        $row = db()->query("SELECT id, code, shift_date, start_time, end_time, status FROM shifts WHERE status = 'OPEN' LIMIT 1")->fetch();
        json_out(['ok' => true, 'shift' => $row ? shift_json($row, shift_opening_map(db(), (int) $row['id'])[(int) $row['id']] ?? []) : null]);
    }
    $rows = db()->query('SELECT id, code, shift_date, start_time, end_time, status FROM shifts ORDER BY id DESC')->fetchAll();
    $openMap = shift_opening_map(db());
    $out = [];
    foreach ($rows as $r) {
        $out[] = shift_json($r, $openMap[(int) $r['id']] ?? []);
    }
    json_out(['ok' => true, 'shifts' => $out]);
}
if ($method !== 'POST') { header('Allow: GET, POST'); json_out(['ok'=>false,'error'=>'Method not allowed.'],405); }
require_same_origin(); require_csrf();

$action = trim((string) ($_GET['action'] ?? ''));
if ($action === 'start') {
    shift_start(db(), $user);
}
if ($action === 'end') {
    shift_end(db(), $user, shift_optional_body());
}
if ($action !== '') {
    ledger_fail('Unknown action. Use ?action=start or ?action=end.', 400);
}

/* Saving the whole shift list was RETIRED: shifts are started and ended with ?action=start and ?action=end.
 * An old cached page that still sends the list is told to refresh instead of overwriting shifts. */
ledger_fail('This page is out of date. Refresh it (Ctrl+F5) and try again.', 410);
