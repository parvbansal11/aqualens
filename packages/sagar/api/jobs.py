"""Observable job state for uploaded survey runs.

The processing screen is only allowed to show what the backend actually
observed, so every field here is a real count, a real availability flag or a
real phase transition. There is deliberately no percentage field: the only
ratio this module publishes is ``frames_completed`` over ``source_frame_count``,
both of which are counted, never estimated.

Jobs are persisted in the existing runtime SQLite database when configured.
Interrupted jobs fail explicitly on restart; inference is never silently repeated.
"""
from __future__ import annotations

import threading
import sqlite3
import json
from pathlib import Path
from collections import OrderedDict
from datetime import datetime, timezone
from typing import Any, Iterable

# Canonical, ordered phases. A phase appears in the payload only after the
# backend has actually entered or resolved it.
PHASES: tuple[tuple[str, str], ...] = (
    ("upload_decoded", "Upload decoded"),
    ("metadata_read", "Survey metadata read"),
    ("detector_ready", "Frozen detector loaded"),
    ("inference", "Detector inference over source frames"),
    ("condition", "Sonar condition assessment"),
    ("open_set", "Open-set anomaly evidence"),
    ("contact_fusion", "Contact fusion"),
    ("evidence", "Evidence fusion and recovery priority"),
    ("report", "Report records prepared"),
)

STEP_STATES = ("queued", "running", "done", "skipped", "unavailable", "failed")

# Jobs are progress telemetry; only the most recent runs are retained.
MAX_RETAINED_JOBS = 200


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class JobRegistry:
    """Thread-safe, bounded store of job payloads.

    Uploads are processed on a worker thread while the API keeps serving
    polls, so every read and write goes through one lock and every read hands
    back a detached copy.
    """

    def __init__(self, limit: int = MAX_RETAINED_JOBS, database_path: Path | None = None) -> None:
        self._lock = threading.Lock()
        self._jobs: "OrderedDict[str, dict[str, Any]]" = OrderedDict()
        self._limit = limit
        self._database_path = database_path
        if database_path:
            with sqlite3.connect(database_path) as db:
                db.execute('CREATE TABLE IF NOT EXISTS processing_jobs (id TEXT PRIMARY KEY, payload TEXT NOT NULL)')
                for identifier, encoded in db.execute('SELECT id,payload FROM processing_jobs'):
                    payload = json.loads(encoded)
                    if payload.get('state') not in {'COMPLETED', 'FAILED'}:
                        payload.update(state='FAILED', stage='failed', completed_at=_now(),
                            error={'code': 'PROCESS_INTERRUPTED', 'message': 'Server restarted before completion; no automatic rerun.', 'phase': payload.get('phase')})
                    self._jobs[identifier] = payload
                for identifier in list(self._jobs):
                    self._persist(identifier)

    def _persist(self, identifier):
        if self._database_path:
            with sqlite3.connect(self._database_path, timeout=30) as db:
                db.execute('INSERT INTO processing_jobs VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',
                           (identifier, json.dumps(self._jobs[identifier])))

    def create(self, job_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            self._jobs[job_id] = payload
            self._jobs.move_to_end(job_id)
            self._persist(job_id)
            while len(self._jobs) > self._limit:
                self._jobs.popitem(last=False)
            return dict(payload)

    def get(self, job_id: str) -> dict[str, Any] | None:
        with self._lock:
            payload = self._jobs.get(job_id)
            if payload is None and self._database_path:
                with sqlite3.connect(self._database_path) as db:
                    row = db.execute('SELECT payload FROM processing_jobs WHERE id=?', (job_id,)).fetchone()
                    payload = json.loads(row[0]) if row else None
            return _deep_copy(payload) if payload is not None else None

    def update(self, job_id: str, **changes: Any) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return
            job.update(changes)
            job["updated_at"] = _now()
            self._persist(job_id)

    def increment(self, job_id: str, field: str, amount: int = 1) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return
            job[field] = int(job.get(field) or 0) + amount
            job["updated_at"] = _now()
            self._persist(job_id)

    def set_phase(self, job_id: str, phase: str, state: str, detail: str | None = None) -> None:
        """Record one phase transition. ``state`` must be a real observed state."""
        if state not in STEP_STATES:
            raise ValueError(f"unknown job step state: {state}")
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return
            steps = job.setdefault("steps", {})
            entry = steps.setdefault(phase, {"state": "queued", "detail": None})
            entry["state"] = state
            if detail is not None:
                entry["detail"] = detail
            if state == "running":
                job["phase"] = phase
            job["updated_at"] = _now()
            self._persist(job_id)

    def fail(self, job_id: str, code: str, message: str, phase: str | None = None) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return
            job["state"] = "FAILED"
            job["stage"] = "failed"
            job["error"] = {"code": code, "message": message, "phase": phase or job.get("phase")}
            job["completed_at"] = _now()
            job["updated_at"] = job["completed_at"]
            if phase:
                steps = job.setdefault("steps", {})
                entry = steps.setdefault(phase, {"state": "queued", "detail": None})
                entry["state"] = "failed"
                entry["detail"] = message
            self._persist(job_id)


def _deep_copy(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _deep_copy(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_deep_copy(item) for item in value]
    return value


def new_job(
    *,
    job_id: str,
    survey_id: str,
    upload: dict[str, Any],
    detector: dict[str, Any],
    open_set: dict[str, Any],
) -> dict[str, Any]:
    """A job payload whose every field is already true at creation time."""
    created = _now()
    return {
        "job_id": job_id,
        "survey_id": survey_id,
        "state": "QUEUED",
        "stage": "queued",
        "phase": None,
        "created_at": created,
        "updated_at": created,
        "completed_at": None,
        # Legacy counters kept so existing clients keep working unchanged.
        "files_parsed": 0,
        "images_processed": 0,
        "tiles_processed": 0,
        "detections_generated": 0,
        "upload": upload,
        "source_frame_count": upload.get("raster_count", 0),
        "frames_completed": 0,
        "metadata": {
            "navigation": "UNAVAILABLE",
            "mission": "UNAVAILABLE",
            "sequential_observation_contract": False,
        },
        "detector": detector,
        "open_set": open_set,
        "contacts_fused": None,
        "report_ready": False,
        "steps": {},
        "error": None,
    }


def render_job(job: dict[str, Any]) -> dict[str, Any]:
    """Public payload: the stored job plus its ordered, named step list.

    Steps that the backend has not reached remain ``queued``; steps whose
    component is not configured in this deployment are ``unavailable`` with the
    reason, never animated as if they were running.
    """
    stored_steps: dict[str, dict[str, Any]] = job.get("steps") or {}
    ordered = [
        {
            "id": phase_id,
            "label": label,
            "state": stored_steps.get(phase_id, {}).get("state", "queued"),
            "detail": stored_steps.get(phase_id, {}).get("detail"),
        }
        for phase_id, label in PHASES
    ]
    return {**job, "steps": ordered}


def phase_labels() -> Iterable[tuple[str, str]]:
    return PHASES
