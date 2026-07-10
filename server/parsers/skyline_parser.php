<?php
// ============================================================
// Flightlog — Skyline .skylog Parser
//
// Format: Skyline ground control / telemetry system
// Extension: .skylog
// Structure: text file, one brace-delimited record per line
//
// REVERSE-ENGINEERED FORMAT SPECIFICATION:
// =========================================
// Each line is one of:
//   {unix_timestamp}              -- bare integer unix timestamp (seconds)
//   {key:value}                   -- record with key and value
//   >{key:value}                  -- uplink/command record (prefixed with >)
//
// KEY RECORD TYPES:
//
// TIMESTAMP:
//   {1779697786}                  -- Unix timestamp in seconds
//
// TLM (telemetry binary, 28 bytes hex-encoded):
//   {tlm:"aabbcc..."}
//   Packet structure:
//     Byte  0:     0xAA magic marker
//     Bytes 1-3:   rolling counter (uint24 LE)
//     Byte  3:     packet subtype (ALL subtypes carry GPS at offsets 12-19)
//     Bytes 4-5:   int16 LE = relative altitude in cm (above home)
//                  ONLY valid when byte[5] < 128 (high bit clear).
//                  Works across all subtype families (0x2x, 0x3x, 0x5x).
//     Bytes 6-11:  subtype-dependent payload (cannot be reliably decoded)
//                  DO NOT parse speed from bytes 8-9: the encoding varies
//                  per subtype in ways that produce 85-300 m/s bogus values.
//                  Speed is computed from consecutive GPS position deltas.
//     Bytes 12-15: int32 LE = latitude  * 1e7 (degrees) — all subtypes
//     Bytes 16-19: int32 LE = longitude * 1e7 (degrees) — all subtypes
//     Bytes 20-27: additional data (subtype-dependent)
//
// BATTERY:
//   {vbatt:[raw_int, amps_float]}
//   Voltage = raw_int / 100.0 (Volts)
//   Amps = float directly
//
// MONITOR (link/system health):
//   {mon:[v0,v1,v2,v3,v4,v5,link_pct,snr,v8,v9,txpow,v11,armed]}
//   mon[6]  = link quality percentage (0-100)
//   mon[7]  = SNR value
//   mon[10] = TX power / armed indicator (-9 = disarmed, >=0 = armed)
//   mon[12] = armed flag (2 = armed, 0 = disarmed)
//
// SBUS (RC channel data):
//   {sbus:"hex_string"}   -- 31-byte RC frame
//   Channels 1-16 stored as uint16 LE at byte offsets 0,2,4,...30
//   SBUS range: 172 (min) - 1811 (max), center = 992
//   Convert to microseconds: ((val - 992) / 819 * 500) + 1500
//
// HOME position:
//   {home:lat_1e7, lng_1e7, alt_mm}
//   lat = lat_1e7 / 1e7, lng = lng_1e7 / 1e7, alt = alt_mm / 1000 (m)
//
// ENV (environment/firmware):
//   {env:{v:"0.9.36", f:410, s:0.3125, txp:-9, id:122, cfg:0, ls:14}}
//   v = firmware version, f = frequency, id = device ID
//
// STATUSTEXT (log messages):
//   {statustext:[severity, "message text"]}
//   severity: 1=Emergency, 2=Alert, 3=Critical, 4=Error, 5=Warning, 6=Info
//
// REF_SET (reference/waypoint points):
//   {ref_set:[id, alt_m, lat, lng, reserved, active_flag]}          ← older firmware (6 fields)
//   {ref_set:[id, alt_m, lat, lng, reserved, active_flag,0,0,0,0]}  ← newer firmware (10 fields)
//   First ref_set is used as home altitude when no {home:} block is present.
//
// GIMBAL:
//   {gimbal:"aabbccdd"}   -- 4 bytes
//   byte[1] = pan  (signed int8, degrees)
//   byte[2] = tilt (signed int8, degrees)
//
// T (temperatures):
//   {t:[v1, v2]}   -- values in tenths of degrees Celsius, divide by 10
//
// MISSION_CURRENT:
//   {mission_current: N}   -- current waypoint index being flown
//
// VHCL (vehicle identifier):
//   {vhcl:["name", id]}
//
// ============================================================

