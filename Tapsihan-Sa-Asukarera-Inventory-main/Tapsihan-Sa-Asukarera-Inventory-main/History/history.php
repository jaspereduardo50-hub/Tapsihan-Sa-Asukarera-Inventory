<?php
declare(strict_types=1);

/*
 * Transaction History endpoint (read only).
 * Builds the movement ledger from the existing tables:
 *   restocks, stock_counts, wastes  (joined with inventory_items and users)
 */

require dirname(__DIR__) . '/includes/bootstrap.php';

$user = require_page_access('history');
require_method('GET');

/** 12 -> 12, 12.50 -> 12.5 (avoids "12.00" in the table). */
function history_num($value): float|int
{
    $n = (float) $value;
    return floor($n) === $n ? (int) $n : $n;
}

function history_logger(array $row): string
{
    $role = trim((string) ($row['recorded_role'] ?? ''));
    if ($role !== '') {
        return $role;
    }
    $name = strtolower((string) ($row['full_name'] ?? ''));
    if ($name !== '' && (str_contains($name, 'owner') || str_contains($name, 'administrator'))) {
        return 'Owner';
    }
    if ($name !== '' && str_contains($name, 'staff')) {
        return 'Staff';
    }
    return 'Unknown';
}

$pdo = db();
$movements = [];

$rows = $pdo->query(
    'SELECT r.restock_date AS d, r.recorded_at AS ts, r.quantity, r.supplier_name, r.recorded_role,
            i.code AS item_code, i.name AS item_name, u.full_name
     FROM restocks r
     JOIN inventory_items i ON i.id = r.item_id
     LEFT JOIN users u ON u.id = r.recorded_by
     ORDER BY r.recorded_at DESC, r.id DESC LIMIT 5000'
)->fetchAll();
foreach ($rows as $r) {
    $supplier = trim((string) $r['supplier_name']);
    $movements[] = [
        'date' => $r['d'], 'timestamp' => (string) $r['ts'],
        'itemId' => $r['item_code'], 'item' => $r['item_name'],
        'type' => 'Restock', 'quantity' => history_num($r['quantity']),
        'notes' => 'Supplier: ' . ($supplier !== '' ? $supplier : 'Not specified'),
        'loggedBy' => history_logger($r),
    ];
}

$rows = $pdo->query(
    'SELECT c.count_date AS d, c.recorded_at AS ts, c.opening, c.closing, c.recorded_role,
            i.code AS item_code, i.name AS item_name, u.full_name
     FROM stock_counts c
     JOIN inventory_items i ON i.id = c.item_id
     LEFT JOIN users u ON u.id = c.recorded_by
     ORDER BY c.recorded_at DESC, c.id DESC LIMIT 5000'
)->fetchAll();
foreach ($rows as $r) {
    $opening = (float) $r['opening'];
    $closing = (float) ($r['closing'] ?? 0);
    $movements[] = [
        'date' => $r['d'], 'timestamp' => (string) $r['ts'],
        'itemId' => $r['item_code'], 'item' => $r['item_name'],
        'type' => 'Count', 'quantity' => history_num($closing - $opening),
        'notes' => 'Opening: ' . history_num($opening) . '; Closing: ' . history_num($closing),
        'loggedBy' => history_logger($r),
    ];
}

$rows = $pdo->query(
    'SELECT w.waste_date AS d, w.recorded_at AS ts, w.quantity, w.reason, w.recorded_role,
            i.code AS item_code, i.name AS item_name, u.full_name
     FROM wastes w
     JOIN inventory_items i ON i.id = w.item_id
     LEFT JOIN users u ON u.id = w.recorded_by
     ORDER BY w.recorded_at DESC, w.id DESC LIMIT 5000'
)->fetchAll();
foreach ($rows as $r) {
    $reason = trim((string) $r['reason']);
    $movements[] = [
        'date' => $r['d'], 'timestamp' => (string) $r['ts'],
        'itemId' => $r['item_code'], 'item' => $r['item_name'],
        'type' => 'Spoilage', 'quantity' => -abs(history_num($r['quantity'])),
        'notes' => 'Reason: ' . ($reason !== '' ? $reason : 'Not specified'),
        'loggedBy' => history_logger($r),
    ];
}

usort($movements, static fn(array $a, array $b): int => strcmp($b['timestamp'], $a['timestamp']));

json_out(['ok' => true, 'movements' => $movements]);
