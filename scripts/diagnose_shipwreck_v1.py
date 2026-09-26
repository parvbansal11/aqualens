#!/usr/bin/env python3
"""Train/validation-only forensic audit and conservative v1.2 shipwreck recovery.

This program deliberately never opens a test image, mask, or label.  The v1.2
candidate is a train/validation training bundle; its manifest explicitly keeps
the sealed v1.1 test split external to the candidate.
"""
from __future__ import annotations

import csv
import hashlib
import json
import os
import shutil
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
V11 = ROOT / "data/processed/multidomain_sonar_v1_1_20260831"
ART = ROOT / "ml/artifacts/shipwreck_diagnosis_v1"
MIN_COMPONENT_AREA = 256  # conservative: removes visibly isolated mask speckle only
Q = ("min", "p10", "p25", "median", "p75", "p90", "max")


def sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def rows() -> list[dict]:
    # Metadata is used only to locate train/val samples.  Test media and labels
    # are never opened by this script.
    return [json.loads(x) for x in (V11 / "canonical/metadata.jsonl").read_text().splitlines() if json.loads(x)["split"] in {"train", "val"}]


def summary(values: list[float]) -> dict[str, float | None]:
    if not values:
        return {k: None for k in Q}
    a = np.asarray(values, dtype=float)
    return dict(zip(Q, [float(np.min(a)), *[float(np.quantile(a, p)) for p in (.10, .25, .50, .75, .90)], float(np.max(a))]))


def component_rows(record: dict) -> list[dict]:
    mask = np.asarray(Image.open(V11 / record["segmentation_mask_path"]).convert("L")) > 0
    n, _labels, stats, _centroids = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    result = []
    for ordinal, (x, y, w, h, area) in enumerate(stats[1:n], 1):
        if not area:
            continue
        image_area = record["image_width"] * record["image_height"]
        result.append({"sample_id": record["sample_id"], "split": record["split"], "group_id": record["source_group_id"], "ordinal": ordinal,
                       "x": int(x), "y": int(y), "width": int(w), "height": int(h), "component_area": int(area),
                       "bbox_area": int(w * h), "fill_ratio": float(area / (w * h)), "component_image_fraction": float(area / image_area),
                       "bbox_image_fraction": float((w * h) / image_area), "kept_v12": bool(area >= MIN_COMPONENT_AREA)})
    # nearest component-edge distance gives an interpretable fragmentation measure.
    for a in result:
        distances = []
        for b in result:
            if a is b: continue
            dx = max(b["x"] - (a["x"] + a["width"]), a["x"] - (b["x"] + b["width"]), 0)
            dy = max(b["y"] - (a["y"] + a["height"]), a["y"] - (b["y"] + b["height"]), 0)
            distances.append(float(np.hypot(dx, dy)))
        a["nearest_component_distance_px"] = min(distances) if distances else None
    return result


