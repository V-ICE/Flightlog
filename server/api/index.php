<?php
// ============================================================
// UAVLogBook — REST API Router
// Deploy to: public_html/api/index.php
// All requests proxied through .htaccess
// ============================================================
header('Content-Type: application/json');
header('X-Content-Type-Options: nosniff');

require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../middleware/auth.php';
require_once __DIR__ . '/../api/processor.php';
require_once __DIR__ . '/../api/video_handler.php';
require_once __DIR__ . '/../api/photo_handler.php';

// CORS Headers
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, ALLOWED_ORIGINS)) {
    header("Access-Control-Allow-Origin: $origin");
    header('Access-Control-Allow-Credentials: true');
}
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Auth-Token');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit(0);

// Route dispatcher
$method = $_SERVER['REQUEST_METHOD'];
$uri    = strtok($_SERVER['REQUEST_URI'], '?');
$uri    = preg_replace('#^/api/v1#', '', $uri);
$parts  = array_filter(explode('/', trim($uri, '/')));
$parts  = array_values($parts);

$resource = $parts[0] ?? '';
$id       = isset($parts[1]) ? (int)$parts[1] : null;
$sub      = $parts[2] ?? '';

// Input body
$body = json_decode(file_get_contents('php://input'), true) ?? [];

try {
    switch ("$method:$resource") {

        // ── Authentication ────────────────────────────────────
        case 'POST:auth':
            $action = $parts[1] ?? '';
            switch ($action) {
                case 'register': echo json_encode(authRegister($body)); break;
                case 'login':    echo json_encode(authLogin($body));    break;
                case 'refresh':  echo json_encode(authRefresh());       break;
                default: http_response_code(404); echo json_encode(['error'=>'Not found']);
            }
            break;

        // ── Flights ───────────────────────────────────────────
        case 'GET:flights':
            $user = Auth::requireAuth();
            if ($id) {
                echo json_encode(getFlightDetail($user, $id, $sub));
            } else {
                echo json_encode(listFlights($user));
            }
            break;

        case 'POST:flights':
            $user = Auth::requireAuth();
            echo json_encode(uploadFlight($user));
            break;

        case 'PUT:flights':
            $user = Auth::requireAuth();
            echo json_encode(updateFlight($user, $id, $body));
            break;

        case 'DELETE:flights':
            $user = Auth::requireAuth();
            echo json_encode(deleteFlight($user, $id));
            break;

        // ── Aircraft ─────────────────────────────────────────
        case 'GET:aircraft':
            $user = Auth::requireAuth();
            echo json_encode($id ? getAircraft($user, $id) : listAircraft($user));
            break;
        case 'POST:aircraft':
            $user = Auth::requireAuth();
            if ($sub === 'image') {
                echo json_encode(uploadAircraftImage($user, $id));
            } else {
                echo json_encode(createAircraft($user, $body));
            }
            break;
        case 'PUT:aircraft':
            $user = Auth::requireAuth();
            echo json_encode(updateAircraft($user, $id, $body));
            break;
        case 'DELETE:aircraft':
            $user = Auth::requireAuth();
            echo json_encode(deleteAircraft($user, $id));
            break;

        // ── User Profile ──────────────────────────────────────
        case 'GET:profile':
            $user = Auth::requireAuth();
            echo json_encode(getProfile($user));
            break;
        case 'PUT:profile':
            $user = Auth::requireAuth();
            echo json_encode(updateProfile($user, $body));
            break;

        // ── View Preferences ──────────────────────────────────
        case 'GET:prefs':
            $user = Auth::requireAuth();
            echo json_encode(getViewPrefs($user));
            break;
        case 'PUT:prefs':
            $user = Auth::requireAuth();
            echo json_encode(updateViewPrefs($user, $body));
            break;

        // ── Stats / Dashboard ─────────────────────────────────
        case 'GET:stats':
            $user = Auth::requireAuth();
            echo json_encode(getDashboardStats($user));
            break;

        // ── Video sync ────────────────────────────────────────
        case 'GET:videos':
            $user = Auth::requireAuth();
            $vh = new VideoHandler();
            echo json_encode($vh->getVideos($id));
            break;

        case 'POST:videos':
            // POST /videos/{flight_id}  — upload video for a flight
            $user = Auth::requireAuth();
            $vh = new VideoHandler();
            echo json_encode($vh->upload($user, $id));
            break;

        case 'PUT:videos':
            // PUT /videos/{video_id}  — update sync offset
            $user = Auth::requireAuth();
            $vh = new VideoHandler();
            echo json_encode($vh->updateSync($user, $id, $body));
            break;

        case 'DELETE:videos':
            $user = Auth::requireAuth();
            $vh = new VideoHandler();
            echo json_encode($vh->delete($user, $id));
            break;

        // ── Flight Photos ─────────────────────────────────────
        case 'GET:photos':
            $user = Auth::requireAuth();
            $ph = new PhotoHandler();
            echo json_encode($ph->getPhotos($id));
            break;
        case 'POST:photos':
            $user = Auth::requireAuth();
            $ph = new PhotoHandler();
            echo json_encode($ph->upload($user, $id));
            break;
        case 'PUT:photos':
            $user = Auth::requireAuth();
            $ph = new PhotoHandler();
            echo json_encode($ph->updateCaption($user, $id, $body));
            break;
        case 'DELETE:photos':
            $user = Auth::requireAuth();
            $ph = new PhotoHandler();
            echo json_encode($ph->delete($user, $id));
            break;

        // ── Aircraft Maintenance ───────────────────────────────
        case 'GET:maintenance':
            $user = Auth::requireAuth();
            echo json_encode(listMaintenance($user, $id));
            break;
        case 'POST:maintenance':
            $user = Auth::requireAuth();
            echo json_encode(createMaintenance($user, $id, $body));
            break;
        case 'PUT:maintenance':
            $user = Auth::requireAuth();
            echo json_encode(updateMaintenance($user, $id, $body));
            break;
        case 'DELETE:maintenance':
            $user = Auth::requireAuth();
            echo json_encode(deleteMaintenance($user, $id));
            break;

        // ── Shared flights (public, no auth) ─────────────────
        case 'GET:share':
            echo json_encode(getSharedFlight($parts[1] ?? ''));
            break;
        case 'POST:share':
            $user = Auth::requireAuth();
            echo json_encode(createShareLink($user, $id));
            break;

        default:
            http_response_code(404);
            echo json_encode(['error' => 'Endpoint not found']);
    }
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}

