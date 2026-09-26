"""H0-5: layer-16 cell embeddings from the harness's own forward pass (spec C item 1, H0 item 4).

``tapped_infer_row`` runs H0-4's ``infer_row`` (the production path, recovery off, raw fields only) with a forward
hook on layer 16 of the frozen detector. It adds no network pass: every ``predict`` call the runtime makes (one per
768 tile, or one per full frame) contributes the last layer-16 output of that call, so Ultralytics' first-call
warm-up forward is never taken as a cell map. Each 80 × 80 × 128 map is average-pooled to 20 × 20 cells (exact
4 × 4 blocks: ≈ 38.4 px native on a 768 tile, 32 px on a 640 frame) and each cell is L2-normalised, in float32.

Cells over tile padding are kept; ``cell_valid_fraction`` records exactly how much of each cell is image, and any
exclusion (padding, water column) is left to the tickets that define it. ``write_cache`` covers every val and test
image of the frozen manifest, never train, and records the provenance needed to rebuild the cache.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

import numpy as np
import torch

from round2.guards import FROZEN_MANIFEST_SHA256, load_frozen_manifest
from round2.infer import IDENTITY_FIELDS, ScientificPathError, inference_config, infer_row, scientific_detector
from round2.manifest import REPO, evaluation_set

from sagar.perception.runtime import TILE_SIZE, FinalDetector, _tile_origins

LAYER_INDEX = 16
CELL_GRID = 20              # spec C item 1: 20 × 20 cells per 768 tile or 640 frame
FEATURE_MAP = (80, 80)      # layer 16 at the detector's 640 input (stride 8)
CACHED_SPLITS = ("val", "test")   # spec H0 item 4 / ticket H0-5; train embeddings are extracted by D2 and C7
MODEL_ID = "sagardrishti_multidomain_v1_1_yolo11s"  # the runtime's model_id for the frozen detector
_SAFE_ID = re.compile(r"^[A-Za-z0-9_.-]+$")


def pool_cells(feature_map: torch.Tensor) -> np.ndarray:
    """(1, 128, 80, 80) layer-16 map → (20, 20, 128) float32 cells: 4 × 4 block mean, then per-cell L2 norm."""
    if tuple(feature_map.shape[-2:]) != FEATURE_MAP or feature_map.shape[0] != 1:
        raise ScientificPathError(f"layer-16 map has shape {tuple(feature_map.shape)}, expected (1, C, 80, 80)")
    if feature_map.dtype != torch.float32:
        raise ScientificPathError(f"layer-16 map is {feature_map.dtype}; cells are cached from float32 only")
    pooled = torch.nn.functional.adaptive_avg_pool2d(feature_map.detach().cpu(), (CELL_GRID, CELL_GRID))[0]
    cells = pooled.permute(1, 2, 0)
    cells = cells / cells.norm(dim=-1, keepdim=True).clamp_min(1e-12)
    return cells.numpy()


def cell_valid_fraction(origin: tuple[int, int], native: tuple[int, int], image: tuple[int, int]) -> np.ndarray:
    """(20, 20) float32: the fraction of each cell's native area that lies inside the image (not tile padding)."""
    (ox, oy), (native_w, native_h), (image_w, image_h) = origin, native, image

    def axis(start: int, extent: int, limit: int) -> np.ndarray:
        size = extent / CELL_GRID
        lows = start + np.arange(CELL_GRID) * size
        return (np.clip(np.minimum(lows + size, limit) - lows, 0, None) / size).astype(np.float64)

    return np.outer(axis(oy, native_h, image_h), axis(ox, native_w, image_w)).astype(np.float32)


class _LayerTap:
    """Collects the last layer-16 output of each detector predict call while active."""

    def __init__(self, detector: FinalDetector):
        self.detector, self.maps, self._current = detector, [], []

    def __enter__(self) -> "_LayerTap":
        model = self.detector.model
        self._hook = model.model.model[LAYER_INDEX].register_forward_hook(lambda _m, _i, out: self._current.append(out.detach()))
        self._shadowed = "predict" in vars(model)
        self._predict = model.predict

        def predict(**kwargs):
            self._current = []
            output = self._predict(**kwargs)
            if not self._current:
                raise ScientificPathError("a detector pass produced no layer-16 output")
            self.maps.append(self._current[-1])   # the pass itself; a warm-up forward comes first
            return output

        model.predict = predict
        return self

    def __exit__(self, *_exc) -> None:
        self._hook.remove()
        if self._shadowed:
            self.detector.model.predict = self._predict
        else:
            del self.detector.model.predict


