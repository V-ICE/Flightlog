<?php
error_reporting(E_ALL);
ini_set('display_errors', 1);
ini_set('memory_limit', '512M');
require '/var/www/html/api/config/config.php';
require '/var/www/html/api/config/db.php';

function detectTakeoffLanding(array $gps): array {
    if (count($gps) < 10) return [null, null, null];
    $homeAlts = [];
    foreach (array_slice($gps, 0, 20) as $pt) {
        if ($pt['alt_m'] !== null) $homeAlts[] = (float)$pt['alt_m'];
        if (count($homeAlts) >= 10) break;
    }
    if (!$homeAlts) return [null, null, null];
    sort($homeAlts);
    $homeAlt = $homeAlts[(int)(count($homeAlts) / 2)];
    $altThreshold = $homeAlt + 5.0;
    $spdThreshold = 1.0;

    $firstMs = $gps[0]['t_ms'];
    $takeoffMs = null; $streak = 0; $streakStart = null;
    foreach ($gps as $pt) {
        $alt = (float)($pt['alt_m'] ?? 0);
        $spd = (float)($pt['speed_ms'] ?? 0);
        if ($alt > $altThreshold && $spd > $spdThreshold) {
            if ($streak === 0) $streakStart = $pt['t_ms'];
            $streak++;
            if ($streak >= 3) { $takeoffMs = $streakStart; break; }
        } else { $streak = 0; $streakStart = null; }
    }

    $landingMs = null;
    foreach (array_reverse($gps) as $pt) {
        $alt = (float)($pt['alt_m'] ?? 0);
        $spd = (float)($pt['speed_ms'] ?? 0);
        if ($alt > $altThreshold || $spd > $spdThreshold) { $landingMs = $pt['t_ms']; break; }
    }
    return [$firstMs, $takeoffMs, $landingMs];
}

$flights = DB::query('SELECT id, original_filename FROM flights')->fetchAll();
foreach ($flights as $f) {
    echo "Flight {$f['id']} ({$f['original_filename']}): ";
    flush();
    $gps = DB::query(
        'SELECT t_ms, alt_m, speed_ms FROM telemetry_gps WHERE flight_id=? ORDER BY t_ms',
        [$f['id']]
    )->fetchAll(PDO::FETCH_ASSOC);

    echo count($gps) . " pts... ";
    flush();

    if (!$gps) { echo "no GPS\n"; continue; }

    [$firstMs, $takeoffMs, $landingMs] = detectTakeoffLanding($gps);
    $idleSec   = ($takeoffMs !== null) ? (int)(($takeoffMs - $firstMs) / 1000) : 0;
    $flightSec = ($takeoffMs && $landingMs) ? (int)(($landingMs - $takeoffMs) / 1000) : null;

    DB::query(
        'UPDATE flights SET takeoff_ms=?, landing_ms=?, flight_duration_sec=?, idle_before_sec=? WHERE id=?',
        [$takeoffMs, $landingMs, $flightSec, $idleSec, $f['id']]
    );
    echo "idle={$idleSec}s  flight={$flightSec}s  takeoff_ms={$takeoffMs}\n";
    flush();
}
echo "Done\n";
