<?php
declare(strict_types=1);

/*
 * Best-Seller report exports (PDF + Excel) for Tapsihan sa Asukarera.
 * Pure PHP: no Composer packages. The Excel export needs the ZipArchive extension (same as before).
 *
 * Entry points used by api/reports.php:
 *   report_export_context(...)  -> normalised data used by both exports
 *   send_pdf_report($ctx, $filename)
 *   send_xlsx_report($ctx, $filename)
 */

const RPT_DISH_COLORS = ['EF2B2D', '2563EB', '16A34A', '9333EA', 'EA580C', '0891B2', 'CA8A04', 'DB2777'];

/* =========================================================
   SHARED HELPERS
   ========================================================= */

function report_fmt_num(float $n): string
{
    if (abs($n - round($n)) < 0.005) {
        return number_format((float) round($n), 0, '.', ',');
    }
    return rtrim(rtrim(number_format($n, 2, '.', ','), '0'), '.');
}

function report_money(float $n): string
{
    return number_format($n, 2, '.', ',');
}

function report_nice_axis(float $max): array
{
    if ($max <= 0) {
        return [100.0, 4];
    }
    $rough = $max / 4;
    $mag = 10 ** floor(log10($rough));
    $norm = $rough / $mag;
    if ($norm <= 1) { $m = 1; } elseif ($norm <= 2) { $m = 2; } elseif ($norm <= 2.5) { $m = 2.5; } elseif ($norm <= 5) { $m = 5; } else { $m = 10; }
    $step = $m * $mag;
    $steps = (int) ceil($max / $step - 1e-9);
    if ($steps < 1) { $steps = 1; }
    return [$step * $steps, $steps];
}

/**
 * Turns the API's report data into one structure both exports use.
 * $totals = ranked dishes (each has '_index' into every matrix day's 'dishes').
 */
function report_export_context(array $range, array $totals, array $matrix, array $user): array
{
    $tz = new DateTimeZone('Asia/Manila');
    $from = new DateTimeImmutable((string) $range['from']);
    $to = new DateTimeImmutable((string) $range['to']);
    $days = (int) $from->diff($to)->days + 1;
    $period = (string) ($range['period'] ?? 'custom');
    $typeLabels = ['daily' => 'Daily', 'weekly' => 'Weekly', 'monthly' => 'Monthly', 'custom' => 'Custom range'];
    $typeLabel = $typeLabels[$period] ?? 'Custom range';

    $sameYear = $from->format('Y') === $to->format('Y');
    if ($days === 1) {
        $periodLabel = $from->format('l, F j, Y');
        $periodShort = $from->format('M j, Y');
    } elseif ($sameYear && $from->format('m-d') === '01-01' && $to->format('m-d') === '12-31') {
        $periodLabel = 'January – December ' . $from->format('Y');
        $periodShort = 'Year ' . $from->format('Y');
    } elseif ($from->format('Y-m') === $to->format('Y-m') && $from->format('d') === '01' && $to->format('Y-m-d') === $to->format('Y-m-t')) {
        $periodLabel = $from->format('F Y');
        $periodShort = $from->format('F Y');
    } else {
        $periodLabel = $from->format('F j, Y') . ' – ' . $to->format('F j, Y');
        $periodShort = $sameYear
            ? $from->format('M j') . ' – ' . $to->format('M j, Y')
            : $from->format('M j, Y') . ' – ' . $to->format('M j, Y');
    }

    /* ----- ranking ----- */
    $grand = 0.0;
    $grandPortions = 0.0;
    foreach ($totals as $t) {
        $grand += (float) $t['revenue'];
        $grandPortions += (float) $t['portions'];
    }
    $dishes = [];
    foreach (array_values($totals) as $i => $t) {
        if (!empty($t['noData'])) {
            $status = 'No count';
            $kind = 'none';
        } elseif (!empty($t['partial'])) {
            $status = $t['counted'] . '/' . $t['pastDays'] . ' days';
            $kind = 'partial';
        } elseif ((int) $t['pastDays'] === 0) {
            $status = 'Upcoming';
            $kind = 'partial';
        } else {
            $status = 'Complete';
            $kind = 'ok';
        }
        $dishes[] = [
            'rank' => $i + 1,
            'name' => (string) $t['dishName'],
            'portions' => (float) $t['portions'],
            'price' => (float) $t['sellingPrice'],
            'revenue' => (float) $t['revenue'],
            'share' => $grand > 0 ? (float) $t['revenue'] / $grand : 0.0,
            'status' => $status,
            'kind' => $kind,
            'index' => (int) $t['_index'],
        ];
    }

    /* ----- breakdown rows (days, or months for long ranges) ----- */
    $monthMode = $days > 62;
    $rows = [];
    $pastDays = 0;
    $countedDays = 0;
    $upcomingDays = 0;
    $utc = new DateTimeZone('UTC');

    if (!$monthMode) {
        foreach ($matrix as $day) {
            $d = new DateTimeImmutable((string) $day['date']);
            $portions = [];
            $revenues = [];
            $tp = 0.0;
            $rev = 0.0;
            $any = false;
            foreach ($dishes as $dish) {
                $rec = $day['dishes'][$dish['index']] ?? ['portions' => 0, 'revenue' => 0, 'counted' => false];
                $p = (float) $rec['portions'];
                $r = (float) $rec['revenue'];
                $portions[] = $p;
                $revenues[] = $r;
                $tp += $p;
                $rev += $r;
                if (!empty($rec['counted'])) { $any = true; }
            }
            $future = !empty($day['isFuture']);
            if ($future) { $upcomingDays++; } else { $pastDays++; if ($any) { $countedDays++; } }
            $serial = intdiv((new DateTimeImmutable($d->format('Y-m-d') . ' 00:00:00', $utc))->getTimestamp(), 86400) + 25569;
            $rows[] = [
                'label' => $d->format('D, M j'),
                'short' => $days <= 7 ? $d->format('D j') : $d->format('j'),
                'serial' => $serial,
                'portions' => $portions,
                'revenues' => $revenues,
                'totalPortions' => $tp,
                'revenue' => $rev,
                'future' => $future,
                'nodata' => (!$future && !$any),
            ];
        }
    } else {
        $groups = [];
        foreach ($matrix as $day) {
            $d = new DateTimeImmutable((string) $day['date']);
            $key = $d->format('Y-m');
            if (!isset($groups[$key])) {
                $groups[$key] = [
                    'date' => $d,
                    'portions' => array_fill(0, count($dishes), 0.0),
                    'revenues' => array_fill(0, count($dishes), 0.0),
                    'past' => 0, 'counted' => 0, 'all' => 0,
                ];
            }
            $groups[$key]['all']++;
            $any = false;
            foreach ($dishes as $di => $dish) {
                $rec = $day['dishes'][$dish['index']] ?? ['portions' => 0, 'revenue' => 0, 'counted' => false];
                $groups[$key]['portions'][$di] += (float) $rec['portions'];
                $groups[$key]['revenues'][$di] += (float) $rec['revenue'];
                if (!empty($rec['counted'])) { $any = true; }
            }
            if (!empty($day['isFuture'])) {
                $upcomingDays++;
            } else {
                $pastDays++;
                $groups[$key]['past']++;
                if ($any) { $countedDays++; $groups[$key]['counted']++; }
            }
        }
        foreach ($groups as $g) {
            $future = $g['past'] === 0;
            $rows[] = [
                'label' => $g['date']->format('F Y'),
                'short' => $sameYear ? $g['date']->format('M') : $g['date']->format('M y'),
                'serial' => null,
                'portions' => $g['portions'],
                'revenues' => $g['revenues'],
                'totalPortions' => array_sum($g['portions']),
                'revenue' => array_sum($g['revenues']),
                'future' => $future,
                'nodata' => (!$future && $g['counted'] === 0),
            ];
        }
    }

    $bestIdx = null;
    foreach ($rows as $i => $row) {
        if (!$row['future'] && $row['revenue'] > 0 && ($bestIdx === null || $row['revenue'] > $rows[$bestIdx]['revenue'])) {
            $bestIdx = $i;
        }
    }

    $bestSeller = null;
    foreach ($dishes as $dish) {
        if ($dish['portions'] > 0) { $bestSeller = $dish; break; }
    }

    $daysLabel = $days . ($days === 1 ? ' day' : ' days') . ' (' . $countedDays . ' with stock counts'
        . ($upcomingDays > 0 ? ', ' . $upcomingDays . ' upcoming' : '') . ')';

    $generated = (new DateTimeImmutable('now', $tz))->format('M j, Y g:i A');
    $who = trim((string) ($user['full_name'] ?? ''));
    if ($who === '') { $who = (string) ($user['username'] ?? 'User'); }

    return [
        'from' => (string) $range['from'],
        'to' => (string) $range['to'],
        'typeLabel' => $typeLabel,
        'periodLabel' => $periodLabel,
        'periodShort' => $periodShort,
        'days' => $days,
        'daysLabel' => $daysLabel,
        'countedDays' => $countedDays,
        'pastDays' => $pastDays,
        'monthMode' => $monthMode,
        'dishes' => $dishes,
        'rows' => $rows,
        'bestIdx' => $bestIdx,
        'bestSeller' => $bestSeller,
        'totalRevenue' => $grand,
        'totalPortions' => $grandPortions,
        'avgPerDay' => $countedDays > 0 ? $grand / $countedDays : 0.0,
        'generated' => $generated,
        'generatedBy' => $who,
    ];
}

