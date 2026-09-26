#!/usr/bin/env python3
"""Machine and visual QA for a real prepared snapshot; failures are fatal."""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages"))
from sagar.io.common import write_json
from sagar.io.canonical import load_frames


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("snapshot")
    args = parser.parse_args()
    destination = ROOT / "data/processed" / args.snapshot
    tiles = [json.loads(line) for line in (destination / "tiles.jsonl").read_text().splitlines() if line]
    split = json.loads((destination / "split.json").read_text())
    snapshot = json.loads((destination / "snapshot.json").read_text())
    errors: list[str] = []
    empty = 0
    classes = Counter()
    dimensions = Counter()
    source_frames = []
    for source in snapshot["source_datasets"]:
        dataset_id = source.get("dataset_id")
        frames_path = ROOT / "data/interim" / str(dataset_id) / "frames.jsonl"
        if frames_path.exists():
            source_frames.extend(load_frames(frames_path))
    source_checked = 0
    source_annotations = 0
    for frame in source_frames:
        try:
            with Image.open(frame["source_path"]) as image:
                image.verify()
        except Exception as exc:
            errors.append(f"corrupt source frame {frame['frame_id']}: {exc}")
            continue
        source_checked += 1
        for annotation in frame["annotations"]:
            x, y, width, height = annotation["bbox_xywh"]
            epsilon = 1e-6
            if width <= 0 or height <= 0 or x < -epsilon or y < -epsilon or x + width > frame["width_px"] + epsilon or y + height > frame["height_px"] + epsilon:
                errors.append(f"invalid source annotation: {frame['frame_id']}:{annotation['annotation_id']}")
            if annotation["source_geometry"].get("format") != "COCO":
                errors.append(f"unexpected Mini2 source annotation format: {annotation['annotation_id']}")
            source_annotations += 1
    for tile in tiles:
        path = destination / tile["image_path"]
        try:
            with Image.open(path) as image:
                image.verify()
            with Image.open(path) as image:
                dimensions[image.size] += 1
                if image.size != (512, 512):
                    errors.append(f"tile dimensions invalid: {tile['tile_id']}")
        except Exception as exc:
            errors.append(f"corrupt tile {tile['tile_id']}: {exc}")
            continue
        label_path = destination / "labels" / f"{tile['tile_id']}.txt"
        if not label_path.exists():
            errors.append(f"missing label file: {tile['tile_id']}")
        if not tile["annotations"]:
            empty += 1
        for annotation in tile["annotations"]:
            x, y, width, height = annotation["bbox_xywh"]
            if width <= 0 or height <= 0 or x < 0 or y < 0 or x + width > 512 or y + height > 512:
                errors.append(f"invalid clipped box: {tile['tile_id']}:{annotation['annotation_id']}")
            classes[annotation["category"]] += 1
        if split["frame_assignments"].get(tile["source_frame_id"]) != tile["split"]:
            errors.append(f"split inheritance violation: {tile['tile_id']}")
    # Contact sheet is evidence, not a product asset.
    selected = [tile for tile in tiles if tile["annotations"]][:12]
    sheet = Image.new("RGB", (4 * 256, 3 * 256), "black")
    for index, tile in enumerate(selected):
        with Image.open(destination / tile["image_path"]) as image:
            preview = image.convert("RGB").resize((256, 256))
        draw = ImageDraw.Draw(preview)
        for annotation in tile["annotations"]:
            x, y, width, height = annotation["bbox_xywh"]
            draw.rectangle((x / 2, y / 2, (x + width) / 2, (y + height) / 2), outline="red", width=2)
        sheet.paste(preview, ((index % 4) * 256, (index // 4) * 256))
    sheet.save(destination / "qa_contact_sheet.png")
    report = {
        "snapshot_id": args.snapshot, "status": "PASS" if not errors else "FAIL", "errors": errors,
        "source_frames_checked": source_checked, "source_annotations_checked": source_annotations,
        "tile_count": len(tiles), "empty_tiles": empty, "empty_tile_fraction": empty / len(tiles),
        "tile_dimensions": {f"{width}x{height}": count for (width, height), count in dimensions.items()},
        "class_distribution": dict(classes), "split_distribution": dict(Counter(tile["split"] for tile in tiles)),
        "image_label_alignment": "PASS" if not errors else "FAIL", "contact_sheet": "qa_contact_sheet.png",
    }
    write_json(destination / "qa_report.json", report)
    print(json.dumps(report, indent=2))
    if errors:
        raise RuntimeError(f"snapshot QA failed with {len(errors)} errors")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
