# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture

UAVLogBook is a full-stack UAV flight log platform with three separate apps sharing one PHP REST API:

```
┌─────────────────────────────────────────────────────────┐
│  PHP REST API (/server)  +  React SPA (/web/dist)       │
│  served together by Apache on port 8080 (dev) / 80/443  │
│  └── MySQL 8.0 (db container)                           │
└────────────────────┬────────────────────────────────────┘
                     │ REST API (HTTPS)
        ┌────────────┴─────────────┐
   React Web App            React Native Mobile
   (/web)                   (/mobile — Expo)
```

**Request flow for a log upload:**
1. Client `POST /api/v1/flights` (multipart) → `server/api/index.php` routes to `uploadFlight()`
2. `FlightProcessor::process()` (`server/api/processor.php`) orchestrates:
   - `AIImportEngine::analyzeFile()` — heuristic first, Claude API if ambiguous (`server/ai/import_engine.php`)
   - Format-specific parser (`server/parsers/`) returns `{gps, attitude, battery, imu, rc, events}`
   - Downsampled to `TELEM_MAX_POINTS` (5000) then bulk-inserted via `DB::batchInsert()`
   - Stats computed with haversine; `AIImportEngine::analyzeFlightAnomalies()` called for post-parse AI summary
3. Flight record updated with `parse_status='complete'` and all computed stats

## Key Files

| File | Role |
|------|------|
| `server/api/index.php` | Route dispatcher — all API endpoints defined here as `"METHOD:resource"` switch cases |
| `server/api/processor.php` | `FlightProcessor` — the upload pipeline orchestrator |
| `server/ai/import_engine.php` | `AIImportEngine` — heuristic + Claude-based format detection and anomaly analysis |
| `server/parsers/ardupilot_bin.php` | ArduPilot DataFlash binary parser |
| `server/parsers/multi_parsers.php` | PX4 ULog, DJI CSV/Litchi, GPX, Betaflight/INAV BBL parsers |
| `server/parsers/skyline_parser.php` | Skyline GCS `.skylog` brace-delimited parser |
| `server/middleware/auth.php` | `Auth` class — hand-rolled HS256 JWT (no library dependency) |
| `server/config/config.php` | All constants; reads `UAVLOG_*` env vars; loads `config.local.php` if present (cPanel) |
| `server/config/db.php` | `DB` class — PDO wrapper with `query()`, `insert()`, `batchInsert()` helpers |
| `web/src/store.js` | Zustand stores: `useAuthStore`, `useModuleStore`, `useFlightStore`, `useUIStore` |
| `web/src/App.jsx` | Entire React SPA — all views and components in one file |
| `web/src/VideoSync.jsx` | FPV video player with telemetry sync overlay |
| `mobile/App.js` | Entire React Native app — all screens in one file |

## Configuration

**Docker:** set `UAVLOG_*` env vars in `.env` (copy from `.env.example`).  
**cPanel:** create `server/config/config.local.php` defining all constants — if that file exists, `config.php` returns immediately.

Key constants: `DB_HOST/NAME/USER/PASS`, `JWT_SECRET`, `UPLOAD_DIR`, `VIDEO_UPLOAD_DIR`, `ANTHROPIC_API_KEY`, `TELEM_MAX_POINTS`, `ALLOWED_ORIGINS`.

## API Routes

All routes are under `/api/v1/`. Auth uses `Authorization: Bearer <JWT>` or `X-Auth-Token`.

| Endpoint | Auth | Notes |
|----------|------|-------|
| `POST /auth/register` | — | |
| `POST /auth/login` | — | |
| `POST /auth/refresh` | ✓ | |
| `GET/POST/PUT/DELETE /flights` | ✓ | `GET /flights/{id}/{sub}` — sub can be `gps`, `attitude`, `battery`, `imu`, `events` |
| `GET/POST/PUT/DELETE /aircraft` | ✓ | |
| `GET/PUT /profile` | ✓ | |
| `GET/PUT /prefs` | ✓ | Module visibility/order saved per user |
| `GET /stats` | ✓ | Dashboard aggregates |
| `GET/POST/PUT/DELETE /videos` | ✓ | FPV video upload + sync offset |
| `GET /share/{token}` | — | Public shared flight |
| `POST /share/{id}` | ✓ | Creates 30-day share token |

## Database

Schema in `server/db/schema.sql` (identical copy at `docker/mysql-init/schema.sql`). Key tables:

- `users` — UUID + bcrypt password + JSON `settings` column
- `flights` — one row per upload; `parse_status`: `pending → processing → complete|error`
- `telemetry_gps`, `telemetry_attitude`, `telemetry_battery`, `telemetry_imu`, `telemetry_rc` — time-series, keyed by `flight_id` + `t_ms`
- `flight_events` — mode changes, warnings, errors
- `aircraft` — user's drone registry
- `user_view_prefs` — per-user module enable/position (upserted via `ON DUPLICATE KEY UPDATE`)
- `share_tokens` — 30-day expiry public links
- `flight_videos` — video file references with `sync_offset_ms`

## Development Commands

### Docker (recommended)

```bash
cp .env.example .env          # fill in JWT_SECRET, MySQL passwords
make dev                      # start dev stack — app on :8080, Vite HMR on :3000
make logs                     # tail all containers
make shell                    # bash into PHP/Apache container
make db-shell                 # MySQL shell
make rebuild-web              # force React rebuild (clears web_dist volume)
make backup                   # dump DB to ./backups/
make restore F=backups/x.sql  # restore DB
```

### Web frontend (standalone)

```bash
cd web
npm install
npm run dev      # Vite dev server on :3000 — set VITE_API_URL in web/.env
npm run build    # production build to web/dist/
```

### Mobile (Expo)

```bash
cd mobile
npm install
npm start              # Expo dev server
npm run android        # run on Android emulator/device
npm run ios            # run on iOS simulator
npm run build:android  # EAS cloud build
npm run build:ios      # EAS cloud build
```

## Adding a New Log Format

1. Add heuristic detection to `AIImportEngine::heuristicDetect()` in `server/ai/import_engine.php`
2. Create a parser class returning `['gps'=>[], 'attitude'=>[], 'battery'=>[], 'imu'=>[], 'rc'=>[], 'events'=>[], 'params'=>[]]`
3. Wire it into `FlightProcessor::parseFile()` match expression in `server/api/processor.php`
4. Update the format key list in the Claude prompt inside `AIImportEngine::aiAnalyze()`

## Web Frontend State

Four Zustand stores in `web/src/store.js`:
- `useAuthStore` — JWT token + user, persisted to localStorage
- `useModuleStore` — which telemetry panels are enabled and their order; synced to `/api/v1/prefs`
- `useFlightStore` — flight list + currently open flight + telemetry channels (loaded lazily per channel)
- `useUIStore` — sidebar, theme, map style, playhead position (`playheadMs`) for cross-panel time sync

Telemetry channels are fetched separately on demand: `GET /flights/{id}/gps`, `/attitude`, etc. The `playheadMs` value in `useUIStore` drives synchronized crosshairs across all chart panels and the map marker.
