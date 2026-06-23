<?php
// ============================================================
// Flightlog — Video Upload & Time-Sync Engine
//
// SYNC STRATEGY (in order of reliability):
//
// 1. MP4 creation_time atom (moov/mvhd or udta/©day)
//    Most reliable. GoPro, DJI, Insta360, RunCam all write this.
//    Accuracy: ±1 second (depends on camera clock sync).
//
// 2. GPS track in MP4 (GoPro GPMF, DJI SRT sidecar)
//    Cross-correlate GPS speed curve against log speed curve.
//    Accuracy: ±0.5 seconds. Best method when available.
//    (Full implementation requires FFmpeg — noted as enhancement)
//
// 3. Filename timestamp parsing
//    e.g. GoPro: "GH010123_20250525_143022.MP4"
//         DJI:   "DJI_20250525_143000_001.MP4"
//         RunCam: "RC_2025-05-25_14-30-00.mp4"
//    Accuracy: ±1 second.
//
// 4. Manual correction via UI
//    User drags slider to align a recognisable event (takeoff,
//    landing, visible turn) between video and telemetry.
//
// ============================================================
require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../middleware/auth.php';

class VideoHandler {

    // Accepted video MIME types
    const ALLOWED_MIMES = [
        'video/mp4'        => 'mp4',
        'video/quicktime'  => 'mov',
        'video/x-msvideo'  => 'avi',
        'video/x-matroska' => 'mkv',
        'video/webm'       => 'webm',
        'video/mpeg'       => 'mpg',
        'video/3gpp'       => '3gp',
    ];

    const MAX_VIDEO_GB = 8;   // maximum upload size in GB

    // ── Upload entry point ────────────────────────────────────
    public function upload(array $user, int $flightId): array {
        // Verify flight belongs to user
        $flight = DB::query(
            "SELECT id, flight_date, duration_sec FROM flights WHERE id=? AND user_id=?",
            [$flightId, $user['sub']]
        )->fetch();
        if (!$flight) {
            http_response_code(404);
            return ['error' => 'Flight not found'];
        }

        if (empty($_FILES['video'])) {
            http_response_code(400);
            return ['error' => 'No video file uploaded (field name: video)'];
        }

        $file = $_FILES['video'];

        // Size check
        $maxBytes = self::MAX_VIDEO_GB * 1024 * 1024 * 1024;
        if ($file['size'] > $maxBytes) {
            http_response_code(413);
            return ['error' => "File exceeds " . self::MAX_VIDEO_GB . "GB limit"];
        }

        // MIME check
        $mime   = $this->detectMime($file['tmp_name']);
        $ext    = self::ALLOWED_MIMES[$mime] ?? null;
        if (!$ext) {
            http_response_code(415);
            return ['error' => "Unsupported video format. Accepted: MP4, MOV, AVI, MKV, WebM"];
        }

        // Store file
        $uuid = Auth::generateUUID();
        $dir  = VIDEO_UPLOAD_DIR . date('Y/m/') . $user['sub'] . '/';
        if (!is_dir($dir)) mkdir($dir, 0755, true);

        $storageFilename = $uuid . '.' . $ext;
        $storagePath     = $dir . $storageFilename;

        if (!move_uploaded_file($file['tmp_name'], $storagePath)) {
            return ['error' => 'Failed to store video file'];
        }

        // Extract metadata from the video file
        $meta = $this->extractMetadata($storagePath, $file['name']);

        // Build web-accessible path for streaming
        $webPath = VIDEO_WEB_PATH . date('Y/m/') . $user['sub'] . '/' . $storageFilename;

        // Run time-sync
        $logStartUnix = $this->getLogStartUnix($flightId);
        $syncResult   = $this->autoSync($meta, $file['name'], $logStartUnix, $flight);

        // Insert video record
        $videoId = DB::insert('flight_videos', [
            'flight_id'          => $flightId,
            'user_id'            => $user['sub'],
            'original_filename'  => $file['name'],
            'storage_path'       => $storagePath,
            'file_size'          => $file['size'],
            'mime_type'          => $mime,
            'duration_sec'       => $meta['duration_sec'],
            'width_px'           => $meta['width_px'],
            'height_px'          => $meta['height_px'],
            'fps'                => $meta['fps'],
            'codec'              => $meta['codec'],
            'video_start_unix'   => $meta['creation_time_unix_ms'],
            'log_start_unix'     => $logStartUnix,
            'sync_status'        => $syncResult['status'],
            'sync_method'        => $syncResult['method'],
            'sync_offset_ms'     => $syncResult['offset_ms'],
            'manual_correction_ms' => 0,
            'sync_confidence'    => $syncResult['confidence'],
            'sync_notes'         => $syncResult['notes'],
            'web_path'           => $webPath,
            'thumbnail_path'     => null,
        ]);

        // Generate thumbnail if FFmpeg is available
        $this->generateThumbnail($storagePath, $videoId, $dir, $webPath);

        return [
            'success'          => true,
            'video_id'         => $videoId,
            'duration_sec'     => $meta['duration_sec'],
            'resolution'       => $meta['width_px'] && $meta['height_px']
                                  ? "{$meta['width_px']}x{$meta['height_px']}" : null,
            'fps'              => $meta['fps'],
            'sync_status'      => $syncResult['status'],
            'sync_method'      => $syncResult['method'],
            'sync_offset_ms'   => $syncResult['offset_ms'],
            'sync_confidence'  => $syncResult['confidence'],
            'sync_notes'       => $syncResult['notes'],
            'web_path'         => $webPath,
        ];
    }

