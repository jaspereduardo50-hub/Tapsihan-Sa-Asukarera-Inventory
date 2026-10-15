<?php
declare(strict_types=1);
require dirname(__DIR__) . '/includes/bootstrap.php';
$user = require_login();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'GET') {
    $rows=db()->query('SELECT c.*, s.code AS shift_code, i.code AS item_code, i.name AS item_name, i.unit FROM stock_counts c JOIN shifts s ON s.id=c.shift_id JOIN inventory_items i ON i.id=c.item_id ORDER BY c.id')->fetchAll();
    $out=[]; foreach($rows as $r){$out[]=['shiftId'=>$r['shift_code'],'itemId'=>$r['item_code'],'item'=>$r['item_name'],'unit'=>$r['unit'],'date'=>$r['count_date'],'opening'=>(float)$r['opening'],'restocks'=>(float)$r['restocks'],'spoilage'=>(float)$r['spoilage'],'closing'=>$r['closing']===null?null:(float)$r['closing'],'consumed'=>(float)$r['consumed'],'recordedRole'=>$r['recorded_role']];} json_out(['ok'=>true,'stockCounts'=>$out]);

}
if ($method !== 'POST') { header('Allow: GET, POST'); json_out(['ok'=>false,'error'=>'Method not allowed.'],405); }
require_same_origin(); require_csrf();
$body = read_json_body();
$pdo = db();
$inventorySnapshot = $body['inventory'] ?? null;
$entries=$body['stockCounts']??null; if(!is_array($entries)||count($entries)>5000) json_out(['ok'=>false,'error'=>'Invalid stock count data.'],422);
try{$pdo->beginTransaction(); $findShift=$pdo->prepare('SELECT id FROM shifts WHERE code=?'); $findItem=$pdo->prepare('SELECT id FROM inventory_items WHERE code=?'); $pdo->exec('DELETE FROM stock_counts'); $up=$pdo->prepare('INSERT INTO stock_counts (shift_id,item_id,count_date,opening,restocks,spoilage,closing,consumed,recorded_by,recorded_role) VALUES (?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE count_date=VALUES(count_date),opening=VALUES(opening),restocks=VALUES(restocks),spoilage=VALUES(spoilage),closing=VALUES(closing),consumed=VALUES(consumed),recorded_by=VALUES(recorded_by),recorded_role=VALUES(recorded_role)');
 foreach($entries as $e){if(!is_array($e))continue;$shiftCode=(string)($e['shiftId']??'');$itemCode=(string)($e['itemId']??'');$findShift->execute([$shiftCode]);$sid=$findShift->fetchColumn();$findItem->execute([$itemCode]);$iid=$findItem->fetchColumn();if(!$sid||!$iid)continue;$opening=max(0,(float)($e['opening']??0));$restocks=max(0,(float)($e['restocks']??0));$spoilage=max(0,(float)($e['spoilage']??0));$closing=isset($e['closing'])&&$e['closing']!==''?(float)$e['closing']:null;$consumed=max(0,(float)($e['consumed']??0));$date=(string)($e['date']??date('Y-m-d'));$up->execute([(int)$sid,(int)$iid,$date,$opening,$restocks,$spoilage,$closing,$consumed,$user['id'],(string)($e['recordedRole']??$user['role'])]);}
 if (is_array($inventorySnapshot)) { $stockUpdate=$pdo->prepare('UPDATE inventory_items SET stock=? WHERE code=?'); foreach($inventorySnapshot as $it){ if(is_array($it) && isset($it['id']) && is_numeric($it['stock']??null) && (float)$it['stock']>=0) $stockUpdate->execute([(float)$it['stock'],(string)$it['id']]); } }
 $pdo->commit();json_out(['ok'=>true,'saved'=>count($entries)]);
}catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
