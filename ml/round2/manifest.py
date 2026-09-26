"""H0-1: the held-out manifest (spec H0 item 1, §6 "Held-out manifest row", §7.3; ticket H0-1).

One row per image of the frozen detector corpus, built only from the detector's own ``split`` field in the
corpus metadata. Each row records sensor, dataset, split, Survey id, augmentation parent, bootstrap group,
GT boxes, AI4 merged object regions and the source SHA-256, which is re-verified against the image bytes.

Decisions recorded for H0-1 (and written into the artifact):
- PID-01 is deferred. AI4 merged object regions are UNAVAILABLE; GT boxes keep their connected-component
  derivation label. Nothing is merged or filtered.
- SubPipe Survey: the maximal chain of time-adjacent frames of one channel in which every link is confirmed by
  the frozen B4 row-shift verifier. Timestamps choose which pairs to test; pixels decide. No time threshold.
- SubPipe bootstrap group: 60-s block anchored at the first frame of its Survey, so a block never spans Surveys.
- AI4 Survey: one waterfall image. PING Survey: one image.

Class and sensor are confounded in this corpus (each supervised class comes from one sensor), so every row
keeps its dataset and sensor; nothing here pools, rebalances or resamples.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
import re
import subprocess
import sys
from collections import Counter, OrderedDict
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any, Callable

import numpy as np

REPO = Path(__file__).resolve().parents[2]
if str(REPO / "packages") not in sys.path:
    sys.path.insert(0, str(REPO / "packages"))

from sagar.vnext.surveys import RowShiftPolicy, load_native_pixels, verify_row_shift_groups  # noqa: E402

CORPUS_SNAPSHOT_ID = "multidomain_sonar_v1_1_20260831"
DETECTOR_PATH = REPO / "ml/artifacts/final_v1/detector/best.pt"
DETECTOR_METRICS = REPO / "ml/artifacts/final_v1/detector/metrics.json"
TRACKED_METADATA = REPO / "data/processed" / CORPUS_SNAPSHOT_ID / "canonical/metadata.jsonl"
SPLITS = ("train", "val", "test")
EVALUATION_SPLITS = ("val", "test")
# Spec D item 1. Each supervised class comes from one of these sensors: the confound stays visible.
SENSORS = {"SUBPIPE": "Klein 3500", "AI4SHIPWRECKS": "EdgeTech 2205", "PING_GHOSTVISION": "Humminbird"}
# Spec §6 "Held-out manifest row" (gt_object_regions applies to AI4 only).
MANIFEST_FIELDS = ("image_id", "dataset", "sensor", "split", "survey_id", "augmentation_parent", "bootstrap_group",
                   "gt_boxes", "gt_object_regions", "source_sha256")
SUBPIPE_BLOCK_SECONDS = Decimal(60)  # spec §7.3
_SUBPIPE_NAME = re.compile(r"/SSS_(HF|LF)_images/.*/(\d+(?:\.\d+)?)\.\w+$")


class ManifestError(ValueError):
    """The corpus cannot yield a trustworthy manifest; nothing is written."""


def load_corpus_rows(metadata_path: Path) -> list[dict[str, Any]]:
    with Path(metadata_path).open() as handle:
        return [json.loads(line) for line in handle if line.strip()]


def split_counts(rows: list[dict[str, Any]]) -> dict[str, dict[str, int]]:
    """Image counts per split and per dataset, in the frozen corpus QA's terms."""
    splits = Counter(row["split"] for row in rows)
    datasets = Counter(row["source_dataset"] for row in rows)
    return {"splits": {split: splits.get(split, 0) for split in SPLITS},
            "datasets": {dataset: datasets.get(dataset, 0) for dataset in SENSORS}}


def _subpipe_identity(row: dict[str, Any]) -> tuple[str, str]:
    """(channel, timestamp string) from the SubPipe source path, e.g. .../SSS_HF_images/Image/1693569378.780.pbm."""
    match = _SUBPIPE_NAME.search("/" + row["original_filename"])
    if not match:
        raise ManifestError(f"SubPipe image {row['sample_id']} has no channel and timestamp in {row['original_filename']!r}")
    return match.group(1), match.group(2)


