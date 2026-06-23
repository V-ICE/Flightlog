<?php
// ============================================================
// Flightlog — Multi-Format Log Parsers
// Covers: PX4 ULog, DJI CSV, GPX, KML, Betaflight BBL,
//         Generic CSV (AI-mapped), ArduPilot Text
// ============================================================

// ---- PX4 ULog Binary Parser --------------------------------
class PX4ULogParser {
    // ULog magic: 0x55 0x4C 0x6F 0x67 0x01 0x12 0x35
    const MAGIC = "\x55\x4C\x6F\x67\x01\x12\x35";
    const MSG_INFO     = 0x49; // 'I'
    const MSG_INFO_MULTI=0x4D; // 'M'
    const MSG_FORMAT   = 0x46; // 'F'
    const MSG_PARAM    = 0x50; // 'P'
    const MSG_ADD_LOGGED = 0x41; // 'A'
    const MSG_DATA     = 0x44; // 'D'
    const MSG_REMOVE_LOGGED=0x52;
    const MSG_LOG_STR  = 0x4C; // 'L'

    public function parse(string $path): array {
        $fp = fopen($path, 'rb');
        $magic = fread($fp, 7);
        if ($magic !== self::MAGIC) {
            fclose($fp);
            throw new Exception("Not a valid ULog file");
        }
        // Skip version(1) + timestamp(8)
        fread($fp, 9);

        $formats = [];
        $subscriptions = [];  // msg_id => {name, format}
        $gps = $att = $batt = $imu = $events = [];

        while (!feof($fp)) {
            $hdr = fread($fp, 3);
            if (strlen($hdr) < 3) break;
            $msgLen  = unpack('v', substr($hdr,0,2))[1];
            $msgType = ord($hdr[2]);
            if ($msgLen < 1) continue;
            $body = fread($fp, $msgLen - 1);

            switch ($msgType) {
                case self::MSG_FORMAT:
                    $parts = explode(':', rtrim($body, "\x00"), 2);
                    if (count($parts) === 2) {
                        $formats[$parts[0]] = $parts[1];
                    }
                    break;

                case self::MSG_ADD_LOGGED:
                    if (strlen($body) < 3) break;
                    $msgId = unpack('v', substr($body,1,2))[1];
                    $name  = rtrim(substr($body,3), "\x00");
                    $subscriptions[$msgId] = ['name' => $name, 'format' => $formats[$name] ?? ''];
                    break;

                case self::MSG_DATA:
                    if (strlen($body) < 2) break;
                    $msgId = unpack('v', substr($body,0,2))[1];
                    $data  = substr($body, 2);
                    $sub   = $subscriptions[$msgId] ?? null;
                    if (!$sub) break;

                    $fields = $this->unpackULogMsg($data, $sub['format']);
                    $tUs = $fields['timestamp'] ?? null;
                    $tMs = $tUs ? (int)($tUs / 1000) : null;

                    switch ($sub['name']) {
                        case 'vehicle_gps_position':
                            if (isset($fields['lat'], $fields['lon']) && $fields['lat'] != 0) {
                                $gps[] = [
                                    't_ms'   => $tMs,
                                    'lat'    => $fields['lat'] / 1e7,
                                    'lng'    => $fields['lon'] / 1e7,
                                    'alt_m'  => isset($fields['alt']) ? $fields['alt']/1000 : null,
                                    'alt_amsl_m' => isset($fields['alt_ellipsoid']) ? $fields['alt_ellipsoid']/1000 : null,
                                    'speed_ms'   => isset($fields['vel_m_s']) ? $fields['vel_m_s'] : null,
                                    'hdop'   => $fields['hdop'] ?? null,
                                    'sats'   => $fields['satellites_used'] ?? null,
                                    'fix_type' => $fields['fix_type'] ?? null,
                                ];
                            }
                            break;
                        case 'vehicle_attitude':
                            if (isset($fields['q[0]'])) {
                                [$r,$p,$y] = self::quatToEuler($fields['q[0]']??1,$fields['q[1]']??0,$fields['q[2]']??0,$fields['q[3]']??0);
                                $att[] = ['t_ms'=>$tMs,'roll_deg'=>$r,'pitch_deg'=>$p,'yaw_deg'=>$y];
                            }
                            break;
                        case 'battery_status':
                            $batt[] = [
                                't_ms'          => $tMs,
                                'voltage_v'     => $fields['voltage_v'] ?? null,
                                'current_a'     => $fields['current_a'] ?? null,
                                'remaining_pct' => isset($fields['remaining']) ? (int)($fields['remaining']*100) : null,
                                'consumed_mah'  => $fields['discharged_mah'] ?? null,
                            ];
                            break;
                    }
                    break;
            }
        }
        fclose($fp);
        return ['gps'=>$gps,'attitude'=>$att,'battery'=>$batt,'imu'=>$imu,'events'=>$events,'rc'=>[],'params'=>[]];
    }

