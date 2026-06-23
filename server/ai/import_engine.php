<?php
// ============================================================
// Flightlog — AI Import Engine
// Uses Claude AI to analyze unknown log files, detect format,
// map columns, and orchestrate the correct parser.
// ============================================================
require_once __DIR__ . '/../config/config.php';

class AIImportEngine {

    /**
     * Analyze a log file and return format detection + field mapping.
     * Falls back to heuristic detection if AI key not configured.
     */
    public static function analyzeFile(string $filePath, string $originalName): array {
        $ext = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));
        $fileSize = filesize($filePath);

        // Read sample bytes for analysis
        $sample = self::readSample($filePath, $ext);

        // Try heuristic detection first (fast, no API call)
        $heuristic = self::heuristicDetect($sample, $ext, $originalName);

        // If confident via heuristics, skip AI
        if ($heuristic['confidence'] >= 95) {
            return $heuristic;
        }

        // Use AI for ambiguous files if API key is set
        if (ANTHROPIC_API_KEY) {
            try {
                return self::aiAnalyze($sample, $ext, $originalName, $fileSize, $heuristic);
            } catch (Exception $e) {
                error_log("AI analysis failed: " . $e->getMessage());
                // Fall through to heuristic result
            }
        }

        return $heuristic;
    }

    // -------------------------------------------------------------------
    // Heuristic Format Detection
    // -------------------------------------------------------------------
    private static function heuristicDetect(array $sample, string $ext, string $name): array {
        $hex   = $sample['hex'];
        $text  = $sample['text'];
        $lines = $sample['lines'];

        // ArduPilot DataFlash Binary (.BIN)
        // Signature: starts with 0xA3 0x95 (FMT message header)
        if ($ext === 'bin' && str_starts_with($hex, 'a395')) {
            return self::result('ardupilot_bin', 98, 'ArduPilot DataFlash Binary Log',
                'Binary self-describing format with FMT message definitions');
        }

        // PX4 ULog (.ulg / .ulog)
        // Magic: 0x55 0x4C 0x6F 0x67 0x01 0x12 0x35 = "ULog\x01\x12\x35"
        if (in_array($ext, ['ulg','ulog']) && str_starts_with($hex, '554c6f6701')) {
            return self::result('px4_ulog', 99, 'PX4 ULog Binary', 'PX4 ULog binary format');
        }
        if (str_starts_with($hex, '554c6f670112')) {
            return self::result('px4_ulog', 99, 'PX4 ULog Binary', 'PX4 ULog binary format');
        }

        // MAVLink TLOG
        // MAVLink v1: 0xFE, MAVLink v2: 0xFD in binary
        if ($ext === 'tlog') {
            $hasMAVMagic = (strpos($hex, 'fe') !== false || strpos($hex, 'fd') !== false);
            if ($hasMAVMagic) {
                return self::result('mavlink_tlog', 95, 'MAVLink Telemetry Log',
                    'Binary MAVLink message stream from Mission Planner / QGroundControl');
            }
        }

        // DJI TXT (binary despite .txt extension)
        // First bytes are little-endian file size, then binary records
        if ($ext === 'txt' && !self::isReadableText($text)) {
            if (str_contains($name, 'DJIFlightRecord') || str_contains($name, 'FLY')) {
                return self::result('dji_txt', 92, 'DJI TXT Flight Record',
                    'DJI GO/Fly binary flight record (reverse-engineered format)');
            }
            return self::result('dji_txt', 75, 'DJI TXT Flight Record (likely)',
                'Binary .txt file consistent with DJI format');
        }

        // GPX
        if ($ext === 'gpx' || str_contains($text, '<gpx') || str_contains($text, 'xmlns="http://www.topografix.com')) {
            return self::result('gpx', 99, 'GPX GPS Track', 'GPS Exchange Format XML');
        }

        // KML / KMZ
        if ($ext === 'kml' || str_contains($text, '<kml')) {
            return self::result('kml', 99, 'KML Path', 'Google Earth KML flight path');
        }
        if ($ext === 'kmz') {
            return self::result('kmz', 99, 'KMZ Path', 'Google Earth compressed KML');
        }

        // Betaflight Blackbox (text CSV-like with header)
        if ($ext === 'bbl' || $ext === 'bfl') {
            if (str_contains($text, 'Product:Blackbox') || str_contains($text, 'loopIteration')) {
                return self::result('betaflight_bbl', 97, 'Betaflight Blackbox',
                    'Betaflight/INAV Blackbox CSV log');
            }
        }

        // INAV Blackbox (similar to Betaflight)
        if ($ext === 'bbl' && str_contains($text, 'Product:INAV')) {
            return self::result('inav_bbl', 97, 'INAV Blackbox', 'INAV Blackbox log');
        }

        // DJI CSV (Litchi / DJI export)
        if ($ext === 'csv') {
            $header = $lines[0] ?? '';
            // DJI CSV typical columns
            if (str_contains($header, 'datetime(utc)') || str_contains($header, 'OSD.flyTime')) {
                return self::result('dji_csv', 96, 'DJI CSV Export',
                    'DJI or Litchi exported CSV flight data');
            }
            // Litchi CSV
            if (str_contains($header, 'latitude') && str_contains($header, 'longitude')
                && str_contains($header, 'altitude(m)')) {
                return self::result('litchi_csv', 95, 'Litchi CSV',
                    'Litchi app waypoint/flight CSV log');
            }
            // Generic CSV with position data
            if (str_contains(strtolower($header), 'lat') && str_contains(strtolower($header), 'lon')) {
                return self::result('generic_csv', 80, 'Generic CSV with GPS',
                    'Generic CSV file with latitude/longitude columns detected');
            }
            // Any CSV
            return self::result('generic_csv', 60, 'Generic CSV (needs mapping)',
                'CSV file — column mapping required');
        }

        // Skyline .skylog — custom brace-delimited telemetry format
        // Signature: .skylog extension AND/OR {unix_ts} + {tlm:"aa..."} pattern
        if ($ext === 'skylog') {
            $hasTsPattern = (bool)preg_match('/^\{\d{9,11}\}$/m', $text);
            $hasTlmRecord = str_contains($text, '{tlm:"aa');
            if ($hasTsPattern || $hasTlmRecord) {
                return self::result('skyline_skylog', 99, 'Skyline .skylog Telemetry Log',
                    'Skyline GCS brace-delimited log with binary tlm, GPS, battery, SBUS RC, statustext');
            }
            return self::result('skyline_skylog', 90, 'Skyline .skylog (likely)',
                'File has .skylog extension consistent with Skyline GCS format');
        }
        // Content-based detection for Skyline even without correct extension
        $hasTsPattern2 = (bool)preg_match('/^\{\d{9,11}\}$/m', $text);
        $hasTlmRecord2 = str_contains($text, '{tlm:"aa');
        $hasVbatt      = str_contains($text, '{vbatt:[');
        if ($hasTsPattern2 && $hasTlmRecord2 && $hasVbatt) {
            return self::result('skyline_skylog', 88, 'Skyline log (content-detected)',
                'Content matches Skyline GCS format despite non-.skylog extension');
        }

        // ArduPilot text log
        if ($ext === 'log' || $ext === 'txt') {
            if (str_contains($text, 'FMT,') && str_contains($text, 'GPS,')) {
                return self::result('ardupilot_text', 95, 'ArduPilot Text Log',
                    'ArduPilot text/CSV format dataflash log');
            }
        }

        return self::result('unknown', 20, 'Unknown Format',
            'Could not detect format — AI analysis recommended');
    }

    // -------------------------------------------------------------------
    // AI Analysis via Claude API
    // -------------------------------------------------------------------
    private static function aiAnalyze(array $sample, string $ext, string $name,
                                       int $fileSize, array $heuristic): array {
        $textSample = substr($sample['text'], 0, 2000);
        $hexSample  = substr($sample['hex'], 0, 500);

        $prompt = "You are an expert UAV flight log format analyst. Analyze this log file sample and identify:\n1. The exact log format (ardupilot_bin, mavlink_tlog, px4_ulog, dji_txt, dji_csv, litchi_csv, betaflight_bbl, inav_bbl, gpx, kml, generic_csv, ardupilot_text, skyline_skylog)\n2. Confidence score 0-100\n3. Format description\n4. If CSV: detect column mappings (lat, lng, alt, speed, roll, pitch, yaw, timestamp, battery_v, etc.)\n5. Any anomalies or issues\n\nSkyline .skylog: brace-delimited text, lines like {unix_ts}, {tlm:\"aahex...\"}, {vbatt:[raw,A]}, {statustext:[sev,\"msg\"]}, {mon:[13 values]}, {sbus:\"hex\"}, {home:lat_1e7,lng_1e7,alt_mm}\n\nFile info:\n- Name: $name\n- Extension: .$ext\n- Size: $fileSize bytes\n- Heuristic guess: {$heuristic['format']} ({$heuristic['confidence']}% confident)\n\nFirst 2000 chars (text view):\n```\n$textSample\n```\n\nFirst 500 hex chars:\n$hexSample\n\nRespond ONLY with valid JSON, no markdown:\n{\"format\": \"format_key\", \"confidence\": 90, \"description\": \"Human readable description\", \"column_map\": {}, \"anomalies\": [], \"notes\": \"Any useful notes\"}";

        $response = self::callClaude($prompt);
        $json = json_decode($response, true);

        if (!$json || !isset($json['format'])) {
            return $heuristic;
        }

        return [
            'format'      => $json['format'],
            'confidence'  => (int)($json['confidence'] ?? $heuristic['confidence']),
            'description' => $json['description'] ?? $heuristic['description'],
            'notes'       => $json['notes'] ?? '',
            'column_map'  => $json['column_map'] ?? [],
            'anomalies'   => $json['anomalies'] ?? [],
            'ai_analyzed' => true,
        ];
    }

    /**
     * AI-powered anomaly detection for post-parse analysis
     */
    public static function analyzeFlightAnomalies(array $stats, array $events): array {
        if (!ANTHROPIC_API_KEY) return [];

        $prompt = "Analyze this UAV flight log summary for anomalies, safety issues, or noteworthy events.\n\n"
            . "Flight stats: " . json_encode($stats) . "\n"
            . "Events: " . json_encode(array_slice($events, 0, 50)) . "\n\n"
            . "Return JSON only: {\"anomalies\": [{\"type\": \"...\", \"severity\": \"info|warning|error\", \"description\": \"...\", \"t_ms\": null}], \"summary\": \"...\", \"score\": 85}";

        try {
            $result = self::callClaude($prompt);
            return json_decode($result, true) ?? [];
        } catch (Exception $e) {
            return [];
        }
    }

    private static function callClaude(string $prompt): string {
        $payload = json_encode([
            'model'      => AI_MODEL,
            'max_tokens' => 1000,
            'messages'   => [['role'=>'user','content'=>$prompt]]
        ]);

        $ch = curl_init('https://api.anthropic.com/v1/messages');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $payload,
            CURLOPT_HTTPHEADER     => [
                'Content-Type: application/json',
                'x-api-key: ' . ANTHROPIC_API_KEY,
                'anthropic-version: 2023-06-01',
            ],
            CURLOPT_TIMEOUT        => 30,
        ]);
        $resp = curl_exec($ch);
        if (curl_errno($ch)) throw new Exception('cURL error: ' . curl_error($ch));
        curl_close($ch);

        $data = json_decode($resp, true);
        return $data['content'][0]['text'] ?? '';
    }

    // -------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------
    private static function readSample(string $path, string $ext): array {
        $fp = fopen($path, 'rb');
        $raw = fread($fp, 8192);
        fclose($fp);

        $text  = preg_replace('/[^\x20-\x7E\r\n\t]/', '.', $raw);
        $hex   = bin2hex(substr($raw, 0, 256));
        $lines = explode("\n", $text);

        return compact('raw', 'text', 'hex', 'lines');
    }

    private static function isReadableText(string $text): bool {
        $printable = preg_match_all('/[\x20-\x7E]/', $text);
        return $printable / max(1, strlen($text)) > 0.7;
    }

    private static function result(string $format, int $confidence,
                                    string $description, string $notes = ''): array {
        return compact('format', 'confidence', 'description', 'notes') + [
            'column_map'  => [],
            'anomalies'   => [],
            'ai_analyzed' => false,
        ];
    }
}
