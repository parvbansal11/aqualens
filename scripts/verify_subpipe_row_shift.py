#!/usr/bin/env python3
"""Round-2 B4 real-frame check: consecutive SubPipe frames form one VERIFIED Survey (spec B-AC3).

Runs the production verifier (``sagar.vnext.surveys.verify_row_shift_groups``) with the runtime's
native-pixel loading on N consecutive 1-s SubPipe frames, read-only, and writes a verification log
and manifest. Verification time is recorded as a measurement, not a pass/fail gate.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages"))

from sagar.vnext.surveys import RowShiftPolicy, verify_row_shift_groups  # noqa: E402

SUBPIPE_DATA = Path.home() / "Desktop/sagardrishti/data/raw/subpipe/full_extracted/SubPipe/DATA"
DEFAULT_CHANNELS = ("Chunk1/SSS_HF_images/Image", "Chunk1/SSS_LF_images/Image")
DEFAULT_FIRST = "1693573517.84.pbm"  # the pair audited in ROUND2_TECHNICAL_AUDIT F4


def native_pixels(path: Path) -> np.ndarray:
    # Same loading rule as the runtime Survey-formation step.
    with Image.open(path) as image:
        return np.asarray(image.convert("RGBA") if image.mode in {"P", "PA"} else image)


def check(directory: Path, first: str, count: int) -> dict:
    names = sorted(path.name for path in directory.glob("*.pbm"))
    start = names.index(first)
    selected = names[start:start + count]
    times = [float(name.removesuffix(".pbm")) for name in selected]
    paths = {name: directory / name for name in selected}
    before = {name: hashlib.sha256(path.read_bytes()).hexdigest() for name, path in paths.items()}
    started = time.perf_counter()
    groups = verify_row_shift_groups(selected, lambda name: native_pixels(paths[name]))
    elapsed = time.perf_counter() - started
    after = {name: hashlib.sha256(path.read_bytes()).hexdigest() for name, path in paths.items()}
    with Image.open(paths[selected[0]]) as image:
        geometry = {"width_px": image.width, "height_px": image.height, "mode": image.mode}
    return {
        "directory": str(directory), "frames": selected, "frame_timestamps_s": times,
        "frame_spacing_s": [round(b - a, 3) for a, b in zip(times, times[1:])], "geometry": geometry,
        "source_sha256": before, "sources_unchanged": before == after,
        "groups": groups, "verified_as_one_survey": len(groups) == 1 and sorted(groups[0]["frame_ids"]) == selected,
        "verification_seconds": round(elapsed, 4),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=SUBPIPE_DATA)
    parser.add_argument("--channel", action="append", dest="channels")
    parser.add_argument("--first", default=DEFAULT_FIRST)
    parser.add_argument("--count", type=int, default=3)
    parser.add_argument("--out", type=Path, default=ROOT / "artifacts/round2/B/row_shift_verification/iter-1")
    args = parser.parse_args()
    checks = [check(args.data / channel, args.first, args.count) for channel in (args.channels or DEFAULT_CHANNELS)]
    args.out.mkdir(parents=True, exist_ok=True)
    log = {"ticket": "B4", "acceptance": "spec B-AC3", "policy": RowShiftPolicy().__dict__, "checks": checks,
           "all_verified": all(item["verified_as_one_survey"] for item in checks)}
    (args.out / "verification_log.json").write_text(json.dumps(log, indent=2) + "\n")
    commit = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    dirty = bool(subprocess.run(["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True).stdout.strip())
    manifest = {"created_at": datetime.now(timezone.utc).isoformat(), "script": "scripts/verify_subpipe_row_shift.py",
                "argv": sys.argv[1:], "git_commit": commit, "working_tree_dirty": dirty, "python": platform.python_version(),
                "numpy": np.__version__, "machine": platform.platform(), "outputs": ["verification_log.json"]}
    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    for item in checks:
        print(f"{item['directory']}: {item['frames']} verified={item['verified_as_one_survey']} "
              f"offsets={item['groups'][0]['ping_offsets'] if item['groups'] else None} t={item['verification_seconds']}s")
    return 0 if log["all_verified"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
