#!/usr/bin/env bash
# Same FastAPI factory and frozen artifacts as the source internal demo script.
# Only runtime uploads, state, caches and temporary files are written, in Astra.
set -euo pipefail
ASTRA_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_REPO="${AQUALENS_SOURCE_REPO:-/Users/parvbansal/Desktop/aqualens}"
PYTHON_BIN="$SOURCE_REPO/.venv/bin/python"
[[ -x "$PYTHON_BIN" ]] || { echo "Aqualens backend Python environment not found: $PYTHON_BIN" >&2; exit 1; }
if lsof -nP -iTCP:8000 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port 8000 is already in use. This launcher will not replace a running service." >&2
  exit 1
fi
export SAGARDRISHTI_RUNTIME_DIR="$ASTRA_ROOT/.local-runtime"
export PYTHONDONTWRITEBYTECODE=1
export YOLO_AUTOINSTALL=false
export YOLO_CONFIG_DIR="$SAGARDRISHTI_RUNTIME_DIR/ultralytics"
export XDG_CACHE_HOME="$SAGARDRISHTI_RUNTIME_DIR/cache"
export MPLCONFIGDIR="$SAGARDRISHTI_RUNTIME_DIR/matplotlib"
export TMPDIR="$SAGARDRISHTI_RUNTIME_DIR/tmp"
mkdir -p "$SAGARDRISHTI_RUNTIME_DIR" "$TMPDIR"
cd "$ASTRA_ROOT"
exec "$PYTHON_BIN" -B -c '
import sys
from pathlib import Path
source = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(source / "packages"))
import uvicorn
from sagar.api import create_app
uvicorn.run(create_app(root=source), host="127.0.0.1", port=8000)
' "$SOURCE_REPO"