    // ── Get video record(s) for a flight ──────────────────────
    public function getVideos(int $flightId): array {
        return DB::query(
            "SELECT id, original_filename, duration_sec, width_px, height_px, fps,
             mime_type, file_size, sync_status, sync_method, sync_offset_ms,
             manual_correction_ms, effective_offset_ms, sync_confidence,
             sync_notes, web_path, thumbnail_path, created_at
             FROM flight_videos WHERE flight_id=? ORDER BY created_at",
            [$flightId]
        )->fetchAll();
    }

    // ── Update manual correction (fine-tune slider) ───────────
    public function updateSync(array $user, int $videoId, array $body): array {
        // Verify ownership via flight
        $video = DB::query(
            "SELECT fv.id, fv.flight_id, fv.sync_offset_ms
             FROM flight_videos fv
             JOIN flights f ON f.id = fv.flight_id
             WHERE fv.id=? AND f.user_id=?",
            [$videoId, $user['sub']]
        )->fetch();

        if (!$video) {
            http_response_code(404);
            return ['error' => 'Video not found'];
        }

        $updates = [];

        // Manual correction delta (fine-tune in ms, can be negative)
        if (array_key_exists('manual_correction_ms', $body)) {
            $correction = (int)$body['manual_correction_ms'];
            // Clamp to ±1 hour to prevent data corruption
            $correction = max(-3600000, min(3600000, $correction));
            $updates['manual_correction_ms'] = $correction;
            $updates['sync_status']          = 'manual';
        }

        // Allow override of the entire base offset too (full re-sync from UI)
        if (array_key_exists('sync_offset_ms', $body)) {
            $updates['sync_offset_ms'] = (int)$body['sync_offset_ms'];
        }

        if (empty($updates)) {
            return ['success' => false, 'error' => 'Nothing to update'];
        }

        $set = implode(', ', array_map(fn($k) => "`$k`=?", array_keys($updates)));
        DB::query("UPDATE flight_videos SET $set WHERE id=?",
            [...array_values($updates), $videoId]);

        // Fetch the new effective offset
        $row = DB::query("SELECT effective_offset_ms, sync_status FROM flight_videos WHERE id=?",
            [$videoId])->fetch();

        return [
            'success'             => true,
            'effective_offset_ms' => $row['effective_offset_ms'],
            'sync_status'         => $row['sync_status'],
        ];
    }

    // ── Delete video ──────────────────────────────────────────
    public function delete(array $user, int $videoId): array {
        $video = DB::query(
            "SELECT fv.storage_path, fv.thumbnail_path
             FROM flight_videos fv
             JOIN flights f ON f.id = fv.flight_id
             WHERE fv.id=? AND f.user_id=?",
            [$videoId, $user['sub']]
        )->fetch();

        if (!$video) {
            http_response_code(404);
            return ['error' => 'Video not found'];
        }

        foreach (['storage_path', 'thumbnail_path'] as $f) {
            if ($video[$f] && file_exists($video[$f])) {
                @unlink($video[$f]);
            }
        }

        DB::query("DELETE FROM flight_videos WHERE id=?", [$videoId]);
        return ['success' => true];
    }

