<?php
declare(strict_types=1);
require dirname(__DIR__) . '/includes/bootstrap.php';
$user = require_login();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'GET') {
    $rows=db()->query('SELECT r.*,s.code AS shift_code,i.code AS item_code,i.name AS item_name,u.full_name FROM restocks r JOIN inventory_items i ON i.id=r.item_id LEFT JOIN shifts s ON s.id=r.shift_id LEFT JOIN users u ON u.id=r.recorded_by ORDER BY r.id')->fetchAll();$out=[];foreach($rows as $r){$out[]=['id'=>'RESTOCK-'.$r['id'],'shiftId'=>$r['shift_code'],'date'=>$r['restock_date'],'itemId'=>$r['item_code'],'item'=>$r['item_name'],'quantity'=>(float)$r['quantity'],'supplier'=>$r['supplier_name'],'recordedBy'=>$r['full_name']??'','recordedRole'=>$r['recorded_role'],'recordedAt'=>$r['recorded_at']];}json_out(['ok'=>true,'restocks'=>$out]);

}
if ($method !== 'POST') { header('Allow: GET, POST'); json_out(['ok'=>false,'error'=>'Method not allowed.'],405); }
require_same_origin(); require_csrf();
$body = read_json_body();
$pdo = db();
$inventorySnapshot = $body['inventory'] ?? null;
$entries=$body['restocks']??null;if(!is_array($entries)||count($entries)>10000)json_out(['ok'=>false,'error'=>'Invalid restock data.'],422);
try{$pdo->beginTransaction();$pdo->exec('DELETE FROM restocks');$findItem=$pdo->prepare('SELECT id FROM inventory_items WHERE code=?');$findShift=$pdo->prepare('SELECT id FROM shifts WHERE code=?');$ins=$pdo->prepare('INSERT INTO restocks (shift_id,item_id,restock_date,quantity,supplier_name,recorded_by,recorded_role,recorded_at) VALUES (?,?,?,?,?,?,?,?)');foreach($entries as $e){if(!is_array($e))continue;$findItem->execute([(string)($e['itemId']??'')]);$iid=$findItem->fetchColumn();if(!$iid)continue;$shiftId=null;if(!empty($e['shiftId'])){$findShift->execute([(string)$e['shiftId']]);$shiftId=$findShift->fetchColumn()?:null;}$qty=(float)($e['quantity']??0);if($qty<=0)continue;$ins->execute([$shiftId,$iid,(string)($e['date']??date('Y-m-d')),$qty,substr((string)($e['supplier']??''),0,100),$user['id'],(string)($e['recordedRole']??$user['role']),recorded_at_value($e['recordedAt']??null)]);}if (is_array($inventorySnapshot)) { $stockUpdate=$pdo->prepare('UPDATE inventory_items SET stock=? WHERE code=?'); foreach($inventorySnapshot as $it){ if(is_array($it) && isset($it['id']) && is_numeric($it['stock']??null) && (float)$it['stock']>=0) $stockUpdate->execute([(float)$it['stock'],(string)$it['id']]); } }
 $pdo->commit();json_out(['ok'=>true,'saved'=>count($entries)]);}catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