// ============================================================
// Handler Functions
// ============================================================

function authRegister(array $body): array {
    $email = filter_var($body['email'] ?? '', FILTER_VALIDATE_EMAIL);
    $pass  = $body['password'] ?? '';
    $name  = htmlspecialchars($body['display_name'] ?? 'Pilot');
    if (!$email || strlen($pass) < 8) {
        http_response_code(400);
        return ['error' => 'Invalid email or password too short (min 8 chars)'];
    }
    $exists = DB::query("SELECT id FROM users WHERE email=?", [$email])->fetch();
    if ($exists) { http_response_code(409); return ['error' => 'Email already registered']; }

    $uuid = Auth::generateUUID();
    $hash = Auth::hashPassword($pass);
    $userId = DB::insert('users', [
        'uuid' => $uuid, 'email' => $email,
        'password_hash' => $hash, 'display_name' => $name
    ]);
    $token = Auth::generateToken(['sub' => $userId, 'uuid' => $uuid, 'email' => $email]);
    return ['token' => $token, 'user' => ['id'=>$userId,'email'=>$email,'display_name'=>$name]];
}

function authLogin(array $body): array {
    $email = $body['email'] ?? '';
    $pass  = $body['password'] ?? '';
    $user  = DB::query("SELECT * FROM users WHERE email=?", [$email])->fetch();
    if (!$user || !Auth::verifyPassword($pass, $user['password_hash'])) {
        http_response_code(401);
        return ['error' => 'Invalid credentials'];
    }
    $token = Auth::generateToken(['sub' => $user['id'], 'uuid' => $user['uuid'], 'email' => $email]);
    return ['token' => $token, 'user' => [
        'id' => $user['id'], 'email' => $user['email'],
        'display_name' => $user['display_name'], 'role' => $user['role'],
        'settings' => json_decode($user['settings'] ?? '{}', true),
    ]];
}

function authRefresh(): array {
    $user  = Auth::requireAuth();
    $token = Auth::generateToken(['sub'=>$user['sub'],'uuid'=>$user['uuid'],'email'=>$user['email']]);
    return ['token' => $token];
}

