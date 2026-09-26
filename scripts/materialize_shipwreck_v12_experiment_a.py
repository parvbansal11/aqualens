#!/usr/bin/env python3
"""Materialize the approved v1.2 snapshot and Kaggle Experiment-A package.

This is a data-construction operation only. Test mask handling is mechanical:
the approved >=256px rule is applied without inference, metrics, or visual review.
"""
from __future__ import annotations

import csv
import hashlib
import json
import os
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
V11 = ROOT / "data/processed/multidomain_sonar_v1_1_20260831"
OUT = ROOT / "data/processed/multidomain_sonar_v1_2_shipwreck_recovery_20260901"
MIN_AREA = 256


def sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def hardlink(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists():
        if sha(src) != sha(dst):
            raise RuntimeError(f"refusing to overwrite differing file: {dst}")
        return
    os.link(src, dst)


def mask_boxes(record: dict) -> list[list[int]]:
    """Approved deterministic correction; does not inspect imagery or model output."""
    array = np.asarray(Image.open(V11 / record["segmentation_mask_path"]).convert("L")) > 0
    count, _labels, stats, _ = cv2.connectedComponentsWithStats(array.astype(np.uint8), 8)
    return [[int(x), int(y), int(w), int(h)] for x, y, w, h, area in stats[1:count] if area >= MIN_AREA and w > 0 and h > 0]


def yolo(boxes: list[list[int]], width: int, height: int) -> str:
    return "".join(f"1 {(x+w/2)/width:.8f} {(y+h/2)/height:.8f} {w/width:.8f} {h/height:.8f}\n" for x, y, w, h in boxes)


def write_text_once(path: Path, content: str) -> None:
    if path.exists():
        if path.read_text() != content:
            raise RuntimeError(f"refusing to overwrite differing file: {path}")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)


def source_records() -> list[dict]:
    return [json.loads(line) for line in (V11 / "canonical/metadata.jsonl").read_text().splitlines() if line]


def build_snapshot(records: list[dict]) -> tuple[dict[str, list[list[int]]], list[dict]]:
    if not OUT.exists():
        raise RuntimeError(f"expected approved candidate directory: {OUT}")
    boxes = {}
    updated = []
    for r in records:
        image = V11 / r["canonical_filename"]
        hardlink(image, OUT / r["canonical_filename"])
        if r["source_dataset"] == "AI4SHIPWRECKS":
            hardlink(V11 / r["segmentation_mask_path"], OUT / r["segmentation_mask_path"])
            boxes[r["sample_id"]] = mask_boxes(r)
            r = {**r, "bbox_xywh_px": boxes[r["sample_id"]], "bbox_xyxy_px": [[x, y, x+w, y+h] for x, y, w, h in boxes[r["sample_id"]]],
                 "derived_annotation_type": "BBOX_FROM_CONNECTED_COMPONENTS_AREA_GE_256", "is_background": not boxes[r["sample_id"]],
                 "provenance_notes": "v1.2 approved deterministic correction: 8-connected mask components with area >=256 source-mask pixels; no component merging."}
        updated.append(r)
    write_text_once(OUT / "canonical/metadata.jsonl", "".join(json.dumps(r, sort_keys=True)+"\n" for r in updated))
    write_text_once(OUT / "canonical/splits.json", json.dumps({r["sample_id"]: r["split"] for r in updated}, indent=2)+"\n")
    for name in ("sources.json", "licenses.md"):
        hardlink(V11 / "canonical" / name, OUT / "canonical" / name)
    # Main Kaggle representation includes all inherited splits. No model is invoked.
    for r in updated:
        split = r["split"]; src_img = V11 / "kaggle_detection/images" / split / Path(r["canonical_filename"]).name
        source_label = V11 / "kaggle_detection/labels" / split / f"{r['sample_id']}.txt"
        # Full SubPipe frames are canonical evidence records; only their tiles
        # belong to the detection export and are added in the fallback loop.
        if not source_label.exists() and r["source_dataset"] != "AI4SHIPWRECKS":
            stale = OUT / "kaggle_detection/images" / split / Path(r["canonical_filename"]).name
            # A previous interrupted materialization may have created this
            # non-export frame link. It is an explicitly identified orphan,
            # never a source file or approved detection sample.
            if stale.exists(): stale.unlink()
            continue
        if not src_img.exists():
            # Canonical images preserve the exact basename used in detection exports.
            src_img = V11 / r["canonical_filename"]
        target_img = OUT / "kaggle_detection/images" / split / src_img.name
        hardlink(src_img, target_img)
        label = OUT / "kaggle_detection/labels" / split / f"{r['sample_id']}.txt"
        if r["source_dataset"] == "AI4SHIPWRECKS":
            write_text_once(label, yolo(boxes[r["sample_id"]], r["image_width"], r["image_height"]))
        else:
            hardlink(source_label, label)
    # Add source-derived tile records not represented in canonical metadata without touching their labels.
    known = {r["sample_id"] for r in updated}
    for split in ("train", "val", "test"):
        for src_img in (V11 / "kaggle_detection/images" / split).iterdir():
            if src_img.stem in known: continue
            hardlink(src_img, OUT / "kaggle_detection/images" / split / src_img.name)
            hardlink(V11 / "kaggle_detection/labels" / split / f"{src_img.stem}.txt", OUT / "kaggle_detection/labels" / split / f"{src_img.stem}.txt")
    write_text_once(OUT / "kaggle_detection/dataset.yaml", "path: .\ntrain: images/train\nval: images/val\ntest: images/test\nnc: 3\nnames: {0: PIPELINE, 1: SHIPWRECK, 2: CRAB_POT}\n")
    return boxes, updated