    // ── Metadata extraction (pure PHP, no FFmpeg required) ────
    private function extractMetadata(string $path, string $origName): array {
        $meta = [
            'duration_sec'          => null,
            'width_px'              => null,
            'height_px'             => null,
            'fps'                   => null,
            'codec'                 => null,
            'creation_time_unix_ms' => null,
            'creation_time_src'     => null,
        ];

        // Try PHP getimagesize for basic video info (works for some MP4)
        $ext = strtolower(pathinfo($origName, PATHINFO_EXTENSION));

        if (in_array($ext, ['mp4', 'mov', 'm4v'])) {
            $this->parseMp4Atoms($path, $meta);
        }

        // Try FFprobe if available (much more reliable)
        if ($this->ffprobeAvailable()) {
            $this->extractWithFfprobe($path, $meta);
        }

        return $meta;
    }

    // ── Parse MP4 box/atom structure (pure PHP) ───────────────
    // Reads moov/mvhd atom for duration and creation_time.
    // moov/udta/©day or moov/udta/meta for human-readable creation date.
    private function parseMp4Atoms(string $path, array &$meta): void {
        $fp = fopen($path, 'rb');
        if (!$fp) return;

        try {
            // Find moov atom at top level
            $fileSize = filesize($path);
            $pos      = 0;

            while ($pos < $fileSize && $pos < 100 * 1024 * 1024) { // scan up to 100MB
                fseek($fp, $pos);
                $hdr = fread($fp, 8);
                if (strlen($hdr) < 8) break;

                $size = unpack('N', substr($hdr, 0, 4))[1];
                $type = substr($hdr, 4, 4);

                if ($size < 8 || $size > $fileSize) break;

                if ($type === 'moov') {
                    $this->parseMoov($fp, $pos + 8, $pos + $size, $meta);
                    break;
                }

                $pos += $size;
            }
        } finally {
            fclose($fp);
        }
    }

    private function parseMoov(mixed $fp, int $start, int $end, array &$meta): void {
        $pos = $start;
        while ($pos < $end - 8) {
            fseek($fp, $pos);
            $hdr = fread($fp, 8);
            if (strlen($hdr) < 8) break;

            $size = unpack('N', substr($hdr, 0, 4))[1];
            $type = substr($hdr, 4, 4);

            if ($size < 8) break;

            if ($type === 'mvhd') {
                // Movie header: version(1) flags(3) creation_time(4/8) modification_time(4/8)
                // time_scale(4) duration(4/8) ...
                fseek($fp, $pos + 8);
                $body   = fread($fp, 32);
                $ver    = ord($body[0]);
                if ($ver === 0) {
                    // 32-bit times
                    $ct        = unpack('N', substr($body, 4, 4))[1];
                    $timeScale = unpack('N', substr($body, 12, 4))[1];
                    $duration  = unpack('N', substr($body, 16, 4))[1];
                } else {
                    // 64-bit times (version 1)
                    $ctHi      = unpack('N', substr($body, 4, 4))[1];
                    $ctLo      = unpack('N', substr($body, 8, 4))[1];
                    $ct        = ($ctHi << 32) | $ctLo;
                    $timeScale = unpack('N', substr($body, 20, 4))[1];
                    $durHi     = unpack('N', substr($body, 24, 4))[1];
                    $durLo     = unpack('N', substr($body, 28, 4))[1];
                    $duration  = ($durHi << 32) | $durLo;
                }

                // MP4 epoch is Jan 1 1904, Unix epoch is Jan 1 1970
                // Difference: 2082844800 seconds
                if ($ct > 2082844800) {
                    $unixSec = $ct - 2082844800;
                    $meta['creation_time_unix_ms'] = $unixSec * 1000;
                    $meta['creation_time_src']     = 'mp4_mvhd';
                }

                if ($timeScale > 0 && $duration > 0) {
                    $meta['duration_sec'] = round($duration / $timeScale, 3);
                }
            }

            if ($type === 'trak') {
                $this->parseTrak($fp, $pos + 8, $pos + $size, $meta);
            }

            $pos += $size;
        }
    }