class SkylineParser {

    private int    $homeAltMm  = 0;
    private float  $homeLat    = 0.0;
    private float  $homeLng    = 0.0;
    private int    $baseTs     = 0;
    private int    $currentTs  = 0;
    private string $firmwareVer = '';
    private string $vehicleName = '';

    // User-defined mappings: raw_key → mapped_to ('camera_trigger','ignore','custom:label')
    private array $mappings = [];

    // Parsed data arrays
    private array $gps       = [];
    private array $attitude  = [];
    private array $battery   = [];
    private array $imu       = [];
    private array $rc        = [];
    private array $events    = [];
    private array $camera    = [];
    private array $waypoints = [];
    private array $params    = [];
    private array $unknownKeys = [];  // key → ['example'=>..., 'count'=>N]

    public function setMappings(array $mappings): void {
        $this->mappings = $mappings;
    }

    public function parse(string $filePath): array {
        $fp = fopen($filePath, 'r');
        if (!$fp) throw new Exception("Cannot open file: $filePath");

        while (($line = fgets($fp)) !== false) {
            $line = trim($line);
            if ($line === '') continue;

            // Strip leading > (uplink/command marker)
            $isCmd = str_starts_with($line, '>');
            if ($isCmd) $line = substr($line, 1);

            $this->parseLine($line, $isCmd);
        }

        fclose($fp);
        return $this->buildResult();
    }

