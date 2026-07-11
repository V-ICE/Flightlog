#!/bin/bash
# ============================================================
# Flightlog — Synology Install Script
#
# Run this via SSH on your Synology:
#   ssh admin@192.168.0.2
#   bash /volume1/docker/flightlog/install_synology.sh
#
# What this script does:
#   1. Checks DSM version and Docker availability
#   2. Creates all required directories on /volume1/docker/flightlog/
#   3. Copies server files into place
#   4. Creates .env from your input
#   5. Builds the Docker image
#   6. Starts all containers
#   7. Waits for MariaDB and verifies the API
# ============================================================
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'

ok()   { echo -e "${GREEN}  ✓ ${NC} $1"; }
info() { echo -e "${BLUE}  → ${NC} $1"; }
warn() { echo -e "${YELLOW}  ⚠ ${NC} $1"; }
fail() { echo -e "${RED}  ✗ ${NC} $1"; exit 1; }
ask()  { echo -e "${CYAN}  ? ${NC} $1"; }

BASE_DIR="/volume1/docker/flightlog"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║      Flightlog — Synology Installer       ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
echo ""

# ── 1. Pre-flight checks ──────────────────────────────────
info "Checking environment..."

if [ "$(id -u)" != "0" ]; then
    warn "Not running as root. Docker commands may require sudo."
fi

DSM_VER=$(cat /etc/VERSION 2>/dev/null | grep productversion | cut -d'"' -f2 || echo "unknown")
info "DSM version: $DSM_VER"

if ! command -v docker &>/dev/null; then
    fail "Docker not found. Install Docker / Container Manager from DSM Package Center first."
fi
DOCKER_VER=$(docker --version 2>/dev/null | awk '{print $3}' | tr -d ',')
ok "Docker version: $DOCKER_VER"

# Support both docker-compose (DSM 6) and docker compose (DSM 7 Container Manager)
COMPOSE_BIN=""
if command -v docker-compose &>/dev/null; then
    COMPOSE_BIN="docker-compose"
    COMPOSE_VER=$(docker-compose --version 2>/dev/null | awk '{print $3}' | tr -d ',')
    ok "docker-compose v1: $COMPOSE_VER"
elif docker compose version &>/dev/null 2>&1; then
    COMPOSE_BIN="docker compose"
    COMPOSE_VER=$(docker compose version 2>/dev/null | awk '{print $4}')
    ok "docker compose v2: $COMPOSE_VER"
else
    fail "Neither docker-compose nor 'docker compose' found.\nCheck: ls /var/packages/Docker/target/usr/bin/"
fi

RAM_MB=$(free -m 2>/dev/null | awk '/^Mem:/{print $2}' || echo "unknown")
if [ "$RAM_MB" != "unknown" ] && [ "$RAM_MB" -lt 1500 ]; then
    warn "Less than 1.5GB RAM detected (${RAM_MB}MB). Flightlog needs at least 2GB."
else
    ok "RAM: ${RAM_MB}MB"
fi

[ -d "/volume1" ] || fail "/volume1 not found. Synology volume must be set up first."
ok "Volume /volume1 found"

echo ""

# ── 2. Collect configuration ──────────────────────────────
echo -e "${YELLOW}── Configuration ──────────────────────────────${NC}"
echo ""

if [ -f "$BASE_DIR/.env" ]; then
    warn ".env already exists at $BASE_DIR/.env"
    ask "Use existing .env? [Y/n]"
    read -r use_existing
    if [ "$use_existing" = "n" ] || [ "$use_existing" = "N" ]; then
        rm "$BASE_DIR/.env"
    else
        info "Using existing .env"
        SKIP_ENV=1
    fi
fi

if [ -z "$SKIP_ENV" ]; then
    ask "MariaDB root password (strong, stored only in .env):"
    read -r DB_ROOT_PASS
    [ -n "$DB_ROOT_PASS" ] || fail "Root password cannot be empty"

    ask "MariaDB app password (used by Flightlog):"
    read -r DB_PASS
    [ -n "$DB_PASS" ] || fail "App password cannot be empty"

    JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || cat /dev/urandom | tr -dc 'a-f0-9' | head -c 64)
    ok "JWT secret generated automatically"

    ask "Your NAS IP address [192.168.0.2]:"
    read -r NAS_IP
    NAS_IP="${NAS_IP:-192.168.0.2}"

    ask "Anthropic API key for AI log analysis [leave blank to skip]:"
    read -r ANTHROPIC_KEY

    ask "Port for web app [8080]:"
    read -r APP_PORT
    APP_PORT="${APP_PORT:-8080}"
fi

# ── 3. Create directory structure ─────────────────────────
echo ""
info "Creating directory structure..."

for dir in \
    "$BASE_DIR" \
    "$BASE_DIR/db" \
    "$BASE_DIR/init" \
    "$BASE_DIR/server" \
    "$BASE_DIR/www" \
    "$BASE_DIR/uploads/logs" \
    "$BASE_DIR/uploads/videos"; do
    mkdir -p "$dir"
    chmod 755 "$dir"
done
ok "Directories created under $BASE_DIR"

# ── 4. Copy server files ──────────────────────────────────
info "Copying server PHP files..."
cp -r "$SCRIPT_DIR/../../server/"* "$BASE_DIR/server/"
ok "Server files copied"

