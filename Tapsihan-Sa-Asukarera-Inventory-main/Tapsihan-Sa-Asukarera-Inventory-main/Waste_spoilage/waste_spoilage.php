<?php
declare(strict_types=1);
require dirname(__DIR__) . '/includes/bootstrap.php';
$user = require_login();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'GET') {
    $rows=db()->query('SELECT w.*,s.code AS shift_code,i.code AS item_code,i.name AS item_name,u.full_name FROM wastes w JOIN shifts s ON s.id=w.shift_id JOIN inventory_items i ON i.id=w.item_id LEFT JOIN users u ON u.id=w.recorded_by ORDER BY w.id')->fetchAll();$out=[];foreach($rows as $r){$out[]=['id'=>'WASTE-'.$r['id'],'shiftId'=>$r['shift_code'],'date'=>$r['waste_date'],'itemId'=>$r['item_code'],'item'=>$r['item_name'],'quantity'=>(float)$r['quantity'],'reason'=>$r['reason'],'recordedBy'=>$r['full_name']??'','recordedRole'=>$r['recorded_role'],'recordedAt'=>$r['recorded_at']];}json_out(['ok'=>true,'wastes'=>$out]);

}
if ($method !== 'POST') { header('Allow: GET, POST'); json_out(['ok'=>false,'error'=>'Method not allowed.'],405); }
require_same_origin(); require_csrf();
$body = read_json_body();
$pdo = db();
$inventorySnapshot = $body['inventory'] ?? null;
$entries=$body['wastes']??null;if(!is_array($entries)||count($entries)>10000)json_out(['ok'=>false,'error'=>'Invalid waste data.'],422);
try{$pdo->beginTransaction();$pdo->exec('DELETE FROM wastes');$findItem=$pdo->prepare('SELECT id FROM inventory_items WHERE code=?');$findShift=$pdo->prepare('SELECT id FROM shifts WHERE code=?');$ins=$pdo->prepare('INSERT INTO wastes (shift_id,item_id,waste_date,quantity,reason,recorded_by,recorded_role,recorded_at) VALUES (?,?,?,?,?,?,?,?)');foreach($entries as $e){if(!is_array($e))continue;$findItem->execute([(string)($e['itemId']??'')]);$iid=$findItem->fetchColumn();$findShift->execute([(string)($e['shiftId']??'')]);$sid=$findShift->fetchColumn();if(!$iid||!$sid)continue;$qty=(float)($e['quantity']??0);if($qty<=0)continue;$ins->execute([(int)$sid,(int)$iid,(string)($e['date']??date('Y-m-d')),$qty,substr((string)($e['reason']??''),0,255),$user['id'],(string)($e['recordedRole']??$user['role']),recorded_at_value($e['recordedAt']??null)]);}if (is_array($inventorySnapshot)) { $stockUpdate=$pdo->prepare('UPDATE inventory_items SET stock=? WHERE code=?'); foreach($inventorySnapshot as $it){ if(is_array($it) && isset($it['id']) && is_numeric($it['stock']??null) && (float)$it['stock']>=0) $stockUpdate->execute([(float)$it['stock'],(string)$it['id']]); } }
 $pdo->commit();json_out(['ok'=>true,'saved'=>count($entries)]);}catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
