#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> node --test"
node --test

echo "==> node --check lib/*.js"
for f in lib/*.js; do
  node --check "$f"
done

PATCH="$(mktemp /tmp/dsh-plugin-api-verify-anchor.XXXXXX.yml)"
HEADLESS_LOG="$(mktemp /tmp/dsh-plugin-api-headless.XXXXXX.log)"
DEV_LOG="$(mktemp /tmp/dsh-plugin-api-dev.XXXXXX.log)"
DEV_PID=""

cleanup() {
  if [ -n "$DEV_PID" ]; then
    kill "$DEV_PID" 2>/dev/null || true
    wait "$DEV_PID" 2>/dev/null || true
  fi
  rm -f "$PATCH" "$HEADLESS_LOG" "$DEV_LOG"
}
trap cleanup EXIT

# Temporary verification overlay: the current dev/headless profiles include an
# unrelated, work-in-progress extrapro-anchor row that fails to load on its
# own. Disable it for the duration of this run ONLY so migration checks
# exercise dsh-plugin-api + dsh-read-image in isolation. This does not modify
# any profile on disk.
cat > "$PATCH" <<'YAML'
- id: extrapro-anchor
  disabled: true
- id: extrapro-anchor-panel
  disabled: true
YAML

echo "==> headless smoke"
if dsh --profile headless --patch "$PATCH" "请直接回复：OK" > "$HEADLESS_LOG" 2>&1; then
  if ! grep -q '^OK$' "$HEADLESS_LOG"; then
    echo "headless output did not contain OK" >&2
    cat "$HEADLESS_LOG" >&2
    exit 1
  fi
  if grep -Eq 'ERR_MODULE_NOT_FOUND|Error: |^\s+at ' "$HEADLESS_LOG"; then
    echo "headless output contains a stack trace or module error" >&2
    cat "$HEADLESS_LOG" >&2
    exit 1
  fi
  echo "headless smoke: OK"
else
  echo "headless smoke failed" >&2
  cat "$HEADLESS_LOG" >&2
  exit 1
fi

echo "==> dev boot readiness"
PORT=3082
if curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/" | grep -q '^200$'; then
  echo "port $PORT is already serving; refusing to test against an existing server" >&2
  exit 1
fi

dsh --profile dev --patch "$PATCH" > "$DEV_LOG" 2>&1 &
DEV_PID=$!

ready=0
for _ in $(seq 1 60); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/" 2>/dev/null || true)"
  if [ "$code" = "200" ]; then
    ready=1
    break
  fi
  sleep 2
done

if [ "$ready" != "1" ]; then
  echo "dev server did not become ready on port $PORT" >&2
  tail -80 "$DEV_LOG" >&2
  exit 1
fi

echo "dev boot: HTTP 200"
kill "$DEV_PID" 2>/dev/null || true
wait "$DEV_PID" 2>/dev/null || true
DEV_PID=""

echo "migration verification: all checks passed"
