<?php
declare(strict_types=1);
require __DIR__ . '/../includes/bootstrap.php';

$user = require_page_access('dashboard');
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    header('Allow: GET');
    json_out(['ok' => false, 'error' => 'Method not allowed.'], 405);
}

$pdo = db();
$today = date('Y-m-d');

$items = $pdo->query(
    "SELECT id, code, name, category, unit, stock, minimum_stock, archived_at
     FROM inventory_items
     WHERE archived_at IS NULL
     ORDER BY name, id"
)->fetchAll();

$inventory = [];
$lowStock = 0;
foreach ($items as $item) {
    $stock = (float) $item['stock'];
    $minimum = (float) $item['minimum_stock'];
    $isLow = $stock < $minimum;
    if ($isLow) $lowStock++;
    $inventory[] = [
        'id' => (int) $item['id'],
        'code' => $item['code'],
        'name' => $item['name'],
        'category' => $item['category'],
        'unit' => $item['unit'],
        'stock' => $stock,
        'minimum' => $minimum,
        'lowStock' => $isLow,
    ];
}

$q = $pdo->prepare('SELECT COALESCE(SUM(quantity), 0) FROM restocks WHERE restock_date = ?');
$q->execute([$today]);
$restockedToday = (float) $q->fetchColumn();

$q = $pdo->prepare('SELECT COALESCE(SUM(quantity), 0) FROM wastes WHERE waste_date = ?');
$q->execute([$today]);
$wasteToday = (float) $q->fetchColumn();

$shiftRow = $pdo->query(
    "SELECT id, code, shift_date, start_time, end_time, status
     FROM shifts WHERE status = 'OPEN' ORDER BY id DESC LIMIT 1"
)->fetch();
$currentShift = null;
if ($shiftRow) {
    $currentShift = [
        'id' => $shiftRow['code'],
        'databaseId' => (int) $shiftRow['id'],
        'date' => $shiftRow['shift_date'],
        'startTime' => str_replace(' ', 'T', (string) $shiftRow['start_time']),
        'endTime' => $shiftRow['end_time'] ? str_replace(' ', 'T', (string) $shiftRow['end_time']) : null,
        'status' => $shiftRow['status'],
    ];
}

$q = $pdo->prepare(
    'SELECT r.id, s.code AS shift_code, r.recon_date, r.expected_revenue,
            r.total_collected, r.variance, r.status, r.saved_at
     FROM reconciliations r JOIN shifts s ON s.id = r.shift_id
     WHERE r.recon_date = ? ORDER BY r.saved_at DESC, r.id DESC LIMIT 5'
);
$q->execute([$today]);
$recentReconciliations = array_map(static fn(array $r): array => [
    'id' => (int) $r['id'],
    'shiftId' => $r['shift_code'],
    'date' => $r['recon_date'],
    'expectedRevenue' => (float) $r['expected_revenue'],
    'totalCollected' => (float) $r['total_collected'],
    'variance' => (float) $r['variance'],
    'status' => $r['status'],
    'savedAt' => str_replace(' ', 'T', (string) $r['saved_at']),
], $q->fetchAll());

json_out([
    'ok' => true,
    'generatedAt' => date(DATE_ATOM),
    'summary' => [
        'date' => $today,
        'totalItems' => count($inventory),
        'lowStockCount' => $lowStock,
        'restockedToday' => $restockedToday,
        'wasteToday' => $wasteToday,
    ],
    'currentShift' => $currentShift,
    'inventory' => $inventory,
    'recentReconciliations' => $recentReconciliations,
]);
