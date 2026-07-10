#!/usr/bin/env bash
# Non-destructive Docker smoke for the local dashboard image.
# Requires Docker daemon. Skips cleanly when Docker is unavailable.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1 && ! command -v docker.exe >/dev/null 2>&1; then
  echo "docker: unavailable — skip image build/compose smoke"
  exit 0
fi

DOCKER=(docker)
if ! docker info >/dev/null 2>&1; then
  if command -v docker.exe >/dev/null 2>&1 && docker.exe info >/dev/null 2>&1; then
    DOCKER=(docker.exe)
  else
    echo "docker: daemon not reachable — skip image build/compose smoke"
    exit 0
  fi
fi

DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/dont-waste-docker-XXXXXX")"
trap 'rm -rf "$DATA_DIR"' EXIT

echo "Building dont-waste image…"
"${DOCKER[@]}" build -f docker/Dockerfile -t dont-waste:local .

echo "Running compose dashboard against temp data dir…"
DONT_WASTE_HOST_DATA_DIR="$DATA_DIR" "${DOCKER[@]}" compose -f docker/compose.yaml run --service-ports --rm -d --name dont-waste-smoke dashboard
cleanup() {
  "${DOCKER[@]}" rm -f dont-waste-smoke >/dev/null 2>&1 || true
  rm -rf "$DATA_DIR"
}
trap cleanup EXIT

ok=0
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:3000/api/overview" >/dev/null; then
    ok=1
    break
  fi
  sleep 2
done

if [[ "$ok" -ne 1 ]]; then
  echo "dashboard API did not become ready on :3000" >&2
  "${DOCKER[@]}" logs dont-waste-smoke >&2 || true
  exit 1
fi

echo "docker smoke ok"