    private function parseTrak(mixed $fp, int $start, int $end, array &$meta): void {
        $pos = $start;
        while ($pos < $end - 8) {
            fseek($fp, $pos);
            $hdr = fread($fp, 8);
            if (strlen($hdr) < 8) break;
            $size = unpack('N', substr($hdr, 0, 4))[1];
            $type = substr($hdr, 4, 4);
            if ($size < 8) break;

            if ($type === 'mdia') {
                $this->parseMdia($fp, $pos + 8, $pos + $size, $meta);
            }
            $pos += $size;
        }
    }

    private function parseMdia(mixed $fp, int $start, int $end, array &$meta): void {
        $pos = $start;
        while ($pos < $end - 8) {
            fseek($fp, $pos);
            $hdr = fread($fp, 8);
            if (strlen($hdr) < 8) break;
            $size = unpack('N', substr($hdr, 0, 4))[1];
            $type = substr($hdr, 4, 4);
            if ($size < 8) break;

            if ($type === 'minf') {
                $this->parseMinf($fp, $pos + 8, $pos + $size, $meta);
            }
            $pos += $size;
        }
    }

    private function parseMinf(mixed $fp, int $start, int $end, array &$meta): void {
        // Look for stbl → stsd for codec, stts for fps
        $pos = $start;
        while ($pos < $end - 8) {
            fseek($fp, $pos);
            $hdr = fread($fp, 8);
            if (strlen($hdr) < 8) break;
            $size = unpack('N', substr($hdr, 0, 4))[1];
            $type = substr($hdr, 4, 4);
            if ($size < 8) break;

            if ($type === 'stbl') {
                $this->parseStbl($fp, $pos + 8, $pos + $size, $meta);
            }
            $pos += $size;
        }
    }

    private function parseStbl(mixed $fp, int $start, int $end, array &$meta): void {
        $pos = $start;
        while ($pos < $end - 8) {
            fseek($fp, $pos);
            $hdr = fread($fp, 8);
            if (strlen($hdr) < 8) break;
            $size = unpack('N', substr($hdr, 0, 4))[1];
            $type = substr($hdr, 4, 4);
            if ($size < 8) break;

            if ($type === 'stsd' && $meta['codec'] === null) {
                // Sample description: version(4) entry_count(4) codec_name(4)
                fseek($fp, $pos + 16);
                $codec = fread($fp, 4);
                if (ctype_print($codec)) {
                    $meta['codec'] = strtolower(trim($codec));
                }
            }

            if ($type === 'stts' && $meta['fps'] === null) {
                // Time-to-sample table — first entry gives frame duration
                fseek($fp, $pos + 12); // skip version(4) flags(0) entry_count(4)
                $entCount = unpack('N', fread($fp, 4))[1];
                if ($entCount > 0) {
                    $sampleCount    = unpack('N', fread($fp, 4))[1];
                    $sampleDuration = unpack('N', fread($fp, 4))[1];
                    // fps = timeScale / sampleDuration — but we need timeScale from mvhd
                    // Store raw and compute later
                    $meta['_stts_sample_duration'] = $sampleDuration;
                    $meta['_stts_sample_count']    = $sampleCount;
                }
            }

            if ($type === 'stsd') {
                // Also extract width/height from video sample entry
                fseek($fp, $pos + 24); // past stsd header + entry size + codec
                $data = fread($fp, 16);
                if (strlen($data) >= 16) {
                    // width at offset 24, height at offset 26 within the sample entry
                    $w = unpack('n', substr($data, 24 - 24, 2))[1] ?? null;
                    $h = unpack('n', substr($data, 26 - 24, 2))[1] ?? null;
                    if ($w && $h && $w > 0 && $h > 0 && $w < 8000 && $h < 8000) {
                        $meta['width_px']  = $w;
                        $meta['height_px'] = $h;
                    }
                }
            }

            $pos += $size;
        }
    }

