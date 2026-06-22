#!/bin/bash
# ============================================================
# UAVLogBook — Let's Encrypt SSL Certificate Setup
# Run this ONCE after starting the stack to get a free cert.
# Requires: your domain pointing to this server's IP.
# ============================================================
set -e

DOMAIN="${1:-yourdomain.com}"
EMAIL="${2:-admin@yourdomain.com}"

if [ "$DOMAIN" = "yourdomain.com" ]; then
    echo "Usage: bash certbot.sh yourdomain.com admin@yourdomain.com"
    exit 1
fi

echo "Requesting certificate for: $DOMAIN"
echo "Contact email: $EMAIL"
echo ""

# Run certbot in a temporary container using webroot challenge
# The nginx container must be running and serving /.well-known/ from /var/www/certbot
docker run --rm \
    -v uavlogbook_letsencrypt:/var/www/certbot \
    -v uavlogbook_ssl_certs:/etc/letsencrypt \
    certbot/certbot certonly \
    --webroot \
    --webroot-path=/var/www/certbot \
    --email "$EMAIL" \
    --agree-tos \
    --no-eff-email \
    -d "$DOMAIN"

# Copy certs to the ssl_certs volume nginx expects
docker run --rm \
    -v uavlogbook_ssl_certs:/etc/letsencrypt \
    -v uavlogbook_ssl_certs:/ssl \
    alpine sh -c "
        cp /etc/letsencrypt/live/$DOMAIN/fullchain.pem /ssl/fullchain.pem &&
        cp /etc/letsencrypt/live/$DOMAIN/privkey.pem   /ssl/privkey.pem &&
        echo 'Certs copied to nginx volume'
    "

# Reload nginx to pick up new cert
docker compose exec nginx nginx -s reload

echo ""
echo "SSL configured for $DOMAIN"
echo "Renewal: run 'bash certbot.sh $DOMAIN $EMAIL' again, or set up cron:"
echo "  0 3 * * * cd $(pwd) && bash docker/nginx/certbot.sh $DOMAIN $EMAIL >> /var/log/certbot.log 2>&1"
