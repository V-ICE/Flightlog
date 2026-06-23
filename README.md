# Flightlog

Self-hosted UAV flight log platform. Upload flight logs from ArduPilot, PX4, DJI, Betaflight/INAV, and more — get interactive telemetry charts, GPS maps, AI-powered analysis, and FPV video sync.

## Stack

- **Backend:** PHP 8.2 REST API + Apache (Docker)
- **Database:** MySQL 8.0 (Docker)
- **Web:** React SPA (Vite) — served from the same container as the API
- **Mobile:** React Native (Expo)

## Quick Start (Docker)

```bash
git clone https://github.com/v-ice/Flightlog.git
cd Flightlog
cp .env.example .env
# Edit .env: set JWT_SECRET, DB passwords, ANTHROPIC_API_KEY (optional — for AI analysis)
make dev
```

App runs at **http://localhost:8080**. Vite HMR at **http://localhost:3000** during development.

## .env Variables

| Variable | Description |
|----------|-------------|
| `MYSQL_ROOT_PASSWORD` | MySQL root password |
| `MYSQL_PASSWORD` | App DB password |
| `JWT_SECRET` | Random secret for signing tokens (min 32 chars) |
| `ANTHROPIC_API_KEY` | Optional — enables AI log format detection and anomaly analysis |
| `ALLOWED_ORIGINS` | CORS origins, comma-separated (e.g. `http://localhost:3000`) |

## Make Commands

```bash
make dev           # start full stack (db + app + vite)
make logs          # tail all container logs
make shell         # bash into the PHP/Apache container
make db-shell      # MySQL prompt
make rebuild-web   # force React rebuild (wipes web_dist volume, then rebuilds)
make backup        # dump DB → ./backups/
make restore F=backups/YYYY-MM-DD.sql
make stop
make clean         # stop + remove volumes (DESTRUCTIVE)
```

## Supported Log Formats

| Format | Notes |
|--------|-------|
| ArduPilot DataFlash `.bin` | Full telemetry: GPS, attitude, battery, IMU, RC, events |
| PX4 ULog `.ulg` | Full telemetry |
| DJI CSV / Litchi CSV | GPS + attitude |
| GPX `.gpx` | GPS track only |
| Betaflight / INAV Blackbox `.bbl` | Full telemetry |
| Skyline GCS `.skylog` | Full telemetry |

Format is auto-detected heuristically; falls back to Claude API if ambiguous.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  PHP REST API (/api/v1)  +  React SPA (/)                   │
│  Apache on :80 inside Docker → exposed on :8080 (dev)       │
│  └── MySQL 8.0 (db container, internal only)                │
└────────────────────┬────────────────────────────────────────┘
                     │ REST API (HTTPS in prod)
        ┌────────────┴─────────────┐
   React Web App            React Native (Expo)
   /web                     /mobile
```

All API routes live in `server/api/index.php`. The React SPA is built into a Docker named volume (`uavlogbook_web_dist`) and served by Apache from the same container as the PHP API.

## Production Deployment

Build the frontend into the named volume:

```bash
docker run --rm \
  -v uavlogbook_web_dist:/dist \
  -v /path/to/flightlog/web:/web \
  node:20-alpine \
  sh -c 'cd /web && npm ci --silent && npm run build -- --outDir /dist --emptyOutDir'

# After --emptyOutDir, remount API bind-mount:
docker compose restart app
```

> **Important:** always run `docker compose restart app` after a build that uses `--emptyOutDir`. The flag wipes the volume which breaks Apache's bind-mount to the API directory until the container restarts.

For HTTPS, put Nginx or Caddy in front of the app container on port 80.

## Mobile App (Expo)

```bash
cd mobile
npm install
npm start              # Expo dev server
npm run android        # Android emulator/device
npm run ios            # iOS simulator
npm run build:android  # EAS cloud build
npm run build:ios      # EAS cloud build
```

Set `API_BASE_URL` in `mobile/.env` to point at your server.

## Database

Schema: `server/db/schema.sql` (mirrored to `docker/mysql-init/schema.sql` for auto-init on first run).

To apply schema changes to an existing install:

```bash
make db-shell
source /docker-entrypoint-initdb.d/schema.sql
```

## Themes

7 built-in themes selectable per-user: Dark, Midnight, Terminal, Slate, Phantom, Cyber, Arctic. Each theme also sets a layout (default cards, HUD gauges, terminal text, magazine).

## License

Private — all rights reserved.