    private function unpackULogMsg(string $data, string $format): array {
        // Simple field extractor for common ULog types
        $fields = [];
        // Parse format string like "uint64_t timestamp;float q[4];..."
        $defs = array_filter(array_map('trim', explode(';', $format)));
        $offset = 0;
        foreach ($defs as $def) {
            if (!preg_match('/^(\w+)\s+(\w+)(\[(\d+)\])?$/', trim($def), $m)) continue;
            [, $type, $name, , $arrLen] = $m + ['','','','',''];
            $arrLen = $arrLen ? (int)$arrLen : 1;
            [$fmt, $size] = $this->ulogType($type);
            for ($i = 0; $i < $arrLen; $i++) {
                if ($offset + $size > strlen($data)) break;
                $val = unpack($fmt, substr($data, $offset, $size))[1];
                $key = $arrLen > 1 ? "$name[$i]" : $name;
                $fields[$key] = $val;
                $offset += $size;
            }
        }
        return $fields;
    }

    private function ulogType(string $t): array {
        return match($t) {
            'uint64_t','int64_t' => ['P', 8],
            'uint32_t','int32_t' => ['L', 4],
            'uint16_t','int16_t' => ['S', 2],
            'uint8_t','int8_t','bool' => ['C', 1],
            'float'  => ['f', 4],
            'double' => ['d', 8],
            default  => ['C', 1],
        };
    }

    private static function quatToEuler(float $w, float $x, float $y, float $z): array {
        $roll  = atan2(2*($w*$x+$y*$z), 1-2*($x*$x+$y*$y));
        $pitch = asin(2*($w*$y-$z*$x));
        $yaw   = atan2(2*($w*$z+$x*$y), 1-2*($y*$y+$z*$z));
        return [rad2deg($roll), rad2deg($pitch), rad2deg($yaw)];
    }
}

// ---- DJI CSV / Litchi CSV Parser ---------------------------
class DJICsvParser {

    // Known DJI column name variants → canonical field
    const COLUMN_MAP = [
        'OSD.latitude'   => 'lat',     'latitude'         => 'lat',
        'OSD.longitude'  => 'lng',     'longitude'        => 'lng',
        'OSD.altitude [m]' => 'alt_m', 'altitude(m)'     => 'alt_m',
        'OSD.altitude'   => 'alt_m',   'height_above_takeoff(feet)' => 'alt_ft',
        'OSD.speed'      => 'speed_ms','speed(m/s)'       => 'speed_ms',
        'OSD.roll'       => 'roll',    'aircraft_pitch(degrees)' => 'pitch',
        'OSD.pitch'      => 'pitch',   'aircraft_roll(degrees)'  => 'roll',
        'OSD.yaw'        => 'yaw',     'compass_heading(degrees)'=> 'yaw',
        'OSD.flyTime'    => 't_sec',   'time(millisecond)' => 't_ms',
        'datetime(utc)'  => 'datetime','time'              => 'datetime',
        'BATTERY.voltage' => 'voltage_v', 'battery_voltage(v)' => 'voltage_v',
        'BATTERY.current' => 'current_a',
        'BATTERY.remain'  => 'batt_pct', 'battery_percent' => 'batt_pct',
        'RC.aileron'      => 'ch1',    'RC.elevator'       => 'ch2',
        'RC.throttle'     => 'ch3',    'RC.rudder'         => 'ch4',
        'GPS.numSat'      => 'sats',   'satellites'        => 'sats',
    ];

