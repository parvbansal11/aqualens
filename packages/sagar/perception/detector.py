"""Read-only integration for the frozen internal_v2 supervised detector."""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sagar.core.models import ModelVersion, UnifiedClass


class DetectorUnavailable(RuntimeError):
    """Raised when inference is requested without the optional model runtime."""


@dataclass(frozen=True)
class FrozenDetectorArtifact:
    artifact_dir: Path
    checkpoint: Path
    metrics_path: Path
    weights_sha256: str
    metrics: dict[str, Any]

    @property
    def model_version(self) -> ModelVersion:
        winner = self.metrics["winner"]
        return ModelVersion(
            model_version_id="internal_v2",
            model_id="sagardrishti-internal-detector",
            version="internal_v2",
            architecture=winner["name"],
            init_from="not supplied in frozen artifact",
            framework="ultralytics",
            device_trained=self.metrics.get("device", "unknown"),
            weights_sha256=self.weights_sha256,
            size_mb=float(winner.get("checkpoint_mb", self.checkpoint.stat().st_size / 1024**2)),
            snapshot_id=self.metrics["dataset_snapshot_id"],
            split_id="split recorded by DatasetSnapshot",
            train_run_id=self.metrics["experiment"],
            classes=[UnifiedClass(value) for value in self.metrics["supervised_classes"]],
            metrics_ref=str(self.metrics_path),
            calibration_id=None,
            review_examples_included=0,
            is_active=True,
        )

    def load_predictor(self) -> Any:
        """Load only when Ultralytics is deliberately installed for inference.

        This never writes to the frozen artifact directory and keeps the package usable in
        API-only deployments which do not bundle Torch.
        """
        try:
            from ultralytics import YOLO  # type: ignore[import-not-found]
        except ImportError as exc:
            raise DetectorUnavailable(
                "MODEL_UNAVAILABLE: install the approved Ultralytics/Torch inference runtime; "
                "internal_v2 remains read-only."
            ) from exc
        return YOLO(str(self.checkpoint))


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_frozen_detector_artifact(path: str | Path) -> FrozenDetectorArtifact:
    artifact_dir = Path(path).resolve()
    checkpoint = artifact_dir / "best.pt"
    metrics_path = artifact_dir / "metrics.json"
    if not checkpoint.is_file() or not metrics_path.is_file():
        raise FileNotFoundError("internal_v2 requires best.pt and metrics.json in the supplied artifact directory")
    with metrics_path.open() as handle:
        metrics = json.load(handle)
    if metrics.get("experiment") != "internal_v2":
        raise ValueError("artifact metrics do not identify frozen internal_v2")
    if metrics.get("supervised_classes") != ["PIPELINE"]:
        raise ValueError("internal_v2 contract permits PIPELINE as its sole supervised class")
    return FrozenDetectorArtifact(
        artifact_dir=artifact_dir,
        checkpoint=checkpoint,
        metrics_path=metrics_path,
        weights_sha256=_sha256(checkpoint),
        metrics=metrics,
    )