def _verify_sources(rows: list[dict[str, Any]], corpus_root: Path) -> None:
    for row in rows:
        path = corpus_root / row["canonical_filename"]
        if not path.is_file():
            raise ManifestError(f"source image missing for {row['sample_id']}: {path}")
        if hashlib.sha256(path.read_bytes()).hexdigest() != row["image_sha256"]:
            raise ManifestError(f"source SHA-256 does not match the corpus metadata for {row['sample_id']}")


def _pixel_loader(rows: list[dict[str, Any]], corpus_root: Path) -> Callable[[str], np.ndarray]:
    paths = {row["sample_id"]: corpus_root / row["canonical_filename"] for row in rows}
    cache: OrderedDict[str, np.ndarray] = OrderedDict()

    def load(sample_id: str) -> np.ndarray:
        if sample_id not in cache:
            cache[sample_id] = load_native_pixels(paths[sample_id])
            if len(cache) > 4:
                cache.popitem(last=False)
        return cache[sample_id]
    return load


def _subpipe_surveys(rows: list[dict[str, Any]], load: Callable[[str], np.ndarray]) -> dict[str, tuple[str, Decimal, Decimal]]:
    """sample_id -> (survey_id, frame time, Survey start time), by pixel-verified chains per channel."""
    by_channel: dict[str, list[tuple[Decimal, str, str, dict[str, Any]]]] = {}
    for row in rows:
        channel, stamp = _subpipe_identity(row)
        by_channel.setdefault(channel, []).append((Decimal(stamp), stamp, row["sample_id"], row))
    result: dict[str, tuple[str, Decimal, Decimal]] = {}
    for channel in sorted(by_channel):
        frames = sorted(by_channel[channel], key=lambda item: (item[0], item[2]))
        survey_id, start = None, None
        for index, (time, stamp, sample_id, row) in enumerate(frames):
            linked = False
            if index:
                _, _, previous_id, previous = frames[index - 1]
                same_geometry = (previous["image_width"], previous["image_height"]) == (row["image_width"], row["image_height"])
                linked = same_geometry and bool(verify_row_shift_groups([previous_id, sample_id], load))
                if linked and previous["split"] != row["split"]:
                    raise ManifestError(f"pixel-verified SubPipe chain crosses a split boundary: {previous_id} "
                                        f"({previous['split']}) and {sample_id} ({row['split']}) share pings")
            if not linked:
                survey_id, start = f"SUBPIPE:{channel}:{stamp}", time
            result[sample_id] = (survey_id, time, start)
    return result


