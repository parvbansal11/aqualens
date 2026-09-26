"""Lazy local YOLO11s inference for arbitrary supported survey rasters."""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
from typing import Any

# Ultralytics monkey-patches PIL.Image.open so that ANY failure to decode an
# image triggers a runtime `pip install pi-heif` before re-raising. On a serving
# host that means an unreadable upload stalls on two network install attempts and
# then surfaces a ModuleNotFoundError instead of "this file is not an image".
# A service must not install packages while handling a request, so auto-install
# is disabled before ultralytics is ever imported. Set YOLO_AUTOINSTALL
# explicitly to override this deliberately.
os.environ.setdefault("YOLO_AUTOINSTALL", "false")

import numpy as np
from PIL import Image

from .demo_policy import shipwreck_demo_presentation, spatial_consensus_presentation

CLASSES = {0: "PIPELINE", 1: "SHIPWRECK", 2: "CRAB_POT"}
EXPECTED_SHA256 = "2aa3ac71051856bcfc8ec400804995f03568aa26d1a1fb24583e4eb1b7a10b15"

# Runtime-only tiling for wide/large rasters. Independent of the frozen Stage 2
# dataset tiling in sagar.io.tiling (512px/50%, used only to build training tiles).
# This path never touches model weights; it only changes how pixels are windowed
# before the same frozen detector is called.
TILE_SIZE = 768
TILE_OVERLAP = 0.30
TILE_STRIDE = round(TILE_SIZE * (1 - TILE_OVERLAP))
TILE_CONFIDENCE_FLOOR = 0.12
NMS_IOU_THRESHOLD = 0.45
WIDE_DIMENSION_PX = 1024
WIDE_ASPECT_RATIO = 1.6

# INTERNAL HACKATHON DEMO ONLY: a second, SHIPWRECK-only tiled pass at a far
# lower confidence floor, run only when the normal >=0.12 pass found no
# SHIPWRECK at all. Never runs for PIPELINE/CRAB_POT, never runs outside the
# TILED path, never overwrites raw_confidence. See FinalDetector.infer and
# sagar.perception.demo_policy.spatial_consensus_presentation.
SHIPWRECK_CLASS_ID = 1
RECOVERY_CONFIDENCE_FLOOR = 0.01
RECOVERY_CLUSTER_MIN_IOU = 0.15
RECOVERY_CLUSTER_MIN_SUPPORT = 3


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def select_device() -> str:
    """Portable compute device preference: CUDA, then Apple Silicon MPS, then CPU."""
    import torch
    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def needs_tiling(width: int, height: int) -> bool:
    aspect_ratio = max(width, height) / max(1, min(width, height))
    return width > WIDE_DIMENSION_PX or height > WIDE_DIMENSION_PX or aspect_ratio > WIDE_ASPECT_RATIO


def _tile_origins(length: int, tile_size: int = TILE_SIZE, stride: int = TILE_STRIDE) -> list[int]:
    """Deterministic grid of tile origins that always reaches the far edge.

    stride < tile_size guarantees the last origin plus a full tile overruns
    ``length``, so the final (padded) tile always covers the remainder instead
    of dropping it.
    """
    if length <= tile_size:
        return [0]
    return list(range(0, length, stride))


