#!/usr/bin/env bash
# One-command local startup for the internal hack demo. Backend (FastAPI on
# 127.0.0.1:8000) + frontend (Next.js on localhost:3000). No Cloudflare, no
# Vercel, no manual model exports. Refuses to start if a critical prerequisite
# is missing. Never kills an unrelated process; if a port is already in use it
# reports that clearly and exits.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODEL="$ROOT/ml/artifacts/final_v1/detector/best.pt"
EXPECTED_SHA="2aa3ac71051856bcfc8ec400804995f03568aa26d1a1fb24583e4eb1b7a10b15"
OPEN_SET_DIR="$ROOT/ml/artifacts/vnext/open_set_v1"
FRONTEND_DIR="$ROOT/apps/workstation"
LOG_DIR="$ROOT/.demo-logs"
BACKEND_PORT=8000
FRONTEND_PORT=3000

fail() { printf 'REFUSING TO START: %s\n' "$1" >&2; exit 1; }
info() { printf '%s\n' "$1"; }

command -v uv >/dev/null 2>&1 || fail "'uv' is not on PATH (required to run the backend)."
command -v pnpm >/dev/null 2>&1 || fail "'pnpm' is not on PATH (required to run the frontend)."

[[ -f "$MODEL" ]] || fail "frozen detector is missing at $MODEL"
ACTUAL_SHA="$(shasum -a 256 "$MODEL" | awk '{print $1}')"
[[ "$ACTUAL_SHA" == "$EXPECTED_SHA" ]] || fail "frozen detector SHA mismatch (expected $EXPECTED_SHA, got $ACTUAL_SHA)"
info "OK: frozen detector present and SHA-verified"

[[ -f "$OPEN_SET_DIR/config.json" && -f "$OPEN_SET_DIR/memory_bank.npz" ]] || fail "open_set_v1 artifact is incomplete at $OPEN_SET_DIR"
info "OK: open_set_v1 artifact present"

[[ -d "$FRONTEND_DIR/node_modules" ]] || fail "frontend dependencies are not installed; run 'pnpm install' in $FRONTEND_DIR"
info "OK: frontend dependencies installed"

port_owner() { lsof -nP -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | awk 'NR==2{print $1" (pid "$2")"}'; }

if owner="$(port_owner "$BACKEND_PORT")" && [[ -n "$owner" ]]; then
  fail "port $BACKEND_PORT is already in use by $owner. Stop it yourself or choose another port; this script will not kill it for you."
fi
if owner="$(port_owner "$FRONTEND_PORT")" && [[ -n "$owner" ]]; then
  fail "port $FRONTEND_PORT is already in use by $owner. Stop it yourself or choose another port; this script will not kill it for you."
fi

mkdir -p "$LOG_DIR"
BACKEND_LOG="$LOG_DIR/backend.log"
FRONTEND_LOG="$LOG_DIR/frontend.log"

info "Starting backend on http://127.0.0.1:$BACKEND_PORT ..."
(cd "$ROOT" && nohup uv run uvicorn sagar.api:create_app --factory --host 127.0.0.1 --port "$BACKEND_PORT" >"$BACKEND_LOG" 2>&1 &
 echo $! >"$LOG_DIR/backend.pid")
BACKEND_PID="$(cat "$LOG_DIR/backend.pid")"

info "Waiting for backend health ..."
ready=""
for _ in $(seq 1 60); do
  if curl --fail --silent --max-time 2 "http://127.0.0.1:$BACKEND_PORT/api/v1/runtime/health" >"$LOG_DIR/health.json" 2>/dev/null; then
    ready=1
    break
  fi
  sleep 1
done
if [[ -z "$ready" ]]; then
  info "Backend did not become healthy in time. Last log lines:"
  tail -n 40 "$BACKEND_LOG" >&2 || true
  kill "$BACKEND_PID" 2>/dev/null || true
  fail "backend startup failed; see $BACKEND_LOG"
fi

if ! grep -q '"model_loaded":true' "$LOG_DIR/health.json" || ! grep -q '"runtime_available":true' "$LOG_DIR/health.json"; then
  info "Backend is up but the model did not load. Health response:"
  cat "$LOG_DIR/health.json" >&2
  fail "model_loaded/runtime_available is false; fix the startup cause, do not paper over it in the UI"
fi
info "OK: backend healthy, model_loaded=true, runtime_available=true"

info "Starting frontend on http://localhost:$FRONTEND_PORT ..."
(cd "$FRONTEND_DIR" && NEXT_PUBLIC_API_BASE_URL="http://127.0.0.1:$BACKEND_PORT" nohup pnpm dev --port "$FRONTEND_PORT" >"$FRONTEND_LOG" 2>&1 &
 echo $! >"$LOG_DIR/frontend.pid")
FRONTEND_PID="$(cat "$LOG_DIR/frontend.pid")"

info "Waiting for frontend to answer ..."
ready=""
for _ in $(seq 1 60); do
  if curl --fail --silent --max-time 2 -o /dev/null "http://localhost:$FRONTEND_PORT/"; then
    ready=1
    break
  fi
  sleep 1
done
if [[ -z "$ready" ]]; then
  info "Frontend did not become reachable in time. Last log lines:"
  tail -n 40 "$FRONTEND_LOG" >&2 || true
  fail "frontend startup failed; see $FRONTEND_LOG (backend PID $BACKEND_PID is still running)"
fi

cat <<EOF

INTERNAL DEMO IS UP
  Frontend: http://localhost:$FRONTEND_PORT/app
  Backend:  http://127.0.0.1:$BACKEND_PORT/api/v1/runtime/health
  Backend PID:  $BACKEND_PID   (log: $BACKEND_LOG)
  Frontend PID: $FRONTEND_PID  (log: $FRONTEND_LOG)

Stop with:
  kill $BACKEND_PID $FRONTEND_PID
EOF