    // ── FFprobe extraction (if available on server) ───────────
    private function ffprobeAvailable(): bool {
        exec('ffprobe -version 2>/dev/null', $out, $ret);
        return $ret === 0;
    }

    private function extractWithFfprobe(string $path, array &$meta): void {
        $escaped = escapeshellarg($path);
        $cmd = "ffprobe -v quiet -print_format json -show_streams -show_format $escaped 2>/dev/null";
        exec($cmd, $out, $ret);
        if ($ret !== 0 || empty($out)) return;

        $data = json_decode(implode('', $out), true);
        if (!$data) return;

        // Format-level info
        $fmt = $data['format'] ?? [];
        if (!empty($fmt['duration'])) {
            $meta['duration_sec'] = round((float)$fmt['duration'], 3);
        }

        // Creation time from tags
        $tags = $fmt['tags'] ?? [];
        foreach (['creation_time', 'com.apple.quicktime.creationdate', 'date'] as $k) {
            if (!empty($tags[$k])) {
                $ts = strtotime($tags[$k]);
                if ($ts > 0) {
                    $meta['creation_time_unix_ms'] = $ts * 1000;
                    $meta['creation_time_src']     = "ffprobe_$k";
                    break;
                }
            }
        }

        // Video stream info
        foreach ($data['streams'] ?? [] as $stream) {
            if ($stream['codec_type'] !== 'video') continue;

            if (!empty($stream['width']))  $meta['width_px']  = (int)$stream['width'];
            if (!empty($stream['height'])) $meta['height_px'] = (int)$stream['height'];
            if (!empty($stream['codec_name'])) $meta['codec'] = $stream['codec_name'];

            // FPS from avg_frame_rate or r_frame_rate
            foreach (['avg_frame_rate', 'r_frame_rate'] as $fpsKey) {
                if (!empty($stream[$fpsKey]) && str_contains($stream[$fpsKey], '/')) {
                    [$num, $den] = explode('/', $stream[$fpsKey]);
                    if ((float)$den > 0) {
                        $meta['fps'] = round((float)$num / (float)$den, 3);
                        break;
                    }
                }
            }

            // Tags in stream (GoPro, DJI)
            $sTags = $stream['tags'] ?? [];
            if (!empty($sTags['creation_time']) && !$meta['creation_time_unix_ms']) {
                $ts = strtotime($sTags['creation_time']);
                if ($ts > 0) {
                    $meta['creation_time_unix_ms'] = $ts * 1000;
                    $meta['creation_time_src']     = 'ffprobe_stream_tag';
                }
            }

            break; // first video stream only
        }
    }

    // ── Auto time-sync logic ──────────────────────────────────
    private function autoSync(array $meta, string $filename, ?int $logStartUnix, array $flight): array {
        $result = [
            'status'     => 'failed',
            'method'     => 'none',
            'offset_ms'  => null,
            'confidence' => 0,
            'notes'      => 'Could not determine video start time automatically',
        ];

        // Method 1: Video creation_time from MP4 metadata
        if ($meta['creation_time_unix_ms'] && $logStartUnix) {
            $offsetMs = $meta['creation_time_unix_ms'] - $logStartUnix;
            // Sanity check: offset should be within ±24 hours of flight
            if (abs($offsetMs) < 86400000) {
                $result = [
                    'status'     => 'auto',
                    'method'     => $meta['creation_time_src'],
                    'offset_ms'  => (int)$offsetMs,
                    'confidence' => 85,
                    'notes'      => sprintf(
                        'Video start (UTC): %s, Log start (UTC): %s, Offset: %.1fs',
                        date('Y-m-d H:i:s', intdiv($meta['creation_time_unix_ms'], 1000)),
                        date('Y-m-d H:i:s', intdiv($logStartUnix, 1000)),
                        $offsetMs / 1000
                    ),
                ];
                return $result;
            }
        }

        // Method 2: Parse timestamp from filename
        $fileTs = $this->parseFilenameTimestamp($filename);
        if ($fileTs && $logStartUnix) {
            $offsetMs = ($fileTs * 1000) - $logStartUnix;
            if (abs($offsetMs) < 86400000) {
                $result = [
                    'status'     => 'auto',
                    'method'     => 'filename_ts',
                    'offset_ms'  => (int)$offsetMs,
                    'confidence' => 65,
                    'notes'      => sprintf(
                        'Timestamp from filename: %s, Offset: %.1fs. Manual correction recommended.',
                        date('Y-m-d H:i:s', $fileTs),
                        $offsetMs / 1000
                    ),
                ];
                return $result;
            }
        }

        // Method 3: Use flight_date as best guess (video probably started near flight)
        if ($logStartUnix && !empty($flight['duration_sec'])) {
            $result = [
                'status'     => 'failed',
                'method'     => 'none',
                'offset_ms'  => 0,
                'confidence' => 10,
                'notes'      => 'Could not detect video timestamp. Set offset = 0 (video and log aligned at start). Use manual correction to fine-tune.',
            ];
        }

        return $result;
    }

