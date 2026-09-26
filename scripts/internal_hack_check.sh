#!/usr/bin/env bash
# One-command local health check for internal-hack readiness. Read-only by
# default: it never uploads a survey unless --with-upload is passed. Exits
# nonzero on the first critical failure.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BASE_URL="${BASE_URL:-http://127.0.0.1:8000}"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:3000}"
MODEL="$ROOT/ml/artifacts/final_v1/detector/best.pt"
EXPECTED_SHA="2aa3ac71051856bcfc8ec400804995f03568aa26d1a1fb24583e4eb1b7a10b15"
OPEN_SET_DIR="$ROOT/ml/artifacts/vnext/open_set_v1"
WITH_UPLOAD=""
REQUIRE_FRONTEND=1
EPITOME_ZIP="${EPITOME_ZIP:-$HOME/Desktop/Aqualens_Epitome_Demo_Survey.zip}"

for arg in "$@"; do
  case "$arg" in
    --with-upload) WITH_UPLOAD=1 ;;
    # A backend-only demo (the Astra frontend runs from its own repository, or
    # nothing is served on :3000 at all) must still be able to pass.
    --no-frontend) REQUIRE_FRONTEND="" ;;
  esac
done

CRITICAL_FAILURES=0
pass() { printf 'OK:   %s\n' "$1"; }
warn() { printf 'WARN: %s\n' "$1"; }
critical() { printf 'FAIL: %s\n' "$1" >&2; CRITICAL_FAILURES=$((CRITICAL_FAILURES + 1)); }

echo "=== 1. Frozen model artifact ==="
if [[ -f "$MODEL" ]]; then
  ACTUAL_SHA="$(shasum -a 256 "$MODEL" | awk '{print $1}')"
  if [[ "$ACTUAL_SHA" == "$EXPECTED_SHA" ]]; then
    pass "frozen detector SHA matches ($EXPECTED_SHA)"
  else
    critical "frozen detector SHA mismatch (expected $EXPECTED_SHA, got $ACTUAL_SHA)"
  fi
else
  critical "frozen detector missing at $MODEL"
fi

echo "=== 2. open_set_v1 artifact ==="
if [[ -f "$OPEN_SET_DIR/config.json" && -f "$OPEN_SET_DIR/memory_bank.npz" ]]; then
  pass "open_set_v1 config.json and memory_bank.npz present"
else
  critical "open_set_v1 artifact incomplete at $OPEN_SET_DIR"
fi

echo "=== 3. Backend health ==="
HEALTH_JSON="$(curl --silent --max-time 5 "$BASE_URL/api/v1/runtime/health" || true)"
if [[ -z "$HEALTH_JSON" ]]; then
  critical "backend is unreachable at $BASE_URL (start it with scripts/start_internal_demo.sh)"
else
  if ! python3 - "$HEALTH_JSON" <<'PYEOF'
import json, sys
try:
    d = json.loads(sys.argv[1])
except Exception as exc:
    print(f"FAIL: backend health response is not valid JSON ({exc})")
    sys.exit(1)

def check(cond, msg):
    print(("OK:   " if cond else "FAIL: ") + msg)
    return cond

ok = True
ok &= check(d.get("runtime_available") is True, "runtime_available is true")
ok &= check(d.get("model_loaded") is True, "model_loaded is true")
ok &= check(d.get("model_sha256") == "2aa3ac71051856bcfc8ec400804995f03568aa26d1a1fb24583e4eb1b7a10b15", "model_sha256 matches the frozen artifact")
open_set = (d.get("optional_models") or {}).get("open_set") or {}
ok &= check(open_set.get("availability") == "AVAILABLE", "open_set availability is AVAILABLE")
sys.exit(0 if ok else 1)
PYEOF
  then
    CRITICAL_FAILURES=$((CRITICAL_FAILURES + 1))
  fi
fi

echo "=== 4. Runtime survey routes (read-only) ==="
SURVEYS_CODE="$(curl --silent --max-time 5 -o /tmp/internal_hack_surveys.json -w '%{http_code}' "$BASE_URL/api/v1/runtime/surveys" || true)"
if [[ "$SURVEYS_CODE" == "200" ]]; then
  pass "survey index endpoint reachable"
else
  critical "survey index endpoint returned HTTP $SURVEYS_CODE"
fi

