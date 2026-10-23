<?php
declare(strict_types=1);
require __DIR__ . '/../includes/bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$user = require_page_access('reports');
$pdo = db();

function report_date(string $value): bool {
    $d = DateTime::createFromFormat('!Y-m-d', $value);
    return $d && $d->format('Y-m-d') === $value;
}
require_once __DIR__ . '/report_export.php';
if (!in_array($method,['GET'],true)) { header('Allow: GET'); json_out(['ok'=>false,'error'=>'Method not allowed.'],405); }
$from=(string)($_GET['from'] ?? date('Y-m-d'));
$to=(string)($_GET['to'] ?? date('Y-m-d'));
if (!report_date($from) || !report_date($to) || $from>$to) json_out(['ok'=>false,'error'=>'Choose a valid date range.'],400);
if ((strtotime($to)-strtotime($from))/86400 > 3660) json_out(['ok'=>false,'error'=>'The selected date range cannot exceed 10 years.'],400);

$maps=$pdo->query("SELECT pm.id,pm.dish_name,pm.selling_price,pmi.item_id,pmi.used_per_order
 FROM portion_mappings pm JOIN portion_mapping_ingredients pmi ON pmi.mapping_id=pm.id
 JOIN inventory_items i ON i.id=pmi.item_id
 WHERE i.archived_at IS NULL AND pmi.used_per_order>0
 AND pmi.id=(SELECT p2.id FROM portion_mapping_ingredients p2 JOIN inventory_items i2 ON i2.id=p2.item_id WHERE p2.mapping_id=pm.id ORDER BY CASE WHEN LOWER(i2.category) IN ('meats','meat','fish') THEN 0 ELSE 1 END, p2.id LIMIT 1)
 ORDER BY pm.dish_name")->fetchAll();

$countQ=$pdo->prepare("SELECT sc.* FROM stock_counts sc JOIN shifts s ON s.id=sc.shift_id
 WHERE sc.item_id=? AND sc.count_date=? ORDER BY sc.recorded_at DESC, sc.id DESC LIMIT 1");
$restockQ=$pdo->prepare("SELECT COALESCE(SUM(quantity),0) FROM restocks WHERE item_id=? AND restock_date=?");
$wasteQ=$pdo->prepare("SELECT COALESCE(SUM(quantity),0) FROM wastes WHERE item_id=? AND waste_date=?");
$start=new DateTimeImmutable($from); $end=new DateTimeImmutable($to); $today=date('Y-m-d');
$matrix=[]; $totals=[];
foreach($maps as $idx=>$m) $totals[]=['dishName'=>$m['dish_name'],'sellingPrice'=>(float)$m['selling_price'],'itemId'=>(int)$m['item_id'],'usedPerOrder'=>(float)$m['used_per_order'],'portions'=>0.0,'revenue'=>0.0,'counted'=>0,'pastDays'=>0,'noData'=>false,'partial'=>false,'_index'=>$idx];
for($d=$start;$d<=$end;$d=$d->modify('+1 day')) {
    $date=$d->format('Y-m-d'); $dishRows=[]; $future=$date>$today;
    foreach($maps as $idx=>$m) {
        $countQ->execute([(int)$m['item_id'],$date]); $sc=$countQ->fetch();
        $portions=0.0;
        if ($sc) {
            $restockQ->execute([(int)$m['item_id'],$date]); $restocks=(float)$restockQ->fetchColumn();
            $wasteQ->execute([(int)$m['item_id'],$date]); $waste=(float)$wasteQ->fetchColumn();
            $portions=(float)floor(max(0,((float)$sc['opening']+$restocks-$waste-(float)($sc['closing']??0))/(float)$m['used_per_order'])+0.0000001);
        }
        $revenue=$portions*(float)$m['selling_price'];
        $dishRows[]=['portions'=>$portions,'revenue'=>$revenue,'counted'=>(bool)$sc];
        $totals[$idx]['portions']+=$portions; $totals[$idx]['revenue']+=$revenue;
        if(!$future){$totals[$idx]['pastDays']++;if($sc)$totals[$idx]['counted']++;}
    }
    $matrix[]=['date'=>$date,'isFuture'=>$future,'dishes'=>$dishRows];
}
foreach($totals as &$t){$t['noData']=$t['pastDays']>0&&$t['counted']===0;$t['partial']=$t['counted']>0&&$t['counted']<$t['pastDays'];} unset($t);
usort($totals,fn($a,$b)=>$b['portions']<=>$a['portions']);
$dishes=array_map(fn($m)=>['dishName'=>$m['dish_name'],'sellingPrice'=>(float)$m['selling_price'],'itemId'=>(int)$m['item_id'],'usedPerOrder'=>(float)$m['used_per_order']],$maps);
$period=(string)($_GET['period']??'custom');
$view='days';
if ($period==='monthly' && $from===date('Y-01-01',strtotime($from)) && $to===date('Y-12-31',strtotime($from))) $view='year';
$range=['from'=>$from,'to'=>$to,'period'=>$period,'view'=>$view];
$format=(string)($_GET['format']??'json');
$basename='tapsihan-best-seller-'.$from.'-to-'.$to;
if($format==='xlsx'||$format==='pdf'){
    $ctx=report_export_context($range,$totals,$matrix,$user);
    if($format==='xlsx')send_xlsx_report($ctx,$basename.'.xlsx');
    send_pdf_report($ctx,$basename.'.pdf');
}
json_out(['ok'=>true,'range'=>$range,'dishes'=>$dishes,'matrix'=>$matrix,'reportData'=>$totals,'generatedAt'=>date(DATE_ATOM)]);
