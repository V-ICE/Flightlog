-- ============================================================
-- UAVLogBook — MySQL Docker Init Script
-- This file is run automatically by the MySQL container
-- on first startup (when db_data volume is empty).
--
-- MySQL entrypoint runs all *.sql files in
-- /docker-entrypoint-initdb.d/ in alphabetical order.
-- The database named in MYSQL_DATABASE is already created
-- by the entrypoint before this runs.
-- ============================================================

-- Use the database created by MYSQL_DATABASE env var
-- (the entrypoint already did CREATE DATABASE and USE)

SOURCE /docker-entrypoint-initdb.d/schema.sql;
