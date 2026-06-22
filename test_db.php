<?php
error_reporting(E_ALL);
ini_set('display_errors', 1);
require '/var/www/html/api/config/config.php';
require '/var/www/html/api/config/db.php';
echo "DB_HOST=" . DB_HOST . "\n";
$n = DB::query('SELECT COUNT(*) FROM telemetry_gps WHERE flight_id=1')->fetchColumn();
echo "GPS rows: $n\n";