def build_experiment_a(records: list[dict], boxes: dict[str, list[list[int]]]) -> list[dict]:
    base = OUT / "kaggle_detection_3x"
    for split in ("train", "val"):
        for src in (OUT / "kaggle_detection/images" / split).iterdir():
            source_label = OUT / "kaggle_detection/labels" / split / f"{src.stem}.txt"
            if not source_label.exists():
                stale = base / "images" / split / src.name
                if stale.exists(): stale.unlink()
                continue
            hardlink(src, base / "images" / split / src.name)
            hardlink(source_label, base / "labels" / split / f"{src.stem}.txt")
    entries = []
    for r in records:
        if r["split"] != "train" or r["source_dataset"] != "AI4SHIPWRECKS" or not boxes[r["sample_id"]]:
            continue
        src_img = OUT / "kaggle_detection/images/train" / f"{r['sample_id']}{Path(r['canonical_filename']).suffix}"
        src_lab = OUT / "kaggle_detection/labels/train" / f"{r['sample_id']}.txt"
        for repeat_index in range(3):
            suffix = "" if repeat_index == 0 else f"__shiprepeat_{repeat_index:02d}"
            name = f"{r['sample_id']}{suffix}{src_img.suffix}"
            if repeat_index:
                hardlink(src_img, base / "images/train" / name)
                hardlink(src_lab, base / "labels/train" / f"{Path(name).stem}.txt")
            entries.append({"entry_filename": name, "source_sample_id": r["sample_id"], "source_dataset": r["source_dataset"], "source_group_id": r["source_group_id"], "augmentation_parent_id": r["augmentation_parent_id"], "repeat_index": repeat_index, "repeat_factor": 3})
    write_text_once(base / "dataset.yaml", "path: .\ntrain: images/train\nval: images/val\nnc: 3\nnames: {0: PIPELINE, 1: SHIPWRECK, 2: CRAB_POT}\n")
    write_text_once(OUT / "sampling/experiment_a_shipwreck_3x_entries.jsonl", "".join(json.dumps(x, sort_keys=True)+"\n" for x in entries))
    config = {"experiment": "A", "model": "YOLO11s", "imgsz": 640, "shipwreck_sampling": "3x", "augment": False, "seed": 26057, "selection_split": "validation", "runtime_requirement": "Verify training logs show Albumentations defaults are inactive; augment=False must prevent v8_transforms selection."}
    write_text_once(OUT / "sampling/experiment_A.yaml", "experiment: A\nmodel: YOLO11s\nimgsz: 640\nshipwreck_sampling: 3x\naugment: false\nseed: 26057\nselection_split: validation\nruntime_requirement: Verify logs show Albumentations defaults are inactive.\n")
    return entries


def qa(records: list[dict], boxes: dict[str, list[list[int]]], entries: list[dict]) -> dict:
    report = {"status": "PASS", "checks": {}, "counts": {}}
    source_label_sha = {}
    for split in ("train", "val", "test"):
        images = {p.stem: p for p in (OUT / "kaggle_detection/images" / split).iterdir()}
        labels = {p.stem: p for p in (OUT / "kaggle_detection/labels" / split).iterdir()}
        if set(images) != set(labels): raise AssertionError(f"orphan image/label in {split}")
        for stem, image in images.items():
            with Image.open(image) as im: im.verify()
            for line in labels[stem].read_text().splitlines():
                c, x, y, w, h = line.split(); c = int(c); x,y,w,h = map(float,(x,y,w,h))
                assert c in (0,1,2) and 0 <= x <= 1 and 0 <= y <= 1 and 0 < w <= 1 and 0 < h <= 1 and x-w/2 >= -1e-7 and y-h/2 >= -1e-7 and x+w/2 <= 1+1e-7 and y+h/2 <= 1+1e-7
        report["counts"][split] = {"images": len(images), "labels": len(labels)}
    # Non-shipwreck labels must be byte-equivalent to v1.1.
    unchanged = 0
    for r in records:
        if r["source_dataset"] == "AI4SHIPWRECKS": continue
        p = OUT / "kaggle_detection/labels" / r["split"] / f"{r['sample_id']}.txt"
        q = V11 / "kaggle_detection/labels" / r["split"] / p.name
        if not q.exists():
            continue
        assert sha(p) == sha(q); unchanged += 1
    groups = defaultdict(set)
    for r in records: groups[(r["source_dataset"], r["source_group_id"])].add(r["split"])
    assert all(len(v) == 1 for v in groups.values())
    assert all("__shiprepeat_" not in p.name for p in (OUT / "kaggle_detection_3x/images/val").iterdir())
    assert all(e["repeat_factor"] == 3 and e["repeat_index"] in (0,1,2) for e in entries)
    report["checks"] = {"image_label_bijection": "PASS", "yolo_normalized_in_bounds": "PASS", "class_ids_0_1_2_only": "PASS", "all_images_pillow_verified": "PASS", "group_integrity": "PASS", "validation_no_repeats": "PASS", "pipeline_crabpot_byte_equivalent_records": unchanged, "test_handling": "mechanical label derivation only; no inference, metrics, or qualitative inspection"}
    return report


