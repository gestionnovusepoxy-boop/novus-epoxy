#!/bin/bash
# VPS rebuild — pulls latest code from GitHub and restarts Docker
# Run on VPS: bash <(curl -s https://raw.githubusercontent.com/gestionnovusepoxy-boop/novus-epoxy/main/scripts/vps-rebuild.sh)
set -e

VPS_DIR="/docker/novus-epoxy"
REPO="https://github.com/gestionnovusepoxy-boop/novus-epoxy.git"
TMP="/tmp/novus-rebuild-$$"

echo "=== Novus Epoxy VPS Rebuild ==="
echo "Pulling latest code..."
git clone --depth=1 "$REPO" "$TMP"
cp -r "$TMP/dashboard" "$VPS_DIR/"
cp "$TMP/docker-compose.yml" "$VPS_DIR/"
rm -rf "$TMP"

echo "Rebuilding Docker image..."
cd "$VPS_DIR"
docker compose build --no-cache

echo "Restarting container..."
docker compose up -d --force-recreate

echo ""
echo "✅ Done! Testing..."
sleep 5
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://novus-epoxy.srv1478812.hstgr.cloud/api/health" 2>/dev/null || echo "?")
echo "Health check: $STATUS"
docker compose ps
