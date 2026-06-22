#!/bin/bash
# ============================================================
# UAVLogBook — Synology DS412+ Install Script
#
# Run this via SSH on your Synology:
#   ssh admin@192.168.1.x
#   bash /volume1/docker/uavlogbook/install_synology.sh
#
# What this script does:
#   1. Checks DSM version and Docker availability
#   2. Creates all required directories on /volume1/docker/
#   3. Copies server files into place
#   4. Creates .env from your input
#   5. Builds the Docker image
#   6. Starts all containers
#   7. Waits for MariaDB and imports the schema
#   8. Verifies the API is responding
# ============================================================
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'

ok()   { echo -e "${GREEN}  ✓ ${NC} $1"; }
info() { echo -e "${BLUE}  → ${NC} $1"; }
warn() { echo -e "${YELLOW}  ⚠ ${NC} $1"; }
fail() { echo -e "${RED}  ✗ ${NC} $1"; exit 1; }
ask()  { echo -e "${CYAN}  ? ${NC} $1"; }

BASE_DIR="/volume1/docker/uavlogbook"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  UAVLogBook — Synology DS412+ Installer   ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
echo ""

# ── 1. Pre-flight checks ──────────────────────────────────
info "Checking environment..."

# Must be root or admin for Docker
if [ "$(id -u)" != "0" ]; then
    warn "Not running as root. Docker commands may require sudo."
fi

# Check DSM version
DSM_VER=$(cat /etc/VERSION | grep productversion | cut -d'"' -f2 2>/dev/null || echo "unknown")
info "DSM version: $DSM_VER"

# Check Docker
if ! command -v docker &>/dev/null; then
    fail "Docker not found. Install Docker from DSM Package Center first."
fi
DOCKER_VER=$(docker --version 2>/dev/null | awk '{print $3}' | tr -d ',')
ok "Docker version: $DOCKER_VER"

# Check docker-compose (hyphen — v1 on DSM 6.2)
COMPOSE_BIN=""
if command -v docker-compose &>/dev/null; then
    COMPOSE_BIN="docker-compose"
    COMPOSE_VER=$(docker-compose --version 2>/dev/null | awk '{print $3}' | tr -d ',')
    ok "docker-compose version: $COMPOSE_VER"
else
    fail "docker-compose not found. It should be included with the Synology Docker package.\nCheck: ls /var/packages/Docker/target/usr/bin/"
fi

# Check RAM
RAM_MB=$(free -m | awk '/^Mem:/{print $2}')
info "Available RAM: ${RAM_MB} MB"
if [ "$RAM_MB" -lt 2000 ]; then
    warn "Less than 2GB RAM detected (${RAM_MB}MB)."
    warn "UAVLogBook needs at minimum 2GB. Upgrade your DS412+ RAM to 4GB."
    warn "See: https://jussiroine.com/2019/08/upgrading-synology-ds412-ram-to-4-gb/"
    echo ""
    ask "Continue anyway? (not recommended) [y/N]"
    read -r confirm
    [ "$confirm" = "y" ] || [ "$confirm" = "Y" ] || exit 1
else
    ok "RAM: ${RAM_MB}MB — sufficient"
fi

# Check /volume1 exists
[ -d "/volume1" ] || fail "/volume1 not found. Synology volume must be set up first."
ok "Volume /volume1 found"

echo ""

# ── 2. Collect configuration ──────────────────────────────
echo -e "${YELLOW}── Configuration ──────────────────────────────${NC}"
echo ""

# Check if .env already exists
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
    ask "MariaDB root password (strong, not used by app directly):"
    read -r DB_ROOT_PASS
    [ -n "$DB_ROOT_PASS" ] || fail "Root password cannot be empty"

    ask "MariaDB app password (used by UAVLogBook):"
    read -r DB_PASS
    [ -n "$DB_PASS" ] || fail "App password cannot be empty"

    # Generate JWT secret automatically
    JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || cat /dev/urandom | tr -dc 'a-f0-9' | head -c 64)
    ok "JWT secret generated automatically"

    ask "Your NAS IP address (e.g. 192.168.1.50):"
    read -r NAS_IP
    [ -n "$NAS_IP" ] || NAS_IP="192.168.1.50"

    ask "Anthropic API key for AI import [leave blank to skip]:"
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