    // ── Parse timestamp from common FPV camera filename formats ─
    private function parseFilenameTimestamp(string $filename): ?int {
        $name = pathinfo($filename, PATHINFO_FILENAME);

        $patterns = [
            // DJI: DJI_20250525_143022_001, DJI_2025-05-25_14-30-22
            '/DJI[_-](\d{4})[_-]?(\d{2})[_-]?(\d{2})[_-](\d{2})[_-]?(\d{2})[_-]?(\d{2})/i',
            // GoPro: GH010123_20250525_143022, GOPR1234_20250525143022
            '/\d{6,}_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/',
            '/\d{6,}_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/',
            // RunCam: RC_2025-05-25_14-30-00, RunCam_20250525_143000
            '/(?:RC|RunCam)[_-](\d{4})[_-](\d{2})[_-](\d{2})[_-](\d{2})[_-](\d{2})[_-](\d{2})/i',
            // Generic: any_20250525_143022, any_20250525143022
            '/[_-](\d{4})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})/',
            '/[_-](\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/',
            // ISO-like: 2025-05-25T14:30:22, 2025-05-25_14-30-22
            '/(\d{4})[_-](\d{2})[_-](\d{2})[T_](\d{2})[_:](\d{2})[_:](\d{2})/',
        ];

        foreach ($patterns as $pattern) {
            if (preg_match($pattern, $name, $m)) {
                $ts = mktime((int)$m[4], (int)$m[5], (int)$m[6], (int)$m[2], (int)$m[3], (int)$m[1]);
                if ($ts > 1000000000) { // sanity: after year 2001
                    return $ts;
                }
            }
        }
        return null;
    }

    // ── Get log start Unix timestamp (ms) ─────────────────────
    private function getLogStartUnix(int $flightId): ?int {
        $row = DB::query(
            "SELECT UNIX_TIMESTAMP(flight_date) * 1000 AS start_ms
             FROM flights WHERE id=? AND flight_date IS NOT NULL",
            [$flightId]
        )->fetch();
        return $row ? (int)$row['start_ms'] : null;
    }

    // ── MIME type detection ────────────────────────────────────
    private function detectMime(string $path): string {
        if (function_exists('finfo_file')) {
            $finfo = finfo_open(FILEINFO_MIME_TYPE);
            $mime  = finfo_file($finfo, $path);
            finfo_close($finfo);
            return $mime;
        }
        return mime_content_type($path) ?: 'application/octet-stream';
    }

    // ── Generate thumbnail (requires FFmpeg) ──────────────────
    private function generateThumbnail(string $videoPath, int $videoId, string $dir, string $webPath): void {
        if (!$this->ffprobeAvailable()) return;
        $thumbPath = $dir . "thumb_{$videoId}.jpg";
        $escaped   = escapeshellarg($videoPath);
        $thumbEsc  = escapeshellarg($thumbPath);
        exec("ffmpeg -y -i $escaped -ss 00:00:02 -frames:v 1 -q:v 2 $thumbEsc 2>/dev/null", $out, $ret);
        if ($ret === 0 && file_exists($thumbPath)) {
            $webThumb = str_replace(pathinfo($webPath, PATHINFO_BASENAME),
                                    "thumb_{$videoId}.jpg", $webPath);
            DB::query("UPDATE flight_videos SET thumbnail_path=? WHERE id=?",
                [$thumbPath, $videoId]);
        }
    }
}
