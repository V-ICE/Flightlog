<?php
// ============================================================
// UAVLogBook — Flight Log Processor
// Orchestrates: AI detect → parse → store → summarize
// ============================================================
require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../ai/import_engine.php';
require_once __DIR__ . '/../parsers/ardupilot_bin.php';
require_once __DIR__ . '/../parsers/multi_parsers.php';
require_once __DIR__ . '/../parsers/skyline_parser.php';

class FlightProcessor {

    public function process(int $flightId, string $filePath, string $originalName, int $userId = 0): void {
        // Update status to processing
        DB::query("UPDATE flights SET parse_status='processing' WHERE id=?", [$flightId]);

        try {
            // Step 1: AI-powered format detection
            $analysis = AIImportEngine::analyzeFile($filePath, $originalName);
            DB::query("UPDATE flights SET log_format=?, format_confidence=?, ai_analysis=? WHERE id=?", [
                $analysis['format'],
                $analysis['confidence'],
                json_encode($analysis),
                $flightId,
            ]);

            // Step 2: Parse the log file
            $parsed = $this->parseFile($filePath, $analysis, $userId);

            // Step 3: Downsample to TELEM_MAX_POINTS
            $gps     = $this->downsample($parsed['gps'],      TELEM_MAX_POINTS);
            $att     = $this->downsample($parsed['attitude'],  TELEM_MAX_POINTS);
            $batt    = $this->downsample($parsed['battery'],   TELEM_MAX_POINTS);
            $imu     = $this->downsample($parsed['imu'],       TELEM_MAX_POINTS);
            $rc      = $this->downsample($parsed['rc'],        TELEM_MAX_POINTS);
            $events  = $parsed['events'];
            $camera  = $parsed['camera'] ?? [];

            // Step 4: Store telemetry in DB
            $this->storeTelemetry($flightId, $gps, $att, $batt, $imu, $rc, $events, $camera);

            // Step 5: Compute flight summary stats
            $stats = $this->computeStats($gps, $batt, $events, $originalName);

            // Step 6: AI anomaly detection
            $aiResult = AIImportEngine::analyzeFlightAnomalies($stats, $events);

            // Step 7: Update flight record with stats
            DB::query("UPDATE flights SET
                parse_status='complete',
                flight_date=?, duration_sec=?, flight_duration_sec=?, idle_before_sec=?,
                takeoff_ms=?, landing_ms=?,
                max_altitude_m=?, max_speed_ms=?, max_distance_m=?, total_distance_m=?,
                home_lat=?, home_lng=?, bounding_box=?,
                min_battery_v=?, max_battery_v=?,
                warning_count=?, error_count=?,
                ai_analysis=?
                WHERE id=?", [
                $stats['flight_date'],
                $stats['duration_sec'],
                $stats['flight_duration_sec'],
                $stats['idle_before_sec'],
                $stats['takeoff_ms'],
                $stats['landing_ms'],
                $stats['max_altitude_m'],
                $stats['max_speed_ms'],
                $stats['max_distance_m'],
                $stats['total_distance_m'],
                $stats['home_lat'],
                $stats['home_lng'],
                json_encode($stats['bounding_box']),
                $stats['min_battery_v'],
                $stats['max_battery_v'],
                $stats['warning_count'],
                $stats['error_count'],
                json_encode(array_merge($analysis, ['flight_analysis' => $aiResult])),
                $flightId,
            ]);

        } catch (Exception $e) {
            DB::query("UPDATE flights SET parse_status='error', parse_error=? WHERE id=?",
                [$e->getMessage(), $flightId]);
            throw $e;
        }
    }

    private function parseFile(string $path, array $analysis, int $userId = 0): array {
        if ($analysis['format'] === 'skyline_skylog') {
            $parser = new SkylineParser();
            if ($userId) {
                $rows = DB::query(
                    "SELECT raw_key, mapped_to FROM user_log_mappings WHERE user_id=? AND log_format='skyline_skylog'",
                    [$userId]
                )->fetchAll();
                $mappings = [];
                foreach ($rows as $r) $mappings[$r['raw_key']] = $r['mapped_to'];
                $parser->setMappings($mappings);
            }
            return $parser->parse($path);
        }
        return match($analysis['format']) {
            'ardupilot_bin'   => (new ArduPilotBinParser())->parse($path),
            'px4_ulog'        => (new PX4ULogParser())->parse($path),
            'dji_csv','litchi_csv','generic_csv'
                              => (new DJICsvParser())->parse($path, $analysis['column_map'] ?? []),
            'gpx'             => (new GPXParser())->parse($path),
            'betaflight_bbl','inav_bbl'
                              => (new BetaflightBblParser())->parse($path),
            'dji_txt'         => $this->parseDJITxt($path),
            'kml','kmz'       => $this->parseKML($path),
            'ardupilot_text'  => $this->parseArduPilotText($path),
            default           => $this->genericFallbackParse($path, $analysis),
        };
    }

    private function storeTelemetry(int $flightId, array $gps, array $att,
                                     array $batt, array $imu, array $rc, array $events, array $camera = []): void {
        // Add flight_id to each row
        $addId = fn($rows) => array_map(fn($r) => ['flight_id' => $flightId] + $r, $rows);

        if ($gps)    DB::batchInsert('telemetry_gps',      $addId($gps));
        if ($att)    DB::batchInsert('telemetry_attitude',  $addId($att));
        if ($batt)   DB::batchInsert('telemetry_battery',   $addId($batt));
        if ($imu)    DB::batchInsert('telemetry_imu',       $addId($imu));
        if ($rc)     DB::batchInsert('telemetry_rc',        $addId($rc));
        if ($events) DB::batchInsert('flight_events',       $addId($events));
        if ($camera) DB::batchInsert('telemetry_camera',    $addId($camera));
    }

    private function computeStats(array $gps, array $batt, array $events, string $originalName = ''): array {
        $maxAlt = 0; $maxSpd = 0; $maxDist = 0; $totalDist = 0;
        $homeLat = null; $homeLng = null;
        $minLat = 999; $maxLat = -999; $minLng = 999; $maxLng = -999;
        $prevLat = null; $prevLng = null;
        $flightDate = null;
        $startMs = null; $endMs = null;

        foreach ($gps as $pt) {
            if ($homeLat === null && $pt['lat'] != 0) {
                $homeLat = $pt['lat']; $homeLng = $pt['lng'];
            }
            if ($startMs === null) $startMs = $pt['t_ms'];
            $endMs = $pt['t_ms'];

            $maxAlt = max($maxAlt, $pt['alt_m'] ?? 0);
            $maxSpd = max($maxSpd, $pt['speed_ms'] ?? 0);

            $minLat = min($minLat, $pt['lat']); $maxLat = max($maxLat, $pt['lat']);
            $minLng = min($minLng, $pt['lng']); $maxLng = max($maxLng, $pt['lng']);

            if ($prevLat !== null) {
                $d = $this->haversine($prevLat, $prevLng, $pt['lat'], $pt['lng']);
                $totalDist += $d;
                $maxDist = max($maxDist, $this->haversine($homeLat, $homeLng, $pt['lat'], $pt['lng']));
            }
            $prevLat = $pt['lat']; $prevLng = $pt['lng'];
        }

        // Detect takeoff and landing by altitude+speed threshold
        [$takeoffMs, $landingMs] = $this->detectTakeoffLanding($gps);

        $voltages = array_filter(array_column($batt, 'voltage_v'));
        $warnings = count(array_filter($events, fn($e) => $e['severity'] === 'warning'));
        $errors   = count(array_filter($events, fn($e) => $e['severity'] === 'error' || $e['severity'] === 'critical'));

        $totalDurationSec = $startMs !== null ? (int)(($endMs - $startMs) / 1000) : 0;
        $flightDurationSec = ($takeoffMs !== null && $landingMs !== null)
            ? (int)(($landingMs - $takeoffMs) / 1000)
            : $totalDurationSec;
        $idleBeforeSec = ($takeoffMs !== null && $startMs !== null)
            ? (int)(($takeoffMs - $startMs) / 1000)
            : 0;

        return [
            'flight_date'      => $flightDate ?? $this->parseDateFromFilename($originalName) ?? date('Y-m-d H:i:s', time()),
            'duration_sec'     => $totalDurationSec,
            'flight_duration_sec' => $flightDurationSec,
            'idle_before_sec'  => $idleBeforeSec,
            'takeoff_ms'       => $takeoffMs,
            'landing_ms'       => $landingMs,
            'max_altitude_m'   => round($maxAlt, 2),
            'max_speed_ms'     => round($maxSpd, 2),
            'max_distance_m'   => round($maxDist, 2),
            'total_distance_m' => round($totalDist, 2),
            'home_lat'         => $homeLat,
            'home_lng'         => $homeLng,
            'bounding_box'     => ['min_lat'=>$minLat,'max_lat'=>$maxLat,'min_lng'=>$minLng,'max_lng'=>$maxLng],
            'min_battery_v'    => $voltages ? round(min($voltages), 3) : null,
            'max_battery_v'    => $voltages ? round(max($voltages), 3) : null,
            'warning_count'    => $warnings,
            'error_count'      => $errors,
        ];
    }

    // Detect takeoff (first sustained altitude gain) and landing (last moment above threshold)
    // Returns [takeoff_ms, landing_ms] or [null, null] if not detectable
    private function detectTakeoffLanding(array $gps): array {
        if (count($gps) < 10) return [null, null];

        // Home altitude = median of first 10 points with valid alt
        $homeAlts = [];
        foreach (array_slice($gps, 0, 20) as $pt) {
            if (($pt['alt_m'] ?? null) !== null) $homeAlts[] = (float)$pt['alt_m'];
            if (count($homeAlts) >= 10) break;
        }
        if (!$homeAlts) return [null, null];
        sort($homeAlts);
        $homeAlt = $homeAlts[(int)(count($homeAlts) / 2)]; // median

        $altThreshold = $homeAlt + 5.0;  // 5m above home = flying
        $spdThreshold = 1.0;             // 1 m/s minimum speed

        // Find takeoff: first run of 3+ consecutive points above thresholds
        $takeoffMs = null;
        $streak = 0;
        $streakStart = null;
        foreach ($gps as $pt) {
            $alt = (float)($pt['alt_m'] ?? 0);
            $spd = (float)($pt['speed_ms'] ?? 0);
            if ($alt > $altThreshold && $spd > $spdThreshold) {
                if ($streak === 0) $streakStart = $pt['t_ms'];
                $streak++;
                if ($streak >= 3) { $takeoffMs = $streakStart; break; }
            } else {
                $streak = 0; $streakStart = null;
            }
        }

        // Find landing: last point above thresholds (scan backwards)
        $landingMs = null;
        foreach (array_reverse($gps) as $pt) {
            $alt = (float)($pt['alt_m'] ?? 0);
            $spd = (float)($pt['speed_ms'] ?? 0);
            if ($alt > $altThreshold || $spd > $spdThreshold) {
                $landingMs = $pt['t_ms'];
                break;
            }
        }

        return [$takeoffMs, $landingMs];
    }

    private function downsample(array $data, int $maxPoints): array {
        $n = count($data);
        if ($n <= $maxPoints || $n === 0) return $data;
        $step = $n / $maxPoints;
        $result = [];
        for ($i = 0; $i < $maxPoints; $i++) {
            $result[] = $data[(int)round($i * $step)];
        }
        return $result;
    }

    // Extract flight date from common log filename patterns
    private function parseDateFromFilename(string $name): ?string {
        // Skyline:   log-20260525-112946.skylog   → 2026-05-25 11:29:46
        // DJI GO:    DJI_20260525_112946_001.mp4
        // RunCam:    RC_2026-05-25_11-29-00.mp4
        // GoPro:     GH010123_20260525_112946.mp4
        // ArduPilot: 2026-05-25_11-29-46.bin
        // Generic:   2026-05-25 11:29:46 anywhere
        $patterns = [
            // YYYYMMDD-HHMMSS  (Skyline, DJI, GoPro)
            '/(\d{4})(\d{2})(\d{2})[-_T](\d{2})(\d{2})(\d{2})/',
            // YYYY-MM-DD_HH-MM-SS  (ArduPilot text, RunCam)
            '/(\d{4})-(\d{2})-(\d{2})[_T ](\d{2})-(\d{2})-(\d{2})/',
            // YYYY-MM-DD HH:MM:SS
            '/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/',
            // YYYYMMDD only (fallback, no time)
            '/(\d{4})(\d{2})(\d{2})/',
        ];
        foreach ($patterns as $i => $pattern) {
            if (preg_match($pattern, $name, $m)) {
                if ($i === 3) {
                    // Date only
                    return "{$m[1]}-{$m[2]}-{$m[3]} 00:00:00";
                }
                // Validate ranges
                if ((int)$m[2] < 1 || (int)$m[2] > 12) continue;
                if ((int)$m[3] < 1 || (int)$m[3] > 31) continue;
                return "{$m[1]}-{$m[2]}-{$m[3]} {$m[4]}:{$m[5]}:{$m[6]}";
            }
        }
        return null;
    }

    private function haversine(float $lat1, float $lng1, float $lat2, float $lng2): float {
        $R = 6371000; // Earth radius in meters
        $dLat = deg2rad($lat2-$lat1); $dLng = deg2rad($lng2-$lng1);
        $a = sin($dLat/2)**2 + cos(deg2rad($lat1))*cos(deg2rad($lat2))*sin($dLng/2)**2;
        return $R * 2 * atan2(sqrt($a), sqrt(1-$a));
    }

    // Basic DJI TXT parser (reverse-engineered format)
    private function parseDJITxt(string $path): array {
        // DJI TXT is proprietary binary — extract what we can
        // Full decryption requires DJI SDK; we handle the readable portions
        $gps = []; $events = [];
        $fp = fopen($path, 'rb');
        $data = fread($fp, filesize($path));
        fclose($fp);

        // Try to find GPS records by pattern (lat/lng as little-endian doubles)
        // DJI stores coords as int32 * 1e-7
        for ($i = 0; $i < strlen($data) - 12; $i++) {
            $lat = unpack('l', substr($data, $i, 4))[1] / 1e7;
            $lng = unpack('l', substr($data, $i+4, 4))[1] / 1e7;
            if ($lat > -90 && $lat < 90 && $lng > -180 && $lng < 180 && abs($lat) > 0.001) {
                // Plausible GPS coord — could be false positive but filtering helps
                // Sample every 50 bytes to avoid duplication
                $gps[] = ['t_ms' => $i*2, 'lat' => $lat, 'lng' => $lng,
                           'alt_m' => null, 'speed_ms' => null];
                $i += 49; // skip ahead
            }
        }
        // Deduplicate nearby points
        $filtered = [];
        $prev = null;
        foreach ($gps as $pt) {
            if ($prev === null || abs($pt['lat']-$prev['lat']) > 0.000001) {
                $filtered[] = $pt; $prev = $pt;
            }
        }
        return ['gps'=>$filtered,'attitude'=>[],'battery'=>[],'imu'=>[],'rc'=>[],'events'=>$events,'params'=>[]];
    }

    private function parseKML(string $path): array {
        $gps = [];
        $xml = simplexml_load_file($path);
        if (!$xml) return ['gps'=>[],'attitude'=>[],'battery'=>[],'imu'=>[],'rc'=>[],'events'=>[],'params'=>[]];
        $xml->registerXPathNamespace('kml','http://www.opengis.net/kml/2.2');
        $coords = $xml->xpath('//kml:coordinates') ?: $xml->xpath('//coordinates');
        foreach ($coords as $coord) {
            foreach (array_filter(array_map('trim', preg_split('/\s+/', (string)$coord))) as $i => $point) {
                $parts = explode(',', $point);
                if (count($parts) >= 2) {
                    $gps[] = ['t_ms'=>$i*1000,'lat'=>(float)$parts[1],'lng'=>(float)$parts[0],
                               'alt_m'=>isset($parts[2])?(float)$parts[2]:null,'speed_ms'=>null];
                }
            }
        }
        return ['gps'=>$gps,'attitude'=>[],'battery'=>[],'imu'=>[],'rc'=>[],'events'=>[],'params'=>[]];
    }

    private function parseArduPilotText(string $path): array {
        $gps = $att = $batt = $imu = $events = [];
        $fp = fopen($path, 'r');
        while (($line = fgets($fp, 2048)) !== false) {
            $parts = array_map('trim', explode(',', $line));
            if (count($parts) < 3) continue;
            $type = $parts[0];
            switch ($type) {
                case 'GPS':
                    if (count($parts) > 8) {
                        $tMs = (int)((float)($parts[1]??0)/1000);
                        $gps[] = ['t_ms'=>$tMs,'lat'=>(float)($parts[7]??0),
                                  'lng'=>(float)($parts[8]??0),'alt_m'=>(float)($parts[9]??0),
                                  'speed_ms'=>(float)($parts[6]??0),'sats'=>(int)($parts[5]??0)];
                    }
                    break;
                case 'ATT':
                    if (count($parts) > 8) {
                        $att[] = ['t_ms'=>(int)((float)$parts[1]/1000),
                                  'roll_deg'=>(float)$parts[3],'pitch_deg'=>(float)$parts[5],
                                  'yaw_deg'=>(float)$parts[7]];
                    }
                    break;
                case 'MSG':
                    $events[] = ['t_ms'=>(int)((float)$parts[1]/1000),
                                 'event_type'=>'message','severity'=>'info',
                                 'value'=>'','description'=>implode(',', array_slice($parts,2))];
                    break;
            }
        }
        fclose($fp);
        return ['gps'=>$gps,'attitude'=>$att,'battery'=>$batt,'imu'=>$imu,'rc'=>[],'events'=>$events,'params'=>[]];
    }

    private function genericFallbackParse(string $path, array $analysis): array {
        // Last resort: try CSV with AI-detected column map
        $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        if (in_array($ext, ['csv','txt','log'])) {
            return (new DJICsvParser())->parse($path, $analysis['column_map'] ?? []);
        }
        throw new Exception("Unsupported format: {$analysis['format']}");
    }
}
