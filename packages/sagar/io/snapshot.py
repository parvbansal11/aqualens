from __future__ import annotations

import subprocess
from collections import Counter
from pathlib import Path
from typing import Any

from sagar.core.models import DatasetSnapshot

from .common import stable_id, write_json


def _git_sha(root: Path) -> str | None:
    result = subprocess.run(["git", "rev-parse", "HEAD"], cwd=root, text=True, capture_output=True)
    return result.stdout.strip() if result.returncode == 0 else None


def build_snapshot(root: str | Path, frames: list[dict[str, Any]], tiles: list[dict[str, Any]], split: dict[str, Any],
                   source_datasets: list[dict[str, Any]], class_config_version: int, preprocessing_version: str) -> DatasetSnapshot:
    root = Path(root)
    split_counts = Counter(tile["split"] for tile in tiles)
    class_distribution = Counter(annotation["category"] for tile in tiles for annotation in tile["annotations"])
    frame_counts = Counter(frame["dataset_id"] for frame in frames)
    tile_counts = Counter(tile["dataset_id"] for tile in tiles)
    digest_payload = f"relative_tile_paths_v1:{split['split_id']}:{sorted((t['tile_id'] for t in tiles))}:{class_config_version}:{preprocessing_version}"
    snapshot_id = f"snap_{stable_id(digest_payload)}"
    snapshot = DatasetSnapshot(
        snapshot_id=snapshot_id, source_datasets=source_datasets,
        canonical_class_config_version=class_config_version, split_seed=split["seed"],
        frame_counts=dict(frame_counts), tile_counts=dict(tile_counts), split_counts=dict(split_counts),
        class_distribution=dict(class_distribution), preprocessing_version=preprocessing_version,
        tiling={"tile_size": [512, 512], "overlap": 0.5, "edge_rule": "zero_pad_right_bottom", "min_box_fraction": 0.25},
        git_commit=_git_sha(root), split_id=split["split_id"],
    )
    destination = root / "data" / "processed" / snapshot_id
    destination.mkdir(parents=True, exist_ok=False)
    write_json(destination / "snapshot.json", snapshot.model_dump(mode="json"))
    write_json(destination / "split.json", split)
    return snapshot
