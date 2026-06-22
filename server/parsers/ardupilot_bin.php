<?php
// ============================================================
// UAVLogBook — ArduPilot DataFlash Binary (.BIN) Parser
// Self-describing binary format: FMT messages define all others
// ============================================================

class ArduPilotBinParser {

    // Message type IDs
    const MSG_FMT  = 0x80;  // 128 — Format definition
    const MSG_PARM = 0x81;  // 129 — Parameter
    const MSG_CMD  = 0x9D;  // 157 — Command

    // Format type char → unpack format + byte size
    const FORMAT_CHARS = [
        'b' => ['c', 1],  's' => ['a4',  4],  'i' => ['l',   4],
        'I' => ['L', 4],  'f' => ['f',   4],  'n' => ['a4',  4],
        'N' => ['a16',16], 'Z' => ['a64',64], 'c' => ['s',   2],
        'C' => ['S', 2],  'e' => ['l',   4],  'E' => ['L',   4],
        'd' => ['d', 8],  'L' => ['l',   4],  'M' => ['c',   1],
        'q' => ['q', 8],  'Q' => ['Q',   8],  'h' => ['s',   2],
        'H' => ['S', 2],  'B' => ['C',   1],  'a' => ['a64', 64],
        'R' => ['L', 4],
    ];

    private array $msgFormats = [];   // typeId => {name, length, format, labels}
    private array $gps     = [];
    private array $attitude = [];
    private array $battery  = [];
    private array $imu      = [];
    private array $rc       = [];
    private array $events   = [];
    private array $params   = [];
    private ?float $timeOffset = null;
    private int    $startTime  = 0;

    public function parse(string $filePath): array {
        $fp   = fopen($filePath, 'rb');
        $size = filesize($filePath);

        while (!feof($fp)) {
            // Each message starts with 3-byte header: 0xA3 0x95 <type>
            $hdr = fread($fp, 3);
            if (strlen($hdr) < 3) break;

            if (ord($hdr[0]) !== 0xA3 || ord($hdr[1]) !== 0x95) {
                // Re-sync: scan for next header
                fseek($fp, -2, SEEK_CUR);
                continue;
            }

            $typeId = ord($hdr[2]);

            if ($typeId === self::MSG_FMT) {
                $this->parseFMT($fp);
                continue;
            }

            if (!isset($this->msgFormats[$typeId])) {
                // Unknown type — skip if we know the size from FMT, else try to resync
                continue;
            }

            $fmt    = $this->msgFormats[$typeId];
            $remain = $fmt['length'] - 3;   // already read 3-byte header
            if ($remain <= 0) continue;
            $raw    = fread($fp, $remain);
            if (strlen($raw) < $remain) break;

            $this->dispatchMessage($fmt['name'], $raw, $fmt);
        }

        fclose($fp);
        return $this->buildResult();
    }

    private function parseFMT(resource $fp): void {
        // FMT body: Type(1) Length(1) Name(4) Format(16) Labels(64) = 86 bytes remaining after 3-byte header
        $raw = fread($fp, 86);
        if (strlen($raw) < 86) return;

        $typeId  = ord($raw[0]);
        $length  = ord($raw[1]);
        $name    = rtrim(substr($raw, 2, 4), "\x00");
        $format  = rtrim(substr($raw, 6, 16), "\x00");
        $labelsStr = rtrim(substr($raw, 22, 64), "\x00");
        $labels  = explode(',', $labelsStr);

        $this->msgFormats[$typeId] = compact('typeId','length','name','format','labels');
    }