UPLOAD_PROBE_CODE="$(curl --silent --max-time 5 -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/v1/surveys/upload" || true)"
if [[ "$UPLOAD_PROBE_CODE" == "422" ]]; then
  pass "upload route reachable (422 for a body-less probe, no upload performed)"
else
  critical "upload route returned HTTP $UPLOAD_PROBE_CODE for a body-less probe; expected 422"
fi

FIRST_SURVEY_ID="$(python3 -c "
import json
try:
    d = json.load(open('/tmp/internal_hack_surveys.json'))
    items = d.get('items') or []
    print(items[0]['survey_id'] if items else '')
except Exception:
    print('')
")"
if [[ -n "$FIRST_SURVEY_ID" ]]; then
  REPORT_CODE="$(curl --silent --max-time 5 -o /dev/null -w '%{http_code}' "$BASE_URL/api/v1/runtime/surveys/$FIRST_SURVEY_ID/report?format=json" || true)"
  if [[ "$REPORT_CODE" == "200" ]]; then
    pass "report route reachable for an existing survey ($FIRST_SURVEY_ID)"
  else
    critical "report route returned HTTP $REPORT_CODE for $FIRST_SURVEY_ID"
  fi
else
  NOT_FOUND_CODE="$(curl --silent --max-time 5 -o /dev/null -w '%{http_code}' "$BASE_URL/api/v1/runtime/surveys/does-not-exist/report?format=json" || true)"
  if [[ "$NOT_FOUND_CODE" == "404" ]]; then
    pass "report route is wired (404, not 500, for a nonexistent survey; no surveys exist yet to check against real data)"
  else
    critical "report route returned HTTP $NOT_FOUND_CODE for a nonexistent survey; expected 404"
  fi
fi

echo "=== 5. Frontend reachability ==="
FRONTEND_CODE="$(curl --silent --max-time 5 -o /dev/null -w '%{http_code}' "$FRONTEND_URL/" || true)"
if [[ "$FRONTEND_CODE" == "200" ]]; then
  pass "frontend reachable at $FRONTEND_URL"
elif [[ -n "$REQUIRE_FRONTEND" ]]; then
  critical "frontend returned HTTP $FRONTEND_CODE at $FRONTEND_URL (start it with scripts/start_internal_demo.sh)"
else
  warn "no frontend at $FRONTEND_URL; skipped by --no-frontend (backend-only check)"
fi

echo "=== 6. Critical env ==="
if [[ -f "$ROOT/.env.example" ]]; then
  pass ".env.example present as the documented reference for optional overrides"
else
  warn ".env.example is missing"
fi

if [[ -n "$WITH_UPLOAD" ]]; then
  echo "=== 7. Real Epitome upload (opt-in, --with-upload) ==="
  if [[ -f "$EPITOME_ZIP" ]]; then
    UPLOAD_JSON="$(curl --silent --max-time 60 -X POST "$BASE_URL/api/v1/surveys/upload" -F "file=@$EPITOME_ZIP;type=application/zip" -F "name=Internal Hack Check" || true)"
    JOB_ID="$(python3 -c "import json,sys; print(json.loads(sys.argv[1]).get('job_id',''))" "$UPLOAD_JSON" 2>/dev/null)"
    if [[ -z "$JOB_ID" ]]; then
      critical "upload did not return a job_id: $UPLOAD_JSON"
    else
      pass "upload accepted, job_id=$JOB_ID"
      STATE=""
      for _ in $(seq 1 30); do
        JOB_JSON="$(curl --silent --max-time 5 "$BASE_URL/api/v1/jobs/$JOB_ID" || true)"
        STATE="$(python3 -c "import json,sys; print(json.loads(sys.argv[1]).get('state',''))" "$JOB_JSON" 2>/dev/null)"
        [[ "$STATE" == "COMPLETED" || "$STATE" == "FAILED" ]] && break
        sleep 1
      done
      if [[ "$STATE" == "COMPLETED" ]]; then
        pass "job reached COMPLETED"
      else
        critical "job ended in state '$STATE', expected COMPLETED"
      fi
    fi
  else
    warn "Epitome demo bundle not found at $EPITOME_ZIP; skipping real upload (set EPITOME_ZIP to override)"
  fi
fi

echo
if [[ "$CRITICAL_FAILURES" -eq 0 ]]; then
  echo "ALL CRITICAL CHECKS PASSED"
  exit 0
else
  echo "$CRITICAL_FAILURES CRITICAL CHECK(S) FAILED" >&2
  exit 1
fi
