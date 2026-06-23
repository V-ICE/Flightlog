<?php
// ============================================================
// UAVLogBook — Flight Photo Upload Handler
// ============================================================
require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../middleware/auth.php';

class PhotoHandler {

    const ALLOWED_MIMES = [
        'image/jpeg' => 'jpg',
        'image/jpg'  => 'jpg',
        'image/png'  => 'png',
        'image/webp' => 'webp',
        'image/gif'  => 'gif',
        'image/heic' => 'heic',
        'image/heif' => 'heif',
    ];

    public function getPhotos(int $flightId): array {
        return DB::query(
            "SELECT id, original_filename, web_path, file_size, mime_type,
             width_px, height_px, caption, sort_order, created_at
             FROM flight_photos WHERE flight_id=? ORDER BY sort_order, id",
            [$flightId]
        )->fetchAll();
    }

    public function upload(array $user, int $flightId): array {
        $flight = DB::query(
            "SELECT id FROM flights WHERE id=? AND user_id=?",
            [$flightId, $user['sub']]
        )->fetch();
        if (!$flight) {
            http_response_code(404);
            return ['error' => 'Flight not found'];
        }

        $files = $_FILES['photos'] ?? $_FILES['photo'] ?? null;
        if (!$files) {
            http_response_code(400);
            return ['error' => 'No photo files uploaded (field name: photos or photo)'];
        }

        // Normalize to array (multi-file or single)
        if (!is_array($files['name'])) {
            $files = array_map(fn($v) => [$v], $files);
        } else {
            $count = count($files['name']);
            $normalized = [];
            foreach ($files as $key => $vals) {
                for ($i = 0; $i < $count; $i++) {
                    $normalized[$i][$key] = $vals[$i];
                }
            }
            $files = $normalized;
        }

        $dir = PHOTO_UPLOAD_DIR . $flightId . '/';
        if (!is_dir($dir)) mkdir($dir, 0755, true);

        $maxBytes = MAX_PHOTO_MB * 1024 * 1024;
        $saved = [];
        $errors = [];

        foreach ($files as $file) {
            if ($file['error'] !== UPLOAD_ERR_OK) {
                $errors[] = $file['name'] . ': upload error ' . $file['error'];
                continue;
            }
            if ($file['size'] > $maxBytes) {
                $errors[] = $file['name'] . ": exceeds " . MAX_PHOTO_MB . "MB limit";
                continue;
            }

            $mime = $this->detectMime($file['tmp_name']);
            $ext  = self::ALLOWED_MIMES[$mime] ?? null;
            if (!$ext) {
                $errors[] = $file['name'] . ': unsupported image format';
                continue;
            }

            $hash = md5_file($file['tmp_name']);
            $existing = DB::query(
                "SELECT id FROM flight_photos WHERE flight_id=? AND file_hash=?",
                [$flightId, $hash]
            )->fetch();
            if ($existing) {
                $errors[] = $file['name'] . ': duplicate (already uploaded)';
                continue;
            }

            $fname = uniqid('ph_', true) . '.' . $ext;
            $storagePath = $dir . $fname;
            if (!move_uploaded_file($file['tmp_name'], $storagePath)) {
                $errors[] = $file['name'] . ': failed to save';
                continue;
            }

            $webPath = PHOTO_WEB_PATH . $flightId . '/' . $fname;
            [$w, $h] = $this->imageDimensions($storagePath);

            $photoId = DB::insert('flight_photos', [
                'flight_id'         => $flightId,
                'user_id'           => $user['sub'],
                'original_filename' => basename($file['name']),
                'storage_path'      => $storagePath,
                'web_path'          => $webPath,
                'file_size'         => $file['size'],
                'mime_type'         => $mime,
                'width_px'          => $w,
                'height_px'         => $h,
                'file_hash'         => $hash,
            ]);

            $saved[] = [
                'id'                => $photoId,
                'original_filename' => basename($file['name']),
                'web_path'          => $webPath,
                'file_size'         => $file['size'],
                'width_px'          => $w,
                'height_px'         => $h,
            ];
        }

        $dupes = count(array_filter($errors, fn($e) => str_contains($e, 'duplicate')));
        return ['success' => true, 'saved' => $saved, 'errors' => $errors, 'duplicates_skipped' => $dupes];
    }

    public function updateCaption(array $user, int $photoId, array $body): array {
        $photo = DB::query(
            "SELECT p.id FROM flight_photos p
             JOIN flights f ON f.id = p.flight_id
             WHERE p.id=? AND f.user_id=?",
            [$photoId, $user['sub']]
        )->fetch();
        if (!$photo) {
            http_response_code(404);
            return ['error' => 'Photo not found'];
        }
        DB::query("UPDATE flight_photos SET caption=? WHERE id=?",
            [$body['caption'] ?? null, $photoId]);
        return ['success' => true];
    }

    public function delete(array $user, int $photoId): array {
        $photo = DB::query(
            "SELECT p.storage_path FROM flight_photos p
             JOIN flights f ON f.id = p.flight_id
             WHERE p.id=? AND f.user_id=?",
            [$photoId, $user['sub']]
        )->fetch();
        if (!$photo) {
            http_response_code(404);
            return ['error' => 'Photo not found'];
        }
        if ($photo['storage_path'] && file_exists($photo['storage_path'])) {
            unlink($photo['storage_path']);
        }
        DB::query("DELETE FROM flight_photos WHERE id=?", [$photoId]);
        return ['success' => true];
    }

    private function detectMime(string $path): string {
        if (function_exists('mime_content_type')) {
            return mime_content_type($path) ?: 'application/octet-stream';
        }
        $info = finfo_open(FILEINFO_MIME_TYPE);
        $mime = finfo_file($info, $path);
        finfo_close($info);
        return $mime ?: 'application/octet-stream';
    }

    private function imageDimensions(string $path): array {
        if (function_exists('getimagesize')) {
            $size = @getimagesize($path);
            if ($size) return [$size[0], $size[1]];
        }
        return [null, null];
    }
}