function listFlights(array $user): array {
    $page  = (int)($_GET['page'] ?? 1);
    $limit = min((int)($_GET['limit'] ?? 20), 100);
    $offset = ($page - 1) * $limit;
    $search = '%' . ($_GET['search'] ?? '') . '%';
    $format = $_GET['format'] ?? '';

    $where = "user_id=? AND original_filename LIKE ?";
    $params = [$user['sub'], $search];
    if ($format) { $where .= " AND log_format=?"; $params[] = $format; }

    $total = DB::query("SELECT COUNT(*) c FROM flights WHERE $where", $params)->fetchColumn();
    $rows  = DB::query("SELECT id,uuid,original_filename,log_format,format_confidence,
                        parse_status,flight_date,duration_sec,max_altitude_m,max_speed_ms,
                        max_distance_m,total_distance_m,home_lat,home_lng,min_battery_v,
                        warning_count,error_count,pilot_notes,tags,location_name,created_at
                        FROM flights WHERE $where ORDER BY flight_date DESC, created_at DESC
                        LIMIT ? OFFSET ?",
        [...$params, $limit, $offset])->fetchAll();

    foreach ($rows as &$r) {
        $r['tags'] = json_decode($r['tags'] ?? '[]', true);
    }

    return ['data' => $rows, 'total' => (int)$total, 'page' => $page, 'per_page' => $limit];
}