def build_manifest(rows: list[dict[str, Any]], corpus_root: Path) -> list[dict[str, Any]]:
    """Manifest rows for every corpus image, sorted by dataset, split and image id. Raises ManifestError."""
    corpus_root = Path(corpus_root)
    ids = [row["sample_id"] for row in rows]
    if len(set(ids)) != len(ids):
        raise ManifestError("duplicate sample_id in the corpus metadata")
    for row in rows:
        if row["source_dataset"] not in SENSORS:
            raise ManifestError(f"unknown dataset {row['source_dataset']!r} for {row['sample_id']}")
        if row["split"] not in SPLITS:
            raise ManifestError(f"unknown split {row['split']!r} for {row['sample_id']}")
        if row["source_dataset"] != "SUBPIPE" and not row.get("source_group_id"):
            raise ManifestError(f"no bootstrap group source (source_group_id) for {row['sample_id']}")
    _verify_sources(rows, corpus_root)

    siblings: dict[str, set[tuple[str, str]]] = {}
    for row in rows:
        if row["source_dataset"] == "PING_GHOSTVISION" and row.get("augmentation_parent_id"):
            siblings.setdefault(row["augmentation_parent_id"], set()).add((row["split"], row["source_group_id"]))
    split_parents = sorted(parent for parent, keys in siblings.items() if len(keys) > 1)
    if split_parents:
        raise ManifestError(f"augmentation siblings span splits or recording groups: {', '.join(split_parents[:5])}")

    subpipe = [row for row in rows if row["source_dataset"] == "SUBPIPE"]
    chains = _subpipe_surveys(subpipe, _pixel_loader(subpipe, corpus_root))

    manifest = []
    for row in rows:
        dataset = row["source_dataset"]
        channel = None
        if dataset == "SUBPIPE":
            channel = _subpipe_identity(row)[0]
            survey_id, time, start = chains[row["sample_id"]]
            bootstrap_group = f"{survey_id}:block{int((time - start) // SUBPIPE_BLOCK_SECONDS)}"
        else:
            survey_id, bootstrap_group = f"{dataset}:{row['sample_id']}", row["source_group_id"]
        boxes = row.get("bbox_xyxy_px") or []
        classes = row.get("class_name")
        classes = classes if isinstance(classes, list) else [classes] * len(boxes)
        manifest.append({
            "image_id": row["sample_id"], "dataset": dataset, "sensor": SENSORS[dataset], "channel": channel,
            "split": row["split"], "survey_id": survey_id,
            "augmentation_parent": row.get("augmentation_parent_id") if dataset == "PING_GHOSTVISION" else None,
            "bootstrap_group": bootstrap_group,
            "gt_boxes": [{"class": cls, "xyxy_px": list(box)} for cls, box in zip(classes, boxes)],
            "gt_boxes_derivation": row.get("derived_annotation_type"),
            "gt_object_regions": None,
            "gt_object_regions_status": "UNAVAILABLE_PENDING_PID_01" if dataset == "AI4SHIPWRECKS" else "NOT_APPLICABLE",
            "source_sha256": row["image_sha256"], "source_path": row["canonical_filename"],
            "image_width": row.get("image_width"), "image_height": row.get("image_height"),
        })
    return sorted(manifest, key=lambda item: (item["dataset"], item["split"], item["image_id"]))


def evaluation_set(manifest: list[dict[str, Any]], split: str) -> list[dict[str, Any]]:
    """The rows of one evaluation split. ``train`` is never an evaluation set (spec §7.1, I-H0-1)."""
    if split == "train":
        raise ManifestError("train rows are never an evaluation set")
    if split not in EVALUATION_SPLITS:
        raise ManifestError(f"unknown evaluation split {split!r}")
    return [row for row in manifest if row["split"] == split]