/* =========================================================
   PDF
   ========================================================= */

final class ReportPdf
{
    private const HELV = [
        278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
        556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
        1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
        278, 278, 278, 469, 556,
        333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500,
        334, 260, 334, 584,
    ];
    private const HELV_B = [
        278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
        556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
        975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
        333, 278, 333, 584, 556,
        333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500,
        389, 280, 389, 584,
    ];

    private const M = 36.0;
    private float $W = 841.89;
    private float $H = 595.28;
    private float $y = 0.0;
    private string $c = '';
    private array $pages = [];
    private bool $started = false;
    private ?array $logo = null;
    private array $ctx = [];

    /* ---------- low-level drawing ---------- */

    private static function rgb(string $hex): string
    {
        return sprintf('%.3F %.3F %.3F', hexdec(substr($hex, 0, 2)) / 255, hexdec(substr($hex, 2, 2)) / 255, hexdec(substr($hex, 4, 2)) / 255);
    }

    private static function n(float $v): string
    {
        return sprintf('%.2F', $v);
    }

    private static function enc(string $s): string
    {
        $o = function_exists('iconv') ? @iconv('UTF-8', 'Windows-1252//TRANSLIT//IGNORE', $s) : false;
        if ($o === false || $o === null) {
            $o = (string) preg_replace('/[^\x20-\x7E]/', '?', $s);
        }
        return str_replace(["\r", "\n", "\t"], ' ', $o);
    }

    private static function esc(string $e): string
    {
        return str_replace(['\\', '(', ')'], ['\\\\', '\\(', '\\)'], $e);
    }

    private static function widthEnc(string $e, float $size, string $style): float
    {
        $t = $style === 'b' ? self::HELV_B : self::HELV;
        $fallback = $style === 'b' ? 611 : 556;
        $sum = 0;
        $len = strlen($e);
        for ($i = 0; $i < $len; $i++) {
            $o = ord($e[$i]);
            $sum += ($o >= 32 && $o <= 126) ? $t[$o - 32] : $fallback;
        }
        return $sum * $size / 1000;
    }

    private static function fit(string $e, float $size, string $style, float $maxW): string
    {
        if (self::widthEnc($e, $size, $style) <= $maxW) {
            return $e;
        }
        while ($e !== '' && self::widthEnc($e . '...', $size, $style) > $maxW) {
            $e = substr($e, 0, -1);
        }
        return rtrim($e) . '...';
    }

    private function tw(string $s, float $size, string $style): float
    {
        return self::widthEnc(self::enc($s), $size, $style);
    }

    private function rect(float $x, float $y, float $w, float $h, ?string $fill, ?string $stroke = null, float $lw = 0.5): void
    {
        if ($fill === null && $stroke === null) { return; }
        $s = '';
        if ($fill !== null) { $s .= self::rgb($fill) . " rg\n"; }
        if ($stroke !== null) { $s .= self::rgb($stroke) . " RG\n" . self::n($lw) . " w\n"; }
        $op = ($fill !== null && $stroke !== null) ? 'B' : ($fill !== null ? 'f' : 'S');
        $this->c .= $s . self::n($x) . ' ' . self::n($this->H - $y - $h) . ' ' . self::n($w) . ' ' . self::n($h) . " re $op\n";
    }

    private function rrect(float $x, float $y, float $w, float $h, float $r, ?string $fill, ?string $stroke = null, float $lw = 0.5): void
    {
        if ($fill === null && $stroke === null) { return; }
        $r = min($r, $w / 2, $h / 2);
        $k = 0.5523 * $r;
        $top = $this->H - $y;
        $bot = $top - $h;
        $x2 = $x + $w;
        $f = fn (float $v): string => self::n($v);
        $p = $f($x + $r) . ' ' . $f($top) . " m\n"
            . $f($x2 - $r) . ' ' . $f($top) . " l\n"
            . $f($x2 - $r + $k) . ' ' . $f($top) . ' ' . $f($x2) . ' ' . $f($top - $r + $k) . ' ' . $f($x2) . ' ' . $f($top - $r) . " c\n"
            . $f($x2) . ' ' . $f($bot + $r) . " l\n"
            . $f($x2) . ' ' . $f($bot + $r - $k) . ' ' . $f($x2 - $r + $k) . ' ' . $f($bot) . ' ' . $f($x2 - $r) . ' ' . $f($bot) . " c\n"
            . $f($x + $r) . ' ' . $f($bot) . " l\n"
            . $f($x + $r - $k) . ' ' . $f($bot) . ' ' . $f($x) . ' ' . $f($bot + $r - $k) . ' ' . $f($x) . ' ' . $f($bot + $r) . " c\n"
            . $f($x) . ' ' . $f($top - $r) . " l\n"
            . $f($x) . ' ' . $f($top - $r + $k) . ' ' . $f($x + $r - $k) . ' ' . $f($top) . ' ' . $f($x + $r) . ' ' . $f($top) . " c\nh\n";
        $s = '';
        if ($fill !== null) { $s .= self::rgb($fill) . " rg\n"; }
        if ($stroke !== null) { $s .= self::rgb($stroke) . " RG\n" . self::n($lw) . " w\n"; }
        $op = ($fill !== null && $stroke !== null) ? 'B' : ($fill !== null ? 'f' : 'S');
        $this->c .= $s . $p . $op . "\n";
    }

    private function line(float $x1, float $y1, float $x2, float $y2, string $hex, float $lw = 0.5): void
    {
        $this->c .= self::rgb($hex) . ' RG ' . self::n($lw) . ' w ' . self::n($x1) . ' ' . self::n($this->H - $y1) . ' m '
            . self::n($x2) . ' ' . self::n($this->H - $y2) . " l S\n";
    }

    /** $y is the text baseline measured from the top of the page. */
    private function text(float $x, float $y, string $s, float $size, string $hex, string $style = 'r', string $align = 'L', ?float $maxW = null): void
    {
        $e = self::enc($s);
        if ($maxW !== null) { $e = self::fit($e, $size, $style, $maxW); }
        $w = self::widthEnc($e, $size, $style);
        if ($align === 'R') { $x -= $w; } elseif ($align === 'C') { $x -= $w / 2; }
        $font = $style === 'b' ? 'F2' : ($style === 'i' ? 'F3' : 'F1');
        $this->c .= 'BT ' . self::rgb($hex) . " rg /$font " . self::n($size) . ' Tf ' . self::n($x) . ' ' . self::n($this->H - $y)
            . ' Td (' . self::esc($e) . ") Tj ET\n";
    }

    private function circlePath(float $cx, float $cy, float $r): string
    {
        $k = 0.5523 * $r;
        $f = fn (float $v): string => self::n($v);
        return $f($cx + $r) . ' ' . $f($cy) . " m\n"
            . $f($cx + $r) . ' ' . $f($cy + $k) . ' ' . $f($cx + $k) . ' ' . $f($cy + $r) . ' ' . $f($cx) . ' ' . $f($cy + $r) . " c\n"
            . $f($cx - $k) . ' ' . $f($cy + $r) . ' ' . $f($cx - $r) . ' ' . $f($cy + $k) . ' ' . $f($cx - $r) . ' ' . $f($cy) . " c\n"
            . $f($cx - $r) . ' ' . $f($cy - $k) . ' ' . $f($cx - $k) . ' ' . $f($cy - $r) . ' ' . $f($cx) . ' ' . $f($cy - $r) . " c\n"
            . $f($cx + $k) . ' ' . $f($cy - $r) . ' ' . $f($cx + $r) . ' ' . $f($cy - $k) . ' ' . $f($cx + $r) . ' ' . $f($cy) . " c\nh\n";
    }

    private function logoCircle(float $cx, float $top, float $r): void
    {
        $cy = $this->H - $top;
        $this->c .= self::rgb('FFFFFF') . " rg\n" . $this->circlePath($cx, $cy, $r + 1.5) . "f\n";
        if ($this->logo === null) {
            $this->c .= self::rgb('E32B2F') . " rg\n" . $this->circlePath($cx, $cy, $r) . "f\n";
            return;
        }
        $d = $r * 2;
        $this->c .= "q\n" . $this->circlePath($cx, $cy, $r) . "W n\n"
            . self::n($d) . ' 0 0 ' . self::n($d) . ' ' . self::n($cx - $r) . ' ' . self::n($cy - $r) . " cm\n/Im1 Do\nQ\n";
    }