# Schema for MariaDB auto-init (docker/mysql-init/schema.sql)
info "Copying database schema..."
if [ -f "$SCRIPT_DIR/../../docker/mysql-init/schema.sql" ]; then
    cp "$SCRIPT_DIR/../../docker/mysql-init/schema.sql" "$BASE_DIR/init/schema.sql"
    ok "Schema ready for auto-import"
elif [ -f "$SCRIPT_DIR/../../server/db/schema.sql" ]; then
    cp "$SCRIPT_DIR/../../server/db/schema.sql" "$BASE_DIR/init/schema.sql"
    ok "Schema ready for auto-import (from server/db/)"
else
    fail "Cannot find schema.sql — expected at docker/mysql-init/schema.sql"
fi

info "Copying Docker config files..."
cp "$SCRIPT_DIR/docker-compose.yml"       "$BASE_DIR/docker-compose.yml"
cp "$SCRIPT_DIR/Dockerfile.synology"      "$BASE_DIR/Dockerfile.synology"
cp "$SCRIPT_DIR/apache-synology.conf"     "$BASE_DIR/apache-synology.conf"
ok "Docker files copied"

# ── 5. Write .env ─────────────────────────────────────────
if [ -z "$SKIP_ENV" ]; then
    info "Writing .env..."
    cat > "$BASE_DIR/.env" <<EOF
MYSQL_ROOT_PASSWORD=${DB_ROOT_PASS}
MYSQL_DATABASE=uavlogbook
MYSQL_USER=uavlogbook_user
MYSQL_PASSWORD=${DB_PASS}
JWT_SECRET=${JWT_SECRET}
ANTHROPIC_API_KEY=${ANTHROPIC_KEY}
ALLOWED_ORIGINS=http://localhost:${APP_PORT},http://${NAS_IP}:${APP_PORT}
APP_PORT=${APP_PORT}
EOF
    chmod 600 "$BASE_DIR/.env"
    ok ".env written (permissions 600)"
fi

# ── 6. Web app notice ─────────────────────────────────────
echo ""
warn "IMPORTANT — The React web app must be built on your workstation and copied here."
echo ""
echo "  If you haven't done this yet:"
echo ""
echo "  On your PC (in the project web/ directory):"
echo "    set VITE_API_URL=http://${NAS_IP:-192.168.0.2}:${APP_PORT:-8080}/api/v1"
echo "    npm install && npm run build"
echo ""
echo "  Then copy to NAS:"
echo "    scp -r web/dist/* admin@${NAS_IP:-192.168.0.2}:${BASE_DIR}/www/"
echo ""

ask "Have you copied the web app files to $BASE_DIR/www/? [y/N]"
read -r web_ready
if [ "$web_ready" != "y" ] && [ "$web_ready" != "Y" ]; then
    echo ""
    warn "Run this script again after copying the web files, or start manually:"
    warn "  cd $BASE_DIR && $COMPOSE_BIN up -d"
    echo ""
    info "Setup complete — containers NOT yet started."
    exit 0
fi

# ── 7. Build and start ────────────────────────────────────
echo ""
info "Building Docker image (may take 5–10 minutes)..."
cd "$BASE_DIR"
$COMPOSE_BIN build --no-cache app
ok "Image built"

info "Starting containers..."
$COMPOSE_BIN up -d
ok "Containers started"

# ── 8. Wait for MariaDB ───────────────────────────────────
echo ""
info "Waiting for MariaDB to initialise (up to 3 minutes)..."
for i in $(seq 1 36); do
    if docker exec uavlogbook_db mysqladmin ping -h localhost \
       -u "uavlogbook_user" "--password=${DB_PASS:-}" --silent 2>/dev/null; then
        ok "MariaDB ready (attempt $i)"
        break
    fi
    if [ "$i" -eq 36 ]; then
        warn "MariaDB did not respond in time. Check: docker logs uavlogbook_db"
    fi
    sleep 5
    printf "."
done
echo ""

# ── 9. Verify API ─────────────────────────────────────────
sleep 3
info "Checking API..."
HTTP=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "http://localhost:${APP_PORT:-8080}/api/v1/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"x","password":"x"}' 2>/dev/null || echo "000")

if [ "$HTTP" = "401" ]; then
    ok "API responding (HTTP 401 = auth working)"
else
    warn "API returned HTTP $HTTP — may still be starting. Check: docker logs uavlogbook_app"
fi

# ── Done ──────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║       Flightlog is up and running!        ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
echo ""
echo "  Web app:  http://${NAS_IP}:${APP_PORT}"
echo "  API:      http://${NAS_IP}:${APP_PORT}/api/v1"
echo ""
echo "  Useful commands (run from $BASE_DIR):"
echo "    $COMPOSE_BIN ps               — container status"
echo "    $COMPOSE_BIN logs -f app      — tail PHP/Apache logs"
echo "    $COMPOSE_BIN logs -f db       — tail MariaDB logs"
echo "    $COMPOSE_BIN restart app      — restart PHP container"
echo "    $COMPOSE_BIN down             — stop everything"
echo ""
echo "  To update server PHP files after a git pull on your PC:"
echo "    scp -r server/* admin@${NAS_IP}:${BASE_DIR}/server/"
echo "    $COMPOSE_BIN restart app"
echo ""