    private function parseLine(string $line, bool $isCmd): void {
        // ── Bare timestamp: {1779697786} ──────────────────────────
        if (preg_match('/^\{(\d{9,11})\}$/', $line, $m)) {
            $ts = (int)$m[1];
            if ($this->baseTs === 0) $this->baseTs = $ts;
            $this->currentTs = $ts;
            return;
        }

        // ── Binary telemetry: {tlm:"hexstring"} ───────────────────
        if (preg_match('/^\{tlm:"([0-9a-f]+)"\}$/', $line, $m)) {
            $this->parseTlm($m[1]);
            return;
        }

        // ── Battery: {vbatt:[raw,amps]} ───────────────────────────
        if (preg_match('/^\{vbatt:\[(\d+),([\d.]+)\]\}$/', $line, $m)) {
            $this->battery[] = [
                't_ms'          => $this->tMs(),
                'voltage_v'     => round((int)$m[1] / 100.0, 2),
                'current_a'     => (float)$m[2],
                'remaining_pct' => null,
                'consumed_mah'  => null,
                'temp_c'        => null,
            ];
            return;
        }

        // ── Monitor: {mon:[...]} ──────────────────────────────────
        if (preg_match('/^\{mon:\[([^\]]+)\]\}$/', $line, $m)) {
            $vals = array_map('intval', explode(',', $m[1]));
            $this->parseMon($vals);
            return;
        }

        // ── SBUS RC channels: {sbus:"hex"} ────────────────────────
        if (preg_match('/^\{sbus:"([0-9a-f]+)"\}$/', $line, $m)) {
            $this->parseSbus($m[1]);
            return;
        }

        // ── Home position: {home:lat*1e7,lng*1e7,alt_mm} ─────────
        if (preg_match('/^\{home:(-?\d+),(-?\d+),(-?\d+)\}$/', $line, $m)) {
            $this->homeLat   = (int)$m[1] / 1e7;
            $this->homeLng   = (int)$m[2] / 1e7;
            $this->homeAltMm = (int)$m[3];
            return;
        }

        // ── Status text: {statustext:[sev,"msg"]} ────────────────
        if (preg_match('/^\{statustext:\[(\d+),"([^"]+)"\]\}$/', $line, $m)) {
            $sev = (int)$m[1];
            $msg = $m[2];
            $severity = match(true) {
                $sev <= 3 => 'critical',
                $sev == 4 => 'error',
                $sev == 5 => 'warning',
                default   => 'info',
            };
            // Detect camera shutter: "Relay 2 High" (any case/spacing)
            if (preg_match('/relay\s*2\s*high/i', $msg)) {
                $this->camera[] = ['t_ms' => $this->tMs()];
                // also log as an event so it shows in timeline
                $this->events[] = [
                    't_ms'        => $this->tMs(),
                    'event_type'  => 'camera_trigger',
                    'severity'    => 'info',
                    'value'       => (string)(count($this->camera)),
                    'description' => 'Photo #' . count($this->camera),
                ];
                return;
            }

            // Detect arming events from status text
            $type = 'message';
            if (stripos($msg, 'armed') !== false && stripos($msg, 'dis') === false) $type = 'arm';
            if (stripos($msg, 'disarmed') !== false) $type = 'disarm';
            if (stripos($msg, 'ready') !== false) $type = 'ready';
            if (stripos($msg, 'mode') !== false) $type = 'mode_change';
            if (stripos($msg, 'failsafe') !== false || stripos($msg, 'emergency') !== false) {
                $type = 'failsafe';
                $severity = 'warning';
            }

            $this->events[] = [
                't_ms'        => $this->tMs(),
                'event_type'  => $type,
                'severity'    => $severity,
                'value'       => (string)$sev,
                'description' => $msg,
            ];
            return;
        }

        // ── Env / firmware info: {env:{v:"...", ...}} ─────────────
        if (preg_match('/^\{env:\{v:"([^"]+)"/', $line, $m)) {
            $this->firmwareVer = $m[1];
            $this->params['skyline_firmware'] = $m[1];
            return;
        }

        // ── Vehicle info: {vhcl:["name", id]} ────────────────────
        if (preg_match('/^\{vhcl:\["([^"]+)"/', $line, $m)) {
            $this->vehicleName = trim($m[1]);
            if ($this->vehicleName !== '') {
                $this->params['vehicle_name'] = $this->vehicleName;
            }
            return;
        }

        // ── Reference waypoints: {ref_set:[id,alt,lat,lng,_,flag,...]} ─
        // Older firmware: 6 fields [id,alt,lat,lng,reserved,flag]
        // Newer firmware: 10 fields [id,alt,lat,lng,reserved,flag,0,0,0,0]
        if (preg_match('/^\{ref_set:\[([^\]]+)\]\}$/', $line, $m)) {
            $vals = array_map('floatval', explode(',', $m[1]));
            if (count($vals) >= 4 && abs($vals[2]) > 0.5 && abs($vals[3]) > 0.5) {
                $this->waypoints[] = [
                    'id'     => (int)$vals[0],
                    'alt_m'  => $vals[1],
                    'lat'    => $vals[2],
                    'lng'    => $vals[3],
                    'active' => isset($vals[5]) && (int)$vals[5] === 1,
                ];
                // Use first ref_set as home altitude when no {home:} block is present
                if ($this->homeAltMm === 0 && $vals[1] > 0) {
                    $this->homeAltMm = (int)round($vals[1] * 1000);
                }
            }
            return;
        }

        // ── Gimbal: {gimbal:"aabbccdd"} ───────────────────────────
        if (preg_match('/^\{gimbal:"([0-9a-f]{8})"\}$/', $line, $m)) {
            $bytes = hex2bin($m[1]);
            if (strlen($bytes) >= 3) {
                $pan  = unpack('c', $bytes[1])[1];  // signed int8
                $tilt = unpack('c', $bytes[2])[1];  // signed int8
                $this->params['last_gimbal_pan']  = $pan;
                $this->params['last_gimbal_tilt'] = $tilt;
            }
            return;
        }

        // ── Mission current: {mission_current:N} ──────────────────
        if (preg_match('/^\{mission_current:(\d+)\}$/', $line, $m)) {
            $wp = (int)$m[1];
            $this->events[] = [
                't_ms'        => $this->tMs(),
                'event_type'  => 'waypoint',
                'severity'    => 'info',
                'value'       => (string)$wp,
                'description' => "Reached waypoint $wp",
            ];
            return;
        }

        // ── Temperature: {t:[v1,v2]} ──────────────────────────────
        if (preg_match('/^\{t:\[(-?\d+),(-?\d+)\]\}$/', $line, $m)) {
            $t1 = (int)$m[1] / 10.0;
            $t2 = (int)$m[2] / 10.0;
            if ($t1 > -100 && $t1 < 200) {
                $this->params['last_temp_1'] = $t1;
                $this->params['last_temp_2'] = $t2;
            }
            return;
        }

        // ── Unknown key — track it, apply user mapping if defined ─
        if (preg_match('/^\{([a-zA-Z_][a-zA-Z0-9_]*)[:[\}]/', $line, $m)) {
            $key = $m[1];
            // Record for unknown-key report (first seen example only)
            if (!isset($this->unknownKeys[$key])) {
                $this->unknownKeys[$key] = ['example' => substr($line, 0, 120), 'count' => 0];
            }
            $this->unknownKeys[$key]['count']++;

            // Apply user-defined mapping if one exists
            $mapped = $this->mappings[$key] ?? null;
            if ($mapped === 'camera_trigger') {
                $this->camera[] = ['t_ms' => $this->tMs()];
                $n = count($this->camera);
                $this->events[] = ['t_ms' => $this->tMs(), 'event_type' => 'camera_trigger', 'severity' => 'info', 'value' => (string)$n, 'description' => "Photo #$n"];
            } elseif ($mapped === 'ignore' || $mapped === null) {
                // silently skip
            } elseif (str_starts_with($mapped, 'custom:')) {
                $label = substr($mapped, 7);
                $this->events[] = ['t_ms' => $this->tMs(), 'event_type' => 'message', 'severity' => 'info', 'value' => $key, 'description' => "$label: $line"];
            }
        }
    }