    private function wrap(string $s, float $size, string $style, float $maxW): array
    {
        $words = preg_split('/\s+/', trim($s)) ?: [];
        $lines = [];
        $cur = '';
        foreach ($words as $w) {
            $try = $cur === '' ? $w : $cur . ' ' . $w;
            if ($cur === '' || $this->tw($try, $size, $style) <= $maxW) {
                $cur = $try;
            } else {
                $lines[] = $cur;
                $cur = $w;
            }
        }
        if ($cur !== '') { $lines[] = $cur; }
        return $lines;
    }

    /* ---------- page furniture ---------- */

    private function bottom(): float
    {
        return $this->H - 46;
    }

    private function contentW(): float
    {
        return $this->W - 2 * self::M;
    }

    private function header(bool $first): void
    {
        $W = $this->W;
        $h = $first ? 62.0 : 36.0;
        $this->rect(0, 0, $W, $h, '111111');
        $this->rect(0, $h, $W, 3, 'E32B2F');
        if ($first) {
            $this->logoCircle(self::M + 20, 31, 20);
            $this->text(self::M + 52, 29, 'TAPSIHAN SA ASUKARERA', 15, 'FFFFFF', 'b');
            $this->text(self::M + 52, 44, 'INVENTORY SYSTEM', 7.5, 'B8B3AA');
            $this->text($W - self::M, 29, 'BEST SELLER REPORT', 9, 'FF6B6E', 'b', 'R');
            $this->text($W - self::M, 44, $this->ctx['periodShort'], 8.5, 'DDDDDD', 'r', 'R');
            $this->y = $h + 3 + 22;
        } else {
            $this->logoCircle(self::M + 11, 18, 11);
            $this->text(self::M + 30, 21, 'TAPSIHAN SA ASUKARERA', 9.5, 'FFFFFF', 'b');
            $this->text($W - self::M, 21, 'Best Seller Report  |  ' . $this->ctx['periodShort'], 8.5, 'DDDDDD', 'r', 'R');
            $this->y = $h + 3 + 20;
        }
    }

    private function footer(int $n, int $total): void
    {
        $y = $this->H - 24;
        $this->line(self::M, $y - 11, $this->W - self::M, $y - 11, 'DDD8CE', 0.5);
        $this->text(self::M, $y, 'Tapsihan sa Asukarera - Inventory System', 7.5, '8A857C');
        $this->text($this->W / 2, $y, 'Generated ' . $this->ctx['generated'] . ' (Asia/Manila) by ' . $this->ctx['generatedBy'], 7.5, '8A857C', 'r', 'C');
        $this->text($this->W - self::M, $y, "Page $n of $total", 7.5, '8A857C', 'r', 'R');
    }

    private function newPage(): void
    {
        if ($this->started) {
            $this->pages[] = $this->c;
            $this->c = '';
        }
        $this->started = true;
        $this->header(count($this->pages) === 0);
    }

    private function ensure(float $need): void
    {
        if ($this->y + $need > $this->bottom()) {
            $this->newPage();
        }
    }

    private function sectionTitle(string $tag, string $title, string $caption = ''): void
    {
        $this->text(self::M, $this->y + 6, strtoupper($tag), 7, 'E32B2F', 'b');
        $this->text(self::M, $this->y + 21, $title, 13, '111111', 'b');
        if ($caption !== '') {
            $this->text($this->W - self::M, $this->y + 21, $caption, 8, '8A857C', 'r', 'R');
        }
        $this->y += 32;
    }

    /** Scales column definitions [title, width, align] to the content width and adds x positions. */
    private function layout(array $defs): array
    {
        $sum = 0.0;
        foreach ($defs as $d) { $sum += $d[1]; }
        $k = $this->contentW() / $sum;
        $x = self::M;
        $out = [];
        foreach ($defs as $d) {
            $w = $d[1] * $k;
            $out[] = ['title' => $d[0], 'w' => $w, 'a' => $d[2], 'x' => $x];
            $x += $w;
        }
        return $out;
    }

    private function cell(array $col, float $baseline, string $s, float $size, string $hex, string $style = 'r'): void
    {
        $pad = 8.0;
        if ($col['a'] === 'R') {
            $this->text($col['x'] + $col['w'] - $pad, $baseline, $s, $size, $hex, $style, 'R', $col['w'] - 2 * $pad);
        } elseif ($col['a'] === 'C') {
            $this->text($col['x'] + $col['w'] / 2, $baseline, $s, $size, $hex, $style, 'C', $col['w'] - 2 * $pad);
        } else {
            $this->text($col['x'] + $pad, $baseline, $s, $size, $hex, $style, 'L', $col['w'] - 2 * $pad);
        }
    }

    private function tableHeader(array $cols, float $h): void
    {
        $this->rect(self::M, $this->y, $this->contentW(), $h, '111111');
        foreach ($cols as $col) {
            $this->cell($col, $this->y + $h / 2 + 2.6, $col['title'], 7.5, 'FFFFFF', 'b');
        }
        $this->y += $h;
    }

    /* ---------- report sections ---------- */

    private function summaryCards(): void
    {
        $c = $this->ctx;
        $multi = count($c['rows']) > 1;
        $best = $c['bestSeller'];
        $cards = [];
        $cards[] = ['label' => 'Total revenue', 'value' => 'PHP ' . report_money((float) $c['totalRevenue']), 'sub' => 'Gross, at menu prices', 'size' => 16];
        $cards[] = [
            'label' => 'Portions sold',
            'value' => report_fmt_num((float) $c['totalPortions']),
            'sub' => $multi && $c['countedDays'] > 0
                ? 'Across ' . count($c['dishes']) . ' dishes  |  avg PHP ' . report_money((float) $c['avgPerDay']) . '/day'
                : 'Across ' . count($c['dishes']) . ' dishes',
            'size' => 16,
        ];
        $cards[] = [
            'label' => 'Best seller',
            'value' => $best ? $best['name'] : '-',
            'sub' => $best ? report_fmt_num($best['portions']) . ' portions  |  PHP ' . report_money($best['revenue']) : 'No sales recorded',
            'size' => 14,
        ];
        if ($multi) {
            $bi = $c['bestIdx'];
            $cards[] = [
                'label' => $c['monthMode'] ? 'Best month' : 'Best day',
                'value' => $bi !== null ? $c['rows'][$bi]['label'] : '-',
                'sub' => $bi !== null ? 'PHP ' . report_money($c['rows'][$bi]['revenue']) : 'No sales recorded',
                'size' => 14,
            ];
        } else {
            $total = count($c['dishes']);
            $counted = 0;
            foreach ($c['dishes'] as $d) { if ($d['kind'] === 'ok') { $counted++; } }
            $cards[] = ['label' => 'Data coverage', 'value' => $counted . ' of ' . $total, 'sub' => 'Dishes with a stock count', 'size' => 14];
        }

        $gap = 10.0;
        $n = count($cards);
        $w = ($this->contentW() - $gap * ($n - 1)) / $n;
        $h = 58.0;
        foreach ($cards as $i => $card) {
            $x = self::M + $i * ($w + $gap);
            $this->rrect($x, $this->y, $w, $h, 4, 'F7F5F1', 'E8E3DA', 0.6);
            $this->rect($x, $this->y + 9, 3, $h - 18, 'E32B2F');
            $this->text($x + 14, $this->y + 17, strtoupper($card['label']), 7, '8A857C', 'b');
            $this->text($x + 14, $this->y + 37, $card['value'], (float) $card['size'], '111111', 'b', 'L', $w - 24);
            $this->text($x + 14, $this->y + 50, $card['sub'], 7.5, '6B665D', 'r', 'L', $w - 24);
        }
        $this->y += $h + 20;
    }

