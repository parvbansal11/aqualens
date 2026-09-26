#!/usr/bin/env python3
"""Create a training-only Kaggle bundle without altering the verified snapshot."""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages"))
from sagar.io.common import write_json


def link_or_copy(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.link(source, target)
    except OSError:
        shutil.copy2(source, target)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("snapshot")
    args = parser.parse_args()
    source = ROOT / "data/processed" / args.snapshot
    target = source / "kaggle"
    if target.exists():
        raise RuntimeError(f"Kaggle export already exists: {target}")
    tiles = [json.loads(line) for line in (source / "tiles.jsonl").read_text().splitlines() if line]
    classes = sorted({annotation["category"] for tile in tiles for annotation in tile["annotations"]})
    indices = {name: index for index, name in enumerate(classes)}
    splits: dict[str, list[str]] = defaultdict(list)
    for tile in tiles:
        split = tile["split"]
        image_name = f"{tile['tile_id']}.png"
        label_name = f"{tile['tile_id']}.txt"
        link_or_copy(source / tile["image_path"], target / "images" / split / image_name)
        link_or_copy(source / "labels" / label_name, target / "labels" / split / label_name)
        splits[split].append(tile["tile_id"])
    for name in ("snapshot.json", "split.json", "audit.json", "qa_report.json"):
        link_or_copy(source / name, target / "manifests" / name)
    write_json(target / "splits.json", {name: sorted(ids) for name, ids in splits.items()})
    (target / "dataset.yaml").write_text(
        "path: .\ntrain: images/train\nval: images/val\ntest: images/test\n"
        f"nc: {len(classes)}\nnames: {json.dumps({index: name for name, index in indices.items()})}\n"
    )
    write_json(target / "bundle_manifest.json", {
        "snapshot_id": args.snapshot, "tile_count": len(tiles), "splits": {name: len(ids) for name, ids in splits.items()},
        "classes": indices, "content": ["images", "labels", "splits.json", "dataset.yaml", "manifests"],
    })
    print(target)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
