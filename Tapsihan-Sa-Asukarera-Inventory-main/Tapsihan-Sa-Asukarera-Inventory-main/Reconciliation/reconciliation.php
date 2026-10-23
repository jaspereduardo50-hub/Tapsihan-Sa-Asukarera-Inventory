<?php
declare(strict_types=1);

/*
 * Reconciliation endpoint (MySQL table: reconciliations)
 *   GET  -> all saved reconciliations, newest first
 *   GET ?action=preview[&shiftId=SHIFT-...][&actualCash=..&actualGcash=..]
 *        -> what a reconciliation for that shift would be, without saving anything (see reconciliation_preview)
 *   POST -> { records: [ {...} ], migrate: false }
 *           Saves new reconciliations. One per shift (unique key uq_recon_shift).
 *           migrate=true is used once to move old browser-only records into MySQL;
 *           duplicates and records whose shift is missing are skipped instead of failing.
 */

require dirname(__DIR__) . '/includes/bootstrap.php';

$user   = require_page_access('reconciliation');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

function reconciliation_list(): array
{
    $rows = db()->query(
        'SELECT r.*, s.code AS shift_code, u.full_name
         FROM reconciliations r
         JOIN shifts s ON s.id = r.shift_id
         LEFT JOIN users u ON u.id = r.saved_by
         ORDER BY r.saved_at DESC, r.id DESC'
    )->fetchAll();

    $out = [];
    foreach ($rows as $r) {
        $out[] = [
            'id'             => 'RECON-' . $r['id'],
            'databaseId'     => (int) $r['id'],
            'shiftId'        => $r['shift_code'],
            'date'           => $r['recon_date'],
            'expectedRevenue'=> (float) $r['expected_revenue'],
            'actualCash'     => (float) $r['actual_cash'],
            'actualGcash'    => (float) $r['actual_gcash'],
            'totalCollected' => (float) $r['total_collected'],
            'variance'       => (float) $r['variance'],
            'status'         => $r['status'],
            'ordersServed'   => $r['orders_served'] === null ? null : (int) $r['orders_served'],
            'dishVolume'     => $r['dish_volume'] === null ? null : (int) $r['dish_volume'],
            'savedBy'        => $r['full_name'] ?? '',
            'savedAt'        => str_replace(' ', 'T', (string) $r['saved_at']),
        ];
    }
    return $out;
}

/** Calculate expected revenue from the selected shift's saved counts and database menu prices.
 * The primary meat/fish ingredient determines each dish's portions, rounded down to whole portions, matching Reports.
 * Any expectedRevenue supplied by a browser/mobile client is deliberately ignored.
 */
function reconciliation_expected_revenue(PDO $pdo, int $shiftId, bool $strict = true): array
{
    $q = $pdo->prepare(
        "SELECT pm.id AS mapping_id, pm.dish_name, pm.selling_price,
                i.id AS item_id, i.name AS item_name, i.category,
                pmi.used_per_order,
                sc.opening, sc.restocks, sc.spoilage, sc.closing
         FROM portion_mappings pm
         JOIN portion_mapping_ingredients pmi ON pmi.mapping_id = pm.id
         JOIN inventory_items i ON i.id = pmi.item_id
         LEFT JOIN stock_counts sc ON sc.shift_id = ? AND sc.item_id = i.id
         WHERE i.archived_at IS NULL AND pmi.used_per_order > 0
           AND pmi.id = (
             SELECT p2.id
             FROM portion_mapping_ingredients p2
             JOIN inventory_items i2 ON i2.id = p2.item_id
             WHERE p2.mapping_id = pm.id AND i2.archived_at IS NULL AND p2.used_per_order > 0
             ORDER BY CASE WHEN LOWER(i2.category) IN ('meats','meat','fish') THEN 0 ELSE 1 END, p2.id
             LIMIT 1
           )
         ORDER BY pm.id"
    );
    $q->execute([$shiftId]);
    $rows = $q->fetchAll();
    if (!$rows) {
        if (!$strict) {
            return ['expectedRevenue' => 0.0, 'dishVolume' => 0, 'breakdown' => [], 'missingCounts' => [], 'noMappings' => true];
        }
        json_out(['ok' => false, 'error' => 'Cannot calculate expected revenue because no valid portion mappings are configured.'], 422);
    }

    $expected = 0.0;
    $dishVolume = 0;
    $breakdown = [];
    $missing = [];
    foreach ($rows as $row) {
        if ($row['closing'] === null) {
            $missing[] = $row['item_name'];
            continue;
        }
        $usedPerOrder = (float) $row['used_per_order'];
        if ($usedPerOrder <= 0) continue;
        $consumed = max(0.0, (float)$row['opening'] + (float)$row['restocks'] - (float)$row['spoilage'] - (float)$row['closing']);
        // Whole portions only (round down); leftover pieces are not counted as sold.
        $portions = (int) floor($consumed / $usedPerOrder + 0.0000001);
        $revenue = $portions * (float)$row['selling_price'];
        $expected += $revenue;
        $dishVolume += $portions;
        $breakdown[] = [
            'dishName' => $row['dish_name'],
            'sellingPrice' => (float)$row['selling_price'],
            'ingredient' => $row['item_name'],
            'ingredientConsumed' => round($consumed, 3),
            'usedPerOrder' => $usedPerOrder,
            'estimatedPortions' => $portions,
            'estimatedRevenue' => round($revenue, 2),
        ];
    }
    if ($missing && $strict) {
        json_out([
            'ok' => false,
            'error' => 'Save closing stock counts for the mapped ingredients before reconciling: ' . implode(', ', array_unique($missing)) . '.',
            'missingCounts' => array_values(array_unique($missing)),
        ], 422);
    }
    return [
        'expectedRevenue' => round($expected, 2),
        'dishVolume'      => $dishVolume,
        'breakdown'       => $breakdown,
        'missingCounts'   => array_values(array_unique($missing)),   // always empty when $strict (it exits instead)
        'noMappings'      => false,
    ];
}