    private function rankingTable(): void
    {
        $dishes = $this->ctx['dishes'];
        $this->ensure(32 + 24 + 24 * 2);
        $this->sectionTitle('Menu performance', 'Best-Seller Ranking', 'Ranked by portions sold');
        $cols = $this->layout([
            ['Rank', 36, 'C'], ['Dish', 175, 'L'], ['Portions Sold', 85, 'R'], ['Menu Price (PHP)', 100, 'R'],
            ['Gross Revenue (PHP)', 115, 'R'], ['Share of Revenue', 155, 'L'], ['Data', 104, 'C'],
        ]);
        $hh = 24.0;
        $rh = 23.0;
        $this->tableHeader($cols, $hh);
        $cw = $this->contentW();

        foreach ($dishes as $i => $d) {
            if ($this->y + $rh > $this->bottom()) {
                $this->newPage();
                $this->tableHeader($cols, $hh);
            }
            $this->rect(self::M, $this->y, $cw, $rh, $i % 2 === 0 ? 'FFFFFF' : 'FAF8F5');
            $this->line(self::M, $this->y + $rh, self::M + $cw, $this->y + $rh, 'EAE5DC', 0.5);
            $by = $this->y + $rh / 2 + 3;
            $color = RPT_DISH_COLORS[$i % count(RPT_DISH_COLORS)];

            $this->cell($cols[0], $by, (string) $d['rank'], 9, '111111', $i < 3 ? 'b' : 'r');
            $this->rrect($cols[1]['x'] + 10, $this->y + $rh / 2 - 3.5, 7, 7, 1.5, $color);
            $this->text($cols[1]['x'] + 24, $by, $d['name'], 9, '111111', 'b', 'L', $cols[1]['w'] - 32);
            $this->cell($cols[2], $by, report_fmt_num($d['portions']), 9, '111111');
            $this->cell($cols[3], $by, report_money($d['price']), 9, '444444');
            $this->cell($cols[4], $by, report_money($d['revenue']), 9, '111111', 'b');

            $trackX = $cols[5]['x'] + 10;
            $trackW = $cols[5]['w'] - 20 - 38;
            $this->rrect($trackX, $this->y + $rh / 2 - 3, $trackW, 6, 3, 'EFEBE4');
            if ($d['share'] > 0.002) {
                $this->rrect($trackX, $this->y + $rh / 2 - 3, max(4.0, $trackW * $d['share']), 6, 3, $color);
            }
            $this->text($cols[5]['x'] + $cols[5]['w'] - 8, $by, number_format($d['share'] * 100, 1) . '%', 8, '444444', 'r', 'R');

            $cx = $cols[6]['x'] + $cols[6]['w'] / 2;
            if ($d['kind'] === 'ok') {
                $this->text($cx, $by, $d['status'], 7.5, '2F7D32', 'r', 'C');
            } else {
                $pw = $this->tw($d['status'], 7, 'b') + 14;
                $isNone = $d['kind'] === 'none';
                $this->rrect($cx - $pw / 2, $this->y + $rh / 2 - 7, $pw, 14, 7, $isNone ? 'FFF3CD' : 'ECEAE5');
                $this->text($cx, $by - 0.3, $d['status'], 7, $isNone ? '8A6100' : '555555', 'b', 'C');
            }
            $this->y += $rh;
        }

        /* total row */
        $trh = 25.0;
        if ($this->y + $trh > $this->bottom()) {
            $this->newPage();
        }
        $this->rect(self::M, $this->y, $cw, $trh, 'F1ECE4');
        $this->line(self::M, $this->y, self::M + $cw, $this->y, '111111', 1.2);
        $by = $this->y + $trh / 2 + 3;
        $this->text($cols[1]['x'] + 10, $by, 'TOTAL', 8.5, '111111', 'b');
        $this->cell($cols[2], $by, report_fmt_num((float) $this->ctx['totalPortions']), 9, '111111', 'b');
        $this->cell($cols[3], $by, '-', 9, '8A857C');
        $this->cell($cols[4], $by, report_money((float) $this->ctx['totalRevenue']), 9, '111111', 'b');
        $this->text($cols[5]['x'] + $cols[5]['w'] - 8, $by, $this->ctx['totalRevenue'] > 0 ? '100.0%' : '0.0%', 8, '444444', 'b', 'R');
        $this->y += $trh + 22;
    }

    private function revenueChart(): void
    {
        $rows = $this->ctx['rows'];
        $n = count($rows);
        if ($n < 2) { return; }
        $h = 175.0;
        $this->ensure(32 + $h + 10);
        $this->sectionTitle('Trend', $this->ctx['monthMode'] ? 'Revenue by Month' : 'Revenue by Day', 'Gross revenue in PHP');

        $left = self::M + 46;
        $right = self::M + $this->contentW() - 4;
        $top = $this->y + 10;
        $plotH = $h - 46;
        $base = $top + $plotH;

        $max = 0.0;
        foreach ($rows as $r) { if (!$r['future']) { $max = max($max, (float) $r['revenue']); } }
        [$axisMax, $steps] = report_nice_axis($max);

        for ($i = 0; $i <= $steps; $i++) {
            $gy = $base - $plotH * $i / $steps;
            $this->line($left, $gy, $right, $gy, $i === 0 ? 'B5B0A6' : 'ECE8E0', $i === 0 ? 0.8 : 0.5);
            $this->text($left - 6, $gy + 2.6, number_format($axisMax * $i / $steps, 0, '.', ','), 7, '8A857C', 'r', 'R');
        }

        $slot = ($right - $left) / $n;
        $bw = min(38.0, $slot * 0.62);
        $labelEvery = $n > 40 ? 3 : ($n > 20 ? 2 : 1);
        foreach ($rows as $i => $r) {
            $x = $left + $slot * $i + ($slot - $bw) / 2;
            if (!$r['future'] && $r['revenue'] > 0) {
                $bh = max(1.0, $plotH * (float) $r['revenue'] / $axisMax);
                $this->rect($x, $base - $bh, $bw, $bh, $i === $this->ctx['bestIdx'] ? 'E32B2F' : 'F08A8C');
                if ($n <= 14) {
                    $this->text($x + $bw / 2, $base - $bh - 3.5, number_format((float) $r['revenue'], 0, '.', ','), 7, '444444', 'b', 'C');
                }
            }
            if ($i % $labelEvery === 0) {
                $this->text($x + $bw / 2, $base + 12, $r['short'], 7, '6B665D', 'r', 'C');
            }
        }
        $this->y = $base + 14 + 22;
    }

    private function breakdownTable(): void
    {
        $c = $this->ctx;
        $dishes = $c['dishes'];
        $rows = $c['rows'];
        $nd = count($dishes);
        $monthMode = $c['monthMode'];

        $this->ensure(32 + 24 + 17 * 3);
        $this->sectionTitle(
            'Selected period',
            $monthMode ? 'Monthly Breakdown' : 'Daily Breakdown',
            'Portions sold per dish  |  revenue in PHP'
        );

        $defs = [[$monthMode ? 'Month' : 'Date', 100, 'L']];
        $dishW = max(46.0, (770.0 - 100 - 72 - 100) / max(1, $nd));
        foreach ($dishes as $d) { $defs[] = [$d['name'], $dishW, 'C']; }
        $defs[] = ['Total Portions', 72, 'C'];
        $defs[] = ['Revenue (PHP)', 100, 'R'];
        $cols = $this->layout($defs);
        $hh = 24.0;
        $rh = 17.0;
        $cw = $this->contentW();
        $this->tableHeader($cols, $hh);
        $last = count($cols) - 1;

        foreach ($rows as $i => $r) {
            if ($this->y + $rh > $this->bottom()) {
                $this->newPage();
                $this->tableHeader($cols, $hh);
            }
            $isBest = ($i === $c['bestIdx']);
            $muted = $r['future'] || $r['nodata'];
            $this->rect(self::M, $this->y, $cw, $rh, $isBest ? 'FDECEB' : ($i % 2 === 0 ? 'FFFFFF' : 'FAF8F5'));
            $this->line(self::M, $this->y + $rh, self::M + $cw, $this->y + $rh, 'EFEBE4', 0.4);
            $by = $this->y + $rh / 2 + 2.8;
            $this->text($cols[0]['x'] + 8, $by, $r['label'], 8, $muted ? 'A8A398' : '111111', $isBest ? 'b' : 'r');
            if ($isBest) {
                $this->text($cols[0]['x'] + $cols[0]['w'] - 6, $by, 'BEST', 6.5, 'E32B2F', 'b', 'R');
            }
            foreach ($dishes as $di => $d) {
                $col = $cols[$di + 1];
                if ($muted) {
                    $this->cell($col, $by, '-', 8, 'B5B0A6');
                } else {
                    $p = (float) $r['portions'][$di];
                    $this->cell($col, $by, report_fmt_num($p), 8, $p > 0 ? '111111' : 'B5B0A6');
                }
            }
            if ($muted) {
                $this->cell($cols[$nd + 1], $by, '-', 8, 'B5B0A6');
                $this->cell($cols[$last], $by, $r['future'] ? 'Upcoming' : 'No count', 7.5, 'A8A398', 'i');
            } else {
                $this->cell($cols[$nd + 1], $by, report_fmt_num((float) $r['totalPortions']), 8, '111111', 'b');
                $this->cell($cols[$last], $by, report_money((float) $r['revenue']), 8, '111111', 'b');
            }
            $this->y += $rh;
        }

        $trh = 21.0;
        if ($this->y + $trh > $this->bottom()) {
            $this->newPage();
        }
        $this->rect(self::M, $this->y, $cw, $trh, 'F1ECE4');
        $this->line(self::M, $this->y, self::M + $cw, $this->y, '111111', 1.2);
        $by = $this->y + $trh / 2 + 3;
        $this->text($cols[0]['x'] + 8, $by, 'TOTAL', 8.5, '111111', 'b');
        foreach ($dishes as $di => $d) {
            $this->cell($cols[$di + 1], $by, report_fmt_num($d['portions']), 8.5, '111111', 'b');
        }
        $this->cell($cols[$nd + 1], $by, report_fmt_num((float) $c['totalPortions']), 8.5, '111111', 'b');
        $this->cell($cols[$last], $by, report_money((float) $c['totalRevenue']), 8.5, '111111', 'b');
        $this->y += $trh + 20;
    }

