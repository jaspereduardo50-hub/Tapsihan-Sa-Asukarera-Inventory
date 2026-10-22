<?php
declare(strict_types=1);

/*
 * Shared rules for the three ledgers: restocks, waste/spoilage and stock counts.
 * Load after bootstrap.php. This folder is blocked from the web by includes/.htaccess.
 *
 * The server, not the app, now decides:
 *   - which shift a record belongs to (the one OPEN shift),
 *   - whether a record is locked (its shift has ended),
 *   - how an inventory item's stock changes,
 *   - the restock / waste totals and the consumed amount of a stock count.
 * Every write runs in one transaction and locks the affected item rows first, so two devices
 * saving at the same time cannot corrupt each other's stock.
 */

const LEDGER_LOCKED_MESSAGE =
    'This entry belongs to a shift that has already ended, so it can no longer be edited or removed.';

const LEDGER_RESTOCK_SELECT =
    'SELECT r.*, s.code AS shift_code, i.code AS item_code, i.name AS item_name, u.full_name
     FROM restocks r
     JOIN inventory_items i ON i.id = r.item_id
     LEFT JOIN shifts s ON s.id = r.shift_id
     LEFT JOIN users u ON u.id = r.recorded_by';

const LEDGER_WASTE_SELECT =
    'SELECT w.*, s.code AS shift_code, i.code AS item_code, i.name AS item_name, u.full_name
     FROM wastes w
     JOIN shifts s ON s.id = w.shift_id
     JOIN inventory_items i ON i.id = w.item_id
     LEFT JOIN users u ON u.id = w.recorded_by';

const LEDGER_COUNT_SELECT =
    'SELECT c.*, s.code AS shift_code, i.code AS item_code, i.name AS item_name, i.unit
     FROM stock_counts c
     JOIN shifts s ON s.id = c.shift_id
     JOIN inventory_items i ON i.id = c.item_id';

/* ---------- Small helpers ---------- */

function ledger_fail(string $message, int $status = 422): never
{
    json_out(['ok' => false, 'error' => $message], $status);
}

/** "Owner" for owners, "Staff" for everyone else: the same two labels the website has always stored. */
function ledger_role_label(array $user): string
{
    return ($user['role'] ?? '') === 'owner' ? 'Owner' : 'Staff';
}

/** Reads ?id=RESTOCK-12 (or just ?id=12) and returns 12. */
function ledger_record_id(string $prefix): int
{
    $raw = trim((string) ($_GET['id'] ?? ''));
    if (stripos($raw, $prefix . '-') === 0) {
        $raw = substr($raw, strlen($prefix) + 1);
    }
    if ($raw === '' || !ctype_digit($raw)) {
        ledger_fail('A valid record id is required.');
    }
    return (int) $raw;
}

/** Whole numbers only, like the website forms. */
function ledger_quantity(mixed $value, string $label, bool $allowZero = false): int
{
    if (is_string($value)) {
        $value = trim($value);
    }
    $min = $allowZero ? 0 : 1;
    if (!is_numeric($value)) {
        ledger_fail($label . ' must be a whole number.');
    }
    $n = (float) $value;
    if ($n != floor($n) || $n < $min || $n > 1000000) {
        ledger_fail($label . ($allowZero
            ? ' must be a whole number of 0 or more.'
            : ' must be a whole number greater than zero.'));
    }
    return (int) $n;
}

/* ---------- Items and stock ---------- */

/** Finds an active (not archived) item by its code, for example "ITM-001". Does not lock it. */
function ledger_find_item(PDO $pdo, string $code): array
{
    $q = $pdo->prepare('SELECT id, code, name, unit, stock, archived_at FROM inventory_items WHERE code = ?');
    $q->execute([trim($code)]);
    $item = $q->fetch();
    if (!$item || $item['archived_at'] !== null) {
        ledger_fail('That inventory item was not found.', 404);
    }
    return $item;
}

/**
 * Locks the items for the rest of the transaction and returns them with their current stock,
 * keyed by id. They are locked in id order so two requests can never deadlock each other.
 */
function ledger_lock_items(PDO $pdo, array $ids): array
{
    $ids = array_values(array_unique(array_map('intval', $ids)));
    sort($ids);
    $marks = implode(',', array_fill(0, count($ids), '?'));
    $q = $pdo->prepare("SELECT id, code, name, unit, stock FROM inventory_items WHERE id IN ($marks) ORDER BY id FOR UPDATE");
    $q->execute($ids);
    $out = [];
    foreach ($q->fetchAll() as $row) {
        $out[(int) $row['id']] = $row;
    }
    return $out;
}

/** Adds (or, with a negative number, removes) stock. Never goes below zero. */
function ledger_add_stock(PDO $pdo, int $itemId, float|int $delta): void
{
    $pdo->prepare('UPDATE inventory_items SET stock = GREATEST(0, stock + ?) WHERE id = ?')
        ->execute([$delta, $itemId]);
}

function ledger_item_stock(PDO $pdo, int $itemId): float
{
    $q = $pdo->prepare('SELECT stock FROM inventory_items WHERE id = ?');
    $q->execute([$itemId]);
    return (float) $q->fetchColumn();
}

/* ---------- Shifts and locking ---------- */

/** The one OPEN shift, or null. Call inside a transaction: the row is locked. */
function ledger_open_shift(PDO $pdo): ?array
{
    $row = $pdo->query("SELECT id, code, shift_date, status FROM shifts WHERE status = 'OPEN' LIMIT 1 FOR UPDATE")->fetch();
    return $row ?: null;
}

/**
 * The shift a new record belongs to. The app may send "shiftId" (the shift it thinks is open);
 * if that shift has since closed, the request is refused so a stale phone cannot write into it.
 */