def _grid_origins(inference_mode: str, width: int, height: int) -> list[tuple[str | None, int, int, int, int]]:
    """(tile_id, x, y, native width, native height) per detector pass, in the runtime's tile order."""
    if inference_mode == "FULL_FRAME":
        return [(None, 0, 0, width, height)]
    return [(f"tile_r{row:02d}_c{col:02d}_x{ox:05d}_y{oy:05d}", ox, oy, TILE_SIZE, TILE_SIZE)
            for row, oy in enumerate(_tile_origins(height)) for col, ox in enumerate(_tile_origins(width))]


def tapped_infer_row(detector: FinalDetector, row: Mapping[str, Any], corpus_root: Path) -> tuple[dict[str, Any], np.ndarray]:
    """H0-4 inference for one image, plus its (grids, 20, 20, 128) float32 cells from the same forward passes."""
    detector.load()
    with _LayerTap(detector) as tap:
        result = infer_row(detector, row, corpus_root)
    grids = _grid_origins(result["inference_mode"], result["width_px"], result["height_px"])
    expected = result["tile_count"] if result["inference_mode"] == "TILED" else 1
    if len(tap.maps) != len(grids) or len(grids) != expected:
        raise ScientificPathError(f"{len(tap.maps)} layer-16 maps for {expected} detector passes of {row['image_id']}")
    cells = np.stack([pool_cells(feature) for feature in tap.maps])
    result["grids"] = [{"tile_id": tile_id, "origin_px": [ox, oy], "native_extent_px": [nw, nh],
                        "cell_native_px": [nw / CELL_GRID, nh / CELL_GRID]} for tile_id, ox, oy, nw, nh in grids]
    return result, cells