    private function notes(): void
    {
        $lines = [
            'Portions sold are estimated from stock movement: (opening count + restocks - waste - closing count) divided by the quantity of the main ingredient used per order, rounded down to whole portions.',
            'Gross revenue = portions sold x menu price. A day or dish without a stock count cannot be measured, so it shows "No count" and is left out of the totals.',
        ];
        $flag = [];
        foreach ($this->ctx['dishes'] as $d) {
            if ($d['kind'] === 'none') { $flag[] = $d['name'] . ' (no count)'; }
            elseif ($d['kind'] === 'partial' && $d['status'] !== 'Upcoming') { $flag[] = $d['name'] . ' (' . $d['status'] . ')'; }
        }
        if ($flag) {
            $lines[] = 'Please review stock counts for: ' . implode(', ', $flag) . '. Portions for these dishes may be understated.';
        }
        $wrapped = [];
        $maxW = $this->contentW() - 28;
        foreach ($lines as $l) { $wrapped[] = $this->wrap($l, 7.5, 'r', $maxW - 8); }
        $count = 0;
        foreach ($wrapped as $w) { $count += count($w); }
        $boxH = 28 + $count * 10.5 + count($wrapped) * 3;
        $this->ensure($boxH);
        $this->rrect(self::M, $this->y, $this->contentW(), $boxH, 4, 'F7F5F1', 'E8E3DA', 0.6);
        $this->text(self::M + 14, $this->y + 16, 'HOW TO READ THIS REPORT', 7, 'E32B2F', 'b');
        $yy = $this->y + 29;
        foreach ($wrapped as $w) {
            foreach ($w as $k => $line) {
                $this->text(self::M + 14, $yy, ($k === 0 ? '-  ' : '    ') . $line, 7.5, '5A554C');
                $yy += 10.5;
            }
            $yy += 3;
        }
        $this->y += $boxH + 10;
    }

    /* ---------- public ---------- */

    public function render(array $ctx, string $logoPath): string
    {
        $this->ctx = $ctx;
        if (is_file($logoPath)) {
            $info = @getimagesize($logoPath);
            $data = @file_get_contents($logoPath);
            if ($info && $data !== false && ($info[2] ?? 0) === IMAGETYPE_JPEG) {
                $ch = (int) ($info['channels'] ?? 3);
                $this->logo = [
                    'data' => $data, 'w' => (int) $info[0], 'h' => (int) $info[1],
                    'cs' => $ch === 1 ? 'DeviceGray' : ($ch === 4 ? 'DeviceCMYK' : 'DeviceRGB'),
                ];
            }
        }

        $this->newPage();
        $this->text(self::M, $this->y + 14, 'Best-Seller Report', 20, '111111', 'b');
        $this->text(self::M, $this->y + 31, $ctx['periodLabel'], 11, 'E32B2F', 'b');
        $this->text(self::M, $this->y + 45, $ctx['typeLabel'] . ' report  |  ' . $ctx['daysLabel'], 8.5, '6B665D');
        $this->y += 62;
        $this->summaryCards();
        $this->rankingTable();
        $this->revenueChart();
        $this->breakdownTable();
        $this->notes();

        return $this->assemble();
    }

    private function assemble(): string
    {
        if ($this->started) {
            $this->pages[] = $this->c;
            $this->c = '';
            $this->started = false;
        }
        $total = count($this->pages);
        foreach ($this->pages as $i => $content) {
            $this->c = '';
            $this->footer($i + 1, $total);
            $this->pages[$i] = $content . $this->c;
        }
        $this->c = '';

        $hasLogo = $this->logo !== null;
        $objs = [];
        $objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
        $objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
        $objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
        $objs[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>';
        $next = 6;
        if ($hasLogo) {
            $L = $this->logo;
            $objs[6] = '<< /Type /XObject /Subtype /Image /Width ' . $L['w'] . ' /Height ' . $L['h'] . ' /ColorSpace /' . $L['cs']
                . ' /BitsPerComponent 8 /Filter /DCTDecode /Length ' . strlen($L['data']) . " >>\nstream\n" . $L['data'] . "\nendstream";
            $next = 7;
        }
        $res = '<< /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >>' . ($hasLogo ? ' /XObject << /Im1 6 0 R >>' : '') . ' >>';
        $kids = [];
        foreach ($this->pages as $content) {
            $cid = $next++;
            $pid = $next++;
            $filter = '';
            if (function_exists('gzcompress')) {
                $z = gzcompress($content, 6);
                if ($z !== false) { $content = $z; $filter = ' /Filter /FlateDecode'; }
            }
            $objs[$cid] = '<< /Length ' . strlen($content) . $filter . " >>\nstream\n" . $content . "\nendstream";
            $objs[$pid] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' . self::n($this->W) . ' ' . self::n($this->H) . '] /Resources ' . $res . ' /Contents ' . $cid . ' 0 R >>';
            $kids[] = $pid . ' 0 R';
        }
        $objs[2] = '<< /Type /Pages /Kids [' . implode(' ', $kids) . '] /Count ' . count($kids) . ' >>';
        $infoId = $next++;
        $title = self::esc(self::enc('Best Seller Report ' . $this->ctx['periodShort'] . ' - Tapsihan sa Asukarera'));
        $objs[$infoId] = '<< /Title (' . $title . ') /Creator (Tapsihan Inventory System) /Producer (Tapsihan Inventory System) >>';

        ksort($objs);
        $pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
        $offsets = [];
        foreach ($objs as $id => $body) {
            $offsets[$id] = strlen($pdf);
            $pdf .= $id . " 0 obj\n" . $body . "\nendobj\n";
        }
        $xref = strlen($pdf);
        $count = max(array_keys($objs)) + 1;
        $pdf .= "xref\n0 $count\n0000000000 65535 f \n";
        for ($i = 1; $i < $count; $i++) {
            $pdf .= sprintf("%010d 00000 n \n", $offsets[$i]);
        }
        $pdf .= "trailer\n<< /Size $count /Root 1 0 R /Info $infoId 0 R >>\nstartxref\n$xref\n%%EOF";
        return $pdf;
    }
}

function send_pdf_report(array $ctx, string $filename): never
{
    $pdf = (new ReportPdf())->render($ctx, dirname(__DIR__) . '/logo.jpg');
    header('Content-Type: application/pdf');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    header('Cache-Control: no-store');
    header('Content-Length: ' . strlen($pdf));
    echo $pdf;
    exit;
}

/* =========================================================
   XLSX
   ========================================================= */

const XS_DEFAULT = 0, XS_TITLE = 1, XS_SUBTITLE = 2, XS_TH = 3, XS_TH_L = 4, XS_LABEL = 5, XS_TEXT = 6, XS_TEXT_C = 7,
    XS_NUM_C = 8, XS_MONEY = 9, XS_PCT = 10, XS_DATE = 11, XS_TOT_L = 12, XS_TOT_NUM = 13, XS_TOT_MONEY = 14, XS_TOT_PCT = 15,
    XS_NOTE = 16, XS_SECTION = 17, XS_KPI_TEXT = 18, XS_KPI_MONEY = 19, XS_KPI_NUM = 20, XS_BEST_DATE = 21, XS_BEST_TEXT = 22,
    XS_BEST_NUM = 23, XS_BEST_MONEY = 24, XS_WARN = 25, XS_MUTED_C = 26, XS_BEST_C = 27, XS_KPI_LABEL = 28;

function report_xlsx_col(int $n): string
{
    $s = '';
    while ($n > 0) {
        $r = ($n - 1) % 26;
        $s = chr(65 + $r) . $s;
        $n = intdiv($n - 1, 26);
    }
    return $s;
}

function report_xml(string $s): string
{
    $s = preg_replace('/[^\x{9}\x{A}\x{D}\x{20}-\x{D7FF}\x{E000}-\x{FFFD}]/u', '', $s) ?? $s;
    return htmlspecialchars($s, ENT_XML1 | ENT_QUOTES, 'UTF-8');
}

function report_xlsx_num(float $v): string
{
    $s = rtrim(rtrim(sprintf('%.10F', $v), '0'), '.');
    return ($s === '' || $s === '-0') ? '0' : $s;
}