    private function dispatchMessage(string $name, string $raw, array $fmt): void {
        $fields = $this->unpackMessage($raw, $fmt);
        if (!$fields) return;

        $tUs  = $fields['TimeUS'] ?? $fields['time_us'] ?? null;
        $tMs  = $tUs ? (int)($tUs / 1000) : null;

        switch ($name) {
            case 'GPS':
                if (isset($fields['Lat'], $fields['Lng']) && $fields['Lat'] != 0) {
                    $this->gps[] = [
                        't_ms'      => $tMs,
                        'lat'       => $fields['Lat'] / 1e7,
                        'lng'       => $fields['Lng'] / 1e7,
                        'alt_m'     => ($fields['RelAlt'] ?? null),
                        'alt_amsl_m'=> ($fields['Alt'] ?? null),
                        'speed_ms'  => ($fields['Spd'] ?? null),
                        'hdop'      => isset($fields['HDop']) ? $fields['HDop']/100 : null,
                        'sats'      => $fields['NSats'] ?? null,
                        'fix_type'  => $fields['Status'] ?? null,
                        'ground_course' => $fields['GCrs'] ?? null,
                    ];
                }
                break;

            case 'ATT':
                $this->attitude[] = [
                    't_ms'      => $tMs,
                    'roll_deg'  => isset($fields['Roll'])  ? $fields['Roll']/100  : null,
                    'pitch_deg' => isset($fields['Pitch']) ? $fields['Pitch']/100 : null,
                    'yaw_deg'   => isset($fields['Yaw'])   ? $fields['Yaw']/100   : null,
                    'roll_rate' => $fields['RollRate']  ?? null,
                    'pitch_rate'=> $fields['PitchRate'] ?? null,
                    'yaw_rate'  => $fields['YawRate']   ?? null,
                ];
                break;

            case 'BATT':
            case 'BAT':
                $this->battery[] = [
                    't_ms'           => $tMs,
                    'voltage_v'      => isset($fields['Volt']) ? $fields['Volt']/1000 : ($fields['VoltR'] ?? null),
                    'current_a'      => isset($fields['Curr']) ? $fields['Curr']/100  : null,
                    'remaining_pct'  => $fields['Rem'] ?? null,
                    'consumed_mah'   => $fields['CurrTot'] ?? null,
                    'temp_c'         => $fields['Temp'] ?? null,
                ];
                break;

            case 'IMU':
            case 'IMU2':
                $this->imu[] = [
                    't_ms'    => $tMs,
                    'accel_x' => $fields['AccX'] ?? null,
                    'accel_y' => $fields['AccY'] ?? null,
                    'accel_z' => $fields['AccZ'] ?? null,
                    'gyro_x'  => $fields['GyrX'] ?? null,
                    'gyro_y'  => $fields['GyrY'] ?? null,
                    'gyro_z'  => $fields['GyrZ'] ?? null,
                ];
                break;

            case 'VIBE':
                if (!empty($this->imu)) {
                    $last = count($this->imu) - 1;
                    $this->imu[$last]['vibe_x'] = $fields['VibeX'] ?? null;
                    $this->imu[$last]['vibe_y'] = $fields['VibeY'] ?? null;
                    $this->imu[$last]['vibe_z'] = $fields['VibeZ'] ?? null;
                }
                break;

            case 'RCIN':
                $row = ['t_ms' => $tMs];
                for ($i = 1; $i <= 12; $i++) {
                    $row["ch$i"] = $fields["C$i"] ?? null;
                }
                $this->rc[] = $row;
                break;

            case 'MSG':
                $msg = $fields['Message'] ?? $fields['Msg'] ?? '';
                if ($msg) {
                    $severity = 'info';
                    if (str_contains(strtolower($msg), 'error') || str_contains(strtolower($msg), 'fail')) {
                        $severity = 'error';
                    } elseif (str_contains(strtolower($msg), 'warn')) {
                        $severity = 'warning';
                    }
                    $this->events[] = [
                        't_ms'       => $tMs,
                        'event_type' => 'message',
                        'severity'   => $severity,
                        'value'      => '',
                        'description'=> $msg,
                    ];
                }
                break;

            case 'MODE':
                $this->events[] = [
                    't_ms'        => $tMs,
                    'event_type'  => 'mode_change',
                    'severity'    => 'info',
                    'value'       => (string)($fields['Mode'] ?? ''),
                    'description' => 'Flight mode changed to ' . ($fields['Mode'] ?? 'unknown'),
                ];
                break;

            case 'EV':
                $evId = $fields['Id'] ?? $fields['EV'] ?? 0;
                $evName = match((int)$evId) {
                    10 => 'armed', 11 => 'disarmed', 15 => 'auto_armed',
                    16 => 'takeoff', 18 => 'land_complete', 25 => 'failsafe_radio',
                    default => "event_$evId"
                };
                $this->events[] = [
                    't_ms'       => $tMs,
                    'event_type' => $evName,
                    'severity'   => str_contains($evName, 'fail') ? 'warning' : 'info',
                    'value'      => (string)$evId,
                    'description'=> ucfirst(str_replace('_', ' ', $evName)),
                ];
                break;

            case 'PARM':
                $this->params[$fields['Name'] ?? ''] = $fields['Value'] ?? null;
                break;
        }
    }

    private function unpackMessage(string $raw, array $fmt): ?array {
        $fields = [];
        $offset = 0;
        $labels = $fmt['labels'];
        $format = $fmt['format'];

        foreach (str_split($format) as $i => $char) {
            $label = $labels[$i] ?? "f$i";
            if (!isset(self::FORMAT_CHARS[$char])) {
                break;
            }
            [$unpackFmt, $size] = self::FORMAT_CHARS[$char];
            if ($offset + $size > strlen($raw)) break;
            $chunk = substr($raw, $offset, $size);
            $offset += $size;

            $val = unpack($unpackFmt, $chunk);
            $fields[$label] = $val[1] ?? null;

            // Scale factors for ArduPilot encoded values
            if (in_array($char, ['c','e'])) $fields[$label] = ($fields[$label] ?? 0) * 0.01;
            if ($char === 'C')              $fields[$label] = ($fields[$label] ?? 0) * 0.01;
            if ($char === 'L')              $fields[$label] = ($fields[$label] ?? 0) * 1e-7;
        }
        return $fields;
    }

    private function buildResult(): array {
        return [
            'gps'      => $this->gps,
            'attitude' => $this->attitude,
            'battery'  => $this->battery,
            'imu'      => $this->imu,
            'rc'       => $this->rc,
            'events'   => $this->events,
            'params'   => $this->params,
        ];
    }
}
