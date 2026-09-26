#!/usr/bin/env python3
"""Build the native-mask AI4Shipwrecks S1 train/validation dataset only."""
from __future__ import annotations

import hashlib
import json
import os
import zipfile
from collections import defaultdict
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data/raw/ai4shipwrecks/dataset/AI4Shipwrecks"
V12_TRAINVAL = ROOT / "data/processed/multidomain_sonar_v1_2_shipwreck_recovery_20260901/canonical/metadata_trainval.jsonl"
OUT = ROOT / "data/processed/ai4shipwrecks_s1"
ZIP = ROOT / "data/processed/ai4shipwrecks_s1_kaggle.zip"


def sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def link(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists():
        raise RuntimeError(f"refusing to overwrite existing file: {dst}")
    os.link(src, dst)


def main() -> None:
    if OUT.exists() or ZIP.exists():
        raise RuntimeError("refusing to overwrite an existing S1 dataset or ZIP")
    rows = [json.loads(line) for line in V12_TRAINVAL.read_text().splitlines() if line]
    rows = [r for r in rows if r["source_dataset"] == "AI4SHIPWRECKS"]
    assert {r["split"] for r in rows} == {"train", "val"}
    assert sum(r["split"] == "train" for r in rows) == 140
    assert sum(r["split"] == "val" for r in rows) == 26
    groups = defaultdict(set)
    for r in rows: groups[r["source_group_id"]].add(r["split"])
    assert all(len(s) == 1 for s in groups.values())
    manifest = []
    for r in sorted(rows, key=lambda x: (x["split"], x["original_filename"])):
        image = RAW / r["original_filename"]
        mask = image.parent.parent / "labels" / image.name
        if not image.is_file() or not mask.is_file():
            raise FileNotFoundError(f"missing raw pair for {r['sample_id']}")
        # Native source names, not v1.2 sample IDs or repeated-sampling names.
        if image.name != mask.name: raise AssertionError("basename mismatch")
        link(image, OUT / r["split"] / "images" / image.name)
        link(mask, OUT / r["split"] / "masks" / mask.name)
        manifest.append({"split": r["split"], "basename": image.name, "source_sample_id": r["sample_id"], "source_dataset": r["source_dataset"], "source_group_id": r["source_group_id"], "source_image_path": str(image.relative_to(ROOT)), "source_mask_path": str(mask.relative_to(ROOT)), "image_sha256": sha(image), "mask_sha256": sha(mask)})
    qa = {"status": "PASS", "source_assignment": str(V12_TRAINVAL.relative_to(ROOT)), "raw_source_root": str(RAW.relative_to(ROOT)), "splits": {}, "checks": {"no_test_data_accessed_or_materialized": "PASS", "no_shiprepeat_entries": "PASS", "native_masks_unmodified_hardlinked": "PASS", "train_val_source_group_overlap": "PASS"}}
    for split, expected in (("train", 140), ("val", 26)):
        images = {p.name: p for p in (OUT / split / "images").iterdir()}
        masks = {p.name: p for p in (OUT / split / "masks").iterdir()}
        assert len(images) == len(masks) == expected and set(images) == set(masks)
        for name in images:
            with Image.open(images[name]) as im:
                image_size = im.size; im.verify()
            with Image.open(masks[name]) as ma:
                mask_size = ma.size; ma.verify()
            if image_size != mask_size: raise AssertionError(f"dimension mismatch: {name}")
        qa["splits"][split] = {"pairs": expected, "matching_basenames": "PASS", "dimensions_match": "PASS", "pillow_verified": "PASS"}
    (OUT / "manifest.jsonl").write_text("".join(json.dumps(x, sort_keys=True)+"\n" for x in manifest))
    (OUT / "qa.json").write_text(json.dumps(qa, indent=2)+"\n")
    (OUT / "README.md").write_text("# AI4Shipwrecks S1 native-mask segmentation\n\nTrain/validation-only native image and binary-mask pairs. Split assignment is inherited exactly from Aqualens v1.2. No boxes, repeated sampling entries, or held-out test data are included.\n")
    with zipfile.ZipFile(ZIP, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as z:
        for path in sorted(p for p in OUT.rglob("*") if p.is_file()):
            z.write(path, str(Path("ai4shipwrecks_s1") / path.relative_to(OUT)))
    print(json.dumps({"dataset": str(OUT), "zip": str(ZIP), "zip_size": ZIP.stat().st_size, "zip_sha256": sha(ZIP), "qa": qa}, indent=2))


if __name__ == "__main__": main()