function getFlightDetail(array $user, int $id, string $sub): array {
    $flight = DB::query("SELECT * FROM flights WHERE id=? AND user_id=?",
        [$id, $user['sub']])->fetch();
    if (!$flight) { http_response_code(404); return ['error' => 'Flight not found']; }

    $flight['ai_analysis']  = json_decode($flight['ai_analysis']  ?? '{}', true);
    $flight['bounding_box'] = json_decode($flight['bounding_box'] ?? '{}', true);
    $flight['tags']         = json_decode($flight['tags']         ?? '[]', true);
    $flight['weather']      = json_decode($flight['weather']      ?? '{}', true);

    // Sub-resource: telemetry
    switch ($sub) {
        case 'gps':
            $flight['telemetry'] = DB::query("SELECT t_ms,lat,lng,alt_m,alt_amsl_m,
                speed_ms,ground_course,hdop,sats,fix_type FROM telemetry_gps WHERE flight_id=?
                ORDER BY t_ms", [$id])->fetchAll();
            break;
        case 'attitude':
            $flight['telemetry'] = DB::query("SELECT t_ms,roll_deg,pitch_deg,yaw_deg
                FROM telemetry_attitude WHERE flight_id=? ORDER BY t_ms", [$id])->fetchAll();
            break;
        case 'battery':
            $flight['telemetry'] = DB::query("SELECT t_ms,voltage_v,current_a,remaining_pct,consumed_mah
                FROM telemetry_battery WHERE flight_id=? ORDER BY t_ms", [$id])->fetchAll();
            break;
        case 'imu':
            $flight['telemetry'] = DB::query("SELECT t_ms,accel_x,accel_y,accel_z,gyro_x,gyro_y,gyro_z,vibe_x,vibe_y,vibe_z
                FROM telemetry_imu WHERE flight_id=? ORDER BY t_ms", [$id])->fetchAll();
            break;
        case 'events':
            $flight['events'] = DB::query("SELECT t_ms,event_type,severity,value,description
                FROM flight_events WHERE flight_id=? ORDER BY t_ms", [$id])->fetchAll();
            break;
        case '':
            // Summary with first 100 GPS points for overview map
            $flight['gps_preview'] = DB::query("SELECT lat,lng,alt_m FROM telemetry_gps
                WHERE flight_id=? ORDER BY t_ms", [$id])->fetchAll();
            $flight['events'] = DB::query("SELECT * FROM flight_events WHERE flight_id=? ORDER BY t_ms", [$id])->fetchAll();
            break;
    }
    return $flight;
}

function uploadFlight(array $user): array {
    if (empty($_FILES['log'])) {
        http_response_code(400); return ['error' => 'No file uploaded'];
    }
    $file  = $_FILES['log'];
    $maxBytes = MAX_FILE_MB * 1024 * 1024;
    if ($file['size'] > $maxBytes) {
        http_response_code(413); return ['error' => "File exceeds " . MAX_FILE_MB . "MB limit"];
    }

    // Store file
    $uuid = Auth::generateUUID();
    $dir  = UPLOAD_DIR . date('Y/m/') . $user['sub'] . '/';
    if (!is_dir($dir)) mkdir($dir, 0755, true);
    $storagePath = $dir . $uuid . '_' . basename($file['name']);
    if (!move_uploaded_file($file['tmp_name'], $storagePath)) {
        return ['error' => 'Failed to store file'];
    }

    $hash = hash_file('sha256', $storagePath);
    // Check duplicate
    $dup = DB::query("SELECT id FROM flights WHERE user_id=? AND file_hash=?", [$user['sub'], $hash])->fetch();
    if ($dup) {
        unlink($storagePath);
        return ['warning' => 'Duplicate flight detected', 'existing_id' => $dup['id']];
    }

    // Insert pending flight record
    $flightId = DB::insert('flights', [
        'uuid'              => $uuid,
        'user_id'           => $user['sub'],
        'aircraft_id'       => (int)($_POST['aircraft_id'] ?? 0) ?: null,
        'original_filename' => $file['name'],
        'file_size'         => $file['size'],
        'file_hash'         => $hash,
        'storage_path'      => $storagePath,
        'parse_status'      => 'pending',
        'pilot_notes'       => htmlspecialchars($_POST['notes'] ?? ''),
        'tags'              => json_encode(array_filter(explode(',', $_POST['tags'] ?? ''))),
    ]);

    // Process asynchronously if possible, otherwise inline
    $processor = new FlightProcessor();
    try {
        $processor->process($flightId, $storagePath, $file['name']);
        $flight = DB::query("SELECT * FROM flights WHERE id=?", [$flightId])->fetch();
        return ['success' => true, 'flight_id' => $flightId, 'status' => $flight['parse_status'],
                'format' => $flight['log_format'], 'format_confidence' => $flight['format_confidence']];
    } catch (Exception $e) {
        return ['success' => false, 'flight_id' => $flightId, 'error' => $e->getMessage()];
    }
}

function updateFlight(array $user, int $id, array $body): array {
    $allowed = ['pilot_notes', 'location_name', 'aircraft_id', 'tags', 'display_name', 'home_lat', 'home_lng', 'flight_date'];
    $updates = [];
    foreach ($allowed as $field) {
        if (array_key_exists($field, $body)) {
            if ($field === 'tags') {
                $updates[$field] = json_encode((array)$body[$field]);
            } elseif (in_array($field, ['home_lat', 'home_lng'])) {
                $updates[$field] = $body[$field] === null ? null : (float)$body[$field];
            } else {
                $updates[$field] = $body[$field];
            }
        }
    }
    if (empty($updates)) return ['success' => false, 'error' => 'Nothing to update'];
    $set = implode(', ', array_map(fn($k) => "`$k`=?", array_keys($updates)));
    DB::query("UPDATE flights SET $set WHERE id=? AND user_id=?",
        [...array_values($updates), $id, $user['sub']]);
    return ['success' => true];
}

function deleteFlight(array $user, int $id): array {
    $flight = DB::query("SELECT storage_path FROM flights WHERE id=? AND user_id=?",
        [$id, $user['sub']])->fetch();
    if (!$flight) { http_response_code(404); return ['error' => 'Not found']; }
    if ($flight['storage_path'] && file_exists($flight['storage_path'])) {
        unlink($flight['storage_path']);
    }
    DB::query("DELETE FROM flights WHERE id=?", [$id]);
    return ['success' => true];
}

function listAircraft(array $user): array {
    $rows = DB::query("SELECT * FROM aircraft WHERE user_id=? ORDER BY name", [$user['sub']])->fetchAll();
    foreach ($rows as &$r) $r['specs'] = json_decode($r['specs'] ?? '{}', true);
    return $rows;
}
function getAircraft(array $user, int $id): array {
    $r = DB::query("SELECT * FROM aircraft WHERE id=? AND user_id=?", [$id, $user['sub']])->fetch();
    if (!$r) return [];
    $r['specs'] = json_decode($r['specs'] ?? '{}', true);
    return $r;
}
function createAircraft(array $user, array $body): array {
    $specFields = ['specs'];
    $numericFields = ['auw_g','wingspan_mm','length_mm','frame_size_mm','motor_count',
                      'battery_cells','battery_mah','endurance_min','max_speed_kmh','range_km'];
    $data = [
        'user_id'       => $user['sub'],
        'name'          => htmlspecialchars($body['name'] ?? 'My UAV'),
        'type'          => $body['type'] ?? 'multirotor',
        'make'          => $body['make'] ?? null,
        'model'         => $body['model'] ?? null,
        'serial_number' => $body['serial_number'] ?? null,
        'firmware'      => $body['firmware'] ?? null,
        'firmware_ver'  => $body['firmware_ver'] ?? null,
        'notes'         => $body['notes'] ?? null,
        'status'        => $body['status'] ?? 'active',
        'purchase_date' => ($body['purchase_date'] ?? '') ?: null,
        'specs'         => isset($body['specs']) ? json_encode($body['specs']) : null,
    ];
    foreach ($numericFields as $f) {
        $data[$f] = isset($body[$f]) && $body[$f] !== '' ? (int)$body[$f] : null;
    }
    $id = DB::insert('aircraft', $data);
    return ['success' => true, 'id' => $id];
}
function updateAircraft(array $user, int $id, array $body): array {
    $allowed = ['name','type','make','model','serial_number','firmware','firmware_ver','notes',
                'status','purchase_date','auw_g','wingspan_mm','length_mm','frame_size_mm',
                'motor_count','battery_cells','battery_mah','endurance_min','max_speed_kmh','range_km','specs'];
    $numericFields = ['auw_g','wingspan_mm','length_mm','frame_size_mm','motor_count',
                      'battery_cells','battery_mah','endurance_min','max_speed_kmh','range_km'];
    $updates = [];
    foreach ($allowed as $f) {
        if (!array_key_exists($f, $body)) continue;
        if ($f === 'specs') {
            $updates[$f] = is_array($body[$f]) ? json_encode($body[$f]) : $body[$f];
        } elseif (in_array($f, $numericFields)) {
            $updates[$f] = ($body[$f] !== null && $body[$f] !== '') ? (int)$body[$f] : null;
        } elseif ($f === 'purchase_date') {
            $updates[$f] = ($body[$f] ?? '') ?: null;
        } else {
            $updates[$f] = $body[$f];
        }
    }
    if (empty($updates)) return ['success' => false];
    $set = implode(', ', array_map(fn($k) => "`$k`=?", array_keys($updates)));
    DB::query("UPDATE aircraft SET $set WHERE id=? AND user_id=?",
        [...array_values($updates), $id, $user['sub']]);
    return ['success' => true];
}
function deleteAircraft(array $user, int $id): array {
    DB::query("DELETE FROM aircraft WHERE id=? AND user_id=?", [$id, $user['sub']]);
    return ['success' => true];
}
function uploadAircraftImage(array $user, int $id): array {
    $ac = DB::query("SELECT id, image_url FROM aircraft WHERE id=? AND user_id=?", [$id, $user['sub']])->fetch();
    if (!$ac) { http_response_code(404); return ['error' => 'Aircraft not found']; }

    $file = $_FILES['image'] ?? null;
    if (!$file || $file['error'] !== UPLOAD_ERR_OK) {
        http_response_code(400); return ['error' => 'No image uploaded (field name: image)'];
    }
    if ($file['size'] > 10 * 1024 * 1024) {
        http_response_code(413); return ['error' => 'Image exceeds 10MB limit'];
    }

    $mime = function_exists('mime_content_type') ? mime_content_type($file['tmp_name']) : 'image/jpeg';
    $allowed = ['image/jpeg'=>'jpg','image/png'=>'png','image/webp'=>'webp','image/gif'=>'gif','image/heic'=>'heic'];
    $ext = $allowed[$mime] ?? null;
    if (!$ext) { http_response_code(415); return ['error' => 'Unsupported image format']; }

    $dir = AIRCRAFT_PHOTO_DIR;
    if (!is_dir($dir)) mkdir($dir, 0755, true);

    // Delete old image file if present
    if ($ac['image_url']) {
        $oldPath = str_replace(AIRCRAFT_PHOTO_PATH, AIRCRAFT_PHOTO_DIR, $ac['image_url']);
        if (file_exists($oldPath)) unlink($oldPath);
    }

    $fname = 'ac_' . $id . '_' . uniqid() . '.' . $ext;
    $storagePath = $dir . $fname;
    if (!move_uploaded_file($file['tmp_name'], $storagePath)) {
        return ['error' => 'Failed to save image'];
    }

    $webPath = AIRCRAFT_PHOTO_PATH . $fname;
    DB::query("UPDATE aircraft SET image_url=? WHERE id=?", [$webPath, $id]);
    return ['success' => true, 'image_url' => $webPath];
}

function listMaintenance(array $user, int $aircraftId): array {
    $ac = DB::query("SELECT id FROM aircraft WHERE id=? AND user_id=?", [$aircraftId, $user['sub']])->fetch();
    if (!$ac) { http_response_code(404); return ['error' => 'Aircraft not found']; }
    return DB::query(
        "SELECT id, maintenance_date, type, description, parts_replaced, cost, created_at
         FROM aircraft_maintenance WHERE aircraft_id=? ORDER BY maintenance_date DESC",
        [$aircraftId]
    )->fetchAll();
}
function createMaintenance(array $user, int $aircraftId, array $body): array {
    $ac = DB::query("SELECT id FROM aircraft WHERE id=? AND user_id=?", [$aircraftId, $user['sub']])->fetch();
    if (!$ac) { http_response_code(404); return ['error' => 'Aircraft not found']; }
    $id = DB::insert('aircraft_maintenance', [
        'aircraft_id'      => $aircraftId,
        'user_id'          => $user['sub'],
        'maintenance_date' => $body['maintenance_date'] ?? date('Y-m-d'),
        'type'             => $body['type'] ?? 'other',
        'description'      => $body['description'] ?? '',
        'parts_replaced'   => $body['parts_replaced'] ?? null,
        'cost'             => isset($body['cost']) && $body['cost'] !== '' ? (float)$body['cost'] : null,
    ]);
    return ['success' => true, 'id' => $id];
}
function updateMaintenance(array $user, int $id, array $body): array {
    $rec = DB::query("SELECT m.id FROM aircraft_maintenance m
        JOIN aircraft a ON a.id=m.aircraft_id
        WHERE m.id=? AND a.user_id=?", [$id, $user['sub']])->fetch();
    if (!$rec) { http_response_code(404); return ['error' => 'Record not found']; }
    $allowed = ['maintenance_date','type','description','parts_replaced','cost'];
    $updates = array_intersect_key($body, array_flip($allowed));
    if (isset($updates['cost'])) $updates['cost'] = $updates['cost'] !== '' ? (float)$updates['cost'] : null;
    if (empty($updates)) return ['success' => false];
    $set = implode(', ', array_map(fn($k) => "`$k`=?", array_keys($updates)));
    DB::query("UPDATE aircraft_maintenance SET $set WHERE id=?", [...array_values($updates), $id]);
    return ['success' => true];
}
function deleteMaintenance(array $user, int $id): array {
    $rec = DB::query("SELECT m.id FROM aircraft_maintenance m
        JOIN aircraft a ON a.id=m.aircraft_id
        WHERE m.id=? AND a.user_id=?", [$id, $user['sub']])->fetch();
    if (!$rec) { http_response_code(404); return ['error' => 'Record not found']; }
    DB::query("DELETE FROM aircraft_maintenance WHERE id=?", [$id]);
    return ['success' => true];
}

function getProfile(array $user): array {
    $u = DB::query("SELECT id,uuid,email,display_name,role,avatar_url,settings,created_at
        FROM users WHERE id=?", [$user['sub']])->fetch();
    $u['settings'] = json_decode($u['settings'] ?? '{}', true);
    $stats = DB::query("SELECT COUNT(*) total, SUM(duration_sec) total_time,
        SUM(total_distance_m) total_dist FROM flights WHERE user_id=? AND parse_status='complete'",
        [$user['sub']])->fetch();
    return ['user' => $u, 'stats' => $stats];
}
function updateProfile(array $user, array $body): array {
    $allowed = ['display_name','avatar_url','settings'];
    $updates = [];
    foreach ($allowed as $f) {
        if (isset($body[$f])) $updates[$f] = $f === 'settings' ? json_encode($body[$f]) : $body[$f];
    }
    if ($body['new_password'] ?? '') {
        if (!Auth::verifyPassword($body['current_password'] ?? '', DB::query("SELECT password_hash FROM users WHERE id=?",[$user['sub']])->fetchColumn())) {
            http_response_code(403); return ['error' => 'Wrong current password'];
        }
        $updates['password_hash'] = Auth::hashPassword($body['new_password']);
    }
    if ($updates) {
        $set = implode(', ', array_map(fn($k) => "`$k`=?", array_keys($updates)));
        DB::query("UPDATE users SET $set WHERE id=?", [...array_values($updates), $user['sub']]);
    }
    return ['success' => true];
}

function getViewPrefs(array $user): array {
    $rows = DB::query("SELECT view_key,enabled,position,config FROM user_view_prefs WHERE user_id=?",
        [$user['sub']])->fetchAll();
    foreach ($rows as &$r) $r['config'] = json_decode($r['config'] ?? '{}', true);
    return $rows;
}
function updateViewPrefs(array $user, array $body): array {
    // $body = [{view_key, enabled, position, config}, ...]
    foreach ((array)$body as $pref) {
        $key = $pref['view_key'] ?? '';
        if (!$key) continue;
        DB::query("INSERT INTO user_view_prefs (user_id,view_key,enabled,position,config)
            VALUES (?,?,?,?,?)
            ON DUPLICATE KEY UPDATE enabled=VALUES(enabled),position=VALUES(position),config=VALUES(config)",
            [$user['sub'], $key, (int)($pref['enabled']??1), $pref['position']??null,
             json_encode($pref['config']??[])]);
    }
    return ['success' => true];
}

function getDashboardStats(array $user): array {
    $uid = $user['sub'];
    $totals = DB::query("SELECT COUNT(*) flights,
        COALESCE(SUM(COALESCE(flight_duration_sec, duration_sec)),0) total_time,
        COALESCE(SUM(COALESCE(idle_before_sec,0)),0) total_idle_time,
        COALESCE(SUM(total_distance_m),0) total_dist, COALESCE(MAX(max_altitude_m),0) max_alt,
        COALESCE(MAX(max_speed_ms),0) max_speed
        FROM flights WHERE user_id=? AND parse_status='complete'", [$uid])->fetch();
    $byFormat = DB::query("SELECT log_format, COUNT(*) cnt FROM flights WHERE user_id=? GROUP BY log_format", [$uid])->fetchAll();
    $recent = DB::query("SELECT id,original_filename,flight_date,duration_sec,max_altitude_m,parse_status,log_format
        FROM flights WHERE user_id=? ORDER BY created_at DESC LIMIT 10", [$uid])->fetchAll();
    $monthly = DB::query("SELECT DATE_FORMAT(flight_date,'%Y-%m') m, COUNT(*) cnt, SUM(duration_sec) dur
        FROM flights WHERE user_id=? AND flight_date IS NOT NULL GROUP BY m ORDER BY m DESC LIMIT 12", [$uid])->fetchAll();
    return compact('totals','byFormat','recent','monthly');
}

function getSharedFlight(string $token): array {
    if (!$token) { http_response_code(404); return ['error' => 'Token required']; }
    $share = DB::query("SELECT * FROM share_tokens WHERE token=?", [$token])->fetch();
    if (!$share) { http_response_code(404); return ['error' => 'Not found or expired']; }
    if ($share['expires_at'] && strtotime($share['expires_at']) < time()) {
        http_response_code(410); return ['error' => 'Share link expired'];
    }
    DB::query("UPDATE share_tokens SET views=views+1 WHERE token=?", [$token]);
    $flight = DB::query("SELECT * FROM flights WHERE id=?", [$share['flight_id']])->fetch();
    $flight['gps_preview'] = DB::query("SELECT lat,lng,alt_m FROM telemetry_gps WHERE flight_id=? ORDER BY t_ms", [$share['flight_id']])->fetchAll();
    return $flight;
}
function createShareLink(array $user, int $id): array {
    $token = bin2hex(random_bytes(32));
    DB::insert('share_tokens', ['token'=>$token,'flight_id'=>$id,'user_id'=>$user['sub'],
        'expires_at'=>date('Y-m-d H:i:s', strtotime('+30 days'))]);
    return ['token' => $token, 'url' => 'https://yourdomain.com/share/' . $token];
}
