#!/bin/bash
# UAVLogBook — Web App Build Script (macOS / Linux)
set -e
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

echo -e "${BLUE}UAVLogBook — Building Web App${NC}"
cd "$(dirname "$0")/../web"

# Check Node
node --version >/dev/null 2>&1 || { echo "Node.js not found. Install from https://nodejs.org"; exit 1; }
echo -e "${GREEN}Node.js: $(node --version)${NC}"

# Copy env
if [ ! -f ".env.local" ]; then
    cp .env.example .env.local
    echo -e "${YELLOW}IMPORTANT: Edit web/.env.local and set VITE_API_URL to your domain${NC}"
    read -p "Press Enter after editing .env.local..."
fi

npm install
npm run build

if [ -d "dist" ]; then
    echo -e "${GREEN}Build successful!${NC}"
    echo -e "${YELLOW}Upload web/dist/* to your cPanel public_html folder${NC}"
else
    echo "Build failed. Check errors above."
    exit 1
fi