def _iou(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    if inter <= 0.0:
        return 0.0
    area_a = (ax2 - ax1) * (ay2 - ay1)
    area_b = (bx2 - bx1) * (by2 - by1)
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def _class_aware_nms(candidates: list[dict[str, Any]], iou_threshold: float = NMS_IOU_THRESHOLD) -> list[dict[str, Any]]:
    """Collapse overlapping same-class candidates, keeping the highest raw confidence."""
    kept: list[dict[str, Any]] = []
    for class_id in sorted({c["class_id"] for c in candidates}):
        remaining = sorted((c for c in candidates if c["class_id"] == class_id), key=lambda c: c["confidence"], reverse=True)
        while remaining:
            best = remaining.pop(0)
            kept.append(best)
            remaining = [c for c in remaining if _iou(best["bbox"], c["bbox"]) <= iou_threshold]
    return kept


def _strongest_coherent_cluster(
    proposals: list[dict[str, Any]], min_iou: float = RECOVERY_CLUSTER_MIN_IOU, min_support: int = RECOVERY_CLUSTER_MIN_SUPPORT,
) -> list[dict[str, Any]] | None:
    """Union-find over pairwise IoU: groups proposals that spatially agree, then
    returns the largest group meeting min_support (ties broken by max member
    confidence). Never an isolated box -- a group of one never has min_support."""
    count = len(proposals)
    if count < min_support:
        return None
    parent = list(range(count))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(count):
        for j in range(i + 1, count):
            if _iou(proposals[i]["bbox"], proposals[j]["bbox"]) >= min_iou:
                root_i, root_j = find(i), find(j)
                if root_i != root_j:
                    parent[root_i] = root_j

    groups: dict[int, list[dict[str, Any]]] = {}
    for i in range(count):
        groups.setdefault(find(i), []).append(proposals[i])

    eligible = [members for members in groups.values() if len(members) >= min_support]
    if not eligible:
        return None
    eligible.sort(key=lambda members: (len(members), max(m["confidence"] for m in members)), reverse=True)
    return eligible[0]


class FinalDetector:
    def __init__(self, weights: Path, *, shipwreck_recovery: bool = True, confidence_floor: float | None = None) -> None:
        # The SHIPWRECK recovery pass is an internal demo heuristic (Round-2 Q4, KD-8). Scientific
        # paths construct the detector with shipwreck_recovery=False (spec H0 item 3); the production
        # default is unchanged. Only a real bool is accepted, so a mistyped value fails loudly.
        if not isinstance(shipwreck_recovery, bool):
            raise TypeError(f"shipwreck_recovery must be True or False, not {shipwreck_recovery!r}")
        self.shipwreck_recovery = shipwreck_recovery
        # A declared lower detection floor for calibration sweeps only (spec H0 item 3). None keeps the
        # production floors: TILE_CONFIDENCE_FLOOR when tiled, the Ultralytics default at full frame.
        if confidence_floor is not None and (isinstance(confidence_floor, bool) or not isinstance(confidence_floor, (int, float))):
            raise TypeError(f"confidence_floor must be a number or None, not {confidence_floor!r}")
        if confidence_floor is not None and not 0 < confidence_floor <= TILE_CONFIDENCE_FLOOR:
            raise ValueError(f"confidence_floor may only lower the production floors: 0 < value <= {TILE_CONFIDENCE_FLOOR}, got {confidence_floor}")
        self.confidence_floor = confidence_floor
        self.recovery_invocations = 0  # entries into the recovery path (I-H0-3: 0 when switched off)
        self.weights = weights
        self.model: Any | None = None
        # Cheap to compute (availability flags only, no weights loaded) so it can be
        # reported by /api/v1/runtime/health before the first inference call.
        self.device: str = select_device()
        self._digest: str | None = None
        self._digest_key: tuple[int, int] | None = None

    def checkpoint_digest(self) -> str | None:
        """SHA256 of the frozen checkpoint, memoised against its size and mtime.

        Health is polled while the workstation is open, and hashing a ~20 MB
        checkpoint on every poll is pure waste. The cache key is the file's own
        size and modification time, so a swapped artifact is still re-hashed
        rather than trusted.
        """
        if not self.weights.is_file():
            self._digest = self._digest_key = None
            return None
        stat = self.weights.stat()
        key = (stat.st_size, stat.st_mtime_ns)
        if key != self._digest_key:
            self._digest = sha256(self.weights)
            self._digest_key = key
        return self._digest

    def health(self) -> dict[str, Any]:
        digest = self.checkpoint_digest()
        return {"runtime_available": digest == EXPECTED_SHA256, "device": self.device, "model_loaded": self.model is not None, "model_sha256": digest, "class_names": CLASSES,
                "shipwreck_recovery": self.shipwreck_recovery}

    def load(self) -> None:
        if self.model is not None: return
        if self.checkpoint_digest() != EXPECTED_SHA256:
            raise RuntimeError("final detector artifact missing or SHA256 mismatch")
        from ultralytics import YOLO
        self.model = YOLO(str(self.weights))

    def open_set_embedding(self, image_array: np.ndarray) -> np.ndarray:
        """Extract a deterministic frozen layer-16 embedding for one crop.

        The input follows the same RGB-to-BGR contract as detector inference. This
        method never emits detections and never mutates detector output.
        """
        import torch
        self.load()
        captured: list[Any] = []
        layer = self.model.model.model[16]
        hook = layer.register_forward_hook(lambda _module, _inputs, result: captured.append(result.detach()))
        try:
            self.model.predict(source=image_array, imgsz=640, device=self.device, verbose=False)
            if not captured:
                raise RuntimeError("OPEN_SET_FEATURES_UNAVAILABLE")
            feature_map = captured[-1]
            pooled = torch.nn.functional.adaptive_avg_pool2d(feature_map, (4, 4))
            values = pooled.permute(0, 2, 3, 1).reshape(-1, pooled.shape[1]).float()
            values = values / values.norm(dim=1, keepdim=True).clamp_min(1e-12)
            return values.mean(dim=0).detach().cpu().numpy().astype(np.float32)
        finally:
            hook.remove()

    def _predict_boxes(self, image_array: np.ndarray, conf: float | None = None) -> list[dict[str, Any]]:
        kwargs: dict[str, Any] = {"source": image_array, "imgsz": 640, "device": self.device, "verbose": False}
        if conf is not None:
            kwargs["conf"] = conf
        results = self.model.predict(**kwargs)
        boxes = []
        for box in results[0].boxes or []:
            class_id = int(box.cls.item())
            confidence = float(box.conf.item())
            x1, y1, x2, y2 = [float(v) for v in box.xyxy[0].tolist()]
            boxes.append({"class_id": class_id, "confidence": confidence, "bbox": (x1, y1, x2, y2)})
        return boxes

    def _infer_full_frame(self, image_array: np.ndarray) -> list[dict[str, Any]]:
        candidates = self._predict_boxes(image_array, conf=self.confidence_floor)
        for candidate in candidates:
            candidate["tile_id"] = None
        return candidates

    def _infer_tiled(self, image_array: np.ndarray, width: int, height: int) -> tuple[list[dict[str, Any]], int]:
        xs, ys = _tile_origins(width), _tile_origins(height)
        candidates: list[dict[str, Any]] = []
        tile_count = 0
        for row, oy in enumerate(ys):
            for col, ox in enumerate(xs):
                tile_count += 1
                crop = image_array[oy:min(oy + TILE_SIZE, height), ox:min(ox + TILE_SIZE, width)]
                pad_bottom, pad_right = TILE_SIZE - crop.shape[0], TILE_SIZE - crop.shape[1]
                if pad_bottom or pad_right:
                    crop = np.pad(crop, ((0, pad_bottom), (0, pad_right), (0, 0)), constant_values=0)
                tile_id = f"tile_r{row:02d}_c{col:02d}_x{ox:05d}_y{oy:05d}"
                floor = TILE_CONFIDENCE_FLOOR if self.confidence_floor is None else self.confidence_floor
                for candidate in self._predict_boxes(crop, conf=floor):
                    tx1, ty1, tx2, ty2 = candidate["bbox"]
                    fx1, fy1 = max(0.0, ox + tx1), max(0.0, oy + ty1)
                    fx2, fy2 = min(float(width), ox + tx2), min(float(height), oy + ty2)
                    if fx2 <= fx1 or fy2 <= fy1:
                        continue  # box fell entirely inside padding or was clipped away
                    candidates.append({"class_id": candidate["class_id"], "confidence": candidate["confidence"], "bbox": (fx1, fy1, fx2, fy2), "tile_id": tile_id})
        return candidates, tile_count

    def _recover_weak_shipwreck_cluster(self, image_array: np.ndarray, width: int, height: int) -> dict[str, Any] | None:
        """INTERNAL HACKATHON DEMO ONLY. Re-tiles the raster at a far lower
        confidence floor, keeps SHIPWRECK-only proposals, and looks for a
        spatially coherent cluster (>=RECOVERY_CLUSTER_MIN_SUPPORT proposals in
        mutual agreement). Returns a single consolidated candidate, or None if
        no such cluster exists -- never the single strongest isolated box.
        raw_confidence on the returned candidate is the true maximum YOLO score
        among the cluster's members, never fabricated or adjusted."""
        if not self.shipwreck_recovery:
            raise RuntimeError("the SHIPWRECK recovery pass is switched off for this detector")
        self.recovery_invocations += 1
        xs, ys = _tile_origins(width), _tile_origins(height)
        proposals: list[dict[str, Any]] = []
        for row, oy in enumerate(ys):
            for col, ox in enumerate(xs):
                crop = image_array[oy:min(oy + TILE_SIZE, height), ox:min(ox + TILE_SIZE, width)]
                pad_bottom, pad_right = TILE_SIZE - crop.shape[0], TILE_SIZE - crop.shape[1]
                if pad_bottom or pad_right:
                    crop = np.pad(crop, ((0, pad_bottom), (0, pad_right), (0, 0)), constant_values=0)
                tile_id = f"tile_r{row:02d}_c{col:02d}_x{ox:05d}_y{oy:05d}"
                for candidate in self._predict_boxes(crop, conf=RECOVERY_CONFIDENCE_FLOOR):
                    if candidate["class_id"] != SHIPWRECK_CLASS_ID:
                        continue  # never recovers PIPELINE/CRAB_POT
                    tx1, ty1, tx2, ty2 = candidate["bbox"]
                    fx1, fy1 = max(0.0, ox + tx1), max(0.0, oy + ty1)
                    fx2, fy2 = min(float(width), ox + tx2), min(float(height), oy + ty2)
                    if fx2 <= fx1 or fy2 <= fy1:
                        continue
                    proposals.append({"confidence": candidate["confidence"], "bbox": (fx1, fy1, fx2, fy2), "tile_id": tile_id})

        cluster = _strongest_coherent_cluster(proposals)
        if cluster is None:
            return None

        # The recovery object is the envelope of its coherent proposals. A
        # confidence-weighted mean of corners indents every edge toward the
        # centroid, which is not a defensible object extent.
        bbox = (
            min(member["bbox"][0] for member in cluster),
            min(member["bbox"][1] for member in cluster),
            max(member["bbox"][2] for member in cluster),
            max(member["bbox"][3] for member in cluster),
        )
        raw_confidence = max(member["confidence"] for member in cluster)  # true model max; never adjusted
        tile_diversity = len({member["tile_id"] for member in cluster})
        mean_cluster_iou = sum(_iou(bbox, member["bbox"]) for member in cluster) / len(cluster)
        return {
            "class_id": SHIPWRECK_CLASS_ID, "confidence": raw_confidence, "bbox": bbox, "tile_id": None,
            "evidence_count": len(cluster), "tile_diversity": tile_diversity, "mean_cluster_iou": mean_cluster_iou,
        }

    def infer(self, image_path: Path, survey_id: str, source_image_id: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        with Image.open(image_path) as image:
            rgb = image.convert("RGB")
            width, height = rgb.size
            # Raw ndarray sources are interpreted by Ultralytics/OpenCV as BGR.
            # PIL returns RGB, so convert once before full-frame and tiled paths.
            prepared = np.asarray(rgb)[:, :, ::-1].copy()
        self.load()

        tiled = needs_tiling(width, height)
        if tiled:
            candidates, tile_count = self._infer_tiled(prepared, width, height)
            candidates = _class_aware_nms(candidates)
            # INTERNAL HACKATHON DEMO ONLY: only when the normal >=0.12 tiled pass
            # found no SHIPWRECK at all does the weak-evidence recovery pass run.
            # A real SHIPWRECK survivor always bypasses this entirely.
            if self.shipwreck_recovery and not any(c["class_id"] == SHIPWRECK_CLASS_ID for c in candidates):
                recovered = self._recover_weak_shipwreck_cluster(prepared, width, height)
                if recovered is not None:
                    candidates.append(recovered)
        else:
            candidates = self._infer_full_frame(prepared)
            tile_count = 0
        candidates.sort(key=lambda c: (-c["confidence"], c["bbox"][0], c["bbox"][1]))

        findings = []
        for index, candidate in enumerate(candidates):
            class_id, confidence = candidate["class_id"], candidate["confidence"]
            x1, y1, x2, y2 = candidate["bbox"]
            raw_class = CLASSES[class_id]
            recovery = candidate.get("evidence_count") is not None
            if recovery:
                display = spatial_consensus_presentation(candidate["evidence_count"], candidate["tile_diversity"], candidate["mean_cluster_iou"])
            else:
                display = shipwreck_demo_presentation(raw_class, confidence)
            findings.append({
                "detection_id": f"det_{survey_id}_{source_image_id}_{index:04d}", "survey_id": survey_id,
                "source_frame_id": source_image_id, "source_image_path": str(image_path), "tile_id": candidate["tile_id"],
                "raw_class_id": class_id, "raw_class": raw_class, "raw_confidence": confidence,
                "display_confidence_source": None, **display,
                "candidate_recovery": recovery, "evidence_count": candidate.get("evidence_count"),
                "anomaly_score": None, "bbox_px": [x1, y1, x2, y2], "bbox_normalized": [x1 / width, y1 / height, x2 / width, y2 / height],
                "pixel_dimensions": [width, height], "geo": {"lat": None, "lon": None}, "review_state": None, "review_history": [],
                "model_id": "sagardrishti_multidomain_v1_1_yolo11s", "model_sha256": EXPECTED_SHA256,
                "dataset_snapshot_id": "multidomain_sonar_v1_1_20260831", "run_id": f"runtime_{survey_id}",
                "inference_mode": "TILED" if tiled else "FULL_FRAME", "tile_size": TILE_SIZE if tiled else None,
                "tile_overlap": TILE_OVERLAP if tiled else None,
            })
        meta = {"width_px": width, "height_px": height, "inference_mode": "TILED" if tiled else "FULL_FRAME", "tile_count": tile_count}
        return meta, findings
