#!/usr/bin/env python3
"""Build an isolated, full-SubPipe supervised snapshot; never touches Mini2 data."""
from __future__ import annotations

import json
import shutil
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages"))

from sagar.core import load_class_mapper
from sagar.evaluation import assert_split_integrity, make_splits
from sagar.io import ingest_subpipe
from sagar.io.common import sha256_file, write_json, write_jsonl
from sagar.io.snapshot import build_snapshot
from sagar.io.tiling import build_tiles, write_yolo_labels
from sagar.preprocess import PREPROCESSING_VERSION


def _timestamp(frame: dict) -> float:
    return float(Path(frame["source_filename"]).stem)


def apply_full_sequence_plan(frames: list[dict]) -> None:
    """Split the one continuous acquisition with 900-second temporal embargoes.

    Chunk files roll over every few minutes and are not independent sites.  The release
    timestamps show one uninterrupted 2.6-hour sequence, so its split unit is a protected
    source-time block rather than the archive's storage chunk.
    """
    start = min(_timestamp(frame) for frame in frames)
    for frame in frames:
        block = int((_timestamp(frame) - start) // 300)
        frame["dataset_id"] = "subpipe_full"
        frame["sequence_id"] = "subpipe_full_sequence_001"
        if 0 <= block <= 9:
            group, hint, reason = "full_sequence_001_train", "train", None
        elif 13 <= block <= 23:
            group, hint, reason = "full_sequence_001_val", "val", None
        elif block >= 27:
            group, hint, reason = "full_sequence_001_test", "test", None
        else:
            group, hint, reason = "full_sequence_001_embargo", None, "TEMPORAL_OVERLAP_EMBARGO"
        frame["group_key"], frame["split_hint"], frame["excluded_reason"] = group, hint, reason


def main() -> int:
    raw = ROOT / "data/raw/subpipe/full_extracted"
    interim = ROOT / "data/interim/subpipe_full"
    archive = ROOT / "data/raw/subpipe/SubPipe.zip"
    if not (raw / ".SubPipe.complete").exists():
        raise RuntimeError("full archive extraction marker is absent")
    mapper = load_class_mapper(ROOT / "configs/classes.yaml")
    frames = [frame.to_dict() for frame in ingest_subpipe(raw, interim, mapper)]
    apply_full_sequence_plan(frames)
    write_jsonl(interim / "frames.jsonl", iter(frames))
    for frame in frames:
        write_json(interim / "frames" / f"{frame['frame_id']}.json", frame)
    # The COCO/YOLO source files only establish object annotations.  Frames without a
    # source object annotation are not asserted negatives and therefore are intentionally
    # excluded from this positive-object supervised detector snapshot.
    supervised = [frame for frame in frames if frame["annotations"] and not frame.get("excluded_reason")]
    if not supervised:
        raise RuntimeError("no annotated full-SubPipe frames found")
    split = make_splits(supervised, seed=20260831)
    staging = ROOT / "data/processed/.stage_subpipe_full"
    if staging.exists():
        raise RuntimeError(f"refusing to overwrite pre-existing staging directory: {staging}")
    staging.mkdir(parents=True)
    try:
        tiles = build_tiles(supervised, split["frame_assignments"], staging)
        write_yolo_labels(tiles, staging, mapper.indices)
        assertions = assert_split_integrity(supervised, split, tiles)
        split["assertions"] = assertions
        source = {
            "dataset_id": "subpipe_full", "release": "SubPipe.zip", "archive": str(archive.relative_to(ROOT)),
            "archive_size": archive.stat().st_size, "archive_sha256": sha256_file(archive),
            "extraction_root": str(raw.relative_to(ROOT)), "extraction_marker": ".SubPipe.complete",
            "licence": "GPL-3.0", "dataset_version": "Zenodo:10.5281/zenodo.12666132",
        }
        snapshot = build_snapshot(ROOT, supervised, tiles, split, [source], mapper.version, PREPROCESSING_VERSION)
        destination = ROOT / "data/processed" / snapshot.snapshot_id
        for item in staging.iterdir():
            shutil.move(str(item), destination / item.name)
        snapshot_data = json.loads((destination / "snapshot.json").read_text())
        snapshot_data["split_assertions"] = assertions
        snapshot_data["snapshot_scope"] = "full_subpipe_supervised_only"
        write_json(destination / "snapshot.json", snapshot_data)
        audit = {
            "snapshot_id": snapshot.snapshot_id,
            "source_structure": "SubPipe/DATA/Chunk{0..4}/SSS_{HF,LF}_images/{Image,COCO_Annotation,YOLO_Annotation}",
            "source_frames_total": len(frames), "source_frames_supervised": len(supervised),
            "annotations_source": sum(len(frame["annotations"]) for frame in supervised),
            "classes_source": dict(Counter(a["category"] for frame in supervised for a in frame["annotations"])),
            "source_groups": {name: sorted({f"{f['dataset_id']}:{f['group_key']}" for f in supervised if split["frame_assignments"][f["frame_id"]] == name}) for name in ("train", "val", "test")},
            "source_frames_by_split": dict(Counter(split["frame_assignments"][frame["frame_id"]] for frame in supervised)),
            "tiles_by_split": dict(Counter(tile["split"] for tile in tiles)),
            "class_distribution_tiles": dict(Counter(a["category"] for tile in tiles for a in tile["annotations"])),
            "annotation_instances_tiles": sum(len(tile["annotations"]) for tile in tiles),
            "excluded_unsupervised_source_frames": len(frames) - len(supervised),
            "leakage_assertions": assertions,
            "provenance": source,
            "known_limitations": [
                "Only source frames carrying an object annotation are included; unannotated frames are not assumed to be verified negatives.",
                "The archive chunks are a single continuous acquisition; train/val/test are protected source-time blocks with 900-second embargoes.",
                "Spatial range remains pixel-only because source calibration/nadir geometry is unavailable.",
            ],
        }
        write_json(destination / "audit.json", audit)
        (destination / "AUDIT.md").write_text(f"# Full SubPipe supervised snapshot: {snapshot.snapshot_id}\n\nAll frozen leakage assertions: PASS.\n")
        print(snapshot.snapshot_id)
    finally:
        if staging.exists():
            shutil.rmtree(staging)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
