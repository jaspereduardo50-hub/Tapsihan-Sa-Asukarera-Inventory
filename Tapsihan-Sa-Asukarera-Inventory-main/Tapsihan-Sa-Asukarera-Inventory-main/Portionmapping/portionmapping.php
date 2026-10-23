<?php
declare(strict_types=1);

require __DIR__ . '/../includes/bootstrap.php';
$user = require_login();

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
    $stmt = db()->query(
        'SELECT pm.id, pm.dish_name, pm.selling_price,
                pmi.item_id, i.code AS item_code, i.name AS item_name,
                pmi.unit, pmi.contains, pmi.used_per_order, pmi.servings
         FROM portion_mappings pm
         LEFT JOIN portion_mapping_ingredients pmi ON pmi.mapping_id = pm.id
         LEFT JOIN inventory_items i ON i.id = pmi.item_id
         ORDER BY pm.id, pmi.id'
    );

    $mappings = [];
    foreach ($stmt->fetchAll() as $row) {
        $id = (string) $row['id'];
        if (!isset($mappings[$id])) {
            $mappings[$id] = [
                'id' => $id,
                'dishName' => (string) $row['dish_name'],
                'sellingPrice' => (float) $row['selling_price'],
                'ingredients' => [],
                'estimatedServings' => null,
            ];
        }
        if ($row['item_id'] !== null) {
            $mappings[$id]['ingredients'][] = [
                'itemId' => (string) $row['item_code'],
                'name' => (string) $row['item_name'],
                'unit' => (string) $row['unit'],
                'contains' => (float) $row['contains'],
                'usedPerOrder' => (float) $row['used_per_order'],
                'servings' => (int) floor((float) $row['servings']),
            ];
        }
    }

    foreach ($mappings as &$mapping) {
        $servings = array_column($mapping['ingredients'], 'servings');
        $mapping['estimatedServings'] = $servings ? min($servings) : 0;
    }
    unset($mapping);
    json_out(['ok' => true, 'mappings' => array_values($mappings)]);
}

require_method('POST');
require_same_origin();
require_csrf();
// Reading mappings is open to every role (Reconciliation uses them); changing them is owner/manager only.
$user = require_page_access('portionmapping');
$body = read_json_body();
$action = (string) ($body['action'] ?? 'save');
$mapping = $body['mapping'] ?? null;

if ($action === 'delete') {
    $id = filter_var($body['id'] ?? null, FILTER_VALIDATE_INT);
    if (!$id || $id < 1) {
        json_out(['ok' => false, 'error' => 'Invalid portion mapping ID.'], 422);
    }
    $stmt = db()->prepare('SELECT dish_name FROM portion_mappings WHERE id = ?');
    $stmt->execute([$id]);
    $dishName = $stmt->fetchColumn();
    if ($dishName === false) {
        json_out(['ok' => false, 'error' => 'Portion mapping was not found.'], 404);
    }
    $delete = db()->prepare('DELETE FROM portion_mappings WHERE id = ?');
    $delete->execute([$id]);
    audit_log('Portion Mapping', 'Mapping Deleted', (string) $dishName, 'Deleted portion mapping for ' . $dishName . '.', $user);
    json_out(['ok' => true, 'deletedId' => (string) $id]);
}

if (!is_array($mapping)) {
    json_out(['ok' => false, 'error' => 'Invalid portion mapping data.'], 422);
}
$dishName = trim((string) ($mapping['dishName'] ?? ''));
$sellingPrice = $mapping['sellingPrice'] ?? null;
$ingredients = $mapping['ingredients'] ?? null;
$idValue = $mapping['id'] ?? null;
$id = ($idValue !== null && filter_var($idValue, FILTER_VALIDATE_INT) !== false) ? (int) $idValue : null;

if ($dishName === '' || mb_strlen($dishName) > 100 || !is_numeric($sellingPrice) || (float) $sellingPrice <= 0 || !is_array($ingredients) || count($ingredients) < 1 || count($ingredients) > 50) {
    json_out(['ok' => false, 'error' => 'Enter a dish name, a valid selling price, and at least one ingredient.'], 422);
}