final class ReportSheet
{
    public array $rows = [];
    public array $widths = [];
    public array $merges = [];
    public ?string $freeze = null;     // e.g. "B5"
    public ?string $filter = null;     // e.g. "A4:G20"
    public array $bars = [];           // ranges that get data bars
    public bool $selected = false;

    public function set(int $r, int $c, $v, int $s, ?string $f = null): void
    {
        $this->rows[$r]['cells'][$c] = ['v' => $v, 's' => $s, 'f' => $f];
    }

    public function fill(int $r, int $c1, int $c2, int $s): void
    {
        for ($c = $c1; $c <= $c2; $c++) {
            if (!isset($this->rows[$r]['cells'][$c])) {
                $this->rows[$r]['cells'][$c] = ['v' => null, 's' => $s, 'f' => null];
            }
        }
    }

    public function height(int $r, float $h): void
    {
        $this->rows[$r]['h'] = $h;
        if (!isset($this->rows[$r]['cells'])) { $this->rows[$r]['cells'] = []; }
    }

    public function merge(string $ref): void
    {
        $this->merges[] = $ref;
    }

    public function xml(): string
    {
        $x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';
        $x .= '<sheetPr><tabColor rgb="FFE32B2F"/><pageSetUpPr fitToPage="1"/></sheetPr>';
        $x .= '<sheetViews><sheetView showGridLines="0" workbookViewId="0"' . ($this->selected ? ' tabSelected="1"' : '') . '>';
        if ($this->freeze !== null && preg_match('/^([A-Z]+)(\d+)$/', $this->freeze, $m)) {
            $colIdx = 0;
            foreach (str_split($m[1]) as $ch) { $colIdx = $colIdx * 26 + (ord($ch) - 64); }
            $xs = $colIdx - 1;
            $ys = (int) $m[2] - 1;
            $pane = $xs > 0 && $ys > 0 ? 'bottomRight' : ($ys > 0 ? 'bottomLeft' : 'topRight');
            $x .= '<pane' . ($xs > 0 ? ' xSplit="' . $xs . '"' : '') . ($ys > 0 ? ' ySplit="' . $ys . '"' : '')
                . ' topLeftCell="' . $this->freeze . '" activePane="' . $pane . '" state="frozen"/>';
            $x .= '<selection pane="' . $pane . '" activeCell="' . $this->freeze . '" sqref="' . $this->freeze . '"/>';
        }
        $x .= '</sheetView></sheetViews>';
        $x .= '<sheetFormatPr defaultRowHeight="18" customHeight="1"/>';
        if ($this->widths) {
            $x .= '<cols>';
            foreach ($this->widths as $i => $w) {
                $x .= '<col min="' . ($i + 1) . '" max="' . ($i + 1) . '" width="' . report_xlsx_num((float) $w) . '" customWidth="1"/>';
            }
            $x .= '</cols>';
        }
        $x .= '<sheetData>';
        ksort($this->rows);
        foreach ($this->rows as $r => $row) {
            $x .= '<row r="' . $r . '"' . (isset($row['h']) ? ' ht="' . report_xlsx_num((float) $row['h']) . '" customHeight="1"' : '') . '>';
            $cells = $row['cells'] ?? [];
            ksort($cells);
            foreach ($cells as $c => $cell) {
                $ref = report_xlsx_col((int) $c) . $r;
                $v = $cell['v'];
                $s = (int) $cell['s'];
                if ($cell['f'] !== null) {
                    $x .= '<c r="' . $ref . '" s="' . $s . '"><f>' . report_xml($cell['f']) . '</f><v>' . report_xlsx_num((float) $v) . '</v></c>';
                } elseif ($v === null) {
                    $x .= '<c r="' . $ref . '" s="' . $s . '"/>';
                } elseif (is_int($v) || is_float($v)) {
                    $x .= '<c r="' . $ref . '" s="' . $s . '"><v>' . report_xlsx_num((float) $v) . '</v></c>';
                } else {
                    $x .= '<c r="' . $ref . '" s="' . $s . '" t="inlineStr"><is><t xml:space="preserve">' . report_xml((string) $v) . '</t></is></c>';
                }
            }
            $x .= '</row>';
        }
        $x .= '</sheetData>';
        if ($this->filter !== null) {
            $x .= '<autoFilter ref="' . $this->filter . '"/>';
        }
        if ($this->merges) {
            $x .= '<mergeCells count="' . count($this->merges) . '">';
            foreach ($this->merges as $m) { $x .= '<mergeCell ref="' . $m . '"/>'; }
            $x .= '</mergeCells>';
        }
        foreach ($this->bars as $i => $range) {
            $x .= '<conditionalFormatting sqref="' . $range . '"><cfRule type="dataBar" priority="' . ($i + 1) . '"><dataBar>'
                . '<cfvo type="num" val="0"/><cfvo type="max"/><color rgb="FFF4A3A5"/></dataBar></cfRule></conditionalFormatting>';
        }
        $x .= '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>';
        $x .= '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>';
        $x .= '</worksheet>';
        return $x;
    }
}

function report_xlsx_styles(): string
{
    /* fonts: 0 normal, 1 bold white, 2 title, 3 subtitle, 4 bold, 5 note, 6 section, 7 kpi, 8 muted, 9 bold red */
    $font = static function (string $color, float $sz, bool $b = false, bool $i = false): string {
        return '<font>' . ($b ? '<b/>' : '') . ($i ? '<i/>' : '') . '<sz val="' . report_xlsx_num($sz) . '"/><color rgb="FF' . $color . '"/><name val="Calibri"/><family val="2"/></font>';
    };
    $fonts = [
        $font('111111', 10), $font('FFFFFF', 10, true), $font('FFFFFF', 18, true), $font('FF6B6E', 11, true),
        $font('111111', 10, true), $font('6B665D', 9, false, true), $font('E32B2F', 12, true), $font('111111', 12, true),
        $font('B5B0A6', 10), $font('E32B2F', 10, true),
    ];
    $solid = static fn (string $rgb): string => '<fill><patternFill patternType="solid"><fgColor rgb="FF' . $rgb . '"/><bgColor indexed="64"/></patternFill></fill>';
    /* fills: 0 none, 1 gray125, 2 dark, 3 red, 4 warm, 5 total, 6 best, 7 amber */
    $fills = [
        '<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>',
        $solid('111111'), $solid('E32B2F'), $solid('F7F5F1'), $solid('F1ECE4'), $solid('FDECEB'), $solid('FFF3CD'),
    ];
    $borders = [
        '<border><left/><right/><top/><bottom/><diagonal/></border>',
        '<border><left/><right/><top/><bottom style="thin"><color rgb="FFE3DED5"/></bottom><diagonal/></border>',
        '<border><left/><right/><top style="medium"><color rgb="FF111111"/></top><bottom style="thin"><color rgb="FF111111"/></bottom><diagonal/></border>',
    ];
    /* [numFmt, font, fill, border, halign, valign, wrap] indexed by XS_* */
    $xfs = [
        XS_DEFAULT => [0, 0, 0, 0, 'general', 'center', false],
        XS_TITLE => [0, 2, 2, 0, 'left', 'center', false],
        XS_SUBTITLE => [0, 3, 2, 0, 'left', 'center', false],
        XS_TH => [0, 1, 2, 0, 'center', 'center', true],
        XS_TH_L => [0, 1, 2, 0, 'left', 'center', true],
        XS_LABEL => [0, 4, 0, 1, 'left', 'center', false],
        XS_TEXT => [0, 0, 0, 1, 'left', 'center', false],
        XS_TEXT_C => [0, 0, 0, 1, 'center', 'center', false],
        XS_NUM_C => [0, 0, 0, 1, 'center', 'center', false],
        XS_MONEY => [164, 0, 0, 1, 'right', 'center', false],
        XS_PCT => [165, 0, 0, 1, 'center', 'center', false],
        XS_DATE => [166, 0, 0, 1, 'left', 'center', false],
        XS_TOT_L => [0, 4, 5, 2, 'left', 'center', false],
        XS_TOT_NUM => [0, 4, 5, 2, 'center', 'center', false],
        XS_TOT_MONEY => [164, 4, 5, 2, 'right', 'center', false],
        XS_TOT_PCT => [165, 4, 5, 2, 'center', 'center', false],
        XS_NOTE => [0, 5, 0, 0, 'left', 'top', true],
        XS_SECTION => [0, 6, 0, 0, 'left', 'center', false],
        XS_KPI_TEXT => [0, 7, 4, 1, 'left', 'center', false],
        XS_KPI_MONEY => [164, 7, 4, 1, 'left', 'center', false],
        XS_KPI_NUM => [0, 7, 4, 1, 'left', 'center', false],
        XS_BEST_DATE => [166, 4, 6, 1, 'left', 'center', false],
        XS_BEST_TEXT => [0, 4, 6, 1, 'left', 'center', false],
        XS_BEST_NUM => [0, 4, 6, 1, 'center', 'center', false],
        XS_BEST_MONEY => [164, 4, 6, 1, 'right', 'center', false],
        XS_WARN => [0, 4, 7, 1, 'center', 'center', false],
        XS_MUTED_C => [0, 8, 0, 1, 'center', 'center', false],
        XS_BEST_C => [0, 9, 6, 1, 'center', 'center', false],
        XS_KPI_LABEL => [0, 4, 4, 1, 'left', 'center', false],
    ];
    ksort($xfs);

    $x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
    $x .= '<numFmts count="3">'
        . '<numFmt numFmtId="164" formatCode="&quot;₱&quot;#,##0.00"/>'
        . '<numFmt numFmtId="165" formatCode="0.0%"/>'
        . '<numFmt numFmtId="166" formatCode="ddd, mmm d, yyyy"/></numFmts>';
    $x .= '<fonts count="' . count($fonts) . '">' . implode('', $fonts) . '</fonts>';
    $x .= '<fills count="' . count($fills) . '">' . implode('', $fills) . '</fills>';
    $x .= '<borders count="' . count($borders) . '">' . implode('', $borders) . '</borders>';
    $x .= '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>';
    $x .= '<cellXfs count="' . count($xfs) . '">';
    foreach ($xfs as $d) {
        $x .= '<xf numFmtId="' . $d[0] . '" fontId="' . $d[1] . '" fillId="' . $d[2] . '" borderId="' . $d[3] . '" xfId="0"'
            . ' applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">'
            . '<alignment horizontal="' . $d[4] . '" vertical="' . $d[5] . '"' . ($d[6] ? ' wrapText="1"' : '') . '/></xf>';
    }
    $x .= '</cellXfs>';
    $x .= '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>';
    $x .= '</styleSheet>';
    return $x;
}

