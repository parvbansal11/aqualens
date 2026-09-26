#!/usr/bin/env python3
"""Derive capability gates from observed canonical data, never from expectations."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages"))
from sagar.io.canonical import load_frames


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("dataset", choices=["subpipe", "ai4shipwrecks"])
    args = parser.parse_args()
    frames_path = ROOT / "data/interim" / args.dataset / "frames.jsonl"
    if not frames_path.exists():
        raise RuntimeError(f"canonical frames unavailable: {frames_path}")
    frames = load_frames(frames_path)
    if not frames:
        raise RuntimeError("no canonical frames observed")
    gates = {
        key: all(frame["capability_gates"].get(key) is True for frame in frames)
        for key in ("nav_available", "ping_order_recoverable", "range_scale_known")
    }
    preprocessed = []
    for frame in frames:
        sidecar = ROOT / "data/interim" / args.dataset / "preprocess" / f"{frame['frame_id']}.json"
        if sidecar.exists():
            preprocessed.append(json.loads(sidecar.read_text()))
    gates["nadir_recoverable"] = bool(preprocessed) and all(item["nadir"]["position_px"] is not None for item in preprocessed)
    config_path = ROOT / "configs/datasets" / f"{args.dataset}.yaml"
    config = yaml.safe_load(config_path.read_text())
    config["capability_gates"] = gates
    config_path.write_text(yaml.safe_dump(config, sort_keys=False))
    print(json.dumps(gates, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