$normalized = [];
$seenItems = [];
$findItem = db()->prepare('SELECT id, name, unit FROM inventory_items WHERE code = ? AND archived_at IS NULL');
foreach ($ingredients as $ingredient) {
    if (!is_array($ingredient)) {
        json_out(['ok' => false, 'error' => 'Invalid ingredient data.'], 422);
    }
    $itemCode = strtoupper(trim((string) ($ingredient['itemId'] ?? '')));
    $unit = trim((string) ($ingredient['unit'] ?? ''));
    $contains = $ingredient['contains'] ?? null;
    $used = $ingredient['usedPerOrder'] ?? null;
    if (!preg_match('/^RM-[0-9]{3,}$/', $itemCode) || $unit === '' || mb_strlen($unit) > 30 || !is_numeric($contains) || (float) $contains <= 0 || !is_numeric($used) || (float) $used <= 0 || floor((float) $contains / (float) $used) < 1) {
        json_out(['ok' => false, 'error' => 'Check the ingredient, unit, contains, and used-per-order values.'], 422);
    }
    if (isset($seenItems[$itemCode])) {
        json_out(['ok' => false, 'error' => 'Each ingredient can only be added once to a dish mapping.'], 422);
    }
    $seenItems[$itemCode] = true;
    $findItem->execute([$itemCode]);
    $item = $findItem->fetch();
    if (!$item) {
        json_out(['ok' => false, 'error' => 'An ingredient was not found in active inventory. Save the inventory item first.'], 422);
    }
    $normalized[] = [
        'item_id' => (int) $item['id'],
        'item_code' => $itemCode,
        'name' => (string) $item['name'],
        'unit' => $unit,
        'contains' => (float) $contains,
        'used' => (float) $used,
        'servings' => (float) floor((float) $contains / (float) $used),
    ];
}

$pdo = db();
try {
    $pdo->beginTransaction();
    if ($id !== null) {
        $check = $pdo->prepare('SELECT dish_name FROM portion_mappings WHERE id = ? FOR UPDATE');
        $check->execute([$id]);
        $oldName = $check->fetchColumn();
        if ($oldName === false) {
            throw new RuntimeException('The portion mapping no longer exists. Refresh the page and try again.');
        }
        $update = $pdo->prepare('UPDATE portion_mappings SET dish_name = ?, selling_price = ? WHERE id = ?');
        $update->execute([$dishName, (float) $sellingPrice, $id]);
        $mappingId = $id;
        $actionName = 'Mapping Updated';
        $auditDetails = 'Updated portion mapping for ' . $dishName . ' with ' . count($normalized) . ' ingredients and selling price PHP ' . number_format((float) $sellingPrice, 2) . '.';
    } else {
        $insert = $pdo->prepare('INSERT INTO portion_mappings (dish_name, selling_price) VALUES (?, ?)');
        $insert->execute([$dishName, (float) $sellingPrice]);
        $mappingId = (int) $pdo->lastInsertId();
        $actionName = 'Mapping Created';
        $auditDetails = 'Created portion mapping for ' . $dishName . ' with ' . count($normalized) . ' ingredients and selling price PHP ' . number_format((float) $sellingPrice, 2) . '.';
    }

    $deleteIngredients = $pdo->prepare('DELETE FROM portion_mapping_ingredients WHERE mapping_id = ?');
    $deleteIngredients->execute([$mappingId]);
    $insertIngredient = $pdo->prepare('INSERT INTO portion_mapping_ingredients (mapping_id, item_id, unit, contains, used_per_order, servings) VALUES (?, ?, ?, ?, ?, ?)');
    foreach ($normalized as $ingredient) {
        $insertIngredient->execute([$mappingId, $ingredient['item_id'], $ingredient['unit'], $ingredient['contains'], $ingredient['used'], $ingredient['servings']]);
    }
    audit_log('Portion Mapping', $actionName, $dishName, $auditDetails, $user);
    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    if ($e instanceof PDOException && (string) $e->getCode() === '23000') {
        json_out(['ok' => false, 'error' => 'A portion mapping with that dish name already exists.'], 409);
    }
    if ($e instanceof RuntimeException) {
        json_out(['ok' => false, 'error' => $e->getMessage()], 409);
    }
    throw $e;
}

json_out(['ok' => true, 'mapping' => [
    'id' => (string) $mappingId,
    'dishName' => $dishName,
    'sellingPrice' => (float) $sellingPrice,
    'ingredients' => array_map(static fn(array $item): array => [
        'itemId' => $item['item_code'], 'name' => $item['name'], 'unit' => $item['unit'],
        'contains' => $item['contains'], 'usedPerOrder' => $item['used'], 'servings' => (int) $item['servings'],
    ], $normalized),
    'estimatedServings' => min(array_column($normalized, 'servings')),
]]);