def _sha(path: Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _versions() -> dict[str, Any]:
    import PIL
    import ultralytics
    version = ultralytics.__version__
    return {"python": platform.python_version(), "numpy": np.__version__, "torch": torch.__version__,
            "ultralytics": version, "pillow": PIL.__version__, "machine": platform.platform(),
            # The runtime passes no conf at full frame, so the floor is Ultralytics' predict default. Recorded only.
            "full_frame_floor": {"source": "Ultralytics predict default (runtime passes no conf)",
                                 "value": 0.25 if version == "8.4.135" else None,
                                 "verified_for_version": "8.4.135"}}


def write_cache(out_dir: Path, corpus_root: Path, *, manifest_rows: list[dict[str, Any]] | None = None,
                detector: FinalDetector | None = None, manifest_sha256: str = FROZEN_MANIFEST_SHA256,
                argv: list[str] | None = None) -> dict[str, Any]:
    """Cells for every val and test image of the manifest, written to ``out_dir`` only once complete."""
    out_dir = Path(out_dir)
    partial = out_dir.with_name(out_dir.name + ".partial")
    if (out_dir.exists() and any(out_dir.iterdir())) or partial.exists():
        raise ScientificPathError(f"{out_dir} (or its .partial) already exists; artifacts are immutable, use a new iteration")
    started = datetime.now(timezone.utc).isoformat()
    manifest_rows = load_frozen_manifest() if manifest_rows is None else manifest_rows
    detector = scientific_detector() if detector is None else detector
    config = inference_config(detector)
    selected = {split: sorted(evaluation_set(manifest_rows, split), key=lambda row: row["image_id"]) for split in CACHED_SPLITS}
    (partial / "cells").mkdir(parents=True)
    records: list[dict[str, Any]] = []
    try:
        for split in CACHED_SPLITS:
            for row in selected[split]:
                image_id = row["image_id"]
                if not _SAFE_ID.match(image_id):
                    raise ScientificPathError(f"image id {image_id!r} is not safe as a file name")
                result, cells = tapped_infer_row(detector, row, corpus_root)
                if result.pop("inference_config") != config:
                    raise ScientificPathError("the inference configuration changed during the run")
                valid = np.stack([cell_valid_fraction(tuple(g["origin_px"]), tuple(g["native_extent_px"]), (result["width_px"], result["height_px"]))
                                  for g in result["grids"]])
                cells_file, valid_file = f"cells/{image_id}.cells.npy", f"cells/{image_id}.valid.npy"
                np.save(partial / cells_file, cells, allow_pickle=False)
                np.save(partial / valid_file, valid, allow_pickle=False)
                records.append({**result, "cells_file": cells_file, "cells_sha256": _sha(partial / cells_file),
                                "cells_shape": list(cells.shape), "valid_fraction_file": valid_file,
                                "valid_fraction_sha256": _sha(partial / valid_file),
                                "detections_note": "raw production-floor detections from the same forward pass; not evaluated"})
        if detector.recovery_invocations != 0:
            raise ScientificPathError("the SHIPWRECK recovery path was entered during the cache run")
        coverage = {split: {"manifest": len(selected[split]), "cached": sum(1 for r in records if r["split"] == split)} for split in CACHED_SPLITS}
        if any(entry["manifest"] != entry["cached"] for entry in coverage.values()):
            raise ScientificPathError(f"cache coverage is not 100 % of val and test: {coverage}")
        with (partial / "records.jsonl").open("w") as handle:
            for record in records:
                handle.write(json.dumps(record, sort_keys=True) + "\n")
        git = lambda *args: subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True).stdout.strip()  # noqa: E731
        counts: dict[str, int] = {}
        for record in records:
            key = f"{record['dataset']}|{record['sensor']}|{record['split']}"
            counts[key] = counts.get(key, 0) + 1
        provenance = {
            "ticket": "H0-5", "artifact": "layer-16 cell cache", "iteration": out_dir.name,
            "git_sha": git("rev-parse", "HEAD"), "git_dirty": bool(git("status", "--porcelain")),
            "harness_source_sha256": {name: _sha(Path(__file__).parent / name) for name in ("__init__.py", "manifest.py", "guards.py", "infer.py", "features.py")},
            "frozen_manifest_sha256": manifest_sha256, "corpus_root": str(corpus_root),
            "splits_cached": list(CACHED_SPLITS), "selection": "manifest rows of each split (train never selected)",
            "coverage": coverage, "images_by_dataset_sensor_split": dict(sorted(counts.items())),
            "grids": sum(len(r["grids"]) for r in records), "detector_model_id": MODEL_ID,
            "detector_sha256": config["detector_sha256"], "inference_config": config,
            "recovery_invocations": detector.recovery_invocations,
            "layer_index": LAYER_INDEX, "feature_map": list(FEATURE_MAP), "cell_grid": [CELL_GRID, CELL_GRID], "cell_dim": 128,
            "pooling": "adaptive average pool 80×80 → 20×20 (exact 4×4 blocks)", "normalisation": "per-cell L2 (clamp 1e-12)",
            "dtype": "float32", "precision_conversion": "none",
            "padding": "cells over tile padding are kept; valid_fraction records the image share of each cell",
            "versions": _versions(), "seeds": None, "preregistration_hash": None,
            "command": argv if argv is not None else sys.argv, "started_at": started,
            "finished_at": datetime.now(timezone.utc).isoformat(),
            "bytes": sum(path.stat().st_size for path in (partial / "cells").iterdir()),
            "outputs": ["records.jsonl", "cells/<image_id>.cells.npy", "cells/<image_id>.valid.npy"],
        }
        (partial / "cache_manifest.json").write_text(json.dumps(provenance, indent=2) + "\n")
    except BaseException:
        shutil.rmtree(partial, ignore_errors=True)
        raise
    out_dir.parent.mkdir(parents=True, exist_ok=True)
    if out_dir.exists():
        out_dir.rmdir()   # empty, checked above
    partial.rename(out_dir)
    return provenance


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--corpus-root", type=Path, required=True, help="root of the frozen corpus (holds canonical/)")
    parser.add_argument("--out", type=Path, default=REPO / "artifacts/round2/H0/cells/iter-1")
    args = parser.parse_args()
    provenance = write_cache(args.out, args.corpus_root)
    print(json.dumps({key: provenance[key] for key in ("coverage", "grids", "bytes", "recovery_invocations", "detector_sha256")}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
