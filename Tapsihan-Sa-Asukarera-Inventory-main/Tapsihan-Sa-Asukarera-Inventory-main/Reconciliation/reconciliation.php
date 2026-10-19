<?php
declare(strict_types=1);

/*
 * Reconciliation endpoint (MySQL table: reconciliations)
 *   GET  -> all saved reconciliations, newest first
 *   POST -> { records: [ {...} ], migrate: false }
 *           Saves new reconciliations. One per shift (unique key uq_recon_shift).
 *           migrate=true is used once to move old browser-only records into MySQL;
 *           duplicates and records whose shift is missing are skipped instead of failing.
 */

require dirname(__DIR__) . '/includes/bootstrap.php';

$user   = require_login();
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

if ($method === 'GET') {
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

        foreach (['expectedRevenue', 'actualCash', 'actualGcash'] as $field) {
            if (!is_numeric($rec[$field] ?? null) || (float) $rec[$field] < 0 || (float) $rec[$field] > 9999999999) {
                if ($migrate) { $skipped++; continue 2; }
                $pdo->rollBack();
                json_out(['ok' => false, 'error' => 'Invalid amount for ' . $field . '.'], 422);
            }
        }

        // Totals are recalculated here so the database can never hold inconsistent numbers.
        $expected = round((float) $rec['expectedRevenue'], 2);
        $cash     = round((float) $rec['actualCash'], 2);
        $gcash    = round((float) $rec['actualGcash'], 2);
        $total    = round($cash + $gcash, 2);
        $variance = round($total - $expected, 2);
        $status   = $variance < 0 ? 'SHORTAGE' : ($variance > 0 ? 'OVERAGE' : 'BALANCED');

        $date = (string) ($rec['date'] ?? '');
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            $date = (string) $shift['shift_date'];
        }

        $orders = isset($rec['ordersServed']) && is_numeric($rec['ordersServed']) ? max(0, (int) $rec['ordersServed']) : null;
        $dishes = isset($rec['dishVolume'])   && is_numeric($rec['dishVolume'])   ? max(0, (int) $rec['dishVolume'])   : null;

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
