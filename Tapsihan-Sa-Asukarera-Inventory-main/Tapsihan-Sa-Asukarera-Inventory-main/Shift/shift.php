<?php
declare(strict_types=1);
require dirname(__DIR__) . '/includes/bootstrap.php';
$user = require_login();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'GET') {
    $rows = db()->query('SELECT id, code, shift_date, start_time, end_time, status FROM shifts ORDER BY id DESC')->fetchAll();
    $opening = db()->query('SELECT so.shift_id, i.code, so.quantity FROM shift_opening_stocks so JOIN inventory_items i ON i.id=so.item_id')->fetchAll();
    $openMap=[]; foreach($opening as $r){ $openMap[(int)$r['shift_id']][$r['code']]=(float)$r['quantity']; }
    $out=[]; foreach($rows as $r){ $out[]=['id'=>$r['code'],'databaseId'=>(int)$r['id'],'date'=>$r['shift_date'],'startTime'=>str_replace(' ','T',$r['start_time']),'endTime'=>$r['end_time'] ? str_replace(' ','T',$r['end_time']) : null,'status'=>$r['status'],'openingStocks'=>$openMap[(int)$r['id']] ?? []]; }
    json_out(['ok'=>true,'shifts'=>$out]);

}
if ($method !== 'POST') { header('Allow: GET, POST'); json_out(['ok'=>false,'error'=>'Method not allowed.'],405); }
require_same_origin(); require_csrf();
$body = read_json_body();
$pdo = db();
$inventorySnapshot = $body['inventory'] ?? null;
$shifts=$body['shifts']??null; if(!is_array($shifts)||count($shifts)>500) json_out(['ok'=>false,'error'=>'Invalid shift data.'],422);
try { $pdo->beginTransaction();
 $find=$pdo->prepare('SELECT id FROM shifts WHERE code=?');
 $up=$pdo->prepare('INSERT INTO shifts (code,shift_date,start_time,end_time,status,opened_by,closed_by) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE shift_date=VALUES(shift_date),start_time=VALUES(start_time),end_time=VALUES(end_time),status=VALUES(status),closed_by=VALUES(closed_by)');
 $itemFind=$pdo->prepare('SELECT id FROM inventory_items WHERE code=?'); $del=$pdo->prepare('DELETE FROM shift_opening_stocks WHERE shift_id=?'); $ins=$pdo->prepare('INSERT INTO shift_opening_stocks (shift_id,item_id,quantity) VALUES (?,?,?)');
 foreach($shifts as $s){ if(!is_array($s)) continue; $code=trim((string)($s['id']??'')); if($code==='') continue; $date=(string)($s['date']??date('Y-m-d')); $start=(string)($s['startTime']??''); $end=$s['endTime']??null; $status=($s['status']??'OPEN')==='CLOSED'?'CLOSED':'OPEN';
  $startDate=(new DateTimeImmutable($start ?: 'now'))->format('Y-m-d H:i:s'); $endDate=$end ? (new DateTimeImmutable((string)$end))->format('Y-m-d H:i:s') : null;
  $up->execute([$code,$date,$startDate,$endDate,$status,$user['id'],$status==='CLOSED'?$user['id']:null]); $find->execute([$code]); $sid=(int)$find->fetchColumn();
  $del->execute([$sid]); foreach(($s['openingStocks']??[]) as $itemCode=>$qty){ $itemFind->execute([(string)$itemCode]); $iid=$itemFind->fetchColumn(); if($iid && is_numeric($qty) && (float)$qty>=0) $ins->execute([$sid,(int)$iid,(float)$qty]); }
 }
 if (is_array($inventorySnapshot)) { $stockUpdate=$pdo->prepare('UPDATE inventory_items SET stock=? WHERE code=?'); foreach($inventorySnapshot as $it){ if(is_array($it) && isset($it['id']) && is_numeric($it['stock']??null) && (float)$it['stock']>=0) $stockUpdate->execute([(float)$it['stock'],(string)$it['id']]); } }
 $pdo->commit(); json_out(['ok'=>true,'saved'=>count($shifts)]);
} catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
