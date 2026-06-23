<?php
// ============================================================
// Flightlog — Configuration
// Works for both cPanel hosting and Docker deployments.
// Docker:  set UAVLOG_* environment variables in docker-compose.yml
// cPanel:  create server/config/config.local.php (see INSTALL guide)
// ============================================================

// Load local override first (cPanel installs)
$localCfg = __DIR__ . '/config.local.php';
if (file_exists($localCfg)) {
    require_once $localCfg;
    return;  // local config defines everything
}

// ── Database ──────────────────────────────────────────────
define('DB_HOST',    getenv('UAVLOG_DB_HOST') ?: 'localhost');
define('DB_NAME',    getenv('UAVLOG_DB_NAME') ?: 'uavlogbook');
define('DB_USER',    getenv('UAVLOG_DB_USER') ?: 'uavlogbook_user');
define('DB_PASS',    getenv('UAVLOG_DB_PASS') ?: '');
define('DB_CHARSET', 'utf8mb4');

// ── Auth ──────────────────────────────────────────────────
define('JWT_SECRET',       getenv('UAVLOG_JWT_SECRET') ?: 'CHANGE_ME_BEFORE_PRODUCTION');
define('JWT_EXPIRY_HOURS', 72);

// ── File storage ──────────────────────────────────────────
// Docker: /var/www/uploads/{logs,videos}  (mounted as named volumes)
// cPanel: ~/uavlogbook_data/uploads/{logs,videos}
define('UPLOAD_DIR',        getenv('UAVLOG_UPLOAD_DIR')       ?: '/var/www/uploads/logs/');
define('VIDEO_UPLOAD_DIR',  getenv('UAVLOG_VIDEO_UPLOAD_DIR') ?: '/var/www/uploads/videos/');
define('VIDEO_WEB_PATH',    '/uploads/videos/');
define('PHOTO_UPLOAD_DIR',    getenv('UAVLOG_PHOTO_UPLOAD_DIR')    ?: '/var/www/uploads/photos/');
define('PHOTO_WEB_PATH',      '/uploads/photos/');
define('AIRCRAFT_PHOTO_DIR',  getenv('UAVLOG_AIRCRAFT_PHOTO_DIR') ?: '/var/www/uploads/aircraft/');
define('AIRCRAFT_PHOTO_PATH', '/uploads/aircraft/');
define('MAX_FILE_MB',       500);
define('MAX_PHOTO_MB',      20);

// ── AI / Claude ───────────────────────────────────────────
define('ANTHROPIC_API_KEY', getenv('ANTHROPIC_API_KEY') ?: '');
define('AI_MODEL',          'claude-sonnet-4-20250514');

// ── Telemetry ─────────────────────────────────────────────
define('TELEM_MAX_POINTS', 5000);

// ── CORS ──────────────────────────────────────────────────
// Docker: set UAVLOG_ALLOWED_ORIGINS="https://yourdomain.com,http://localhost"
// Parse comma-separated env var into array
$originsEnv = getenv('UAVLOG_ALLOWED_ORIGINS') ?: '';
define('ALLOWED_ORIGINS', $originsEnv
    ? array_map('trim', explode(',', $originsEnv))
    : ['http://localhost', 'http://localhost:3000', 'http://localhost:8080']
);

// ── App ───────────────────────────────────────────────────
define('APP_VERSION', '1.2.0');
define('API_VERSION', 'v1');