def counts(root: Path) -> dict:
    result = {}
    for split in ("train", "val"):
        labels = list((root / "labels" / split).glob("*.txt")); instances = Counter(); positive = set(); bg = 0
        for f in labels:
            rows = [x.split() for x in f.read_text().splitlines() if x]
            if not rows: bg += 1
            for row in rows: instances[int(row[0])] += 1; positive.add(f.stem)
        result[split] = {"images": len(labels), "positive_images": len(labels)-bg, "background_images": bg, "PIPELINE_instances": instances[0], "SHIPWRECK_instances": instances[1], "CRAB_POT_instances": instances[2]}
    return result


def package() -> tuple[Path, int, str]:
    zip_path = OUT / "sagardrishti_v1_2_experiment_A_kaggle.zip"
    if zip_path.exists(): raise RuntimeError(f"refusing to overwrite existing ZIP: {zip_path}")
    include = [OUT / "kaggle_detection_3x", OUT / "sampling"]
    readme = "# Aqualens v1.2 Experiment A\n\nYOLO11s, imgsz=640, train-only 3x SHIPWRECK exposure, augment=false, validation selection. Repeated shipwreck filenames are sampling entries, not independent observations. Verify runtime logs show no Albumentations defaults.\n"
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as z:
        z.writestr("sagardrishti_v1_2_experiment_A/README.md", readme)
        for top in include:
            for f in sorted(p for p in top.rglob("*") if p.is_file()):
                z.write(f, "sagardrishti_v1_2_experiment_A/" + str(f.relative_to(OUT)))
    return zip_path, zip_path.stat().st_size, sha(zip_path)


def main() -> None:
    records = source_records()
    boxes, updated = build_snapshot(records)
    entries = build_experiment_a(updated, boxes)
    report = qa(updated, boxes, entries)
    c = {"original": counts(OUT / "kaggle_detection"), "experiment_a_3x": counts(OUT / "kaggle_detection_3x"), "shipwreck_components_removed_train": sum(len(r["bbox_xywh_px"]) - len(boxes[r["sample_id"]]) for r in records if r["source_dataset"] == "AI4SHIPWRECKS" and r["split"] == "train"), "shipwreck_components_removed_val": sum(len(r["bbox_xywh_px"]) - len(boxes[r["sample_id"]]) for r in records if r["source_dataset"] == "AI4SHIPWRECKS" and r["split"] == "val"), "original_shipwreck_positive_train_images": sum(r["source_dataset"] == "AI4SHIPWRECKS" and r["split"] == "train" and bool(boxes[r["sample_id"]]) for r in records), "effective_shipwreck_train_entries_3x": len(entries)}
    report["counts"] = c
    write_text_once(OUT / "qa/qa.json", json.dumps(report, indent=2)+"\n")
    write_text_once(OUT / "README.md", "# Aqualens v1.2 shipwreck recovery\n\nImmutable approved recovery snapshot. SHIPWRECK labels use 8-connected source-mask components of area >=256 pixels; no semantic merging. Test labels were mechanically regenerated under that pre-approved rule only—no inference, metrics, or qualitative test inspection occurred. Experiment A is `kaggle_detection_3x/`: YOLO11s, 640px, train-only 3x SHIPWRECK exposure, `augment: false`, seed 26057, validation selection.\n")
    write_text_once(OUT / "DATASET_CARD.md", "# Dataset card: Aqualens v1.2 Experiment A\n\nParent: multidomain_sonar_v1_1_20260831. Split source groups are unchanged. PIPELINE and CRAB_POT labels are byte-equivalent to v1.1. SHIPWRECK mask-to-box correction removes components under 256 source-mask pixels, without merging. Repeated 3x entries are documented in `sampling/experiment_a_shipwreck_3x_entries.jsonl` and are not independent observations. UNKNOWN is unsupervised and absent.\n")
    checksum_paths = [p for p in sorted(OUT.rglob("*")) if p.is_file() and p.name not in {"checksums.sha256", "sagardrishti_v1_2_experiment_A_kaggle.zip"}]
    write_text_once(OUT / "checksums.sha256", "".join(f"{sha(p)}  {p.relative_to(OUT)}\n" for p in checksum_paths))
    z, size, digest = package()
    print(json.dumps({"counts": c, "zip": str(z), "zip_size": size, "zip_sha256": digest}, indent=2))

if __name__ == "__main__": main()