    public function parse(string $path, array $aiColMap = []): array {
        $fp = fopen($path, 'r');
        $rawHeader = fgetcsv($fp);
        if (!$rawHeader) { fclose($fp); return []; }

        // Build column index map
        $colMap = [];
        foreach ($rawHeader as $i => $col) {
            $key = strtolower(trim($col));
            // Check AI-provided map first
            foreach ($aiColMap as $canonical => $colName) {
                if (strtolower($colName) === $key) {
                    $colMap[$canonical] = $i;
                }
            }
            // Then our known map
            foreach (self::COLUMN_MAP as $srcName => $canonical) {
                if (strtolower($srcName) === $key && !isset($colMap[$canonical])) {
                    $colMap[$canonical] = $i;
                }
            }
        }

        $gps = $att = $batt = $imu = $rc = $events = [];
        $startTime = null;
        $row = 0;

        while (($line = fgetcsv($fp)) !== false) {
            $row++;
            $g = fn($field) => isset($colMap[$field]) ? ($line[$colMap[$field]] ?? null) : null;
            $f = fn($field) => ($v = $g($field)) !== null && $v !== '' ? (float)$v : null;
            $i = fn($field) => ($v = $g($field)) !== null && $v !== '' ? (int)$v : null;

            // Timestamp
            $tMs = null;
            if ($g('t_ms') !== null)  $tMs = (int)$g('t_ms');
            elseif ($g('t_sec') !== null) $tMs = (int)((float)$g('t_sec') * 1000);
            else $tMs = $row * 100; // fallback: 10Hz

            $lat = $f('lat');
            $lng = $f('lng');
            if ($lat !== null && $lng !== null && $lat != 0 && $lng != 0) {
                $alt = $f('alt_m') ?? ($f('alt_ft') !== null ? $f('alt_ft')*0.3048 : null);
                $gps[] = [
                    't_ms'    => $tMs,
                    'lat'     => $lat,
                    'lng'     => $lng,
                    'alt_m'   => $alt,
                    'speed_ms'=> $f('speed_ms'),
                    'sats'    => $i('sats'),
                ];
            }

            $roll = $f('roll'); $pitch = $f('pitch'); $yaw = $f('yaw');
            if ($roll !== null || $pitch !== null || $yaw !== null) {
                $att[] = ['t_ms'=>$tMs,'roll_deg'=>$roll,'pitch_deg'=>$pitch,'yaw_deg'=>$yaw];
            }

            $v = $f('voltage_v');
            if ($v !== null) {
                $batt[] = [
                    't_ms'      => $tMs,
                    'voltage_v' => $v,
                    'current_a' => $f('current_a'),
                    'remaining_pct' => $i('batt_pct'),
                ];
            }

            // RC channels
            if (isset($colMap['ch1'])) {
                $rc[] = ['t_ms'=>$tMs,'ch1'=>$i('ch1'),'ch2'=>$i('ch2'),
                         'ch3'=>$i('ch3'),'ch4'=>$i('ch4')];
            }
        }
        fclose($fp);

        return ['gps'=>$gps,'attitude'=>$att,'battery'=>$batt,'imu'=>$imu,'rc'=>$rc,'events'=>$events,'params'=>[]];
    }
}

// ---- GPX Parser --------------------------------------------
class GPXParser {
    public function parse(string $path): array {
        $xml = simplexml_load_file($path);
        if (!$xml) throw new Exception('Invalid GPX file');

        $gps = [];
        $t0  = null;
        $ns  = $xml->getNamespaces(true);
        $tracks = $xml->trk ?? $xml->rte ?? [];

        foreach ($tracks as $trk) {
            foreach ($trk->trkseg ?? $trk->rtept ?? [] as $seg) {
                foreach ($seg->trkpt ?? [$seg] as $pt) {
                    $attr = $pt->attributes();
                    $lat  = (float)($attr['lat'] ?? 0);
                    $lng  = (float)($attr['lon'] ?? 0);
                    $alt  = isset($pt->ele) ? (float)$pt->ele : null;
                    $time = isset($pt->time) ? strtotime((string)$pt->time) : null;
                    if ($t0 === null && $time) $t0 = $time;
                    $tMs  = $time && $t0 ? (int)(($time - $t0) * 1000) : count($gps)*1000;

                    // Speed from extensions if present
                    $speed = null;
                    foreach ($pt->extensions ?? [] as $ext) {
                        $speed = (float)($ext->speed ?? $ext->{'gpxx:TrackPointExtension'}->speed ?? 0) ?: null;
                    }

                    if ($lat !== 0) {
                        $gps[] = compact('lat','lng','alt_m','tMs','speed_ms');
                        $gps[count($gps)-1]['alt_m'] = $alt;
                        $gps[count($gps)-1]['t_ms'] = $tMs;
                        $gps[count($gps)-1]['speed_ms'] = $speed;
                        unset($gps[count($gps)-1]['alt_m_']);
                    }
                }
            }
        }
        return ['gps'=>$gps,'attitude'=>[],'battery'=>[],'imu'=>[],'rc'=>[],'events'=>[],'params'=>[]];
    }
}

