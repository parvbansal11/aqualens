#!/usr/bin/env sh
# Read-only deployment smoke check. It deliberately does not upload a survey.
set -eu

base_url="${BASE_URL:-${1:-}}"
if [ -z "$base_url" ]; then
  echo "Usage: BASE_URL=https://api.example.com $0" >&2
  exit 64
fi
base_url=${base_url%/}

health="$(curl --fail --silent --show-error --max-time 30 "$base_url/api/v1/runtime/health")"
printf '%s\n' "$health" | grep -q '"runtime_available":true' || {
  echo "Detector is not available according to runtime health." >&2
  exit 1
}
printf '%s\n' "$health" | grep -q '"open_set"[^}]*"availability":"AVAILABLE"' || {
  echo "open_set_v1 is not available according to runtime health." >&2
  exit 1
}

# A body-less POST must be rejected as a validation error (422); that proves the
# multipart route is reachable without creating an upload or starting inference.
upload_status="$(curl --silent --show-error --max-time 30 -o /dev/null -w '%{http_code}' \
  -X POST "$base_url/api/v1/surveys/upload")"
[ "$upload_status" = "422" ] || {
  echo "Upload route returned HTTP $upload_status; expected 422 for a body-less probe." >&2
  exit 1
}
curl --fail --silent --show-error --max-time 30 "$base_url/api/v1/runtime/surveys" >/dev/null

echo "Smoke check passed: health, detector, open_set_v1, upload route, and survey index are reachable."
