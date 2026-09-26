"""SQLite WAL review memory with evaluation-split feedback safeguards."""
from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sagar.core.models import Review, ReviewVerdict
from sagar.evaluation.splits import feedback_training_eligible


class ReviewRepository:
    def __init__(self, database_path: str | Path) -> None:
        self.database_path = Path(database_path)
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("CREATE TABLE IF NOT EXISTS review_events (review_id TEXT PRIMARY KEY, detection_id TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL)")

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self.database_path)

    def append(self, detection: dict[str, Any], payload: dict[str, Any], split: dict[str, Any], licence_permits_training: bool = True) -> Review:
        has_review = True
        eligible, reason = feedback_training_eligible(detection["frame_id"], split, has_review, licence_permits_training)
        review = Review(
            review_id=f"rev_{uuid.uuid4().hex[:12]}", detection_id=detection["detection_id"],
            verdict=ReviewVerdict(payload["verdict"]), corrected_class=payload.get("corrected_class"),
            corrected_bbox_px=tuple(payload["corrected_bbox_px"]) if payload.get("corrected_bbox_px") else None,
            notes=payload.get("notes"), reviewer=payload["reviewer"],
            created_at=datetime.now(timezone.utc), model_version_id_at_prediction=detection.get("model", {}).get("model_version_id"),
            confidence_at_prediction=detection.get("model", {}).get("confidence_at_prediction"),
            training_eligible=eligible, training_eligible_reason=reason,
        )
        encoded = review.model_dump(mode="json")
        with self._connect() as conn:
            conn.execute("INSERT INTO review_events(review_id, detection_id, payload, created_at) VALUES (?, ?, ?, ?)", (review.review_id, review.detection_id, json.dumps(encoded), encoded["created_at"]))
        return review

    def list(self, detection_id: str) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute("SELECT payload FROM review_events WHERE detection_id = ? ORDER BY created_at", (detection_id,)).fetchall()
        return [json.loads(row[0]) for row in rows]

    def stats(self) -> dict[str, Any]:
        with self._connect() as conn:
            rows = [json.loads(row[0]) for row in conn.execute("SELECT payload FROM review_events")]
        verdicts = {verdict.value: sum(row["verdict"] == verdict.value for row in rows) for verdict in ReviewVerdict}
        return {"reviewed": len(rows), "confirmed": verdicts["CONFIRMED"], "rejected": verdicts["REJECTED"], "relabelled": verdicts["RELABELLED"], "training_eligible": sum(bool(row["training_eligible"]) for row in rows), "by_model_version": {}}

    def export_training_manifests(self, output_dir: str | Path, detections: dict[str, dict[str, Any]]) -> dict[str, int]:
        """Deterministically materialise review memory only; this does not train or copy imagery."""
        destination = Path(output_dir); destination.mkdir(parents=True, exist_ok=True)
        buckets = {"hard_negative_manifest.jsonl": [], "confirmed_positive_manifest.jsonl": [], "uncertain_manifest.jsonl": []}
        with self._connect() as conn:
            rows = [json.loads(row[0]) for row in conn.execute("SELECT payload FROM review_events ORDER BY created_at, review_id")]
        for review in rows:
            detection = detections.get(review["detection_id"], {})
            record = {"contact_id": detection.get("contact_id"), "source_detection_ids": [review["detection_id"]], "source_frame": detection.get("frame_id"),
                      "crop_identity_hash": detection.get("crop_identity_hash"), "model_prediction": detection.get("category"), "model_raw_confidence": detection.get("class_confidence"),
                      "evidence_score": detection.get("evidence_score"), "analyst_verdict": review["verdict"], "analyst_relabel": review.get("corrected_class"),
                      "rejection_reason": detection.get("rejection_reason"), "sensor_context": detection.get("sensor_context"), "model_version": review.get("model_version_id_at_prediction"), "timestamp": review["created_at"]}
            target = "hard_negative_manifest.jsonl" if review["verdict"] == "REJECTED" else "confirmed_positive_manifest.jsonl" if review["verdict"] == "CONFIRMED" else "uncertain_manifest.jsonl"
            buckets[target].append(record)
        for name, records in buckets.items(): (destination / name).write_text("".join(json.dumps(r, sort_keys=True) + "\n" for r in records))
        return {name: len(records) for name, records in buckets.items()}
