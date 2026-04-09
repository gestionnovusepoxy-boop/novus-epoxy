#!/bin/bash
cd /Users/novusepoxy/novus-epoxy/scraper
echo "🔍 Démarrage Novus Scraper sur port 8899..."
uv run uvicorn main:app --host 0.0.0.0 --port 8899
