"""Open-set payload and frozen-backbone nearest-neighbour runtime."""
from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
from typing import Any
import hashlib
import json
import numpy as np

OPEN_SET_VERSION = "open_set_v1"

class OpenSetUnavailable(RuntimeError):
    """Raised when a provenance-valid open-set artifact is unavailable."""
    pass

def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()

@dataclass(frozen=True)
class OpenSetEvidence:
    anomaly_score:float|None=None; threshold:float|None=None; threshold_source:str|None=None; feature_source:str|None=None; memory_version:str|None=None
    status: str = "NOT_CONFIGURED"
    missing_inputs: tuple[str, ...] = ()
    @property
    def is_open_set_candidate(self)->bool:
        return self.anomaly_score is not None and self.threshold is not None and self.anomaly_score >= self.threshold
    def model_dump(self)->dict[str,object]: return {**self.__dict__,"missing_inputs":list(self.missing_inputs),"is_open_set_candidate":self.is_open_set_candidate}

@dataclass(frozen=True)
class OpenSetMemoryBank:
    """PatchCore-style bank over embeddings from a frozen YOLO feature layer."""
    embeddings: np.ndarray
    threshold: float | None = None
    threshold_source: str | None = None
    feature_source: str = "frozen_feature_embeddings"
    memory_version: str = OPEN_SET_VERSION
    artifact_sha256: str | None = None

    @classmethod
    def load(cls, artifact_dir: str | Path) -> "OpenSetMemoryBank":
        root = Path(artifact_dir)
        config = json.loads((root / "config.json").read_text())
        bank_path = root / "memory_bank.npz"
        expected = config.get("memory_bank_sha256")
        actual = _sha256(bank_path)
        if expected and expected != actual:
            raise OpenSetUnavailable("OPEN_SET_MEMORY_HASH_MISMATCH")
        embeddings = np.load(bank_path, allow_pickle=False)["embeddings"].astype(np.float32)
        if embeddings.ndim != 2 or not len(embeddings):
            raise OpenSetUnavailable("OPEN_SET_MEMORY_EMPTY")
        return cls(embeddings, float(config["threshold"]), str(config["threshold_source"]),
                   str(config["feature_source"]), str(config["memory_version"]), actual)

    @classmethod
    def from_train_background(cls, embeddings: Any, split: str, annotation_free: bool) -> "OpenSetMemoryBank":
        if split != "train":
            raise ValueError("open-set memory bank may only be built from the train split")
        if not annotation_free:
            raise ValueError("open-set memory bank requires annotation-free background patches")
        rows = [np.asarray(row, dtype=np.float32) for row in embeddings]
        if not rows:
            raise OpenSetUnavailable("BACKBONE_EMBEDDINGS_UNAVAILABLE")
        return cls(np.vstack(rows))

    def score(self, embedding: np.ndarray) -> Any:
        query = np.asarray(embedding, dtype=np.float32)
        if query.ndim == 1:
            query = query.reshape(1, -1)
        if query.shape[1] != self.embeddings.shape[1]:
            raise ValueError("open-set embedding dimension does not match memory bank")
        scores = np.sqrt(((query[:, None, :] - self.embeddings[None, :, :]) ** 2).sum(axis=2)).min(axis=1)
        return float(scores[0]) if len(scores) == 1 and np.asarray(embedding).ndim == 1 else scores

    def threshold_for(self, survey_scores: np.ndarray, tau_min: float = 0.0) -> float:
        if not len(survey_scores):
            raise OpenSetUnavailable("NO_SURVEY_SCORES")
        return float(max(tau_min, np.quantile(survey_scores, .995)))

    # Compatibility name used by the original perception scaffold.
    def threshold(self, survey_scores: np.ndarray, tau_min_global: float) -> float:
        return self.threshold_for(survey_scores, tau_min_global)

    def evidence(self, embedding: np.ndarray) -> dict[str, Any]:
        score = float(self.score(embedding))
        return OpenSetEvidence(score, self.threshold, self.threshold_source, self.feature_source,
                               self.memory_version, "AVAILABLE", ()).model_dump() | {
                                   "artifact_sha256": self.artifact_sha256,
                               }
