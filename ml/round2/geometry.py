"""H0-6: geometry records under PID-02 (spec H0 item 2, §6 "Geometry record", H0-AC5).

PID-02 (locked): nadir x_i is the argmax of the image column mean within ±5 % of the centre column. The window is
the integer columns x with |x − W/2| ≤ 0.05·W (inclusive); the column mean is taken on the native single-channel
pixel values (never converted); a tied maximum resolves to the midpoint of the first and last tied columns, and the
tied interval is recorded. Ties are compared on exact integer column sums (one height per image, so the order of
sums is the order of means). Water-column half-width and nadir confidence stay UNAVAILABLE: no validated
water-column edge procedure exists, so they are never estimated, guessed, substituted or set to 0.

The range axis is the spec's per-dataset fact (H0 item 2): columns for SubPipe and AI4, UNKNOWN for PING, which
gets no nadir. Nothing here reads ground truth, detections or labels; rows are read through a ground-truth-free view.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import platform
import shutil
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

import numpy as np
from PIL import Image

from round2.guards import FROZEN_MANIFEST_SHA256, GroundTruthFreeRow, load_frozen_manifest
from round2.manifest import REPO, ManifestError

NADIR_METHOD = "column_mean_argmax_within_5pct_of_W_over_2_plateau_midpoint@v1"
WINDOW_FRACTION = 0.05                          # spec F item 1 / PID-02
UNAVAILABLE = "UNAVAILABLE_PID_02"               # no validated water-column edge procedure (PID-02)
# Spec H0 item 2: range axis known for SubPipe/AI4 (columns are Slant range), UNKNOWN for PING.
RANGE_AXIS = {"SUBPIPE": "COLUMNS", "AI4SHIPWRECKS": "COLUMNS", "PING_GHOSTVISION": "UNKNOWN"}
IDENTITY_FIELDS = ("image_id", "dataset", "sensor", "channel", "split", "survey_id", "bootstrap_group", "image_width", "image_height")


class GeometryError(ManifestError):
    """A geometry record cannot be derived under PID-02 without guessing."""


def nadir_window(width: int) -> tuple[int, int]:
    """Inclusive integer columns x with |x − W/2| ≤ 0.05·W."""
    half = WINDOW_FRACTION * width
    return max(0, math.ceil(width / 2 - half)), min(width - 1, math.floor(width / 2 + half))


def estimate_nadir(pixels: np.ndarray) -> dict[str, Any]:
    """PID-02 nadir of one single-channel image: column-mean argmax in the window, tie → plateau midpoint."""
    if pixels.ndim != 2:
        raise GeometryError("nadir is defined on single-channel pixels only")
    lo, hi = nadir_window(pixels.shape[1])
    sums = pixels[:, lo:hi + 1].astype(np.int64).sum(axis=0)
    tied = lo + np.flatnonzero(sums == sums.max())
    first, last = int(tied[0]), int(tied[-1])
    return {"nadir_col": (first + last) / 2, "tie_interval": [first, last], "tied_columns": int(tied.size), "search_window": [lo, hi]}


def geometry_record(row: Mapping[str, Any], corpus_root: Path) -> dict[str, Any]:
    """The §6 geometry record of one manifest image."""
    view = row if isinstance(row, GroundTruthFreeRow) else GroundTruthFreeRow(row)
    dataset = view["dataset"]
    if dataset not in RANGE_AXIS:
        raise GeometryError(f"no range-axis fact for dataset {dataset!r}")
    record: dict[str, Any] = {field: view.get(field) for field in IDENTITY_FIELDS}
    record.update({"range_axis": RANGE_AXIS[dataset], "nadir_method": NADIR_METHOD, "source_sha256": view["source_sha256"],
                   "nadir_confidence": None, "nadir_confidence_status": UNAVAILABLE,
                   "water_column_halfwidth_px": None, "water_column_halfwidth_status": UNAVAILABLE})
    if record["range_axis"] != "COLUMNS":
        record.update({"nadir_col": None, "nadir_status": "NOT_APPLICABLE_RANGE_AXIS_UNKNOWN", "tie_interval": None,
                       "tied_columns": None, "search_window": None})
        return record
    path = Path(corpus_root) / view["source_path"]
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != view["source_sha256"]:
        raise GeometryError(f"source SHA-256 of {view['image_id']} does not match the manifest")
    with Image.open(path) as image:
        if image.mode != "L":
            raise GeometryError(f"{view['image_id']} is {image.mode}; nadir is taken on native single-channel values, never converted")
        pixels = np.asarray(image)
    record.update(estimate_nadir(pixels), nadir_status="ESTIMATED")
    return record


def _nadir_report(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Nadir estimates relative to the ±5 % window per dataset and channel (and per split)."""
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        if record["nadir_col"] is not None:
            groups[f"{record['dataset']}|{record['channel'] or ''}"].append(record)

    def summary(items: list[dict[str, Any]]) -> dict[str, Any]:
        offsets = np.array([r["nadir_col"] - r["image_width"] / 2 for r in items])
        fractions = np.array([(r["nadir_col"] - r["image_width"] / 2) / r["image_width"] for r in items])
        ties = np.array([r["tied_columns"] for r in items])
        return {"images": len(items),
                "within_window": sum(r["search_window"][0] <= r["nadir_col"] <= r["search_window"][1] for r in items),
                "on_window_edge": sum(r["tie_interval"][0] == r["search_window"][0] or r["tie_interval"][1] == r["search_window"][1] for r in items),
                "offset_from_W_over_2_columns": {"min": float(offsets.min()), "median": float(np.median(offsets)), "max": float(offsets.max())},
                "offset_fraction_of_W": {"min": float(fractions.min()), "median": float(np.median(fractions)), "max": float(fractions.max())},
                "window_half_fraction": WINDOW_FRACTION,
                "images_with_tied_maximum": int((ties > 1).sum()), "max_tied_columns": int(ties.max())}

    report = {}
    for key in sorted(groups):
        items = groups[key]
        report[key] = {**summary(items), "by_split": {split: summary([r for r in items if r["split"] == split])
                                                      for split in ("train", "val", "test") if any(r["split"] == split for r in items)}}
    return report