    // ── TLM Binary Packet Decoder ─────────────────────────────────
    //
    // Packet structure (all subtypes share this layout):
    //   Byte  0:     0xAA magic
    //   Bytes 1-2:   rolling counter
    //   Byte  3:     subtype
    //   Bytes 4-5:   int16 LE = relative altitude in cm, ONLY when byte[5] < 128
    //   Bytes 6-11:  subtype-dependent (do not decode)
    //   Bytes 12-15: int32 LE = latitude  × 1e7 (all subtypes)
    //   Bytes 16-19: int32 LE = longitude × 1e7 (all subtypes)
    //
    // Speed is NOT decoded from packet bytes — the byte[8:9] encoding varies by
    // subtype in ways that cannot be reliably distinguished. Instead, speed_ms is
    // computed from consecutive GPS position deltas in computeSpeeds().
    private function parseTlm(string $hex): void {
        $d = hex2bin($hex);
        if (strlen($d) < 20) return;

        $bytes = array_values(unpack('C*', $d));
        if ($bytes[0] !== 0xAA) return;

        // GPS coordinates — valid across all subtypes
        $lat = unpack('l', substr($d, 12, 4))[1] / 1e7;
        $lng = unpack('l', substr($d, 16, 4))[1] / 1e7;
        if (abs($lat) < 0.5 || abs($lng) < 0.5) return;
        if ($lat < -90 || $lat > 90 || $lng < -180 || $lng > 180) return;

        // Relative altitude — bytes[4:5] as signed int16, only when byte[5] high bit clear
        $altRelM = null;
        $altAslM = null;
        if ($bytes[5] < 128) {
            $relAltCm = unpack('s', substr($d, 4, 2))[1];
            if ($relAltCm > -10000 && $relAltCm < 50000) {
                $altRelM = round($relAltCm / 100.0, 2);
                $altAslM = $this->homeAltMm > 0
                    ? round(($this->homeAltMm / 1000.0) + $altRelM, 2)
                    : null;
            }
        }

        $this->gps[] = [
            't_ms'          => $this->tMs(),
            'lat'           => round($lat, 7),
            'lng'           => round($lng, 7),
            'alt_m'         => $altRelM,
            'alt_amsl_m'    => $altAslM,
            'speed_ms'      => null,   // filled by computeSpeeds()
            'hdop'          => null,
            'sats'          => null,
            'fix_type'      => 3,
            'ground_course' => null,
        ];
    }

