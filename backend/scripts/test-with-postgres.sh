#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$BACKEND_DIR/docker-compose.test.yml"

cleanup() {
  if [[ "${KEEP_POSTGRES:-0}" != "1" ]]; then
    docker compose -f "$COMPOSE_FILE" down --volumes --remove-orphans
  fi
}

trap cleanup EXIT
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker not detected. Export TEST_DATABASE_URL and run npm run test:pg instead." >&2
  exit 1
fi
docker compose -f "$COMPOSE_FILE" up -d --wait
export TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5433/wingcaster_test"
cd "$BACKEND_DIR"
npm test