# Copy schema for MariaDB auto-init
info "Copying database schema..."
cp "$SCRIPT_DIR/../../server/db/schema.sql" "$BASE_DIR/init/schema.sql"
ok "Schema ready for auto-import"

# Copy Synology docker files
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
    ok ".env written (permissions set to 600)"
fi

# ── 6. Build web app notice ───────────────────────────────
echo ""
warn "IMPORTANT — Web app must be built on your workstation first!"
echo ""
echo "  The DS412+ cannot run Node.js to build the React app."
echo "  Build it on your computer and copy the files to the NAS:"
echo ""
echo "  On your computer:"
echo "    cd web"
echo "    cp .env.example .env.local"
echo "    # Edit .env.local: VITE_API_URL=http://${NAS_IP}:${APP_PORT}/api/v1"
echo "    npm install && npm run build"
echo ""
echo "  Then copy to NAS (replace 192.168.1.50 with your NAS IP):"
echo "    scp -r web/dist/* admin@${NAS_IP}:${BASE_DIR}/www/"
echo ""
echo "  OR use File Manager in DSM to upload web/dist/ contents to:"
echo "    $BASE_DIR/www/"
echo ""

ask "Have you copied the web app files to $BASE_DIR/www/? [y/N]"
read -r web_ready
if [ "$web_ready" != "y" ] && [ "$web_ready" != "Y" ]; then
    echo ""
    warn "Run this script again after copying the web files."
    warn "Or start containers manually:"
    warn "  cd $BASE_DIR && docker-compose up -d"
    echo ""
    info "Setup complete — containers NOT yet started."
    exit 0
fi

# ── 7. Build and start ────────────────────────────────────
echo ""
info "Building Docker image (this takes 5–15 minutes on DS412+)..."
cd "$BASE_DIR"
docker-compose build --no-cache app
ok "Image built"

info "Starting containers..."
docker-compose up -d
ok "Containers started"

# ── 8. Wait for MariaDB ───────────────────────────────────
echo ""
info "Waiting for MariaDB to initialise (up to 3 minutes)..."
RETRIES=36
for i in $(seq 1 $RETRIES); do
    if docker exec uavlogbook_db mysqladmin ping -h localhost \
       -u "${MYSQL_USER:-uavlogbook_user}" \
       "--password=${DB_PASS:-}" --silent 2>/dev/null; then
        ok "MariaDB is ready (attempt $i)"
        break
    fi
    if [ "$i" -eq "$RETRIES" ]; then
        warn "MariaDB did not respond in time. Check: docker logs uavlogbook_db"
    fi
    sleep 5
    printf "."
done
echo ""

# ── 9. Verify API ─────────────────────────────────────────
info "Checking API..."
sleep 3
HTTP=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "http://localhost:${APP_PORT}/api/v1/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"x","password":"x"}' 2>/dev/null || echo "000")

if [ "$HTTP" = "401" ]; then
    ok "API responding correctly (HTTP 401 = auth working)"
else
    warn "API returned HTTP $HTTP — may still be starting up"
    warn "Check: docker logs uavlogbook_app"
fi

# ── Done ──────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║         Installation Complete!             ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
echo ""
echo "  Web app:  http://${NAS_IP}:${APP_PORT}"
echo "  API:      http://${NAS_IP}:${APP_PORT}/api/v1"
echo ""
echo "  Useful commands (run from $BASE_DIR):"
echo "    docker-compose ps              — show container status"
echo "    docker-compose logs -f app     — tail PHP/Apache logs"
echo "    docker-compose logs -f db      — tail MariaDB logs"
echo "    docker-compose restart app     — restart PHP container"
echo "    docker-compose down            — stop all containers"
echo ""
echo "  To update server PHP files:"
echo "    cp -r /path/to/server/* $BASE_DIR/server/"
echo "    docker-compose restart app"
echo ""