    // ── GPS-derived speed ─────────────────────────────────────────
    private function computeSpeeds(): void {
        $n = count($this->gps);
        for ($i = 1; $i < $n; $i++) {
            $dt = ($this->gps[$i]['t_ms'] - $this->gps[$i - 1]['t_ms']) / 1000.0;
            if ($dt <= 0 || $dt > 5.0) continue;   // skip gaps / duplicate timestamps
            $dist = $this->haversineM(
                $this->gps[$i - 1]['lat'], $this->gps[$i - 1]['lng'],
                $this->gps[$i]['lat'],     $this->gps[$i]['lng']
            );
            $spd = $dist / $dt;
            if ($spd <= 200.0) {   // discard physically impossible values
                $this->gps[$i]['speed_ms'] = round($spd, 2);
            }
        }
    }

    private function haversineM(float $lat1, float $lng1, float $lat2, float $lng2): float {
        $R    = 6371000.0;
        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);
        $a    = sin($dLat / 2) ** 2
              + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;
        return $R * 2.0 * asin(min(1.0, sqrt($a)));
    }

    // ── Monitor Packet Decoder ────────────────────────────────────
    private function parseMon(array $vals): void {
        if (count($vals) < 13) return;

        $linkPct  = $vals[6] ?? null;   // link quality %
        $snr      = $vals[7] ?? null;   // SNR
        $txPow    = $vals[10] ?? null;  // TX power or armed indicator
        $armed    = $vals[12] ?? null;  // 2 = armed, 0 = disarmed

        // Detect arm/disarm transitions
        static $prevArmed = null;
        if ($prevArmed !== null && $prevArmed !== $armed) {
            if ($armed === 2) {
                $this->events[] = [
                    't_ms'       => $this->tMs(),
                    'event_type' => 'arm',
                    'severity'   => 'info',
                    'value'      => '2',
                    'description'=> 'Motors Armed',
                ];
            } elseif ($armed === 0 && $prevArmed === 2) {
                $this->events[] = [
                    't_ms'       => $this->tMs(),
                    'event_type' => 'disarm',
                    'severity'   => 'info',
                    'value'      => '0',
                    'description'=> 'Motors Disarmed',
                ];
            }
        }
        $prevArmed = $armed;

        // Store link quality metrics (but don't flood the DB — only keep every 10th)
        $this->params['last_link_pct'] = $linkPct;
        $this->params['last_snr']      = $snr;
    }

    // ── SBUS RC Channel Decoder ───────────────────────────────────
    private function parseSbus(string $hex): void {
        $d = hex2bin($hex);
        if (strlen($d) < 16) return;

        // Channels stored as uint16 LE at byte offsets 0,2,4,...
        // SBUS range: 172-1811, center=992
        // Convert to microseconds: ((val-992)/819*500)+1500
        $toUs = function(int $raw): int {
            return (int)round(((($raw - 992) / 819.0) * 500) + 1500);
        };

        $ch = [];
        for ($i = 0; $i < min(12, (int)(strlen($d)/2)); $i++) {
            $raw  = unpack('v', substr($d, $i*2, 2))[1];
            $ch[] = $toUs($raw);
        }

        if (count($ch) >= 4) {
            $row = ['t_ms' => $this->tMs(), 'rssi' => null];
            for ($i = 1; $i <= min(12, count($ch)); $i++) {
                $row["ch$i"] = $ch[$i-1];
            }
            // Only store every 5th RC packet to avoid flooding DB
            static $rcCount = 0;
            $rcCount++;
            if ($rcCount % 5 === 0) {
                $this->rc[] = $row;
            }
        }
    }

    // ── GPS interpolation for camera triggers ─────────────────────
    private function interpolateCameraPositions(array $triggers, array $gps): array {
        if (empty($triggers) || empty($gps)) return $triggers;

        $result = [];
        $n = count($gps);

        foreach ($triggers as $i => $trig) {
            $tMs = $trig['t_ms'];

            // Binary search for surrounding GPS samples
            $lo = 0; $hi = $n - 1;
            while ($lo < $hi - 1) {
                $mid = (int)(($lo + $hi) / 2);
                if ($gps[$mid]['t_ms'] <= $tMs) $lo = $mid;
                else $hi = $mid;
            }

            $g0 = $gps[$lo];
            $g1 = $gps[$hi];
            $span = $g1['t_ms'] - $g0['t_ms'];

            if ($span > 0 && $g0['lat'] !== null && $g1['lat'] !== null) {
                $frac = ($tMs - $g0['t_ms']) / $span;
                $lat   = $g0['lat']   + ($g1['lat']   - $g0['lat'])   * $frac;
                $lng   = $g0['lng']   + ($g1['lng']   - $g0['lng'])   * $frac;
                $alt   = ($g0['alt_m'] !== null && $g1['alt_m'] !== null)
                    ? $g0['alt_m'] + ($g1['alt_m'] - $g0['alt_m']) * $frac
                    : ($g0['alt_m'] ?? $g1['alt_m']);
            } else {
                $lat = $g0['lat']; $lng = $g0['lng']; $alt = $g0['alt_m'];
            }

            $result[] = [
                't_ms'   => $tMs,
                'seq'    => $i + 1,
                'lat'    => $lat !== null ? round($lat, 7) : null,
                'lng'    => $lng !== null ? round($lng, 7) : null,
                'alt_m'  => $alt !== null ? round($alt, 2) : null,
            ];
        }

        return $result;
    }

    // ── Helpers ───────────────────────────────────────────────────
    private function tMs(): int {
        if ($this->baseTs === 0 || $this->currentTs === 0) return 0;
        return ($this->currentTs - $this->baseTs) * 1000;
    }

    private function buildResult(): array {
        $this->computeSpeeds();

        // Add firmware version / vehicle info as events
        if ($this->firmwareVer) {
            array_unshift($this->events, [
                't_ms'       => 0,
                'event_type' => 'message',
                'severity'   => 'info',
                'value'      => '6',
                'description'=> "Skyline firmware: {$this->firmwareVer}",
            ]);
        }

        // Add waypoints as events
        foreach ($this->waypoints as $wp) {
            $this->events[] = [
                't_ms'       => 0,
                'event_type' => 'waypoint',
                'severity'   => 'info',
                'value'      => (string)$wp['id'],
                'description'=> sprintf('Ref point %d: %.5f,%.5f alt %.1fm',
                    $wp['id'], $wp['lat'], $wp['lng'], $wp['alt_m']),
            ];
        }

        // Store home position in params
        if ($this->homeLat !== 0.0) {
            $this->params['home_lat']    = $this->homeLat;
            $this->params['home_lng']    = $this->homeLng;
            $this->params['home_alt_m']  = round($this->homeAltMm / 1000.0, 3);
        }

        // Interpolate GPS position for each camera trigger
        $cameraWithPos = $this->interpolateCameraPositions($this->camera, $this->gps);

        // Filter out unknown keys that have user-defined mappings already
        $unmapped = array_filter($this->unknownKeys, fn($k) => !isset($this->mappings[$k]),
            ARRAY_FILTER_USE_KEY);

        if ($unmapped) {
            $this->params['unknown_keys'] = array_map(
                fn($k, $v) => ['key' => $k, 'example' => $v['example'], 'count' => $v['count']],
                array_keys($unmapped), $unmapped
            );
        }

        return [
            'gps'      => $this->gps,
            'attitude' => $this->attitude,
            'battery'  => $this->battery,
            'imu'      => $this->imu,
            'rc'       => $this->rc,
            'events'   => $this->events,
            'camera'   => $cameraWithPos,
            'params'   => $this->params,
        ];
    }
}
