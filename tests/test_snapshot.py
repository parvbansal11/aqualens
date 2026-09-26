from pathlib import Path

from sagar.io.snapshot import build_snapshot


def test_snapshot_has_traceable_identity(tmp_path):
    root = tmp_path
    (root / ".git").mkdir()
    frame = {"frame_id": "f", "dataset_id": "d", "annotations": []}
    tile = {"tile_id": "t", "dataset_id": "d", "split": "train", "annotations": []}
    split = {"split_id": "split_x", "seed": 7}
    snapshot = build_snapshot(root, [frame], [tile], split, [{"dataset_id": "d", "archive_sha256": "abc"}], 2, "p0.1")
    assert snapshot.snapshot_id.startswith("snap_")
    assert (root / "data" / "processed" / snapshot.snapshot_id / "snapshot.json").exists()