function reconciliation_status(float $variance): string
{
    return $variance < 0 ? 'SHORTAGE' : ($variance > 0 ? 'OVERAGE' : 'BALANCED');
}

/**
 * Read-only preview for the mobile app (and anything else): the expected revenue for a shift, worked out
 * on the server from the shift's saved stock counts and the menu prices, exactly as a save would.
 * Saves nothing and writes no audit entry.
 *   ?shiftId=SHIFT-...   optional; defaults to the open shift
 *   ?actualCash=&actualGcash=   optional; when both are sent the response also shows the variance
 * canSave tells the app whether a save would be accepted right now; problems says what is in the way.
 */
function reconciliation_preview(PDO $pdo): never
{
    $code = trim((string) ($_GET['shiftId'] ?? ''));
    if ($code === '') {
        $shift = $pdo->query("SELECT id, code, shift_date, status FROM shifts WHERE status = 'OPEN' ORDER BY id DESC LIMIT 1")->fetch();
        if (!$shift) {
            json_out(['ok' => false, 'error' => 'No shift is open. Send ?shiftId=SHIFT-... to preview a past shift.'], 409);
        }
    } else {
        $q = $pdo->prepare('SELECT id, code, shift_date, status FROM shifts WHERE code = ?');
        $q->execute([$code]);
        $shift = $q->fetch();
        if (!$shift) {
            json_out(['ok' => false, 'error' => 'Shift not found.'], 404);
        }
    }

    $shiftId = (int) $shift['id'];
    $rev = reconciliation_expected_revenue($pdo, $shiftId, false);

    $q = $pdo->prepare('SELECT id FROM reconciliations WHERE shift_id = ?');
    $q->execute([$shiftId]);
    $already = (bool) $q->fetchColumn();

    $problems = [];
    if ($rev['noMappings']) {
        $problems[] = 'No valid portion mappings are configured.';
    }
    if ($rev['missingCounts']) {
        $problems[] = 'Save closing stock counts for: ' . implode(', ', $rev['missingCounts']) . '.';
    }
    if ($already) {
        $problems[] = 'This shift has already been reconciled.';
    }

    $preview = [
        'shiftId'           => $shift['code'],
        'date'              => $shift['shift_date'],
        'shiftStatus'       => $shift['status'],
        'expectedRevenue'   => $rev['expectedRevenue'],
        'dishVolume'        => $rev['dishVolume'],
        'breakdown'         => $rev['breakdown'],
        'missingCounts'     => $rev['missingCounts'],
        'alreadyReconciled' => $already,
        'canSave'           => !$problems,
        'problems'          => $problems,
    ];

    // Optional: show how the counted cash and GCash compare, using the same rounding and status as a save.
    if (isset($_GET['actualCash'], $_GET['actualGcash'])) {
        foreach (['actualCash', 'actualGcash'] as $field) {
            $v = $_GET[$field];
            if (!is_numeric($v) || (float) $v < 0 || (float) $v > 9999999999) {
                json_out(['ok' => false, 'error' => 'Invalid amount for ' . $field . '.'], 422);
            }
        }
        $cash     = round((float) $_GET['actualCash'], 2);
        $gcash    = round((float) $_GET['actualGcash'], 2);
        $total    = round($cash + $gcash, 2);
        $variance = round($total - (float) $rev['expectedRevenue'], 2);
        $preview['collection'] = [
            'actualCash'     => $cash,
            'actualGcash'    => $gcash,
            'totalCollected' => $total,
            'variance'       => $variance,
            'status'         => reconciliation_status($variance),
        ];
    }

    json_out(['ok' => true, 'preview' => $preview]);
}

