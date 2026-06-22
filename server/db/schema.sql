-- ============================================================
-- UAVLogBook Database Schema
-- Compatible: MySQL 5.7+ / MariaDB 10.3+
-- ============================================================

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
SET FOREIGN_KEY_CHECKS=0;
SET time_zone = "+00:00";

-- --------------------------------------------------------
-- Database: uavlogbook (set your own name during install)
-- --------------------------------------------------------

-- Users
CREATE TABLE IF NOT EXISTS `users` (
  `id`            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `uuid`          VARCHAR(36) NOT NULL UNIQUE,
  `email`         VARCHAR(255) NOT NULL UNIQUE,
  `password_hash` VARCHAR(255) NOT NULL,
  `display_name`  VARCHAR(100) NOT NULL DEFAULT '',
  `role`          ENUM('admin','pilot','viewer') NOT NULL DEFAULT 'pilot',
  `avatar_url`    VARCHAR(500) DEFAULT NULL,
  `settings`      JSON DEFAULT NULL,         -- dashboard module on/off prefs
  `api_token`     VARCHAR(64) DEFAULT NULL,
  `token_expires` DATETIME DEFAULT NULL,
  `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_email` (`email`),
  INDEX `idx_uuid` (`uuid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- UAV Aircraft registry
CREATE TABLE IF NOT EXISTS `aircraft` (
  `id`            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `user_id`       INT UNSIGNED NOT NULL,
  `name`          VARCHAR(100) NOT NULL,
  `type`          ENUM('multirotor','fixed_wing','vtol','helicopter','other') DEFAULT 'multirotor',
  `make`          VARCHAR(100) DEFAULT NULL,
  `model`         VARCHAR(100) DEFAULT NULL,
  `serial_number` VARCHAR(100) DEFAULT NULL,
  `firmware`      VARCHAR(50) DEFAULT NULL,    -- ArduPilot, PX4, DJI, Betaflight, INAV
  `firmware_ver`  VARCHAR(50) DEFAULT NULL,
  `notes`         TEXT DEFAULT NULL,
  `image_url`     VARCHAR(500) DEFAULT NULL,
  `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  INDEX `idx_user_aircraft` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Flight log files (master record)
CREATE TABLE IF NOT EXISTS `flights` (
  `id`               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `uuid`             VARCHAR(36) NOT NULL UNIQUE,
  `user_id`          INT UNSIGNED NOT NULL,
  `aircraft_id`      INT UNSIGNED DEFAULT NULL,
  `original_filename` VARCHAR(255) NOT NULL,
  `file_size`        INT UNSIGNED DEFAULT NULL,
  `file_hash`        VARCHAR(64) DEFAULT NULL,   -- SHA-256 for dedup
  `log_format`       VARCHAR(30) DEFAULT NULL,   -- ardupilot_bin, mavlink_tlog, px4_ulog, dji_txt, dji_csv, generic_csv, gpx, kml, betaflight, inav
  `format_confidence` TINYINT UNSIGNED DEFAULT NULL, -- 0-100 AI confidence score
  `parse_status`     ENUM('pending','processing','complete','error') NOT NULL DEFAULT 'pending',
  `parse_error`      TEXT DEFAULT NULL,
  `ai_analysis`      JSON DEFAULT NULL,          -- AI-detected format info, anomalies
  -- Flight metadata (extracted from log)
  `flight_date`      DATETIME DEFAULT NULL,
  `duration_sec`     MEDIUMINT UNSIGNED DEFAULT NULL,
  `max_altitude_m`   DECIMAL(8,2) DEFAULT NULL,
  `max_speed_ms`     DECIMAL(6,2) DEFAULT NULL,
  `max_distance_m`   DECIMAL(8,2) DEFAULT NULL,
  `home_lat`         DECIMAL(10,7) DEFAULT NULL,
  `home_lng`         DECIMAL(10,7) DEFAULT NULL,
  `bounding_box`     JSON DEFAULT NULL,          -- {min_lat, max_lat, min_lng, max_lng}
  `waypoints_count`  SMALLINT UNSIGNED DEFAULT NULL,
  `takeoffs`         TINYINT UNSIGNED DEFAULT NULL,
  `landings`         TINYINT UNSIGNED DEFAULT NULL,
  `firmware_version` VARCHAR(100) DEFAULT NULL,
  `vehicle_type`     VARCHAR(50) DEFAULT NULL,
  `total_distance_m` DECIMAL(10,2) DEFAULT NULL,
  `min_battery_v`    DECIMAL(5,3) DEFAULT NULL,
  `max_battery_v`    DECIMAL(5,3) DEFAULT NULL,
  `warning_count`    SMALLINT UNSIGNED DEFAULT 0,
  `error_count`      SMALLINT UNSIGNED DEFAULT 0,
  `pilot_notes`      TEXT DEFAULT NULL,
  `tags`             JSON DEFAULT NULL,           -- ["survey","mapping","test"]
  `location_name`    VARCHAR(255) DEFAULT NULL,
  `weather`          JSON DEFAULT NULL,           -- optional weather data
  `storage_path`     VARCHAR(500) DEFAULT NULL,   -- server path to raw file
  `created_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`aircraft_id`) REFERENCES `aircraft`(`id`) ON DELETE SET NULL,
  INDEX `idx_user_flights` (`user_id`),
  INDEX `idx_flight_date` (`flight_date`),
  INDEX `idx_parse_status` (`parse_status`),
  INDEX `idx_format` (`log_format`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- GPS / position telemetry (downsampled for storage efficiency)
CREATE TABLE IF NOT EXISTS `telemetry_gps` (
  `id`          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `flight_id`   INT UNSIGNED NOT NULL,
  `t_ms`        INT UNSIGNED NOT NULL,   -- milliseconds from log start
  `lat`         DECIMAL(10,7) NOT NULL,
  `lng`         DECIMAL(10,7) NOT NULL,
  `alt_m`       DECIMAL(8,2) DEFAULT NULL,   -- relative/home altitude
  `alt_amsl_m`  DECIMAL(8,2) DEFAULT NULL,   -- above mean sea level
  `speed_ms`    DECIMAL(6,2) DEFAULT NULL,
  `ground_course` DECIMAL(5,2) DEFAULT NULL,
  `hdop`        DECIMAL(5,2) DEFAULT NULL,
  `sats`        TINYINT UNSIGNED DEFAULT NULL,
  `fix_type`    TINYINT UNSIGNED DEFAULT NULL,  -- 0=none,2=2D,3=3D,5=RTK
  FOREIGN KEY (`flight_id`) REFERENCES `flights`(`id`) ON DELETE CASCADE,
  INDEX `idx_gps_flight` (`flight_id`),
  INDEX `idx_gps_time` (`flight_id`, `t_ms`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Attitude telemetry (roll, pitch, yaw)
CREATE TABLE IF NOT EXISTS `telemetry_attitude` (
  `id`        BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `flight_id` INT UNSIGNED NOT NULL,
  `t_ms`      INT UNSIGNED NOT NULL,
  `roll_deg`  DECIMAL(7,3) DEFAULT NULL,
  `pitch_deg` DECIMAL(7,3) DEFAULT NULL,
  `yaw_deg`   DECIMAL(7,3) DEFAULT NULL,
  `roll_rate` DECIMAL(7,3) DEFAULT NULL,
  `pitch_rate` DECIMAL(7,3) DEFAULT NULL,
  `yaw_rate`  DECIMAL(7,3) DEFAULT NULL,
  FOREIGN KEY (`flight_id`) REFERENCES `flights`(`id`) ON DELETE CASCADE,
  INDEX `idx_att_flight` (`flight_id`, `t_ms`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Battery telemetry
CREATE TABLE IF NOT EXISTS `telemetry_battery` (
  `id`          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `flight_id`   INT UNSIGNED NOT NULL,
  `t_ms`        INT UNSIGNED NOT NULL,
  `voltage_v`   DECIMAL(6,3) DEFAULT NULL,
  `current_a`   DECIMAL(7,3) DEFAULT NULL,
  `remaining_pct` TINYINT UNSIGNED DEFAULT NULL,
  `consumed_mah` DECIMAL(8,2) DEFAULT NULL,
  `temp_c`      DECIMAL(5,2) DEFAULT NULL,
  FOREIGN KEY (`flight_id`) REFERENCES `flights`(`id`) ON DELETE CASCADE,
  INDEX `idx_batt_flight` (`flight_id`, `t_ms`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- IMU / vibration telemetry
CREATE TABLE IF NOT EXISTS `telemetry_imu` (
  `id`        BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `flight_id` INT UNSIGNED NOT NULL,
  `t_ms`      INT UNSIGNED NOT NULL,
  `accel_x`   DECIMAL(8,4) DEFAULT NULL,
  `accel_y`   DECIMAL(8,4) DEFAULT NULL,
  `accel_z`   DECIMAL(8,4) DEFAULT NULL,
  `gyro_x`    DECIMAL(8,4) DEFAULT NULL,
  `gyro_y`    DECIMAL(8,4) DEFAULT NULL,
  `gyro_z`    DECIMAL(8,4) DEFAULT NULL,
  `vibe_x`    DECIMAL(8,4) DEFAULT NULL,
  `vibe_y`    DECIMAL(8,4) DEFAULT NULL,
  `vibe_z`    DECIMAL(8,4) DEFAULT NULL,
  FOREIGN KEY (`flight_id`) REFERENCES `flights`(`id`) ON DELETE CASCADE,
  INDEX `idx_imu_flight` (`flight_id`, `t_ms`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Event timeline (mode changes, errors, warnings, RC failsafe, etc.)
CREATE TABLE IF NOT EXISTS `flight_events` (
  `id`          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `flight_id`   INT UNSIGNED NOT NULL,
  `t_ms`        INT UNSIGNED NOT NULL,
  `event_type`  VARCHAR(50) NOT NULL,   -- mode_change, arm, disarm, failsafe, error, warning, gps_fix, waypoint
  `severity`    ENUM('info','warning','error','critical') NOT NULL DEFAULT 'info',
  `value`       VARCHAR(255) DEFAULT NULL,
  `description` TEXT DEFAULT NULL,
  FOREIGN KEY (`flight_id`) REFERENCES `flights`(`id`) ON DELETE CASCADE,
  INDEX `idx_events_flight` (`flight_id`),
  INDEX `idx_events_type` (`flight_id`, `event_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- RC channel data
CREATE TABLE IF NOT EXISTS `telemetry_rc` (
  `id`        BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `flight_id` INT UNSIGNED NOT NULL,
  `t_ms`      INT UNSIGNED NOT NULL,
  `ch1`  SMALLINT DEFAULT NULL, `ch2`  SMALLINT DEFAULT NULL,
  `ch3`  SMALLINT DEFAULT NULL, `ch4`  SMALLINT DEFAULT NULL,
  `ch5`  SMALLINT DEFAULT NULL, `ch6`  SMALLINT DEFAULT NULL,
  `ch7`  SMALLINT DEFAULT NULL, `ch8`  SMALLINT DEFAULT NULL,
  `ch9`  SMALLINT DEFAULT NULL, `ch10` SMALLINT DEFAULT NULL,
  `ch11` SMALLINT DEFAULT NULL, `ch12` SMALLINT DEFAULT NULL,
  `rssi` TINYINT UNSIGNED DEFAULT NULL,
  FOREIGN KEY (`flight_id`) REFERENCES `flights`(`id`) ON DELETE CASCADE,
  INDEX `idx_rc_flight` (`flight_id`, `t_ms`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Custom annotations by pilot
CREATE TABLE IF NOT EXISTS `annotations` (
  `id`          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `flight_id`   INT UNSIGNED NOT NULL,
  `user_id`     INT UNSIGNED NOT NULL,
  `t_ms`        INT UNSIGNED DEFAULT NULL,
  `lat`         DECIMAL(10,7) DEFAULT NULL,
  `lng`         DECIMAL(10,7) DEFAULT NULL,
  `type`        VARCHAR(30) NOT NULL DEFAULT 'note',
  `content`     TEXT NOT NULL,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`flight_id`) REFERENCES `flights`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- User module/view preferences per dashboard
CREATE TABLE IF NOT EXISTS `user_view_prefs` (
  `user_id`     INT UNSIGNED NOT NULL,
  `view_key`    VARCHAR(50) NOT NULL,
  `enabled`     TINYINT(1) NOT NULL DEFAULT 1,
  `position`    TINYINT UNSIGNED DEFAULT NULL,
  `config`      JSON DEFAULT NULL,
  PRIMARY KEY (`user_id`, `view_key`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Flight sharing tokens
CREATE TABLE IF NOT EXISTS `share_tokens` (
  `token`      VARCHAR(64) NOT NULL PRIMARY KEY,
  `flight_id`  INT UNSIGNED NOT NULL,
  `user_id`    INT UNSIGNED NOT NULL,
  `expires_at` DATETIME DEFAULT NULL,
  `views`      INT UNSIGNED DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`flight_id`) REFERENCES `flights`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS=1;

-- ============================================================
-- VIDEO SYNC EXTENSION (added v1.2)
-- ============================================================

-- Video files attached to flights
CREATE TABLE IF NOT EXISTS `flight_videos` (
  `id`               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `flight_id`        INT UNSIGNED NOT NULL,
  `user_id`          INT UNSIGNED NOT NULL,
  `original_filename` VARCHAR(255) NOT NULL,
  `storage_path`     VARCHAR(500) NOT NULL,
  `file_size`        BIGINT UNSIGNED DEFAULT NULL,
  `mime_type`        VARCHAR(50) DEFAULT NULL,        -- video/mp4, video/quicktime, etc.
  `duration_sec`     DECIMAL(10,3) DEFAULT NULL,      -- video duration in seconds
  `width_px`         SMALLINT UNSIGNED DEFAULT NULL,
  `height_px`        SMALLINT UNSIGNED DEFAULT NULL,
  `fps`              DECIMAL(6,3) DEFAULT NULL,
  `codec`            VARCHAR(50) DEFAULT NULL,
  -- Timestamp extracted from video file metadata (MP4 creation_time or EXIF)
  `video_start_unix` BIGINT DEFAULT NULL,             -- Unix ms when video recording began
  -- Log start time for this flight (Unix ms)
  `log_start_unix`   BIGINT DEFAULT NULL,
  -- Sync state
  `sync_status`      ENUM('pending','auto','manual','failed') DEFAULT 'pending',
  `sync_method`      VARCHAR(30) DEFAULT NULL,        -- 'mp4_atom','exif','filename_ts','manual'
  -- THE KEY FIELD: offset in milliseconds
  -- video_time_ms = log_time_ms - sync_offset_ms
  -- Positive: video started AFTER log (video is behind; seek forward to match log)
  -- Negative: video started BEFORE log (video is ahead; seek back to match log)
  `sync_offset_ms`   INT DEFAULT NULL,
  -- Manual fine-tune applied on top of auto-detected offset (user correction in ms)
  `manual_correction_ms` INT NOT NULL DEFAULT 0,
  -- Final computed offset = sync_offset_ms + manual_correction_ms
  `effective_offset_ms`  INT GENERATED ALWAYS AS (
    COALESCE(`sync_offset_ms`, 0) + `manual_correction_ms`
  ) STORED,
  -- Confidence of auto-sync (0-100)
  `sync_confidence`  TINYINT UNSIGNED DEFAULT NULL,
  `sync_notes`       TEXT DEFAULT NULL,
  `web_path`         VARCHAR(500) DEFAULT NULL,       -- public URL path for streaming
  `thumbnail_path`   VARCHAR(500) DEFAULT NULL,       -- path to thumbnail image
  `created_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`flight_id`) REFERENCES `flights`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`user_id`)   REFERENCES `users`(`id`)   ON DELETE CASCADE,
  INDEX `idx_video_flight` (`flight_id`),
  INDEX `idx_video_user`   (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
