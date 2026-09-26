"""Deterministic source-frame tiling. Splits are input, never invented here."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterable

import numpy as np
from PIL import Image

from .common import write_jsonl

TILE_SIZE = 512
OVERLAP = 0.5
STRIDE = int(TILE_SIZE * (1 - OVERLAP))
MIN_CLIPPED_BOX_FRACTION = 0.25


def origins(length: int, tile_size: int = TILE_SIZE, stride: int = STRIDE) -> list[int]:
    if length <= tile_size:
        return [0]
    # Include the partial edge by advancing on the regular deterministic grid, then pad it.
    return list(range(0, length, stride))


def clip_box(box: list[float] | tuple[float, float, float, float], x: int, y: int,
             width: int, height: int) -> tuple[float, float, float, float] | None:
    bx, by, bw, bh = box
    left, top = max(bx, x), max(by, y)
    right, bottom = min(bx + bw, x + width), min(by + bh, y + height)
    if right <= left or bottom <= top:
        return None
    clipped = (left - x, top - y, right - left, bottom - top)
    if clipped[2] * clipped[3] / (bw * bh) < MIN_CLIPPED_BOX_FRACTION:
        return None
    return clipped


def _load(frame: dict[str, Any]) -> np.ndarray:
    with Image.open(frame["source_path"]) as image:
        return np.asarray(image.convert("L"))


def build_tiles(frames: Iterable[dict[str, Any]], split_by_frame: dict[str, str], output: str | Path,
                tile_size: int = TILE_SIZE, overlap: float = OVERLAP) -> list[dict[str, Any]]:
    if tile_size != 512 or overlap != 0.5:
        raise ValueError("Stage 2 tiling is frozen at 512x512 with 50% overlap")
    output = Path(output)
    tiles: list[dict[str, Any]] = []
    for frame in frames:
        if frame["frame_id"] not in split_by_frame:
            raise ValueError(f"frame lacks precomputed split: {frame['frame_id']}")
        pixels = _load(frame)
        height, width = pixels.shape
        for y in origins(height):
            for x in origins(width):
                crop = pixels[y:min(y + tile_size, height), x:min(x + tile_size, width)]
                padded_bottom, padded_right = tile_size - crop.shape[0], tile_size - crop.shape[1]
                if padded_bottom or padded_right:
                    crop = np.pad(crop, ((0, padded_bottom), (0, padded_right)), constant_values=0)
                tile_id = f"{frame['frame_id']}_x{x:05d}_y{y:05d}"
                tile_path = output / "tiles" / f"{tile_id}.png"
                tile_path.parent.mkdir(parents=True, exist_ok=True)
                Image.fromarray(crop).save(tile_path)
                labels: list[dict[str, Any]] = []
                for annotation in frame.get("annotations", []):
                    clipped = clip_box(annotation["bbox_xywh"], x, y, tile_size, tile_size)
                    if clipped is None:
                        continue
                    labels.append({
                        "annotation_id": annotation["annotation_id"], "source_annotation_id": annotation["source_annotation_id"],
                        "category": annotation["category"], "label_certainty": annotation["label_certainty"],
                        "bbox_xywh": list(clipped),
                        "transformation_lineage": annotation.get("transformation_lineage", []) + [{
                            "operation": "tile_clip", "parameters": {"origin_px": [x, y], "retained_fraction_min": MIN_CLIPPED_BOX_FRACTION},
                        }],
                    })
                record = {
                    "tile_id": tile_id, "source_frame_id": frame["frame_id"], "dataset_id": frame["dataset_id"],
                    "group_key": frame["group_key"], "site_id": frame.get("site_id"), "split": split_by_frame[frame["frame_id"]],
                    "x_origin_px": x, "y_origin_px": y, "width_px": tile_size, "height_px": tile_size,
                    "source_width_px": width, "source_height_px": height, "padded_right_px": padded_right,
                    "padded_bottom_px": padded_bottom, "image_path": f"tiles/{tile_id}.png", "annotations": labels,
                    "pics_transform": {"tile_to_source_offset_px": [x, y], "geometry": frame["geometry"],
                                        "range_unit_when_uncalibrated": "PIXEL_RANGE"},
                }
                tiles.append(record)
    write_jsonl(output / "tiles.jsonl", iter(tiles))
    return tiles


def write_yolo_labels(tiles: Iterable[dict[str, Any]], output: str | Path, class_indices: dict[str, int]) -> None:
    labels_dir = Path(output) / "labels"
    labels_dir.mkdir(parents=True, exist_ok=True)
    for tile in tiles:
        rows = []
        for annotation in tile["annotations"]:
            category = annotation["category"]
            if category not in class_indices:
                continue
            x, y, width, height = annotation["bbox_xywh"]
            rows.append(f"{class_indices[category]} {(x + width / 2) / TILE_SIZE:.8f} {(y + height / 2) / TILE_SIZE:.8f} {width / TILE_SIZE:.8f} {height / TILE_SIZE:.8f}")
        (labels_dir / f"{tile['tile_id']}.txt").write_text("\n".join(rows) + ("\n" if rows else ""))