function ledger_resolve_shift(PDO $pdo, array $entry, bool $required): ?array
{
    $shift = ledger_open_shift($pdo);
    $sent  = trim((string) ($entry['shiftId'] ?? ''));
    if ($required && $shift === null) {
        ledger_fail('Please start a shift before performing this operation.', 409);
    }
    if ($sent !== '' && ($shift === null || $shift['code'] !== $sent)) {
        ledger_fail('That shift is no longer open. Reload the data and try again.', 409);
    }
    return $shift;
}

/**
 * Same rule the website applies in the browser, now enforced here:
 *  - a record that belongs to a shift can change only while that shift is OPEN;
 *  - a restock saved with no shift becomes part of the next shift's opening stock,
 *    so it locks once any shift has started at or after the moment it was recorded.
 */
function ledger_entry_locked(PDO $pdo, ?int $shiftId, string $recordedAt): bool
{
    if ($shiftId !== null) {
        $q = $pdo->prepare('SELECT status FROM shifts WHERE id = ?');
        $q->execute([$shiftId]);
        return $q->fetchColumn() !== 'OPEN';
    }
    $q = $pdo->prepare('SELECT COUNT(*) FROM shifts WHERE start_time >= ?');
    $q->execute([$recordedAt]);
    return (int) $q->fetchColumn() > 0;
}

/** Restock and waste totals for one item in one shift (used by stock counts). */
function ledger_shift_totals(PDO $pdo, int $shiftId, int $itemId): array
{
    $r = $pdo->prepare('SELECT COALESCE(SUM(quantity), 0) FROM restocks WHERE shift_id = ? AND item_id = ?');
    $r->execute([$shiftId, $itemId]);
    $w = $pdo->prepare('SELECT COALESCE(SUM(quantity), 0) FROM wastes WHERE shift_id = ? AND item_id = ?');
    $w->execute([$shiftId, $itemId]);
    return ['restocks' => (float) $r->fetchColumn(), 'spoilage' => (float) $w->fetchColumn()];
}

/* ---------- JSON shapes (same fields the website already reads) ---------- */

function ledger_restock_json(array $r): array
{
    return [
        'id'           => 'RESTOCK-' . $r['id'],
        'shiftId'      => $r['shift_code'],
        'date'         => $r['restock_date'],
        'itemId'       => $r['item_code'],
        'item'         => $r['item_name'],
        'quantity'     => (float) $r['quantity'],
        'supplier'     => $r['supplier_name'],
        'recordedBy'   => $r['full_name'] ?? '',
        'recordedRole' => $r['recorded_role'],
        'recordedAt'   => $r['recorded_at'],
    ];
}

function ledger_waste_json(array $r): array
{
    return [
        'id'           => 'WASTE-' . $r['id'],
        'shiftId'      => $r['shift_code'],
        'date'         => $r['waste_date'],
        'itemId'       => $r['item_code'],
        'item'         => $r['item_name'],
        'quantity'     => (float) $r['quantity'],
        'reason'       => $r['reason'],
        'recordedBy'   => $r['full_name'] ?? '',
        'recordedRole' => $r['recorded_role'],
        'recordedAt'   => $r['recorded_at'],
    ];
}

function ledger_count_json(array $r): array
{
    return [
        'shiftId'      => $r['shift_code'],
        'itemId'       => $r['item_code'],
        'item'         => $r['item_name'],
        'unit'         => $r['unit'],
        'date'         => $r['count_date'],
        'opening'      => (float) $r['opening'],
        'restocks'     => (float) $r['restocks'],
        'spoilage'     => (float) $r['spoilage'],
        'closing'      => $r['closing'] === null ? null : (float) $r['closing'],
        'consumed'     => (float) $r['consumed'],
        'recordedRole' => $r['recorded_role'],
        'recordedAt'   => $r['recorded_at'],
    ];
}

function ledger_restock_by_id(PDO $pdo, int $id): array
{
    $q = $pdo->prepare(LEDGER_RESTOCK_SELECT . ' WHERE r.id = ?');
    $q->execute([$id]);
    return ledger_restock_json($q->fetch());
}

function ledger_waste_by_id(PDO $pdo, int $id): array
{
    $q = $pdo->prepare(LEDGER_WASTE_SELECT . ' WHERE w.id = ?');
    $q->execute([$id]);
    return ledger_waste_json($q->fetch());
}

function ledger_count_by_keys(PDO $pdo, int $shiftId, int $itemId): array
{
    $q = $pdo->prepare(LEDGER_COUNT_SELECT . ' WHERE c.shift_id = ? AND c.item_id = ?');
    $q->execute([$shiftId, $itemId]);
    return ledger_count_json($q->fetch());
}

/* ---------- Named locks (for actions that have no row to lock yet) ---------- */

/**
 * Takes a MySQL named lock, for example before starting a shift (there is no OPEN shift row to
 * lock yet) or before handing out the next item code. The lock belongs to the database connection,
 * so it is also released automatically if the request ends early.
 */
function ledger_app_lock(PDO $pdo, string $name, int $waitSeconds = 5): void
{
    $q = $pdo->prepare('SELECT GET_LOCK(?, ?)');
    $q->execute(['tapsihan:' . $name, $waitSeconds]);
    if ((int) $q->fetchColumn() !== 1) {
        ledger_fail('The system is busy. Please try again in a moment.', 503);
    }
}

function ledger_app_unlock(PDO $pdo, string $name): void
{
    try {
        $pdo->prepare('SELECT RELEASE_LOCK(?)')->execute(['tapsihan:' . $name]);
    } catch (Throwable) {
        // The lock is released when the connection closes anyway.
    }
}
