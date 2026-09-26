"""Gate 2 integration test: deliberately refuses synthetic-only test coverage."""
import json
from pathlib import Path

from sagar.evaluation import ASSERTION_NAMES, assert_split_integrity
from sagar.io.canonical import load_frames


ROOT = Path(__file__).resolve().parents[1]


def test_real_snapshot_has_all_five_leakage_assertions():
    snapshots = sorted((ROOT / "data/processed").glob("snap_*"))
    assert snapshots, "REAL SNAPSHOT REQUIRED: acquire, ingest, and build tiles before Gate 2"
    snapshot_dir = max(snapshots, key=lambda path: json.loads((path / "snapshot.json").read_text())["generated_at"])
    snapshot = json.loads((snapshot_dir / "snapshot.json").read_text())
    assert set(snapshot["split_assertions"]) == set(ASSERTION_NAMES)
    assert all(value == "PASS" for value in snapshot["split_assertions"].values())
    # The saved tiles are inspected too: a source-frame derivative must inherit its split.
    dataset_ids = {source["dataset_id"] for source in snapshot["source_datasets"] if "dataset_id" in source}
    split = json.loads((snapshot_dir / "split.json").read_text())
    frames = []
    for dataset_id in dataset_ids:
        frames.extend(load_frames(ROOT / "data/interim" / dataset_id / "frames.jsonl"))
    # The snapshot records a supervised subset while preserving excluded source frames in the
    # canonical corpus. Leakage assertions apply to every frame actually assigned a split.
    frames = [frame for frame in frames if frame["frame_id"] in split["frame_assignments"]]
    assert frames, "snapshot contains no split-assigned source frames"
    tiles = [json.loads(line) for line in (snapshot_dir / "tiles.jsonl").read_text().splitlines() if line]
    assert_split_integrity(frames, split, tiles)
