#!/usr/bin/env bash
PORT=4173
FOLIO_DIR="${FOLIO_DIR:-/content/Folio}"

# Install cloudflared
if ! command -v cloudflared &>/dev/null; then
  wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
    -O /usr/local/bin/cloudflared
  chmod +x /usr/local/bin/cloudflared
fi

# Stop previous instances
pkill -f "vite preview" 2>/dev/null || true
pkill -f cloudflared       2>/dev/null || true
sleep 1

# Start Vite preview
cd "$FOLIO_DIR"
nohup npx vite preview --host 0.0.0.0 --port $PORT > /tmp/folio-vite.log 2>&1 &
sleep 3

# Start cloudflared tunnel
nohup cloudflared tunnel --url http://localhost:$PORT > /tmp/folio-cf.log 2>&1 &

# Wait up to 30 s for the public URL
URL=""
for i in $(seq 1 30); do
  URL=$(grep -oP 'https://[a-z0-9\-]+\.trycloudflare\.com' /tmp/folio-cf.log 2>/dev/null | head -1)
  [ -n "$URL" ] && break
  sleep 1
done

if [ -n "$URL" ]; then
  echo ""
  echo "  $URL"
else
  echo "Tunnel URL not found — check /tmp/folio-cf.log"
  tail -20 /tmp/folio-cf.log
fi