def _sha(path: Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def verified_detector_sha() -> str:
    """I-H0-2: the frozen detector file's SHA-256, checked against the SHA recorded when it was frozen."""
    recorded = json.loads(DETECTOR_METRICS.read_text())["winner"]["best_checkpoint_sha256"]
    actual = _sha(DETECTOR_PATH)
    if actual != recorded:
        raise ManifestError(f"frozen detector SHA-256 {actual} does not match the recorded {recorded}")
    return actual


def _summary(manifest: list[dict[str, Any]]) -> dict[str, Any]:
    by = lambda *keys: dict(sorted(Counter("|".join(str(row[key]) for key in keys) for row in manifest).items()))  # noqa: E731
    subpipe = [row for row in manifest if row["dataset"] == "SUBPIPE"]
    ping_test = [row for row in manifest if row["dataset"] == "PING_GHOSTVISION" and row["split"] == "test"]
    return {
        "images_by_split": by("split"), "images_by_dataset_sensor_split": by("dataset", "sensor", "split"),
        "subpipe_images_by_channel_split": dict(sorted(Counter(f"{r['channel']}|{r['split']}" for r in subpipe).items())),
        "subpipe_surveys_by_channel_split": dict(sorted(Counter(f"{r['channel']}|{r['split']}" for r in
                                                                {r["survey_id"]: r for r in subpipe}.values()).items())),
        "bootstrap_groups_by_dataset_split": dict(sorted(Counter(f"{r['dataset']}|{r['split']}" for r in
                                                                 {(r["dataset"], r["split"], r["bootstrap_group"]): r for r in manifest}.values()).items())),
        "ping_test_augmentation_parents": len({row["augmentation_parent"] for row in ping_test}),
        "gt_object_regions_status": by("dataset", "gt_object_regions_status"),
        "gt_boxes_derivation": by("dataset", "gt_boxes_derivation"),
    }


def write_artifact(corpus_root: Path, out_dir: Path, argv: list[str] | None = None) -> dict[str, Any]:
    """Build the manifest from the frozen corpus and write manifest.jsonl, summary.json and artifact_manifest.json."""
    corpus_root, out_dir = Path(corpus_root), Path(out_dir)
    if out_dir.exists() and any(out_dir.iterdir()):
        raise ManifestError(f"{out_dir} already holds an artifact; artifacts are immutable, use a new iteration directory")
    started = datetime.now(timezone.utc).isoformat()
    detector_sha = verified_detector_sha()
    metadata_path = corpus_root / "canonical/metadata.jsonl"
    metadata_sha = _sha(metadata_path)
    if TRACKED_METADATA.is_file() and _sha(TRACKED_METADATA) != metadata_sha:
        raise ManifestError("the corpus metadata differs from the repository's frozen copy")
    rows = load_corpus_rows(metadata_path)
    qa_path = corpus_root / "qa/qa.json"
    qa = json.loads(qa_path.read_text())["counts"]
    counts = split_counts(rows)
    if counts["splits"] != {split: qa["splits"][split] for split in SPLITS} or counts["datasets"] != {d: qa["images"][d] for d in SENSORS}:
        raise ManifestError(f"corpus counts {counts} differ from the frozen QA counts")
    manifest = build_manifest(rows, corpus_root)
    summary = _summary(manifest)
    out_dir.mkdir(parents=True, exist_ok=True)
    with (out_dir / "manifest.jsonl").open("w") as handle:
        for row in manifest:
            handle.write(json.dumps(row, sort_keys=True) + "\n")
    (out_dir / "summary.json").write_text(json.dumps({"counts_vs_qa": {"manifest": split_counts(rows), "qa_splits": qa["splits"],
                                                                        "qa_images": qa["images"], "match": True}, **summary}, indent=2) + "\n")
    git = lambda *args: subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True).stdout.strip()  # noqa: E731
    provenance = {
        "ticket": "H0-1", "artifact": "held-out manifest", "iteration": out_dir.name,
        "git_sha": git("rev-parse", "HEAD"), "git_dirty": bool(git("status", "--porcelain")),
        "harness_source_sha256": {name: _sha(Path(__file__).parent / name) for name in ("__init__.py", "manifest.py")},
        "detector_sha256": detector_sha, "detector_path": str(DETECTOR_PATH.relative_to(REPO)),
        "corpus_snapshot_id": CORPUS_SNAPSHOT_ID, "corpus_root": str(corpus_root),
        "corpus_metadata_sha256": metadata_sha, "corpus_qa_sha256": _sha(qa_path),
        "splits_used": list(SPLITS), "split_source": "corpus metadata field 'split' (the detector's own split)",
        "seeds": None, "device": platform.platform(), "runtime_config": None, "preregistration_hash": None,
        "decisions": {
            "PID-01": "deferred: AI4 gt_object_regions UNAVAILABLE_PENDING_PID_01; GT boxes carry derived_annotation_type",
            "subpipe_survey": "maximal chains of time-adjacent frames per channel, every link confirmed by the frozen B4 verifier",
            "subpipe_bootstrap_block": "60-s blocks anchored at the first frame of the frame's Survey",
            "row_shift_policy": RowShiftPolicy().__dict__,
        },
        "command": argv if argv is not None else sys.argv, "started_at": started,
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "outputs": ["manifest.jsonl", "summary.json"], "rows": len(manifest),
    }
    (out_dir / "artifact_manifest.json").write_text(json.dumps(provenance, indent=2) + "\n")
    return {"provenance": provenance, "summary": summary}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--corpus-root", type=Path, required=True, help="root of the frozen corpus (holds canonical/ and qa/)")
    parser.add_argument("--out", type=Path, default=REPO / "artifacts/round2/H0/manifest/iter-1")
    args = parser.parse_args()
    result = write_artifact(args.corpus_root, args.out)
    print(json.dumps(result["summary"], indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