def _sha(path: Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_geometry(out_dir: Path, corpus_root: Path, *, manifest_rows: list[dict[str, Any]] | None = None,
                   manifest_sha256: str = FROZEN_MANIFEST_SHA256, argv: list[str] | None = None) -> dict[str, Any]:
    """A geometry record for every manifest image, the nadir report, and provenance; written once, complete."""
    out_dir = Path(out_dir)
    partial = out_dir.with_name(out_dir.name + ".partial")
    if (out_dir.exists() and any(out_dir.iterdir())) or partial.exists():
        raise GeometryError(f"{out_dir} (or its .partial) already exists; artifacts are immutable, use a new iteration")
    started = datetime.now(timezone.utc).isoformat()
    rows = load_frozen_manifest() if manifest_rows is None else manifest_rows
    records = [geometry_record(GroundTruthFreeRow(row), corpus_root) for row in sorted(rows, key=lambda row: row["image_id"])]
    partial.mkdir(parents=True)
    try:
        with (partial / "geometry.jsonl").open("w") as handle:
            for record in records:
                handle.write(json.dumps(record, sort_keys=True) + "\n")
        (partial / "nadir_report.json").write_text(json.dumps(_nadir_report(records), indent=2, sort_keys=True) + "\n")
        git = lambda *args: subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True).stdout.strip()  # noqa: E731
        counts: dict[str, int] = defaultdict(int)
        for record in records:
            counts[f"{record['dataset']}|{record['range_axis']}|{record['nadir_status']}"] += 1
        provenance = {
            "ticket": "H0-6", "artifact": "geometry records", "iteration": out_dir.name,
            "git_sha": git("rev-parse", "HEAD"), "git_dirty": bool(git("status", "--porcelain")),
            "harness_source_sha256": {name: _sha(Path(__file__).parent / name) for name in ("__init__.py", "manifest.py", "guards.py", "geometry.py")},
            "frozen_manifest_sha256": manifest_sha256, "corpus_root": str(corpus_root), "records": len(records),
            "splits": sorted({record["split"] for record in records}), "counts": dict(sorted(counts.items())),
            "nadir_method": NADIR_METHOD, "range_axis_by_dataset": RANGE_AXIS,
            "pid_02": ("Nadir x_i is the argmax of the image column mean within ±5% of the centre column. Water-column half-width and "
                       "nadir confidence remain UNAVAILABLE unless and until a validated water-column edge procedure exists."),
            "conventions": {"window": "integer columns x with |x - W/2| <= 0.05*W, inclusive", "values": "native single-channel pixels, no conversion",
                            "ties": "midpoint of first and last tied columns; interval recorded", "comparison": "exact integer column sums"},
            "detector_used": False, "labels_used": False, "learned_parameters": None, "seeds": None,
            "versions": {"python": platform.python_version(), "numpy": np.__version__, "pillow": Image.__version__, "machine": platform.platform()},
            "command": argv if argv is not None else ["PYTHONPATH=packages:ml", "python", "-m", "round2.geometry", *sys.argv[1:]],
            "started_at": started, "finished_at": datetime.now(timezone.utc).isoformat(),
            "outputs": ["geometry.jsonl", "nadir_report.json"],
        }
        (partial / "artifact_manifest.json").write_text(json.dumps(provenance, indent=2) + "\n")
    except BaseException:
        shutil.rmtree(partial, ignore_errors=True)
        raise
    out_dir.parent.mkdir(parents=True, exist_ok=True)
    if out_dir.exists():
        out_dir.rmdir()
    partial.rename(out_dir)
    return provenance


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--corpus-root", type=Path, required=True, help="root of the frozen corpus (holds canonical/)")
    parser.add_argument("--out", type=Path, default=REPO / "artifacts/round2/H0/geometry/iter-1")
    args = parser.parse_args()
    provenance = write_geometry(args.out, args.corpus_root)
    print(json.dumps({key: provenance[key] for key in ("records", "counts", "nadir_method")}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
