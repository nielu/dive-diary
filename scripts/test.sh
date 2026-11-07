#!/usr/bin/env bash
# Runs every test suite against a throwaway PocketBase server.
#   ./scripts/test.sh            unit + sync + browser tests
#   ./scripts/test.sh --unit     unit tests only (no server)
# Needs backend/pocketbase (or PB_BIN) and a built frontend (npm run build).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FRONT="$ROOT/frontend"

if [[ "${1:-}" == "--unit" ]]; then
  cd "$FRONT" && node --test tests/units.test.js tests/tour.test.js tests/refs.test.js tests/import.test.js
  exit
fi

PB="${PB_BIN:-$ROOT/backend/pocketbase}"
PORT="${PORT:-8090}"
export PB_URL="http://127.0.0.1:$PORT" BASE_URL="http://127.0.0.1:$PORT"
export OWNER_EMAIL="me@example.com" OWNER_PASSWORD="testpass123"
DATA="$(mktemp -d)"
LOG="$DATA/server.log"

# Same folder layout as the Docker image.
"$PB" serve --http="127.0.0.1:$PORT" --dir="$DATA/pb_data" \
  --publicDir="$ROOT/backend/pb_public" --hooksDir="$ROOT/backend/pb_hooks" \
  --migrationsDir="$ROOT/backend/pb_migrations" >"$LOG" 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true; rm -rf "$DATA"' EXIT

for _ in $(seq 1 50); do
  curl -sf "$PB_URL/api/health" >/dev/null && break
  sleep 0.2
done
curl -sf "$PB_URL/api/health" >/dev/null || { echo "server didn't start:"; cat "$LOG"; exit 1; }

cd "$FRONT"
node --test tests/*.test.js
npx playwright test "$@"