function report_sheet_banner(ReportSheet $sh, int $lastCol, string $subtitle): void
{
    $end = report_xlsx_col($lastCol);
    $sh->set(1, 1, 'TAPSIHAN SA ASUKARERA', XS_TITLE);
    $sh->fill(1, 1, $lastCol, XS_TITLE);
    $sh->merge("A1:{$end}1");
    $sh->height(1, 34);
    $sh->set(2, 1, $subtitle, XS_SUBTITLE);
    $sh->fill(2, 1, $lastCol, XS_SUBTITLE);
    $sh->merge("A2:{$end}2");
    $sh->height(2, 22);
    $sh->height(3, 8);
}

function report_sheet_summary(array $ctx): ReportSheet
{
    $sh = new ReportSheet();
    $sh->selected = true;
    $sh->widths = [8, 30, 16, 18, 20, 18, 16];
    report_sheet_banner($sh, 7, 'Best-Seller Report  |  ' . $ctx['periodLabel']);

    $meta = [
        ['Report period', $ctx['periodLabel']],
        ['Report type', $ctx['typeLabel']],
        ['Days covered', $ctx['daysLabel']],
        ['Generated', $ctx['generated'] . ' (Asia/Manila) by ' . $ctx['generatedBy']],
    ];
    $r = 4;
    foreach ($meta as $m) {
        $sh->set($r, 1, $m[0], XS_LABEL);
        $sh->fill($r, 1, 2, XS_LABEL);
        $sh->merge("A{$r}:B{$r}");
        $sh->set($r, 3, $m[1], XS_TEXT);
        $sh->fill($r, 3, 7, XS_TEXT);
        $sh->merge("C{$r}:G{$r}");
        $sh->height($r, 20);
        $r++;
    }
    $sh->height($r, 10);
    $r++;

    $dishes = $ctx['dishes'];
    $nd = count($dishes);

    /* positions needed for formulas */
    $kpiStart = $r + 1;                 // first KPI row (after the section heading)
    $kpiRows = 5;
    $rankHead = $kpiStart + $kpiRows + 2;       // blank row + section heading, then the header row
    $first = $rankHead + 1;
    $lastDish = $first + $nd - 1;
    $tot = $lastDish + 1;

    $sh->set($r, 1, 'KEY FIGURES', XS_SECTION);
    $sh->height($r, 22);
    $r++;
    $best = $ctx['bestSeller'];
    $multi = count($ctx['rows']) > 1;
    $bi = $ctx['bestIdx'];
    $kpis = [
        ['Total revenue (PHP)', (float) $ctx['totalRevenue'], XS_KPI_MONEY, $nd > 0 ? "E{$tot}" : null],
        ['Portions sold', (float) $ctx['totalPortions'], XS_KPI_NUM, $nd > 0 ? "C{$tot}" : null],
        ['Best seller', $best ? $best['name'] . '  (' . report_fmt_num($best['portions']) . ' portions)' : '-', XS_KPI_TEXT, null],
        [$ctx['monthMode'] ? 'Best month' : 'Best day', ($multi && $bi !== null) ? $ctx['rows'][$bi]['label'] . '  (PHP ' . report_money((float) $ctx['rows'][$bi]['revenue']) . ')' : '-', XS_KPI_TEXT, null],
        ['Average revenue per counted day (PHP)', (float) $ctx['avgPerDay'], XS_KPI_MONEY, null],
    ];
    foreach ($kpis as $k) {
        $sh->set($r, 1, $k[0], XS_KPI_LABEL);
        $sh->fill($r, 1, 2, XS_KPI_LABEL);
        $sh->merge("A{$r}:B{$r}");
        $sh->set($r, 3, $k[1], $k[2], $k[3]);
        $sh->fill($r, 3, 4, $k[2]);
        $sh->merge("C{$r}:D{$r}");
        $sh->height($r, 24);
        $r++;
    }
    $sh->height($r, 12);
    $r++;
    $sh->set($r, 1, 'BEST-SELLER RANKING', XS_SECTION);
    $sh->height($r, 22);
    $r++;

    /* ranking header */
    $heads = ['Rank', 'Dish', 'Portions Sold', 'Menu Price (PHP)', 'Gross Revenue (PHP)', 'Share of Revenue', 'Data'];
    foreach ($heads as $i => $h) {
        $sh->set($r, $i + 1, $h, $i === 1 ? XS_TH_L : XS_TH);
    }
    $sh->height($r, 30);
    $r++;

    foreach ($dishes as $d) {
        $sh->set($r, 1, $d['rank'], XS_TEXT_C);
        $sh->set($r, 2, $d['name'], XS_LABEL);
        $sh->set($r, 3, round($d['portions'], 2), XS_NUM_C);
        $sh->set($r, 4, round($d['price'], 2), XS_MONEY);
        $sh->set($r, 5, round($d['revenue'], 2), XS_MONEY);
        $sh->set($r, 6, $d['share'], XS_PCT, "IF(E\${$tot}=0,0,E{$r}/E\${$tot})");
        $sh->set($r, 7, $d['status'], $d['kind'] === 'ok' ? XS_TEXT_C : ($d['kind'] === 'none' ? XS_WARN : XS_MUTED_C));
        $sh->height($r, 22);
        $r++;
    }
    if ($nd > 0) {
        $sh->set($r, 1, 'Total', XS_TOT_L);
        $sh->fill($r, 1, 2, XS_TOT_L);
        $sh->merge("A{$r}:B{$r}");
        $sh->set($r, 3, round((float) $ctx['totalPortions'], 2), XS_TOT_NUM, "SUM(C{$first}:C{$lastDish})");
        $sh->set($r, 4, null, XS_TOT_NUM);
        $sh->set($r, 5, round((float) $ctx['totalRevenue'], 2), XS_TOT_MONEY, "SUM(E{$first}:E{$lastDish})");
        $sh->set($r, 6, $ctx['totalRevenue'] > 0 ? 1.0 : 0.0, XS_TOT_PCT, "SUM(F{$first}:F{$lastDish})");
        $sh->set($r, 7, null, XS_TOT_NUM);
        $sh->height($r, 24);
        $sh->bars[] = "F{$first}:F{$lastDish}";
        $r++;
    }
    $sh->height($r, 14);
    $r++;
    $sh->set($r, 1, 'HOW THESE FIGURES ARE CALCULATED', XS_SECTION);
    $sh->height($r, 22);
    $r++;
    $note = 'Portions sold are estimated from stock movement: (opening count + restocks - waste - closing count) divided by the quantity of the main ingredient used per order, rounded down to whole portions. '
        . 'Gross revenue = portions sold x menu price. A day or dish without a stock count cannot be measured, so it is marked "No count" and left out of the totals.';
    $flag = [];
    foreach ($dishes as $d) {
        if ($d['kind'] === 'none') { $flag[] = $d['name'] . ' (no count)'; }
        elseif ($d['kind'] === 'partial' && $d['status'] !== 'Upcoming') { $flag[] = $d['name'] . ' (' . $d['status'] . ')'; }
    }
    if ($flag) {
        $note .= ' Please review stock counts for: ' . implode(', ', $flag) . '. Portions for these dishes may be understated.';
    }
    $sh->set($r, 1, $note, XS_NOTE);
    $sh->merge("A{$r}:G{$r}");
    $sh->height($r, 58);
    return $sh;
}

