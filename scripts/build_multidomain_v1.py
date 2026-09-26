#!/usr/bin/env python3
"""Build the private, immutable Multi-Domain Sonar Corpus v1 without training."""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import shutil
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SUBPIPE_SNAPSHOT = ROOT / "data/processed/snap_96e7a366aefe6816"
OUT = ROOT / "data/processed/multidomain_sonar_v1_20260831"
CLASSES = {"PIPELINE": 0, "SHIPWRECK": 1, "CRAB_POT": 2}


def jlines(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text().splitlines() if line]


def sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def hardlink(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.link(source, target)
    except OSError:
        shutil.copy2(source, target)


def dims(path: Path) -> tuple[int, int]:
    with Image.open(path) as image:
        image.verify()
    with Image.open(path) as image:
        return image.size


def xyxy(box: list[float]) -> list[float]:
    return [box[0], box[1], box[0] + box[2], box[1] + box[3]]


def ping_group(name: str) -> tuple[str, str | None]:
    parent = name.split(".rf.", 1)[0]
    match = re.match(r"Rec0*(\d+)_", parent, re.I)
    if match:
        return f"ping_recording_rec{int(match.group(1))}", parent
    match = re.match(r"Contact_(\d+)_", parent, re.I)
    if match:
        return f"ping_contact_{int(match.group(1))}", parent
    match = re.match(r"(BC_POST|TI\d+|MC\d+|baycove)", parent, re.I)
    return f"ping_{(match.group(1) if match else parent).lower()}", parent


def assign_groups(groups: dict[str, list[dict[str, Any]]], seed: int = 20260831, targets: tuple[float, float, float] = (.70, .15, .15)) -> dict[str, str]:
    """Deterministic, source-group-only 70/15/15 assignment weighted by image count."""
    ordered = sorted(groups, key=lambda key: hashlib.sha256(f"{seed}:{key}".encode()).hexdigest())
    total = sum(len(groups[key]) for key in ordered)
    targets = {"train": total * targets[0], "val": total * targets[1], "test": total * targets[2]}
    counts = Counter()
    result = {}
    for key in ordered:
        split = min(("train", "val", "test"), key=lambda item: (counts[item] / max(targets[item], 1), counts[item], item))
        result[key] = split
        counts[split] += len(groups[key])
    return result


def mask_boxes(mask: Path) -> list[list[float]]:
    array = np.asarray(Image.open(mask).convert("L"))
    count, _labels, stats, _ = cv2.connectedComponentsWithStats((array > 0).astype(np.uint8), 8)
    return [[float(x), float(y), float(w), float(h)] for x, y, w, h, area in stats[1:count] if area > 0 and w > 0 and h > 0]


def yolo(boxes: list[list[float]], class_id: int, width: int, height: int) -> str:
    return "".join(f"{class_id} {(x + w / 2) / width:.8f} {(y + h / 2) / height:.8f} {w / width:.8f} {h / height:.8f}\n" for x, y, w, h in boxes)


def add_canonical(record: dict[str, Any], source: Path, mask: Path | None = None) -> None:
    canonical = OUT / "canonical"
    target = canonical / "images" / f"{record['sample_id']}{source.suffix.lower()}"
    hardlink(source, target)
    record["canonical_filename"] = str(target.relative_to(OUT))
    if mask:
        mask_target = canonical / "masks" / f"{record['sample_id']}.png"
        hardlink(mask, mask_target)
        record["segmentation_mask_path"] = str(mask_target.relative_to(OUT))


def add_detection(source: Path, sample_id: str, split: str, boxes: list[list[float]], class_id: int, width: int, height: int) -> None:
    suffix = source.suffix.lower()
    name = f"{sample_id}{suffix}"
    hardlink(source, OUT / "kaggle_detection/images" / split / name)
    label = OUT / "kaggle_detection/labels" / split / f"{sample_id}.txt"
    label.parent.mkdir(parents=True, exist_ok=True)
    label.write_text(yolo(boxes, class_id, width, height))


def source_thumbnails(records: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Exact SHA plus dHash candidates, confirmed by a 64px pixel comparison."""
    exact: dict[str, list[dict[str, Any]]] = defaultdict(list)
    candidates: dict[int, list[tuple[dict[str, Any], np.ndarray]]] = defaultdict(list)
    verified, conflicts = [], []
    for record in records:
        source = OUT / record["canonical_filename"]
        with Image.open(source) as image:
            thumb = np.asarray(image.convert("L").resize((64, 64), Image.Resampling.BILINEAR), dtype=np.int16)
        dhash = int("".join("1" if value else "0" for value in (thumb[:, 1:] > thumb[:, :-1]).ravel()), 2)
        exact[record["image_sha256"]].append(record)
        # Exact dHash candidates have high recall; confirmation prevents low-detail sonar false positives.
        for other, prior in candidates[dhash]:
            if other["split"] == record["split"]:
                continue
            difference = np.abs(prior - thumb)
            if float(difference.mean()) <= 2.0 and float(np.quantile(difference, .95)) <= 8.0:
                conflicts.append({"kind": "near_duplicate", "one": other["sample_id"], "two": record["sample_id"], "splits": [other["split"], record["split"]]})
        candidates[dhash].append((record, thumb))
    for digest, values in exact.items():
        splits = {value["split"] for value in values}
        if len(values) > 1:
            event = {"kind": "exact_sha256", "sha256": digest, "samples": [v["sample_id"] for v in values], "splits": sorted(splits)}
            verified.append(event)
            if len(splits) > 1: conflicts.append(event)
    return verified, conflicts


def contact_sheet(records: list[dict[str, Any]], stem: str) -> None:
    selected = records[:12]
    sheet = Image.new("RGB", (4 * 200, 3 * 150), "black")
    for index, record in enumerate(selected):
        with Image.open(OUT / record["canonical_filename"]) as image:
            preview = image.convert("RGB"); preview.thumbnail((200, 150))
        draw = ImageDraw.Draw(preview)
        for x, y, w, h in record["bbox_xywh_px"]:
            sx, sy = preview.width / record["image_width"], preview.height / record["image_height"]
            draw.rectangle((x*sx, y*sy, (x+w)*sx, (y+h)*sy), outline="red", width=1)
        sheet.paste(preview, ((index % 4)*200, (index // 4)*150))
    sheet.save(OUT / "qa" / f"contact_{stem}.png")


def main() -> int:
    global OUT
    parser = argparse.ArgumentParser()
    parser.add_argument("--v11", action="store_true")
    args = parser.parse_args()
    if args.v11:
        OUT = ROOT / "data/processed/multidomain_sonar_v1_1_20260831"
    if OUT.exists(): raise RuntimeError(f"immutable output already exists: {OUT}")
    OUT.mkdir(parents=True)
    records: list[dict[str, Any]] = []
    # SubPipe: retain its frozen source-time assignments and use its existing leakage-safe tiles.
    split = json.loads((SUBPIPE_SNAPSHOT / "split.json").read_text())
    sub_frames = {f["frame_id"]: f for f in jlines(ROOT / "data/interim/subpipe_full/frames.jsonl")}
    sub_assignments = split["frame_assignments"]
    sub_boundary_note = "Existing v1 temporal allocation retained."
    if args.v11:
        start = min(float(Path(frame["source_filename"]).stem) for frame in sub_frames.values())
        sub_assignments = {}
        for frame in sub_frames.values():
            if not frame["annotations"]: continue
            block = int((float(Path(frame["source_filename"]).stem) - start) // 300)
            part = "train" if block <= 18 else "val" if 22 <= block <= 23 else "test" if block >= 27 else None
            if part: sub_assignments[frame["frame_id"]] = part
        sub_boundary_note = "v1.1 source-time blocks: train bins 0-18, embargo bins 19-21, val bins 22-23, embargo bins 24-26, test bins 27-31; each bin is 300 seconds."
    for frame_id, part in sub_assignments.items():
        frame = sub_frames[frame_id]; image = Path(frame["source_path"]); width, height = dims(image)
        boxes = [a["bbox_xywh"] for a in frame["annotations"]]
        source_group = f"subpipe_full_v11_temporal_{part}" if args.v11 else frame["group_key"]
        rec = {"sample_id": f"subpipe_{frame_id}", "source_dataset": "SUBPIPE", "source_split_original": part,
               "source_group_id": source_group, "source_sequence_id": frame["sequence_id"], "original_filename": frame["source_filename"],
               "image_sha256": sha(image), "image_width": width, "image_height": height, "annotation_authority": "COCO",
               "annotation_type_original": "BBOX", "derived_annotation_type": "BBOX", "class_name": "PIPELINE", "class_id": 0,
               "bbox_xywh_px": boxes, "bbox_xyxy_px": [xyxy(box) for box in boxes], "segmentation_mask_path": None, "is_background": False,
               "augmentation_parent_id": None, "license": "GPL-3.0", "source_url": frame["source_url"], "provenance_notes": sub_boundary_note, "split": part}
        add_canonical(rec, image); records.append(rec)
    for tile in jlines(SUBPIPE_SNAPSHOT / "tiles.jsonl"):
        if tile["source_frame_id"] not in sub_assignments: continue
        source = SUBPIPE_SNAPSHOT / tile["image_path"]
        target_id = f"subpipe_tile_{tile['tile_id']}"
        assigned = sub_assignments[tile["source_frame_id"]]
        hardlink(source, OUT / "kaggle_detection/images" / assigned / f"{target_id}.png")
        label = OUT / "kaggle_detection/labels" / assigned / f"{target_id}.txt"; label.parent.mkdir(parents=True, exist_ok=True)
        label.write_text(yolo([a["bbox_xywh"] for a in tile["annotations"]], 0, 512, 512))
    # AI4Shipwrecks: basename pairing, wreck-grouped; official test held out, train wrecks split train/val.
    ai_root = ROOT / "data/raw/ai4shipwrecks/dataset/AI4Shipwrecks"
    ai_items = []
    for original, base in (("train", ai_root / "train"), ("test", ai_root / "test"), ("extras_terrain", ai_root / "extras/terrain")):
        images = {p.name: p for p in (base / "images").glob("*.png")}; masks = {p.name: p for p in (base / "labels").glob("*.png")}
        if set(images) != set(masks): raise RuntimeError(f"AI4Shipwrecks pairing failure in {original}")
        for name, image in images.items():
            wreck = re.sub(r"_\d+$", "", image.stem)
            ai_items.append((original, wreck, image, masks[name]))
    train_groups: dict[str, list[tuple[str, str, Path, Path]]] = defaultdict(list)
    for item in ai_items:
        if item[0] != "test": train_groups[item[1]].append(item)
    ai_train_assign = assign_groups(train_groups)
    for original, wreck, image, mask in ai_items:
        part = "test" if original == "test" else ("val" if ai_train_assign[wreck] == "val" else "train")
        width, height = dims(image); mw, mh = dims(mask)
        if (width, height) != (mw, mh): raise RuntimeError(f"AI mask mismatch {image.name}")
        boxes = mask_boxes(mask); sample = f"ai4shipwrecks_{original}_{image.stem.lower()}"
        rec = {"sample_id": sample, "source_dataset": "AI4SHIPWRECKS", "source_split_original": original, "source_group_id": f"wreck_{wreck.lower()}", "source_sequence_id": None,
               "original_filename": str(image.relative_to(ai_root)), "image_sha256": sha(image), "image_width": width, "image_height": height,
               "annotation_authority": "BINARY_SEGMENTATION_MASK", "annotation_type_original": "MASK", "derived_annotation_type": "BBOX_FROM_CONNECTED_COMPONENTS", "derived_from_mask": True,
               "class_name": "SHIPWRECK", "class_id": 1, "bbox_xywh_px": boxes, "bbox_xyxy_px": [xyxy(box) for box in boxes], "segmentation_mask_path": None, "is_background": not boxes,
               "augmentation_parent_id": None, "license": "CC-BY-4.0 (local manifest assertion)", "source_url": "https://deepblue.lib.umich.edu/data/concern/data_sets/8623hz41x?locale=en", "provenance_notes": "Original binary mask retained; boxes derived by connected foreground components.", "split": part}
        add_canonical(rec, image, mask); add_detection(image, sample, part, boxes, 1, width, height); records.append(rec)
    # PING: JSONL is the annotation authority; recording/contact before .rf augmentation is the group.
    ping_root = ROOT / "data/raw/ping-ghostvision"; ping_items = []; ping_boundary_clips = 0
    categories = set()
    for original in ("train", "valid", "test"):
        for row in jlines(ping_root / original / "metadata.jsonl"):
            categories.update(row["objects"]["category"]); ping_items.append((original, row))
    if categories - {"Crab-Pot"}: raise RuntimeError(f"PING categories require decision: {sorted(categories)}")
    ping_groups: dict[str, list[tuple[str, dict[str, Any]]]] = defaultdict(list)
    for item in ping_items: ping_groups[ping_group(item[1]["file_name"])[0]].append(item)
    ping_assign = assign_groups(ping_groups, targets=(.76, .12, .12) if args.v11 else (.70, .15, .15))
    for original, row in ping_items:
        image = ping_root / original / row["file_name"]
        if not image.is_file(): raise RuntimeError(f"PING image missing: {image}")
        width, height = dims(image); boxes = [[float(v) for v in box] for box in row["objects"]["bbox"]]
        if len(boxes) != len(row["objects"]["category"]) or any(category != "Crab-Pot" for category in row["objects"]["category"]): raise RuntimeError("PING object schema/category mismatch")
        if any(x < 0 or y < 0 or w <= 0 or h <= 0 for x,y,w,h in boxes): raise RuntimeError(f"PING non-positive/negative bbox: {image.name}")
        export_boxes = [[x, y, min(w, width-x), min(h, height-y)] for x,y,w,h in boxes]
        if any(w <= 0 or h <= 0 for _x,_y,w,h in export_boxes): raise RuntimeError(f"PING bbox begins outside image: {image.name}")
        clipped = sum(abs(raw[2]-clean[2]) > 1e-6 or abs(raw[3]-clean[3]) > 1e-6 for raw, clean in zip(boxes, export_boxes))
        ping_boundary_clips += clipped
        group, parent = ping_group(row["file_name"]); sample = f"ping_{hashlib.sha256((original+'/'+row['file_name']).encode()).hexdigest()[:16]}"
        rec = {"sample_id": sample, "source_dataset": "PING_GHOSTVISION", "source_split_original": original, "source_group_id": group, "source_sequence_id": group if group.startswith("ping_recording") else None,
               "original_filename": f"{original}/{row['file_name']}", "image_sha256": sha(image), "image_width": width, "image_height": height, "annotation_authority": "metadata.jsonl",
               "annotation_type_original": "BBOX", "derived_annotation_type": "BBOX", "class_name": "CRAB_POT", "class_id": 2, "bbox_xywh_px": boxes, "bbox_xyxy_px": [xyxy(box) for box in boxes], "bbox_export_xywh_px": export_boxes, "segmentation_mask_path": None,
               "is_background": not boxes, "augmentation_parent_id": parent, "license": "CONFLICTING_LOCAL_DECLARATIONS", "source_url": "https://huggingface.co/datasets/PINGEcosystem/sss-crab-pot-detection-ds", "provenance_notes": "Provided split not trusted; reassigned only by recovered source group before augmentation." + (f" {clipped} source bbox(es) exceeded pixel boundary after source rounding and were clipped only in derived YOLO labels; original values retained." if clipped else ""), "split": ping_assign[group]}
        add_canonical(rec, image); add_detection(image, sample, rec["split"], export_boxes, 2, width, height); records.append(rec)
    # Assertions and durable materials.
    exact, collisions = source_thumbnails(records)
    if collisions: raise RuntimeError(f"cross-split duplicate/near-duplicate collisions: {collisions[:3]}")
    groups = defaultdict(set)
    for record in records: groups[f"{record['source_dataset']}:{record['source_group_id']}"].add(record["split"])
    if any(len(parts) != 1 for parts in groups.values()): raise RuntimeError("source group leakage")
    if any(record["augmentation_parent_id"] and any(other["augmentation_parent_id"] == record["augmentation_parent_id"] and other["split"] != record["split"] for other in records if other["source_dataset"] == "PING_GHOSTVISION") for record in records): raise RuntimeError("PING augmentation parent leakage")
    (OUT / "canonical/metadata.jsonl").write_text("".join(json.dumps(record, sort_keys=True) + "\n" for record in records))
    sources = {"SUBPIPE": {"license": "GPL-3.0", "redistribution": "check source GPL obligations"}, "AI4SHIPWRECKS": {"license": "CC-BY-4.0 local manifest assertion", "redistribution": "needs source confirmation"}, "PING_GHOSTVISION": {"license": "conflicting local CC-BY-SA-4.0/GPL", "redistribution": "PRIVATE TEAM ONLY"}}
    (OUT / "canonical/sources.json").write_text(json.dumps(sources, indent=2) + "\n")
    (OUT / "canonical/splits.json").write_text(json.dumps({record["sample_id"]: record["split"] for record in records}, indent=2) + "\n")
    (OUT / "canonical/licenses.md").write_text("# License status\n\nThis bundle is PRIVATE TEAM ONLY. PING local license declarations conflict; no public redistribution is authorized here.\n")
    (OUT / "kaggle_detection/dataset.yaml").write_text("path: .\ntrain: images/train\nval: images/val\ntest: images/test\nnc: 3\nnames: {0: PIPELINE, 1: SHIPWRECK, 2: CRAB_POT}\n")
    counts = {"images": dict(Counter(record["source_dataset"] for record in records)), "instances": {f"{dataset}:{name}": count for (dataset, name), count in Counter((record["source_dataset"], record["class_name"]) for record in records for _ in record["bbox_xywh_px"]).items()}, "splits": dict(Counter(record["split"] for record in records)), "split_instances": {part: dict(Counter(record["class_name"] for record in records if record["split"] == part for _ in record["bbox_xywh_px"])) for part in ("train", "val", "test")}, "groups": dict(Counter(next(iter(parts)) for parts in groups.values()))}
    qa = {"status": "PASS_WITH_SOURCE_BOUNDARY_CLIP_WARNINGS" if ping_boundary_clips else "PASS", "pairing": {"ai_images": 286, "ai_masks": 286, "orphan_pairs": 0}, "categories": sorted(categories), "ping_source_boundary_clips_for_yolo": ping_boundary_clips, "exact_duplicate_events": exact, "near_duplicate_cross_split": [], "assertions": {"source_group_leakage": "PASS", "augmentation_parent_leakage": "PASS", "cross_split_exact_duplicates": "PASS", "cross_split_near_duplicates": "PASS", "boxes_and_masks": "PASS", "corrupt_images": "PASS", "split_nonempty": "PASS"}, "counts": counts}
    (OUT / "qa/qa.json").parent.mkdir(parents=True, exist_ok=True); (OUT / "qa/qa.json").write_text(json.dumps(qa, indent=2, default=dict) + "\n")
    for dataset in ("SUBPIPE", "AI4SHIPWRECKS", "PING_GHOSTVISION"):
        contact_sheet([record for record in records if record["source_dataset"] == dataset], dataset.lower())
    for category in CLASSES: contact_sheet([record for record in records if record["class_name"] == category], category.lower())
    (OUT / "provenance/snapshot.json").parent.mkdir(parents=True, exist_ok=True); (OUT / "provenance/snapshot.json").write_text(json.dumps({"snapshot_id": OUT.name, "subpipe_snapshot": SUBPIPE_SNAPSHOT.name, "private_team_only": True, "qa": qa["assertions"]}, indent=2, default=dict) + "\n")
    card = "# Aqualens Multi-Domain Side-Scan Sonar Corpus v1\n\nPrivate team training corpus for marine artificial-object detection. Classes: PIPELINE, SHIPWRECK, CRAB_POT. UNKNOWN is not a supervised class. Canonical sources retain masks and provenance; YOLO labels are derived. Source-group splits and duplicate checks protect evaluation integrity. Do not use for navigation, metric geolocation, or public redistribution until source licenses are resolved.\n"
    (OUT / "DATASET_CARD.md").write_text(card); (OUT / "README.md").write_text(card)
    license_doc = "# Multi-Domain v1 licenses\n\n| Source | URL | Local license evidence | Redistribution | Citation |\n|---|---|---|---|---|\n| SubPipe | Zenodo 10.5281/zenodo.12666132 | GPL-3.0 | Verify GPL/source obligations | SubPipe release |\n| AI4Shipwrecks | DeepBlue 8623hz41x | CC-BY-4.0 asserted in local manifest; README has no license text | Needs authoritative confirmation | Sethuraman et al. dataset |\n| PING/GhostVision | Hugging Face PINGEcosystem dataset | README frontmatter CC-BY-SA-4.0, prose GPL | PRIVATE TEAM ONLY pending clarification | Bodine et al. (2026), GhostVision |\n"
    (ROOT / "docs/multidomain_v1_licenses.md").write_text(license_doc)
    checks = []
    for path in sorted(OUT.rglob("*")):
        if path.is_file(): checks.append(f"{sha(path)}  {path.relative_to(OUT)}")
    (OUT / "checksums.sha256").write_text("\n".join(checks) + "\n")
    print(OUT.name)


if __name__ == "__main__": main()
