# ============================================================
# UAVLogBook — Makefile
# Convenience wrappers around docker compose commands.
# Usage: make <target>
# ============================================================

.PHONY: help up down dev build logs shell db-shell backup restore \
        rebuild-web ssl clean ps

# Default target
help:
	@echo ""
	@echo "  UAVLogBook Docker Commands"
	@echo "  =========================="
	@echo ""
	@echo "  DEVELOPMENT:"
	@echo "    make dev          Start dev stack (app on :8080, Vite on :3000)"
	@echo "    make down         Stop all containers"
	@echo "    make logs         Tail all logs"
	@echo "    make shell        Open bash shell in app container"
	@echo "    make db-shell     Open MySQL shell"
	@echo ""
	@echo "  PRODUCTION:"
	@echo "    make up           Start production stack (no Nginx SSL)"
	@echo "    make prod         Start full production stack with Nginx"
	@echo "    make ssl D=domain.com E=admin@domain.com"
	@echo "                      Get/renew Let's Encrypt SSL certificate"
	@echo ""
	@echo "  MAINTENANCE:"
	@echo "    make rebuild-web  Force rebuild React app (clears dist volume)"
	@echo "    make backup       Backup database to ./backups/"
	@echo "    make restore F=backup.sql  Restore database from file"
	@echo "    make clean        Remove containers and volumes (DATA LOSS!)"
	@echo "    make ps           Show running containers"
	@echo ""

# ── Development stack ─────────────────────────────────────
dev:
	@[ -f .env ] || (cp .env.example .env && echo "Created .env — please review before continuing" && exit 1)
	docker compose \
		-f docker-compose.yml \
		-f docker-compose.dev.yml \
		up --build

dev-d:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build

# ── Production stack (no Nginx) ───────────────────────────
up:
	@[ -f .env ] || (cp .env.example .env && echo "Created .env — please edit it first" && exit 1)
	docker compose up -d
	@echo ""
	@echo "  UAVLogBook running at http://localhost:$$(grep APP_PORT .env | cut -d= -f2)"
	@echo "  Use 'make logs' to follow output"

# ── Full production with Nginx ────────────────────────────
prod:
	docker compose --profile production up -d
	@echo "Nginx + App running on ports 80/443"

# ── Stop everything ───────────────────────────────────────
down:
	docker compose --profile production down

# ── Logs ──────────────────────────────────────────────────
logs:
	docker compose logs -f

logs-app:
	docker compose logs -f app

logs-db:
	docker compose logs -f db

# ── Shell access ──────────────────────────────────────────
shell:
	docker compose exec app bash

db-shell:
	docker compose exec db mysql \
		-u$$(grep MYSQL_USER .env | cut -d= -f2) \
		-p$$(grep MYSQL_PASSWORD .env | cut -d= -f2) \
		$$(grep MYSQL_DATABASE .env | cut -d= -f2)

# ── Force rebuild web app ─────────────────────────────────
rebuild-web:
	@echo "Clearing web_dist volume and rebuilding..."
	docker compose stop builder
	docker volume rm uavlogbook_web_dist 2>/dev/null || true
	docker compose up builder
	docker compose up -d --force-recreate app
	@echo "Web app rebuilt."

# ── Quick rebuild (keeps existing dist volume) ─────────────
rebuild-web-quick:
	@echo "Rebuilding React (quick — keeping dist volume)..."
	docker compose run --rm builder sh -c 'cd /build && rm -rf dist && node node_modules/vite/bin/vite.js build'
	docker compose up -d --force-recreate app
	@echo "Done."

# ── Rebuild PHP container ─────────────────────────────────
rebuild-app:
	docker compose build --no-cache app
	docker compose up -d app

# ── Database backup ───────────────────────────────────────
backup:
	@mkdir -p backups
	@BACKUP_FILE="backups/uavlogbook_$$(date +%Y%m%d_%H%M%S).sql"; \
	docker compose exec -T db mysqldump \
		-u$$(grep MYSQL_USER .env | cut -d= -f2) \
		-p$$(grep MYSQL_PASSWORD .env | cut -d= -f2) \
		$$(grep MYSQL_DATABASE .env | cut -d= -f2) \
		> "$$BACKUP_FILE" && \
	echo "Backup saved: $$BACKUP_FILE"

# ── Database restore ──────────────────────────────────────
restore:
	@[ -n "$(F)" ] || (echo "Usage: make restore F=backups/file.sql" && exit 1)
	@echo "Restoring from $(F)..."
	docker compose exec -T db mysql \
		-u$$(grep MYSQL_USER .env | cut -d= -f2) \
		-p$$(grep MYSQL_PASSWORD .env | cut -d= -f2) \
		$$(grep MYSQL_DATABASE .env | cut -d= -f2) \
		< $(F)
	@echo "Restore complete."

# ── SSL certificate ───────────────────────────────────────
ssl:
	@[ -n "$(D)" ] || (echo "Usage: make ssl D=yourdomain.com E=admin@yourdomain.com" && exit 1)
	bash docker/nginx/certbot.sh $(D) $(E)

# ── Status ────────────────────────────────────────────────
ps:
	docker compose ps

# ── Clean everything (DESTRUCTIVE) ───────────────────────
clean:
	@echo "WARNING: This will delete ALL containers and volumes including database data."
	@echo "Press Ctrl+C to cancel, or Enter to continue..."
	@read confirm
	docker compose --profile production down -v --remove-orphans
	@echo "Cleaned."