function report_sheet_matrix(array $ctx, string $kind): ReportSheet
{
    $isRevenue = ($kind === 'revenue');
    $dishes = $ctx['dishes'];
    $rows = $ctx['rows'];
    $nd = count($dishes);
    $monthMode = $ctx['monthMode'];

    $sh = new ReportSheet();
    $totalCol = $nd + 2;
    $revCol = $isRevenue ? null : $totalCol + 1;
    $statusCol = ($revCol ?? $totalCol) + 1;
    $lastCol = $statusCol;

    $widths = [22];
    for ($i = 0; $i < $nd; $i++) { $widths[] = 16; }
    $widths[] = 16;
    if (!$isRevenue) { $widths[] = 18; }
    $widths[] = 16;
    $sh->widths = $widths;

    $what = $isRevenue ? 'Revenue (PHP) by dish' : 'Portions sold by dish';
    report_sheet_banner($sh, $lastCol, ($monthMode ? 'Monthly' : 'Daily') . ' breakdown  |  ' . $what . '  |  ' . $ctx['periodLabel']);

    $hr = 4;
    $sh->set($hr, 1, $monthMode ? 'Month' : 'Date', XS_TH_L);
    foreach ($dishes as $i => $d) { $sh->set($hr, $i + 2, $d['name'], XS_TH); }
    $sh->set($hr, $totalCol, $isRevenue ? 'Total Revenue (PHP)' : 'Total Portions', XS_TH);
    if (!$isRevenue) { $sh->set($hr, $revCol, 'Revenue (PHP)', XS_TH); }
    $sh->set($hr, $statusCol, 'Status', XS_TH);
    $sh->height($hr, 32);

    $r = $hr + 1;
    $first = $r;
    $sumCols = array_fill(0, $nd, 0.0);
    $sumTotal = 0.0;
    $sumRev = 0.0;
    $lastLetter = report_xlsx_col($nd + 1);
    foreach ($rows as $i => $row) {
        $isBest = ($i === $ctx['bestIdx']);
        $muted = $row['future'] || $row['nodata'];
        $sh->height($r, 20);

        if (!$monthMode && $row['serial'] !== null) {
            $sh->set($r, 1, (int) $row['serial'], $isBest ? XS_BEST_DATE : XS_DATE);
        } else {
            $sh->set($r, 1, $row['label'], $isBest ? XS_BEST_TEXT : XS_TEXT);
        }

        $vals = $isRevenue ? $row['revenues'] : $row['portions'];
        $rowSum = 0.0;
        foreach ($dishes as $di => $d) {
            if ($muted) {
                $sh->set($r, $di + 2, '-', XS_MUTED_C);
            } else {
                $v = round((float) $vals[$di], 2);
                $rowSum += $v;
                $sumCols[$di] += $v;
                $sh->set($r, $di + 2, $v, $isRevenue ? XS_MONEY : ($isBest ? XS_BEST_NUM : XS_NUM_C));
            }
        }
        if ($muted) {
            $sh->set($r, $totalCol, '-', XS_MUTED_C);
            if (!$isRevenue) { $sh->set($r, $revCol, '-', XS_MUTED_C); }
            $sh->set($r, $statusCol, $row['future'] ? 'Upcoming' : 'No stock count', $row['future'] ? XS_MUTED_C : XS_WARN);
        } else {
            $sumTotal += $rowSum;
            $totalStyle = $isRevenue ? ($isBest ? XS_BEST_MONEY : XS_MONEY) : ($isBest ? XS_BEST_NUM : XS_NUM_C);
            $sh->set($r, $totalCol, $rowSum, $totalStyle, "SUM(B{$r}:{$lastLetter}{$r})");
            if (!$isRevenue) {
                $rv = round((float) $row['revenue'], 2);
                $sumRev += $rv;
                $sh->set($r, $revCol, $rv, $isBest ? XS_BEST_MONEY : XS_MONEY);
            }
            $sh->set($r, $statusCol, $isBest ? ($monthMode ? 'Best month' : 'Best day') : '', $isBest ? XS_BEST_C : XS_TEXT_C);
        }
        $r++;
    }
    $lastRow = $r - 1;

    if (count($rows) > 0) {
        $sh->set($r, 1, 'Total', XS_TOT_L);
        foreach ($dishes as $di => $d) {
            $L = report_xlsx_col($di + 2);
            $sh->set($r, $di + 2, $sumCols[$di], $isRevenue ? XS_TOT_MONEY : XS_TOT_NUM, "SUM({$L}{$first}:{$L}{$lastRow})");
        }
        $TL = report_xlsx_col($totalCol);
        $sh->set($r, $totalCol, $sumTotal, $isRevenue ? XS_TOT_MONEY : XS_TOT_NUM, "SUM({$TL}{$first}:{$TL}{$lastRow})");
        if (!$isRevenue) {
            $RL = report_xlsx_col((int) $revCol);
            $sh->set($r, $revCol, $sumRev, XS_TOT_MONEY, "SUM({$RL}{$first}:{$RL}{$lastRow})");
        }
        $sh->set($r, $statusCol, null, XS_TOT_NUM);
        $sh->height($r, 24);

        $sh->filter = 'A' . $hr . ':' . report_xlsx_col($lastCol) . $lastRow;
        $barCol = report_xlsx_col($isRevenue ? $totalCol : (int) $revCol);
        $sh->bars[] = "{$barCol}{$first}:{$barCol}{$lastRow}";
    }
    $sh->freeze = 'B' . ($hr + 1);
    return $sh;
}

function send_xlsx_report(array $ctx, string $filename): never
{
    if (!class_exists('ZipArchive')) {
        json_out(['ok' => false, 'error' => 'Excel export requires the PHP ZipArchive extension. Enable php_zip in php.ini and restart Apache.'], 500);
    }
    $monthMode = $ctx['monthMode'];
    $sheets = [
        ['Summary', report_sheet_summary($ctx)],
        [$monthMode ? 'Portions by Month' : 'Portions by Day', report_sheet_matrix($ctx, 'portions')],
        [$monthMode ? 'Revenue by Month' : 'Revenue by Day', report_sheet_matrix($ctx, 'revenue')],
    ];

    $tmp = tempnam(sys_get_temp_dir(), 'xlsx');
    $zip = new ZipArchive();
    if ($zip->open($tmp, ZipArchive::OVERWRITE) !== true) {
        json_out(['ok' => false, 'error' => 'Unable to create Excel report.'], 500);
    }
    $hdr = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    $ct = $hdr . '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        . '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        . '<Default Extension="xml" ContentType="application/xml"/>'
        . '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        . '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>';
    $wbSheets = '';
    $wbRels = '';
    foreach ($sheets as $i => $s) {
        $n = $i + 1;
        $ct .= '<Override PartName="/xl/worksheets/sheet' . $n . '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
        $wbSheets .= '<sheet name="' . report_xml($s[0]) . '" sheetId="' . $n . '" r:id="rId' . $n . '"/>';
        $wbRels .= '<Relationship Id="rId' . $n . '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' . $n . '.xml"/>';
        $zip->addFromString('xl/worksheets/sheet' . $n . '.xml', $s[1]->xml());
    }
    $ct .= '</Types>';
    $styleRid = count($sheets) + 1;
    $wbRels .= '<Relationship Id="rId' . $styleRid . '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>';

    $zip->addFromString('[Content_Types].xml', $ct);
    $zip->addFromString('_rels/.rels', $hdr . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    $names = '';
    foreach ($sheets as $i => $s) {
        if ($s[1]->filter !== null && preg_match('/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/', $s[1]->filter, $m)) {
            $names .= '<definedName name="_xlnm._FilterDatabase" localSheetId="' . $i . '" hidden="1">\'' . report_xml($s[0]) . '\'!$' . $m[1] . '$' . $m[2] . ':$' . $m[3] . '$' . $m[4] . '</definedName>';
        }
    }
    $zip->addFromString('xl/workbook.xml', $hdr . '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        . '<bookViews><workbookView activeTab="0"/></bookViews><sheets>' . $wbSheets . '</sheets>'
        . ($names !== '' ? '<definedNames>' . $names . '</definedNames>' : '')
        . '<calcPr fullCalcOnLoad="1"/></workbook>');
    $zip->addFromString('xl/_rels/workbook.xml.rels', $hdr . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' . $wbRels . '</Relationships>');
    $zip->addFromString('xl/styles.xml', report_xlsx_styles());
    $zip->close();

    header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    header('Cache-Control: no-store');
    header('Content-Length: ' . filesize($tmp));
    readfile($tmp);
    unlink($tmp);
    exit;
}