def sheet(name: str, selected: list[dict], components: dict[str, list[dict]]) -> None:
    out = ART / "contact_sheets"; out.mkdir(parents=True, exist_ok=True)
    # 5 rows/page, three 300x220 panels per sample: image, mask, boxes.
    for page_start in range(0, len(selected), 5):
        page = selected[page_start:page_start + 5]
        canvas = Image.new("RGB", (900, 5 * 245), "black")
        for i, r in enumerate(page):
            im = Image.open(V11 / r["canonical_filename"]).convert("RGB")
            ma = Image.open(V11 / r["segmentation_mask_path"]).convert("L").convert("RGB")
            boxed = im.copy(); d = ImageDraw.Draw(boxed)
            for c in components[r["sample_id"]]:
                d.rectangle((c["x"], c["y"], c["x"] + c["width"], c["y"] + c["height"]), outline="red", width=max(1, min(im.size)//400))
            panels = [im, ma, boxed]
            for j, panel in enumerate(panels):
                panel.thumbnail((300, 220))
                x = j * 300 + (300-panel.width)//2; y = i*245 + 22
                canvas.paste(panel, (x, y))
            ImageDraw.Draw(canvas).text((3, i*245+3), f"{r['sample_id']} | components={len(components[r['sample_id']])}", fill="white")
        canvas.save(out / f"{name}_{page_start//5+1:02d}.png")


def image_features(record: dict, comps: list[dict]) -> dict:
    im = np.asarray(Image.open(V11 / record["canonical_filename"]).convert("L"), dtype=np.uint8)
    mask = np.asarray(Image.open(V11 / record["segmentation_mask_path"]).convert("L")) > 0
    edges = cv2.Canny(im, 50, 150) > 0
    hist = np.bincount(im.ravel(), minlength=256) / im.size
    entropy = -float(np.sum(hist[hist > 0] * np.log2(hist[hist > 0])))
    return {"mean_intensity": float(im.mean()), "std_intensity": float(im.std()), "p05": float(np.quantile(im,.05)), "p50": float(np.quantile(im,.5)), "p95": float(np.quantile(im,.95)),
            "contrast_p95_p05": float(np.quantile(im,.95)-np.quantile(im,.05)), "entropy": entropy, "edge_density": float(edges.mean()), "mask_fraction": float(mask.mean()),
            "bbox_area_median": float(np.median([c["bbox_image_fraction"] for c in comps])) if comps else 0.0,
            "bbox_aspect_median": float(np.median([c["width"]/c["height"] for c in comps])) if comps else 0.0, "objects": len(comps), "image_width": record["image_width"], "image_height": record["image_height"]}


def letterbox(box: dict, record: dict, imgsz: int) -> tuple[float, float, float]:
    # Ultralytics LetterBox(auto=False, scaleup=True): r=min(imgsz/h, imgsz/w), symmetric pad; dimensions scale by r.
    r = min(imgsz / record["image_width"], imgsz / record["image_height"])
    w, h = box["width"] * r, box["height"] * r
    return w, h, w*h


def build_candidate(records: list[dict], comps: dict[str, list[dict]]) -> Path:
    out = ROOT / f"data/processed/multidomain_sonar_v1_2_shipwreck_recovery_{date.today():%Y%m%d}"
    if out.exists():
        # Re-running the diagnosis must never rewrite an immutable candidate.
        if (out / "provenance.json").is_file():
            return out
        raise RuntimeError(f"refusing to use incomplete existing candidate: {out}")
    (out / "kaggle_detection/images/train").mkdir(parents=True)
    (out / "kaggle_detection/images/val").mkdir(parents=True)
    (out / "kaggle_detection/labels/train").mkdir(parents=True)
    (out / "kaggle_detection/labels/val").mkdir(parents=True)
    trainval = []
    for r in records:
        src = V11 / r["canonical_filename"]; suffix = src.suffix
        target = out / "kaggle_detection/images" / r["split"] / f"{r['sample_id']}{suffix}"
        os.link(src, target)
        kept = [c for c in comps.get(r["sample_id"], []) if c["kept_v12"]] if r["source_dataset"] == "AI4SHIPWRECKS" else None
        if kept is None:
            src_label = V11 / "kaggle_detection/labels" / r["split"] / f"{r['sample_id']}.txt"
            if src_label.exists(): os.link(src_label, out / "kaggle_detection/labels" / r["split"] / src_label.name)
        else:
            lines = [f"1 {(c['x']+c['width']/2)/r['image_width']:.8f} {(c['y']+c['height']/2)/r['image_height']:.8f} {c['width']/r['image_width']:.8f} {c['height']/r['image_height']:.8f}\n" for c in kept]
            (out / "kaggle_detection/labels" / r["split"] / f"{r['sample_id']}.txt").write_text("".join(lines))
        trainval.append({**r, "v12_shipwreck_component_filter": MIN_COMPONENT_AREA if r["source_dataset"] == "AI4SHIPWRECKS" else None})
    # Tile images are not canonical metadata. Copy only their TRAIN/VAL links and labels untouched.
    indexed = {r["sample_id"] for r in records}
    for split in ("train", "val"):
        for src in (V11 / "kaggle_detection/images" / split).iterdir():
            stem = src.stem
            if stem in indexed: continue
            os.link(src, out / "kaggle_detection/images" / split / src.name)
            lab = V11 / "kaggle_detection/labels" / split / f"{stem}.txt"
            os.link(lab, out / "kaggle_detection/labels" / split / lab.name)
    (out / "canonical").mkdir()
    (out / "canonical/metadata_trainval.jsonl").write_text("".join(json.dumps(r, sort_keys=True)+"\n" for r in trainval))
    (out / "kaggle_detection/dataset.yaml").write_text("path: .\ntrain: images/train\nval: images/val\nnc: 3\nnames: {0: PIPELINE, 1: SHIPWRECK, 2: CRAB_POT}\n")
    positives = [r for r in records if r["source_dataset"] == "AI4SHIPWRECKS" and r["split"] == "train" and any(c["kept_v12"] for c in comps[r["sample_id"]])]
    manifests = {}
    for mult in (1, 3, 5):
        repeat = [{"sample_id": r["sample_id"], "repeat_index": i} for r in positives for i in range(mult)]
        f = out / f"shipwreck_train_sampling_{mult}x.jsonl"; f.write_text("".join(json.dumps(x, sort_keys=True)+"\n" for x in repeat)); manifests[str(mult)] = {"path": str(f.relative_to(out)), "extra_train_draws": len(repeat)-len(positives), "shipwreck_positive_draws": len(repeat)}
    base_train_images = len(list((V11 / "kaggle_detection/images/train").iterdir()))
    manifest = {"snapshot_id": out.name, "parent_v11": V11.name, "scope": "TRAIN_AND_VALIDATION_ONLY; sealed test intentionally absent and unaccessed", "shipwreck_correction": {"rule": "connected component area >= 256 px", "merge_components": False, "rationale": "conservative removal of visually isolated tiny foreground speckle; no unvalidated semantic merging"}, "sampling_manifests": manifests,
                "effective_shipwreck_positive_exposure": {f"{mult}x": {"positive_draws": len(positives)*mult, "effective_epoch_draws": base_train_images + len(positives)*(mult-1), "probability": len(positives)*mult/(base_train_images + len(positives)*(mult-1))} for mult in (1,3,5)}}
    (out / "provenance.json").write_text(json.dumps(manifest, indent=2)+"\n")
    return out


def main() -> None:
    if ART.exists(): shutil.rmtree(ART)
    ART.mkdir(parents=True); (ART / "contact_sheets").mkdir()
    records = rows(); ship = [r for r in records if r["source_dataset"] == "AI4SHIPWRECKS"]
    comps = {r["sample_id"]: component_rows(r) for r in ship}
    flat = [c for values in comps.values() for c in values]
    # Required box-level audit CSV.
    with (ART / "bbox_statistics.csv").open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(flat[0])); w.writeheader(); w.writerows(flat)
    byid = {r["sample_id"]: r for r in ship}
    train = sorted([r for r in ship if r["split"] == "train"], key=lambda x: hashlib.sha256(x["sample_id"].encode()).hexdigest())[:30]
    val = sorted([r for r in ship if r["split"] == "val"], key=lambda x: x["sample_id"])
    ordered_most = sorted(ship, key=lambda r: (-len(comps[r["sample_id"]]), r["sample_id"]))[:30]
    with_components = [r for r in ship if comps[r["sample_id"]]]
    smallest_ids = sorted(flat, key=lambda c: (c["component_area"], c["sample_id"]))[:30]
    smallest = [byid[x] for x in dict.fromkeys(c["sample_id"] for c in smallest_ids)]
    sheet("train_random_30", train, comps); sheet("validation_all", val, comps); sheet("largest_fragmentation", ordered_most, comps); sheet("smallest_components", smallest, comps); sheet("most_derived_boxes", ordered_most, comps)
    features = {r["sample_id"]: image_features(r, comps[r["sample_id"]]) for r in ship}
    groups = defaultdict(list)
    for r in ship: groups[(r["source_group_id"], r["split"])].append(r)
    group_rows=[]
    for (gid, split), values in sorted(groups.items()):
        fs=[features[r["sample_id"]] for r in values]; cc=[c for r in values for c in comps[r["sample_id"]]]
        group_rows.append({"group_id":gid,"split":split,"image_count":len(values),"instance_count":len(cc),"median_bbox_area":float(np.median([c['bbox_image_fraction'] for c in cc])) if cc else 0.0,"median_intensity":float(np.median([x['mean_intensity'] for x in fs])),"mask_fraction":float(np.mean([x['mask_fraction'] for x in fs]))})
    with (ART / "group_statistics.csv").open("w", newline="") as f: w=csv.DictWriter(f,fieldnames=list(group_rows[0]));w.writeheader();w.writerows(group_rows)
    resolutions=[]
    for size in (640,768,960):
        for split in ("train","val"):
            b=[letterbox(c,byid[c["sample_id"]],size) for c in flat if c["split"]==split]
            resolutions.append({"imgsz":size,"split":split,"boxes":len(b),"width_lt_4_pct":100*np.mean([x[0]<4 for x in b]),"width_lt_8_pct":100*np.mean([x[0]<8 for x in b]),"width_lt_16_pct":100*np.mean([x[0]<16 for x in b]),"height_lt_4_pct":100*np.mean([x[1]<4 for x in b]),"height_lt_8_pct":100*np.mean([x[1]<8 for x in b]),"height_lt_16_pct":100*np.mean([x[1]<16 for x in b]),"area_lt_64_pct":100*np.mean([x[2]<64 for x in b]),"area_lt_256_pct":100*np.mean([x[2]<256 for x in b]),"area_lt_1024_pct":100*np.mean([x[2]<1024 for x in b])})
    with (ART / "resolution_analysis.csv").open("w",newline="") as f:w=csv.DictWriter(f,fieldnames=list(resolutions[0]));w.writeheader();w.writerows(resolutions)
    # Training exposure: label files are the detection-layer authority; no test files read.
    labels=list((V11/"kaggle_detection/labels/train").glob("*.txt")); image_count=len(list((V11/"kaggle_detection/images/train").iterdir()))
    cls=Counter(); pos=Counter(); bg=0
    for label in labels:
        lines=[x.split() for x in label.read_text().splitlines() if x.strip()]
        if not lines: bg+=1
        for x in lines: cls[int(x[0])]+=1
        for k in {int(x[0]) for x in lines}: pos[k]+=1
    geom=defaultdict(list)
    for label in labels:
        for x in [x.split() for x in label.read_text().splitlines() if x.strip()]:
            geom[int(x[0])].append((float(x[3]),float(x[4])))
    exposure={"train_images":image_count,"background_images":bg,"classes":{name:{"class_id":cid,"instances":cls[cid],"positive_images":pos[cid],"instances_per_positive_image":cls[cid]/pos[cid],"probability_uniform_image":pos[cid]/image_count,
            "median_normalized_bbox_width":float(np.median([z[0] for z in geom[cid]])),"median_normalized_bbox_height":float(np.median([z[1] for z in geom[cid]])),"median_normalized_bbox_area":float(np.median([z[0]*z[1] for z in geom[cid]]))} for name,cid in (("PIPELINE",0),("SHIPWRECK",1),("CRAB_POT",2))},"background_probability":bg/image_count}
    exposure["expected_shipwreck_positive_per_batch"]={str(b):b*exposure["classes"]["SHIPWRECK"]["probability_uniform_image"] for b in (32,48,64)}
    surviving_ship_pos = sum(r["split"] == "train" and any(c["kept_v12"] for c in comps[r["sample_id"]]) for r in ship)
    exposure["v12_train_only_sampling_effective_exposure"] = {}
    for multiplier in (1, 3, 5):
        effective_epoch = image_count + surviving_ship_pos * (multiplier - 1)
        probability = surviving_ship_pos * multiplier / effective_epoch
        exposure["v12_train_only_sampling_effective_exposure"][f"{multiplier}x"] = {"shipwreck_positive_draws": surviving_ship_pos * multiplier, "effective_epoch_draws": effective_epoch, "probability_uniform_draw": probability, "expected_per_batch": {str(batch): batch * probability for batch in (32,48,64)}}
    with (ART/"class_exposure.json").open("w") as f:json.dump(exposure,f,indent=2)
    stats={"scope":"TRAIN_AND_VALIDATION_ONLY; held-out test image/mask/label data were not opened","mask_component_rule_v11":"8-connected foreground components, unfiltered","shipwreck_images":{"train":sum(r['split']=='train' for r in ship),"val":sum(r['split']=='val' for r in ship)},"components":{"total":len(flat),"kept_area_ge_256":sum(c['kept_v12'] for c in flat),"removed_area_lt_256":sum(not c['kept_v12'] for c in flat),"boxes_per_image":summary([len(comps[r['sample_id']]) for r in ship]),"component_area":summary([c['component_area'] for c in flat]),"bbox_normalized_width":summary([c['width']/byid[c['sample_id']]['image_width'] for c in flat]),"bbox_normalized_height":summary([c['height']/byid[c['sample_id']]['image_height'] for c in flat]),"bbox_normalized_area":summary([c['bbox_image_fraction'] for c in flat]),"nearest_component_distance_px":summary([c['nearest_component_distance_px'] for c in flat if c['nearest_component_distance_px'] is not None])},"split_feature_summary":{s:{k:summary([features[r['sample_id']][k] for r in ship if r['split']==s]) for k in features[ship[0]['sample_id']]} for s in ('train','val')},"baseline":"AWAITING_BASELINE_ARTIFACT: local YOLO11s best.pt SHA-256 is f94d934681c8f95c0eda5474fe578d8aaa06463e638184f376456f861bb5c8a4, not supplied frozen winner SHA-256 2aa3ac71051856bcfc8ec400804995f03568aa26d1a1fb24583e4eb1b7a10b15"}
    (ART/"diagnosis.json").write_text(json.dumps(stats,indent=2)+"\n")
    candidate=build_candidate(records,comps)
    bundle = ART / "kaggle_v12_candidates.json"
    bundle.write_text(json.dumps({"snapshot": str(candidate.relative_to(ROOT)), "validation": "Use the unchanged group-held validation images (with the same evidence-supported mask conversion) represented in this train/val-only candidate; do not create or use a test stanza.", "sampler": "All three resolution experiments use the pre-registered middle shipwreck_train_sampling_3x.jsonl manifest. It is a candidate, not a claim that 3x is optimal; retain the 1x and 5x manifests for a later validation-only sampler study. Standard Ultralytics dataset.yaml alone does not consume this manifest.", "experiments": [{"id":"A","model":"YOLO11s","imgsz":640,"sampling":"train-only 3x manifest","augment":False},{"id":"B","model":"YOLO11s","imgsz":768,"sampling":"train-only 3x manifest","augment":False},{"id":"C","model":"YOLO11s","imgsz":960,"sampling":"train-only 3x manifest","augment":False}]}, indent=2)+"\n")
    (ART/"README.md").write_text(f"# Shipwreck diagnosis v1\n\nScope: train and validation only; test was not opened. Current v1.1 labels turn every 8-connected mask component into a detection. Contact sheets show sparse isolated foreground speckle and fragmented semantic masks. The v1.2 candidate uses the conservative, auditable `area >= {MIN_COMPONENT_AREA}px` rule only; it intentionally does **not** merge components without per-object annotation authority.\n\nCandidate: `{candidate.relative_to(ROOT)}`. The candidate contains no test media or labels. Sampling manifests provide train-only 1x, 3x, and 5x shipwreck-positive exposure.\n\nUltralytics 8.4.135: `v8_transforms()` unconditionally appends `Albumentations(p=1.0, transforms=getattr(hyp, 'augmentations', None))`; when that setting is `None`, `Albumentations` supplies Blur, MedianBlur, ToGray and CLAHE at p=0.01 in `ultralytics/data/augment.py` lines 2109–2112. These are separate from zeroing the usual geometric/color hyperparameters. V1.2 should use `augment=False` and verify from runtime transform logging that `v8_transforms()` was not selected; if the Kaggle runner cannot guarantee that, provide `augmentations=[]` explicitly. This candidate preserves no augmentation decision; its Kaggle configs request explicit disable-and-verify.\n")
    print(json.dumps({"artifacts":str(ART),"candidate":str(candidate)},indent=2))

if __name__ == "__main__": main()