if ($method === 'GET') {
    if (($_GET['action'] ?? '') === 'preview') {
        reconciliation_preview(db());
    }
    json_out(['ok' => true, 'reconciliations' => reconciliation_list()]);
}

if ($method !== 'POST') {
    header('Allow: GET, POST');
    json_out(['ok' => false, 'error' => 'Method not allowed.'], 405);
}

require_same_origin();
require_csrf();

$body    = read_json_body();
$records = $body['records'] ?? null;
$migrate = !empty($body['migrate']);

if (!is_array($records) || count($records) === 0 || count($records) > 500) {
    json_out(['ok' => false, 'error' => 'Invalid reconciliation data.'], 422);
}

$pdo       = db();
$findShift = $pdo->prepare('SELECT id, shift_date FROM shifts WHERE code = ?');
$exists    = $pdo->prepare('SELECT id FROM reconciliations WHERE shift_id = ?');
$insert    = $pdo->prepare(
    'INSERT INTO reconciliations
        (shift_id, recon_date, expected_revenue, actual_cash, actual_gcash, total_collected,
         variance, status, orders_served, dish_volume, saved_by, saved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
);

$saved   = 0;
$skipped = 0;

try {
    $pdo->beginTransaction();

    foreach ($records as $rec) {
        if (!is_array($rec)) {
            $skipped++;
            continue;
        }

        $shiftCode = trim((string) ($rec['shiftId'] ?? ''));
        $findShift->execute([$shiftCode]);
        $shift = $findShift->fetch();

        if (!$shift) {
            if ($migrate) { $skipped++; continue; }
            $pdo->rollBack();
            json_out([
                'ok'    => false,
                'error' => 'Shift ' . $shiftCode . ' was not found in the database. Open the Shift page once so it syncs, then try again.',
            ], 422);
        }

        $exists->execute([(int) $shift['id']]);
        if ($exists->fetchColumn()) {
            if ($migrate) { $skipped++; continue; }
            $pdo->rollBack();
            json_out(['ok' => false, 'error' => 'This shift has already been reconciled. Only one reconciliation is allowed per shift.'], 409);
        }

        foreach (['actualCash', 'actualGcash'] as $field) {
            if (!is_numeric($rec[$field] ?? null) || (float) $rec[$field] < 0 || (float) $rec[$field] > 9999999999) {
                if ($migrate) { $skipped++; continue 2; }
                $pdo->rollBack();
                json_out(['ok' => false, 'error' => 'Invalid amount for ' . $field . '.'], 422);
            }
        }

        // Expected revenue is authoritative server-side data; never trust a client-provided amount.
        $revenue = reconciliation_expected_revenue($pdo, (int) $shift['id']);
        $expected = (float) $revenue['expectedRevenue'];
        $cash     = round((float) $rec['actualCash'], 2);
        $gcash    = round((float) $rec['actualGcash'], 2);
        $total    = round($cash + $gcash, 2);
        $variance = round($total - $expected, 2);
        $status   = reconciliation_status($variance);

        $date = (string) ($rec['date'] ?? '');
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            $date = (string) $shift['shift_date'];
        }

        $orders = isset($rec['ordersServed']) && is_numeric($rec['ordersServed']) ? max(0, (int) $rec['ordersServed']) : null;
        $dishes = (int) $revenue['dishVolume'];

        $savedAt = date('Y-m-d H:i:s');
        if ($migrate && !empty($rec['savedAt']) && ($ts = strtotime((string) $rec['savedAt'])) !== false) {
            $savedAt = date('Y-m-d H:i:s', $ts);
        }

        $insert->execute([
            (int) $shift['id'], $date, $expected, $cash, $gcash, $total,
            $variance, $status, $orders, $dishes, $user['id'], $savedAt,
        ]);
        $saved++;

        // The audit row is written in the SAME transaction as the insert, so one new
        // reconciliation always means exactly one audit entry (never zero, never two).
        // Migrated browser-only records already have their old audit entries.
        if (!$migrate) {
            audit_log(
                'Reconciliation',
                'Reconciliation Saved',
                $shiftCode . ' - ' . $date,
                sprintf(
                    'Expected revenue: ₱%.2f | Cash: ₱%.2f | GCash: ₱%.2f | Total collected: ₱%.2f | Variance: ₱%.2f (%s)',
                    $expected, $cash, $gcash, $total, $variance, $status
                ),
                $user
            );
        }
    }

    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    // 1062 = duplicate key (two saves at the same moment)
    if ($e instanceof PDOException && (int) ($e->errorInfo[1] ?? 0) === 1062) {
        json_out(['ok' => false, 'error' => 'This shift has already been reconciled. Only one reconciliation is allowed per shift.'], 409);
    }
    throw $e;
}

json_out(['ok' => true, 'saved' => $saved, 'skipped' => $skipped, 'reconciliations' => reconciliation_list()]);
