#!/usr/bin/env bash
# Non-destructive local judge-demo prerequisite check.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODEL="$ROOT/ml/artifacts/final_v1/detector/best.pt"
EXPECTED="2aa3ac71051856bcfc8ec400804995f03568aa26d1a1fb24583e4eb1b7a10b15"
FRONTEND="$ROOT/apps/workstation"
cd "$ROOT"

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
pass() { printf 'OK: %s\n' "$1"; }

[[ -f "$MODEL" ]] || fail "frozen detector is missing"
[[ "$(shasum -a 256 "$MODEL" | awk '{print $1}')" == "$EXPECTED" ]] || fail "frozen detector SHA mismatch"
pass "frozen detector SHA"

[[ -f "$FRONTEND/package.json" ]] || fail "workstation package manifest is missing"
[[ -d "$FRONTEND/node_modules" ]] || fail "frontend dependencies are not installed"
[[ -f "$FRONTEND/src/styles/design-tokens.css" ]] || fail "frozen design tokens are missing"
[[ -f "$ROOT/docs/assets/readme/aqualens-wave.svg" ]] || fail "Aqualens visual asset is missing"
pass "frontend dependencies and frozen visual references"

uv run python -c 'from sagar.api.app import create_app; create_app()' >/dev/null || fail "backend import/startup preflight"
pass "backend import/startup preflight"

if curl --fail --silent --max-time 2 http://127.0.0.1:8000/api/v1/runtime/health >/dev/null; then
  pass "running backend health endpoint (:8000)"
else
  printf 'INFO: backend is not running on :8000; start it with the runbook command.\n'
fi