// ---- Betaflight / INAV Blackbox Parser ---------------------
class BetaflightBblParser {

    public function parse(string $path): array {
        $fp = fopen($path, 'r');
        $headers = [];
        $fieldNames = [];
        $gps = $att = $imu = $events = [];
        $tScale = 1;   // default microseconds

        while (!feof($fp)) {
            $line = fgets($fp, 4096);
            if ($line === false) break;
            $line = rtrim($line);

            // Header lines
            if (str_starts_with($line, 'H ')) {
                $rest = substr($line, 2);
                [$k, $v] = explode(':', $rest, 2) + ['',''];
                $headers[trim($k)] = trim($v);
                if (trim($k) === 'Field I name') {
                    $fieldNames = array_map('trim', explode(',', trim($v)));
                }
                if (trim($k) === 'loopIteration') continue;
                continue;
            }

            if (empty($fieldNames)) continue;

            // Data lines: "I <values>" or just comma-separated
            $data = str_starts_with($line, 'I ') ? substr($line, 2) : $line;
            $vals = explode(',', $data);
            if (count($vals) < 3) continue;

            $f = array_combine(array_slice($fieldNames, 0, count($vals)), $vals);
            if (!$f) continue;

            $tMs = isset($f['time']) ? (int)((int)$f['time'] / 1000) : (count($gps)*10);

            // Attitude (in centi-degrees)
            if (isset($f['roll'], $f['pitch'], $f['heading'])) {
                $att[] = [
                    't_ms'      => $tMs,
                    'roll_deg'  => (float)$f['roll']  / 10,
                    'pitch_deg' => (float)$f['pitch'] / 10,
                    'yaw_deg'   => (float)($f['heading'] ?? 0) / 10,
                ];
            }

            // IMU
            if (isset($f['accSmooth[0]'])) {
                $imu[] = [
                    't_ms'    => $tMs,
                    'accel_x' => (float)($f['accSmooth[0]'] ?? 0) / 1000,
                    'accel_y' => (float)($f['accSmooth[1]'] ?? 0) / 1000,
                    'accel_z' => (float)($f['accSmooth[2]'] ?? 0) / 1000,
                    'gyro_x'  => (float)($f['gyroADC[0]'] ?? 0) / 16.384,
                    'gyro_y'  => (float)($f['gyroADC[1]'] ?? 0) / 16.384,
                    'gyro_z'  => (float)($f['gyroADC[2]'] ?? 0) / 16.384,
                ];
            }

            // GPS if present
            if (isset($f['GPS_coord[0]'], $f['GPS_coord[1]'])) {
                $lat = (float)$f['GPS_coord[0]'] / 1e7;
                $lng = (float)$f['GPS_coord[1]'] / 1e7;
                if ($lat != 0) {
                    $gps[] = [
                        't_ms' => $tMs, 'lat' => $lat, 'lng' => $lng,
                        'alt_m' => isset($f['GPS_altitude']) ? (float)$f['GPS_altitude'] : null,
                        'speed_ms' => isset($f['GPS_speed']) ? (float)$f['GPS_speed']/100 : null,
                        'sats' => isset($f['GPS_numSat']) ? (int)$f['GPS_numSat'] : null,
                    ];
                }
            }
        }
        fclose($fp);
        return ['gps'=>$gps,'attitude'=>$att,'battery'=>[],'imu'=>$imu,'rc'=>[],'events'=>$events,'params'=>$headers];
    }
}
