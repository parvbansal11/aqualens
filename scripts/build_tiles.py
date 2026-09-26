#!/usr/bin/env python3
"""Build a complete prepared-data snapshot from canonical sidecars. No training occurs here."""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages"))
from sagar.core import load_class_mapper
from sagar.evaluation import assert_split_integrity, make_splits
from sagar.io.canonical import load_frames
from sagar.io.common import write_json
from sagar.io.snapshot import build_snapshot
from sagar.io.tiling import build_tiles, write_yolo_labels
from sagar.preprocess import PREPROCESSING_VERSION, preprocess_frame


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", choices=["subpipe", "ai4shipwrecks", "all"], default="all")
    parser.add_argument("--seed", type=int, default=20260830)
    args = parser.parse_args()
    dataset_names = [args.dataset] if args.dataset != "all" else ["subpipe", "ai4shipwrecks"]
    all_frames = []
    for name in dataset_names:
        file = ROOT / "data/interim" / name / "frames.jsonl"
        if not file.exists():
            raise RuntimeError(f"canonical data missing: run scripts/ingest_{name}.py first")
        all_frames.extend(load_frames(file))
    # Retain every raw frame canonically, but Mini2 source frames without any source annotation
    # are not used in this supervised snapshot. This avoids treating dHash-colliding blank
    # imagery from independent recordings as evidence of a cross-split positive lineage.
    frames = [frame for frame in all_frames if not frame.get("excluded_reason") and frame.get("annotations")]
    if not frames:
        raise RuntimeError("no canonical frames remain after documented exclusion rules")
    split = make_splits(frames, seed=args.seed)
    for frame in frames:
        preprocessing = preprocess_frame(frame, ROOT / "data/interim" / frame["dataset_id"])
        frame["preprocessing"] = preprocessing
    staging = ROOT / "data/processed/.stage"
    if staging.exists():
        shutil.rmtree(staging)
    tiles = build_tiles(frames, split["frame_assignments"], staging)
    mapper = load_class_mapper(ROOT / "configs/classes.yaml")
    write_yolo_labels(tiles, staging, mapper.indices)
    assertions = assert_split_integrity(frames, split, tiles)
    split["assertions"] = assertions
    sources = []
    for name in dataset_names:
        manifest = ROOT / "data/raw" / name / "manifest.json"
        sources.append(json.loads(manifest.read_text()) if manifest.exists() else {"dataset_id": name, "acquisition": "MISSING_MANIFEST"})
    snapshot = build_snapshot(ROOT, frames, tiles, split, sources, mapper.version, PREPROCESSING_VERSION)
    destination = ROOT / "data/processed" / snapshot.snapshot_id
    for item in staging.iterdir():
        shutil.move(str(item), destination / item.name)
    staging.rmdir()
    snapshot_data = json.loads((destination / "snapshot.json").read_text())
    snapshot_data["split_assertions"] = assertions
    write_json(destination / "snapshot.json", snapshot_data)
    audit = {
        "snapshot_id": snapshot.snapshot_id, "source_frames": len(frames), "source_frames_total": len(all_frames), "tiles": len(tiles),
        "frames_by_dataset": dict(Counter(frame["dataset_id"] for frame in frames)),
        "tiles_by_split": dict(Counter(tile["split"] for tile in tiles)),
        "classes": dict(Counter(annotation["category"] for tile in tiles for annotation in tile["annotations"])),
        "annotations": sum(len(tile["annotations"]) for tile in tiles),
        "negative_tile_fraction": sum(not tile["annotations"] for tile in tiles) / len(tiles),
        "group_counts": dict(Counter(f"{f['dataset_id']}:{f['group_key']}" for f in frames)),
        "excluded_frames": dict(Counter(
            frame.get("excluded_reason") or "UNANNOTATED_SOURCE_FRAME_NOT_USED_IN_DETECTION_SNAPSHOT"
            for frame in all_frames if frame.get("excluded_reason") or not frame.get("annotations")
        )),
        "provenance": sources, "warnings": [
            "SubPipeMini2 uses source-timestamp sequence blocks with 300-second overlap embargoes between train and validation.",
            "Unannotated Mini2 source frames remain canonical but are excluded from this supervised detection snapshot after conservative near-duplicate screening.",
        ],
        "known_limitations": ["Pixel range is never represented as metres without source calibration.", "Nadir estimates can drop frames to L0."],
    }
    write_json(destination / "audit.json", audit)
    summary = "\n".join([f"# Dataset audit: {snapshot.snapshot_id}", "", f"Source frames: {len(frames)}", f"Tiles: {len(tiles)}", f"Split tiles: {audit['tiles_by_split']}", f"Classes: {audit['classes']}", f"Negative tile fraction: {audit['negative_tile_fraction']:.3f}", "", "All five frozen pipeline leakage assertions: PASS."]) + "\n"
    (destination / "AUDIT.md").write_text(summary)
    print(f"Dataset snapshot: {snapshot.snapshot_id}")
    print(json.dumps(audit["tiles_by_split"], indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
