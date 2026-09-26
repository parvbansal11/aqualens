"""Contract-conformant API over real frozen-model run artifacts."""
from __future__ import annotations

import csv
import io
import json
import os
import threading
import uuid
import shutil
import zipfile
from datetime import datetime, timezone
from collections import Counter
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

from sagar.api.jobs import JobRegistry, new_job, render_job
from sagar.memory import ReviewRepository
from sagar.mission.change import ComparisonRefused, change_summary, compare_detections
from sagar.perception.navigation import (
    NavigationValidationError,
    finding_navigation_view,
    frame_navigation_view,
    parse_mission_json,
    parse_navigation_csv,
)
from sagar.perception.runtime import FinalDetector
from sagar.vnext import ModelRegistry, SonarConditionEngine, fuse_contact_confidence, fuse_contacts, score_contact
from sagar.vnext.openset import OpenSetMemoryBank, OpenSetUnavailable
from sagar.vnext.physics import verify_candidate, verify_pipeline_acoustics
from sagar.vnext.priority import prioritize


class ReviewInput(BaseModel):
    verdict: str
    corrected_class: str | None = None
    corrected_bbox_px: list[float] | None = None
    notes: str | None = None
    rejection_reason: str | None = None
    reviewer: str = Field(min_length=1)


class CompareInput(BaseModel):
    baseline_survey_id: str
    new_survey_id: str
    confirmed_only: bool = False


class PreparedSurveyInput(BaseModel):
    """Open the immutable, locally materialised frozen survey for operator review."""
    label: str | None = Field(default=None, max_length=120)


def _error(status: int, code: str, message: str, detail: dict[str, Any] | None = None) -> HTTPException:
    return HTTPException(status_code=status, detail={"error": {"code": code, "message": message, "detail": detail or {}}})


def _model_dump(value: Any) -> Any:
    return value.model_dump(mode="json") if hasattr(value, "model_dump") else value


class Store:
    def __init__(self, root: Path) -> None:
        self.root = root
        stage3c_run = root / "runs/run_stage3c_v4"
        self.run_dir = stage3c_run if (stage3c_run / "manifest.json").is_file() else root / "runs/run_internal_v2_evidence_v1"
        if not self.run_dir.is_dir():
            raise FileNotFoundError("No materialized frozen-model evidence run is available.")
        self.manifest = json.loads((self.run_dir / "manifest.json").read_text())
        self.benchmark = json.loads((self.run_dir / "benchmark.json").read_text())
        self.model = json.loads((self.run_dir / "model_version.json").read_text())
        self.frames = {row["frame_id"]: row for row in json.loads((self.run_dir / "frames.json").read_text())}
        self.detections = {row["detection_id"]: row for row in json.loads((self.run_dir / "detections.json").read_text())}
        self.snapshot_dir = root / "data/processed/snap_2fa4bca0a0bc4b7d"
        self.split = json.loads((self.snapshot_dir / "split.json").read_text())
        runtime_dir_env = os.environ.get("SAGARDRISHTI_RUNTIME_DIR", "").strip()
        runtime_root = Path(runtime_dir_env).expanduser().resolve() if runtime_dir_env else root / "data" / "runtime"
        runtime_root.mkdir(parents=True, exist_ok=True)
        self.reviews = ReviewRepository(runtime_root / "reviews.sqlite3")
        self.comparisons: dict[str, dict[str, Any]] = {}
        self.jobs = JobRegistry()
        # Survey processing runs on a worker thread while the API keeps serving
        # job polls, so every mutation of the persisted runtime state is
        # serialised through one lock.
        self.state_lock = threading.RLock()
        self.started_at = datetime.now(timezone.utc)
        self.uploads = runtime_root / "uploads"
        self.uploads.mkdir(parents=True, exist_ok=True)

        model_path_env = os.environ.get("SAGARDRISHTI_MODEL_PATH", "").strip()
        if model_path_env:
            model_path = Path(model_path_env).expanduser()
            if not model_path.is_absolute():
                model_path = (root / model_path).resolve()
        else:
            model_path = root / "ml/artifacts/final_v1/detector/best.pt"
        if not model_path.is_file():
            configured = "SAGARDRISHTI_MODEL_PATH is set" if model_path_env else "the default model path is in use"
            raise FileNotFoundError(
                f"Frozen detector artifact is missing at '{model_path}' ({configured}). "
                "Refusing to start rather than silently substituting a different model."
            )
        self.runtime = FinalDetector(model_path)
        self.open_set = None
        open_set_dir_env = os.environ.get("SAGARDRISHTI_OPEN_SET_DIR", "").strip()
        open_set_dir = Path(open_set_dir_env).expanduser() if open_set_dir_env else root / "ml/artifacts/vnext/open_set_v1"
        if not open_set_dir.is_absolute():
            open_set_dir = (root / open_set_dir).resolve()
        if open_set_dir_env and not open_set_dir.is_dir():
            raise FileNotFoundError(
                f"SAGARDRISHTI_OPEN_SET_DIR is set to '{open_set_dir}' but no artifact directory exists there. "
                "Refusing to start with a configured but unavailable open_set_v1 artifact."
            )
        if open_set_dir.is_dir():
            try:
                self.open_set = OpenSetMemoryBank.load(open_set_dir)
            except (OSError, KeyError, ValueError, OpenSetUnavailable) as exc:
                if open_set_dir_env:
                    raise RuntimeError(
                        f"Configured open_set_v1 artifact at '{open_set_dir}' is invalid: {exc}"
                    ) from exc
                self.open_set = None
        open_set_health = {"availability": "AVAILABLE", "available": True, "role": "ADVISORY_OPEN_SET_EVIDENCE",
                           "method": "PATCHCORE_STYLE_OPEN_SET", "memory_version": self.open_set.memory_version,
                           "feature_source": self.open_set.feature_source, "threshold": self.open_set.threshold,
                           "threshold_source": self.open_set.threshold_source} if self.open_set else {
                               "availability": "NOT_CONFIGURED", "available": False, "role": "ADVISORY_OPEN_SET_EVIDENCE"}
        self.model_registry = ModelRegistry(self.runtime.health()["runtime_available"], open_set=open_set_health)
        self.conditions = SonarConditionEngine()

        self.runtime_state_path = runtime_root / "runtime_surveys.json"
        self.runtime_state_path.parent.mkdir(parents=True, exist_ok=True)
        self.runtime_surveys: dict[str, dict[str, Any]] = json.loads(self.runtime_state_path.read_text()) if self.runtime_state_path.exists() else {}
        # Records written before VNEXT contact/evidence materialization retain
        # raw detector observations but not a Contact payload. Rehydrate only
        # those records from their retained upload and declared metadata; never
        # rerun or alter detector inference.
        if self._hydrate_legacy_runtime_surveys():
            self.save_runtime_surveys()

    def _hydrate_legacy_runtime_surveys(self) -> bool:
        changed = False
        for survey in self.runtime_surveys.values():
            if "contacts" in survey or not survey.get("findings"):
                continue
            frames = survey.get("frames", [])
            frame_index = {frame.get("frame_id"): index for index, frame in enumerate(frames)}
            source_paths = [Path(frame["source_path"]) for frame in frames if frame.get("source_path")]
            bundle = source_paths[0].parent if source_paths else None
            navigation: dict[str, dict[str, Any]] = {}
            mission: dict[str, Any] | None = survey.get("mission")
            if bundle and (bundle / "navigation.csv").is_file():
                navigation = parse_navigation_csv(bundle / "navigation.csv")
            if bundle and (bundle / "mission.json").is_file():
                mission = {**(mission or {}), **parse_mission_json(bundle / "mission.json")}
            sequential = bool((mission or {}).get("sequential_observations"))
            conditions: dict[str, dict[str, Any]] = {}
            pixels_by_frame: dict[str, Any] = {}
            for finding in survey["findings"]:
                source = Path(finding["source_image_path"])
                nav = navigation.get(source.name)
                finding.update(finding_navigation_view(nav))
                finding["frame_index"] = frame_index.get(finding.get("source_frame_id"), 0)
                finding["ping_start"] = nav.get("ping_start") if nav else None
                finding["ping_end"] = nav.get("ping_end") if nav else None
                finding["sequential_observation_supported"] = bool(
                    sequential and nav and nav.get("ping_start") is not None and nav.get("ping_end") is not None
                )
                if not source.is_file():
                    continue
                if finding["source_frame_id"] not in conditions:
                    from PIL import Image
                    import numpy as np
                    with Image.open(source) as image:
                        pixels = np.asarray(image.convert("RGB"))
                    pixels_by_frame[finding["source_frame_id"]] = pixels
                    conditions[finding["source_frame_id"]] = self.conditions.assess(pixels, {"navigation_available": nav is not None})
                condition = conditions[finding["source_frame_id"]]
                pixels = pixels_by_frame[finding["source_frame_id"]]
                frame = next((item for item in frames if item.get("frame_id") == finding["source_frame_id"]), {})
                shape = (frame.get("height_px"), frame.get("width_px"))
                finding["sonar_condition"] = condition
                finding["sonar_evidence"] = self.conditions.candidate_overlap(finding["bbox_px"], shape, condition)
                # Orientation remains unknown until calibrated range-side metadata exists.
                finding["physics"] = verify_candidate(pixels, finding["bbox_px"], None, condition)
            contacts = fuse_contacts(survey["findings"], survey["survey_id"])
            for contact in contacts:
                supporting = [item for item in survey["findings"] if item["detection_id"] in contact["source_detection_ids"]]
                quality = [item["sonar_condition"]["quality_score"] for item in supporting if item.get("sonar_condition")]
                contact["quality_score"] = sum(quality) / len(quality) if quality else None
                contact["quality_flags"] = sorted({flag for item in supporting for flag in item.get("sonar_condition", {}).get("quality_flags", [])})
                contact["nadir_overlap"] = max((item.get("sonar_evidence", {}).get("nadir_overlap") for item in supporting), default=None)
                contact["physics_consistency"] = None
                contact["evidence_breakdown"] = score_contact(contact)
                contact["evidence_score"] = contact["evidence_breakdown"]["evidence_score"]
                contact["evidence_strength"] = contact["evidence_score"]
                confidence = fuse_contact_confidence(contact)
                contact.update({key: confidence[key] for key in ("confidence", "raw_fused_confidence", "normalized_confidence", "raw_detector_confidence", "confidence_components", "confidence_method", "confidence_normalization", "confidence_normalization_range", "confidence_normalization_reference_center", "confidence_normalization_steepness", "confidence_normalization_note")})
                contact.update(prioritize(contact))
            survey.update({"contacts": contacts, "mission": mission, "model_registry": self.model_registry.health(),
                           "contact_fusion_policy": "contact_fusion@v1", "sequential_observation_contract": sequential})
            changed = True
        return changed

    def save_runtime_surveys(self) -> None:
        """Persist uploaded-survey state locally; this is runtime data, never a dataset artifact.

        Written to a sibling temp file and atomically replaced, so an interrupted
        write can never leave a truncated state file behind. Serialised through
        ``state_lock`` because upload processing runs on a worker thread.
        """
        with self.state_lock:
            temp = self.runtime_state_path.with_suffix(".tmp")
            temp.write_text(json.dumps(self.runtime_surveys, indent=2, sort_keys=True))
            temp.replace(self.runtime_state_path)

    def open_set_health(self) -> dict[str, Any]:
        return self.model_registry.health()["open_set"]

    def runtime_survey_index(self, limit: int) -> list[dict[str, Any]]:
        """Newest-first summary of retained runtime surveys.

        This is the reconnect path: a client that lost its session (a reload, a
        different tab, a restarted browser) can find the survey it was working
        on again instead of being told to upload it a second time.
        """
        with self.state_lock:
            surveys = list(self.runtime_surveys.values())
        rows = []
        for survey in surveys:
            findings = survey.get("findings") or []
            contacts = survey.get("contacts") or []
            rows.append({
                "survey_id": survey.get("survey_id"),
                "name": survey.get("name"),
                "created_at": survey.get("created_at"),
                "frame_count": len(survey.get("frames") or []),
                "finding_count": len(findings),
                "contact_count": len(contacts),
                "reviewed_count": sum(1 for item in findings if item.get("review_state")),
                "navigation_status": survey.get("navigation_status") or "UNAVAILABLE",
            })
        rows.sort(key=lambda row: row.get("created_at") or "", reverse=True)
        return rows[:limit]

    def survey(self) -> dict[str, Any]:
        levels = {row.get("geometry", {}).get("level", "L0_PIXEL_ONLY") for row in self.frames.values()}
        level = "L0_PIXEL_ONLY" if "L0_PIXEL_ONLY" in levels else "L1_TILE_RELATIVE"
        return {
            "survey_id": "survey_subpipe_mini2_internal_v2", "mission_id": "mission_subpipe_mini2", "name": "SubPipeMini2 internal_v2 held-out evidence", "dataset_id": "subpipe",
            "sensor": "Klein 3500", "frequency_khz": 900.0, "acquired_at": None, "is_demo": False, "demo_banner": None,
            "spatial_reference_level": level, "level_reason": "Mini2 does not expose calibrated PICS navigation for this frozen evaluation subset.",
            "frame_count": len(self.frames), "tile_count": sum(1 for row in self._tiles() if row["source_frame_id"] in self.frames),
            "coverage_polygon": None, "coverage_provenance": "NONE", "track": None,
            "capability_gates": {"nav_available": True, "ping_order_recoverable": True, "nadir_recoverable": level != "L0_PIXEL_ONLY", "range_scale_known": False},
            "latest_run_id": self.manifest["run_id"],
        }

    def mission(self) -> dict[str, Any]:
        return {"mission_id": "mission_subpipe_mini2", "name": "SubPipeMini2 internal evidence", "operator": None, "created_at": self.manifest["created_at"], "survey_ids": [self.survey()["survey_id"]], "notes": "Frozen internal_v2 real Stage 3C inference and evidence; L0 geometry limitations remain explicit."}

    def _tiles(self) -> list[dict[str, Any]]:
        with (self.snapshot_dir / "tiles.jsonl").open() as handle:
            return [json.loads(line) for line in handle if line.strip()]

    def detection(self, detection_id: str) -> dict[str, Any]:
        value = self.detections.get(detection_id)
        if value is None:
            raise _error(404, "NOT_FOUND", f"Detection {detection_id} was not found.")
        history = self.reviews.list(detection_id)
        value = json.loads(json.dumps(value))
        if history:
            last = history[-1]
            value["review"] = {"latest_verdict": last["verdict"], "review_count": len(history), "reviewed_at": last["created_at"], "reviewer": last["reviewer"]}
            value["provenance"]["review"] = "OPERATOR_PROVIDED"
        return value

    def report_rows(self) -> list[dict[str, Any]]:
        rows = []
        for detection_id in self.detections:
            item = self.detection(detection_id)
            rows.append({
                "detection_id": item["detection_id"], "classification": item["category"], "kind": item["kind"],
                "class_confidence": item["class_confidence"], "anomaly_score": item["anomaly_score"],
                "review_state": item["review"]["latest_verdict"], "latitude": item["geo"]["lat"],
                "longitude": item["geo"]["lon"], "length_m": item["dimensions"]["length_m"],
                "width_m": item["dimensions"]["width_m"], "source_frame": item["frame_id"],
                "source_tile": item["tile_id"], "run_id": item["run_id"],
                "model_version_id": item["model"]["model_version_id"],
            })
        return rows


def create_app(root: str | Path | None = None) -> FastAPI:
    project_root = Path(root or Path.cwd()).resolve()
    store = Store(project_root)
    app = FastAPI(
        title="Aqualens API",
        description="Marine survey analysis and review API for the Aqualens platform.",
        version="0.1.0",
    )
    # Production origins are explicit and env-driven (SAGARDRISHTI_ALLOWED_ORIGINS,
    # comma-separated). Local dev keeps the existing behaviour: the workstation dev
    # server is permitted on any loopback port without widening CORS beyond it.
    allowed_origins_env = os.environ.get("SAGARDRISHTI_ALLOWED_ORIGINS", "").strip()
    if allowed_origins_env:
        cors_kwargs: dict[str, Any] = {
            "allow_origins": [origin.strip() for origin in allowed_origins_env.split(",") if origin.strip()],
        }
    else:
        cors_kwargs = {"allow_origin_regex": r"^http://(localhost|127\.0\.0\.1):[0-9]+$"}
    app.add_middleware(
        CORSMiddleware,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        **cors_kwargs,
    )

    @app.exception_handler(HTTPException)
    async def http_exception(_request, exc: HTTPException):  # type: ignore[no-untyped-def]
        if isinstance(exc.detail, dict) and "error" in exc.detail:
            return JSONResponse(status_code=exc.status_code, content=exc.detail)
        return JSONResponse(status_code=exc.status_code, content={"error": {"code": "INTERNAL", "message": str(exc.detail), "detail": {}}})

    @app.get("/api/v1/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "run_id": store.manifest["run_id"]}

    @app.get("/api/v1/runtime/health")
    def runtime_health() -> dict[str, Any]:
        """Production host health check target and the operator diagnostics source.

        Reports what is actually available: API liveness, the frozen detector and
        its digest, the selected compute device, every optional component's real
        availability, and how much runtime state this deployment is holding. No
        filesystem paths and no secrets.
        """
        health = store.runtime.health()
        with store.state_lock:
            survey_count = len(store.runtime_surveys)
        degraded = [name for name, value in store.model_registry.health().items() if value.get("availability") == "FAILED"]
        return {
            "status": "degraded" if degraded or not health["runtime_available"] else "ok",
            **health,
            "optional_models": store.model_registry.health(),
            "api_version": app.version,
            "started_at": store.started_at.isoformat(),
            "uptime_seconds": (datetime.now(timezone.utc) - store.started_at).total_seconds(),
            "runtime_surveys_retained": survey_count,
            "frozen_evidence_run_id": store.manifest["run_id"],
        }

    @app.get("/api/v1/runtime/surveys")
    def list_runtime_surveys(limit: int = Query(default=25, le=200)) -> dict[str, Any]:
        """Newest-first index of retained runtime surveys, for reconnect/recovery."""
        rows = store.runtime_survey_index(limit)
        with store.state_lock:
            total = len(store.runtime_surveys)
        return {"items": rows, "total": total}

    @app.get("/api/v1/runtime/model-card")
    def runtime_model_card() -> dict[str, Any]:
        """Authoritative frozen final-v1 provenance for the operator-facing Model Lab."""
        metrics_path = store.root / "ml/artifacts/final_v1/detector/metrics.json"
        if not metrics_path.is_file():
            raise _error(503, "ARTIFACT_UNAVAILABLE", "Frozen final-v1 metrics artifact is unavailable.")
        return {"model": "YOLO11s", "checkpoint_sha256": store.runtime.health()["model_sha256"], "metrics": json.loads(metrics_path.read_text()),
                "shipwreck_status": "experimental / demo-assisted", "s1_provenance": "ml/artifacts/final_v1/research/shipwreck_s1/",
                "open_set": {**store.model_registry.health()["open_set"], "reference_count": store.open_set.embeddings.shape[0] if store.open_set else None}}

    @app.get("/api/v1/missions")
    def list_missions() -> list[dict[str, Any]]:
        mission = store.mission()
        return [{**mission, "surveys": [store.survey()]}]

    @app.post("/api/v1/missions")
    def create_mission() -> None:
        raise _error(409, "CAPABILITY_UNAVAILABLE", "Mission creation is not enabled for the frozen internal round.")

    @app.post("/api/v1/surveys/open-prepared")
    def open_prepared_survey(payload: PreparedSurveyInput) -> dict[str, Any]:
        """Return the real immutable survey rather than fabricating a second run."""
        survey = store.survey()
        return {"survey": survey, "mode": "FROZEN_ARTIFACT", "message": "Opened the locally materialised frozen evidence survey; no inference was rerun."}

    # ------------------------------------------------------------ ingest
    #
    # An upload has two phases with two different failure meanings, and the API
    # keeps them apart so a client never has to guess which one happened:
    #
    #   1. Decode and metadata validation run inside the request. They are fast
    #      (extract, parse navigation.csv/mission.json, confirm every raster
    #      opens) and every failure here is a rejected upload, answered with a
    #      4xx and a precise reason.
    #   2. Detector inference, evidence fusion and persistence run on a worker
    #      thread. They are slow, so the request never blocks on them. The
    #      client polls GET /api/v1/jobs/{job_id}, which reports counted
    #      progress and, on failure, a processing error -- never a rejected
    #      upload.
    #
    # Nothing is retried automatically. A repeated upload is a new run with a
    # new survey id, so it stays an operator decision.

    RASTER_SUFFIXES = {".png", ".jpg", ".jpeg", ".pbm"}
    # The request body is streamed to disk, rather than accumulated in memory.
    # This cap is deliberately operational rather than scientific: it protects
    # the single instance and its volume from an accidental oversized survey.
    max_upload_bytes = int(os.environ.get("SAGARDRISHTI_MAX_UPLOAD_BYTES", str(512 * 1024 * 1024)))
    if max_upload_bytes <= 0:
        raise ValueError("SAGARDRISHTI_MAX_UPLOAD_BYTES must be a positive integer")

    def _open_raster_size(path: Path, display_name: str) -> tuple[int, int]:
        from PIL import Image
        try:
            with Image.open(path) as image:
                return image.size
        # Deliberately broad: PIL's open is monkey-patched by ultralytics and can
        # raise beyond the documented decode errors. Whatever went wrong, the
        # operator-facing fact is the same and precise -- this file could not be
        # read as an image -- and it is a rejected upload, never a 500.
        except Exception as exc:  # noqa: BLE001
            raise _error(
                422, "UNREADABLE_RASTER",
                f"{display_name} could not be read as an image. No inference was attempted on it.",
                {"file": display_name},
            ) from exc

    def _decode_upload(destination: Path, suffix: str, upload_id: str, filename: str) -> dict[str, Any]:
        """Extract and validate the upload. Raises a 4xx for a rejected upload."""
        paths: list[Path] = []
        navigation_path: Path | None = None
        mission_path: Path | None = None
        bundle_entries = 0
        if suffix == ".zip":
            bundle = store.uploads / upload_id
            bundle.mkdir(exist_ok=True)
            try:
                archive = zipfile.ZipFile(destination)
            except zipfile.BadZipFile as exc:
                raise _error(422, "UNREADABLE_BUNDLE", "The uploaded file is not a readable ZIP bundle.") from exc
            with archive:
                for info in archive.infolist():
                    candidate = Path(info.filename)
                    if candidate.is_absolute() or ".." in candidate.parts:
                        raise _error(422, "UNSAFE_ARCHIVE", "The bundle contains an unsafe entry path and was not extracted.", {"entry": info.filename})
                    bundle_entries += 1
                    name_lower = candidate.name.lower()
                    if candidate.suffix.lower() in RASTER_SUFFIXES:
                        target = bundle / candidate.name
                        with archive.open(info) as source, target.open("wb") as out:
                            shutil.copyfileobj(source, out)
                        paths.append(target)
                    elif name_lower == "navigation.csv":
                        navigation_path = bundle / candidate.name
                        with archive.open(info) as source, navigation_path.open("wb") as out:
                            shutil.copyfileobj(source, out)
                    elif name_lower == "mission.json":
                        mission_path = bundle / candidate.name
                        with archive.open(info) as source, mission_path.open("wb") as out:
                            shutil.copyfileobj(source, out)
            if not paths:
                raise _error(422, "EMPTY_BUNDLE", "The bundle contains no PNG, JPEG or PBM raster to process.")
        else:
            paths = [destination]

        paths.sort(key=lambda item: item.name)
        for path in paths:
            # A single raster is stored under a generated id, so the operator is
            # told the name they actually uploaded.
            _open_raster_size(path, path.name if suffix == ".zip" else filename)

        # Navigation/mission are optional companions to the rasters. Malformed
        # metadata is rejected outright rather than silently dropped; a frame
        # with no matching row simply stays null.
        navigation_by_frame: dict[str, dict[str, Any]] = {}
        navigation_status = "UNAVAILABLE"
        if navigation_path is not None:
            navigation_by_frame = parse_navigation_csv(navigation_path)
            known_frames = {path.name for path in paths}
            unknown_frames = sorted(set(navigation_by_frame) - known_frames)
            if unknown_frames:
                raise NavigationValidationError(
                    f"navigation.csv references frame(s) not present in this upload: {', '.join(unknown_frames)}", field="frame",
                )
            navigation_status = "AVAILABLE"
        mission_meta = parse_mission_json(mission_path) if mission_path is not None else None
        # A ZIP's member order and timestamps are not enough to assert sequential
        # ping persistence. The uploader must explicitly declare the recording
        # relationship and supply ping bounds for the frame.
        sequential_contract = bool((mission_meta or {}).get("sequential_observations"))
        return {
            "paths": paths, "navigation": navigation_by_frame, "navigation_status": navigation_status,
            "mission": mission_meta, "sequential_contract": sequential_contract,
            "bundle_entries": bundle_entries if suffix == ".zip" else None,
        }

    def _run_survey_job(job_id: str, survey_id: str, decoded: dict[str, Any], survey_name: str) -> None:
        """Worker-thread body: real inference, real evidence, real persistence.

        Every counter published here is incremented after the work it describes
        has actually happened, so the processing view can never run ahead of the
        backend.
        """
        paths: list[Path] = decoded["paths"]
        navigation_by_frame: dict[str, Any] = decoded["navigation"]
        mission_meta = decoded["mission"]
        sequential_contract = decoded["sequential_contract"]
        open_set_available = store.open_set is not None
        try:
            store.jobs.update(job_id, state="INFERENCE", stage="yolo11s", files_parsed=len(paths))
            store.jobs.set_phase(job_id, "detector_ready", "running")
            store.runtime.load()
            health = store.runtime.health()
            store.jobs.update(job_id, detector={
                "availability": "AVAILABLE" if health["runtime_available"] else "UNAVAILABLE",
                "loaded": health["model_loaded"], "device": health["device"], "model_sha256": health["model_sha256"],
            })
            store.jobs.set_phase(job_id, "detector_ready", "done", f"Frozen YOLO11s on {health['device']}")

            store.jobs.set_phase(job_id, "inference", "running", f"0 of {len(paths)} source frames")
            store.jobs.set_phase(job_id, "condition", "running")
            if open_set_available:
                store.jobs.set_phase(job_id, "open_set", "running")
            else:
                store.jobs.set_phase(
                    job_id, "open_set", "unavailable",
                    "No open-set reference memory is configured in this deployment.",
                )

            from PIL import Image
            import numpy as np

            all_findings: list[dict[str, Any]] = []
            frames: list[dict[str, Any]] = []
            for index, path in enumerate(paths):
                meta, findings = store.runtime.infer(path, survey_id, f"frame_{index:04d}")
                nav_record = navigation_by_frame.get(path.name)
                with Image.open(path) as source_image:
                    pixels = np.asarray(source_image.convert("RGB"))
                condition = store.conditions.assess(pixels, {"navigation_available": nav_record is not None})
                for finding in findings:
                    finding.update(finding_navigation_view(nav_record))
                    finding["frame_index"] = index
                    finding["ping_start"] = nav_record.get("ping_start") if nav_record else None
                    finding["ping_end"] = nav_record.get("ping_end") if nav_record else None
                    finding["sequential_observation_supported"] = bool(
                        sequential_contract and nav_record is not None
                        and nav_record.get("ping_start") is not None and nav_record.get("ping_end") is not None
                    )
                    overlap = store.conditions.candidate_overlap(finding["bbox_px"], (meta["height_px"], meta["width_px"]), condition)
                    finding["sonar_condition"] = condition
                    finding["sonar_evidence"] = overlap
                    # Orientation is intentionally unknown unless supplied by calibrated acquisition metadata.
                    finding["physics"] = verify_candidate(pixels, finding["bbox_px"], None, condition)
                    if finding["raw_class"] == "PIPELINE":
                        finding["pipeline_verification"] = verify_pipeline_acoustics(pixels, finding["bbox_px"])
                    if store.open_set is not None:
                        x1, y1, x2, y2 = map(int, finding["bbox_px"])
                        pad = max(8, int(max(x2 - x1, y2 - y1) * 0.5))
                        context = pixels[max(0, y1-pad):min(pixels.shape[0], y2+pad), max(0, x1-pad):min(pixels.shape[1], x2+pad)]
                        try:
                            prepared = context[:, :, ::-1].copy() if context.ndim == 3 else context
                            finding["open_set"] = store.open_set.evidence(store.runtime.open_set_embedding(prepared))
                        except (RuntimeError, ValueError):
                            finding["open_set"] = {"status": "FAILED", "missing_inputs": ["FROZEN_FEATURE_EMBEDDING"]}
                frames.append({"frame_id": f"frame_{index:04d}", "source_path": str(path), **meta, "navigation": frame_navigation_view(nav_record), "sonar_condition": condition})
                all_findings.extend(findings)
                store.jobs.increment(job_id, "images_processed")
                store.jobs.increment(job_id, "frames_completed")
                store.jobs.increment(job_id, "tiles_processed", int(meta.get("tile_count", 0) or 0))
                store.jobs.set_phase(job_id, "inference", "running", f"{index + 1} of {len(paths)} source frames")

            store.jobs.set_phase(job_id, "inference", "done", f"{len(paths)} of {len(paths)} source frames")
            store.jobs.set_phase(job_id, "condition", "done", "Measured raster quality recorded for every source frame")
            if open_set_available:
                scored = sum(1 for item in all_findings if (item.get("open_set") or {}).get("status") == "AVAILABLE")
                store.jobs.set_phase(job_id, "open_set", "done", f"{scored} of {len(all_findings)} observations scored against the reference memory")
            store.jobs.update(job_id, state="POSTPROCESSING", stage="persist", detections_generated=len(all_findings))

            store.jobs.set_phase(job_id, "contact_fusion", "running")
            contacts = fuse_contacts(all_findings, survey_id)
            for contact in contacts:
                supporting = [x for x in all_findings if x["detection_id"] in contact["source_detection_ids"]]
                contact["quality_score"] = sum(x["sonar_condition"]["quality_score"] for x in supporting) / len(supporting)
                contact["quality_flags"] = sorted({flag for x in supporting for flag in x["sonar_condition"]["quality_flags"]})
                contact["nadir_overlap"] = max((x["sonar_evidence"]["nadir_overlap"] for x in supporting), default=None)
                contact["physics_consistency"] = None  # unknown orientation does not become a score
                pipeline = [item.get("pipeline_verification") for item in supporting if item.get("pipeline_verification")]
                if pipeline:
                    contact["pipeline_verification"] = pipeline[0]
                open_set = [item.get("open_set") for item in supporting if item.get("open_set", {}).get("status") == "AVAILABLE"]
                if open_set:
                    strongest = max(open_set, key=lambda item: float(item.get("anomaly_score", 0.0)))
                    contact["open_set"] = strongest
                    contact.update({"anomaly_score": strongest.get("anomaly_score"), "anomaly_threshold": strongest.get("threshold"),
                                    "anomaly_threshold_provenance": strongest.get("threshold_source"), "anomaly_feature_source": strongest.get("feature_source"),
                                    "anomaly_memory_version": strongest.get("memory_version"), "is_open_set_candidate": strongest.get("is_open_set_candidate", False)})
            store.jobs.set_phase(job_id, "contact_fusion", "done", f"{len(contacts)} contact{'' if len(contacts) == 1 else 's'} from {len(all_findings)} observation{'' if len(all_findings) == 1 else 's'}")
            store.jobs.update(job_id, contacts_fused=len(contacts))

            store.jobs.set_phase(job_id, "evidence", "running")
            for contact in contacts:
                fused = score_contact(contact)
                contact["evidence_score"] = fused["evidence_score"]
                contact["evidence_strength"] = contact["evidence_score"]
                contact["evidence_breakdown"] = fused
                confidence = fuse_contact_confidence(contact)
                contact.update({key: confidence[key] for key in ("confidence", "raw_fused_confidence", "normalized_confidence", "raw_detector_confidence", "confidence_components", "confidence_method", "confidence_normalization", "confidence_normalization_range", "confidence_normalization_reference_center", "confidence_normalization_steepness", "confidence_normalization_note")})
                priority = prioritize(contact)
                contact["priority_score"] = priority["priority_score"]
                contact["priority_band"] = priority["priority_band"]
                contact["priority_components"] = priority["priority_components"]
                contact["recommended_action"] = priority["recommended_action"]
            missing = sorted({name for contact in contacts for name in contact.get("evidence_breakdown", {}).get("missing_components", [])})
            store.jobs.set_phase(
                job_id, "evidence", "done",
                f"UNVALIDATED_EVIDENCE_FUSION over available channels; unavailable channels excluded: {', '.join(missing) if missing else 'none'}",
            )

            store.jobs.set_phase(job_id, "report", "running")
            record = {
                "survey_id": survey_id, "name": survey_name, "frames": frames, "findings": all_findings,
                "contacts": contacts, "created_at": datetime.now(timezone.utc).isoformat(),
                "navigation_status": decoded["navigation_status"], "mission": mission_meta,
                "model_registry": store.model_registry.health(), "contact_fusion_policy": "contact_fusion@v1",
                "sequential_observation_contract": sequential_contract,
            }
            with store.state_lock:
                store.runtime_surveys[survey_id] = record
            store.save_runtime_surveys()
            store.jobs.set_phase(job_id, "report", "done", f"{len(all_findings)} finding record{'' if len(all_findings) == 1 else 's'} written")
            store.jobs.update(job_id, state="COMPLETED", stage="completed", report_ready=True,
                              completed_at=datetime.now(timezone.utc).isoformat())
        except Exception as exc:  # noqa: BLE001 -- the reason is surfaced verbatim to the operator
            store.jobs.fail(job_id, "PROCESSING_FAILED", str(exc) or exc.__class__.__name__)

    @app.post("/api/v1/surveys/upload")
    async def upload_survey(file: UploadFile = File(...)) -> dict[str, Any]:
        """Accept a real raster/bundle, validate it, and start a real run.

        The response is the accepted job, not a finished survey: nothing here
        reports a model result that has not actually occurred.
        """
        suffix = Path(file.filename or "").suffix.lower()
        if suffix not in RASTER_SUFFIXES | {".zip"}:
            raise _error(422, "VALIDATION_FAILED", "Upload must be PNG, JPEG, PBM, or a prepared ZIP bundle.")
        upload_id = f"upload_{uuid.uuid4().hex[:12]}"
        destination = store.uploads / f"{upload_id}{suffix}"
        size_bytes = 0
        with destination.open("wb") as output:
            while chunk := await file.read(1024 * 1024):
                size_bytes += len(chunk)
                if size_bytes > max_upload_bytes:
                    output.close()
                    destination.unlink(missing_ok=True)
                    raise _error(
                        413, "UPLOAD_TOO_LARGE",
                        f"Upload exceeds the {max_upload_bytes} byte deployment limit.",
                    )
                output.write(chunk)
        if size_bytes == 0:
            destination.unlink(missing_ok=True)
            raise _error(422, "VALIDATION_FAILED", "Upload is empty.")

        try:
            decoded = _decode_upload(destination, suffix, upload_id, file.filename or destination.name)
        except NavigationValidationError as exc:
            raise _error(422, "VALIDATION_FAILED", str(exc), {"row": exc.row, "field": exc.field}) from exc

        job_id = f"job_{uuid.uuid4().hex[:12]}"
        survey_id = f"survey_{upload_id}"
        detector_health = store.runtime.health()
        store.jobs.create(job_id, new_job(
            job_id=job_id, survey_id=survey_id,
            upload={
                "filename": file.filename, "bytes": size_bytes,
                "kind": "BUNDLE" if suffix == ".zip" else "RASTER",
                "decoded": True, "bundle_entries": decoded["bundle_entries"],
                "raster_count": len(decoded["paths"]),
            },
            detector={
                "availability": "AVAILABLE" if detector_health["runtime_available"] else "UNAVAILABLE",
                "loaded": detector_health["model_loaded"], "device": detector_health["device"],
                "model_sha256": detector_health["model_sha256"],
            },
            open_set=store.open_set_health(),
        ))
        store.jobs.update(job_id, metadata={
            "navigation": decoded["navigation_status"],
            "mission": "AVAILABLE" if decoded["mission"] else "UNAVAILABLE",
            "sequential_observation_contract": decoded["sequential_contract"],
        })
        store.jobs.set_phase(
            job_id, "upload_decoded", "done",
            f"{len(decoded['paths'])} source frame{'' if len(decoded['paths']) == 1 else 's'} decoded from "
            f"{'bundle' if suffix == '.zip' else 'raster'}",
        )
        store.jobs.set_phase(
            job_id, "metadata_read",
            "done" if decoded["navigation_status"] == "AVAILABLE" or decoded["mission"] else "skipped",
            "navigation.csv parsed and validated" if decoded["navigation_status"] == "AVAILABLE"
            else "mission.json parsed; no navigation.csv accompanies this upload" if decoded["mission"]
            else "No navigation.csv or mission.json accompanies this upload, so findings carry no position.",
        )

        survey_name = (decoded["mission"] or {}).get("survey_name") or file.filename or survey_id
        worker = threading.Thread(
            target=_run_survey_job, args=(job_id, survey_id, decoded, survey_name),
            name=f"aqualens-{job_id}", daemon=True,
        )
        # The accepted state is captured before the worker can advance it, so a
        # caller is never told a phase that had not begun when it asked.
        accepted_state = (store.jobs.get(job_id) or {}).get("state", "QUEUED")
        worker.start()
        return {
            "upload_id": upload_id, "job_id": job_id, "survey_id": survey_id, "state": accepted_state,
            "source_frame_count": len(decoded["paths"]), "navigation_status": decoded["navigation_status"],
            "accepted": True,
        }

    @app.get("/api/v1/runtime/surveys/{survey_id}")
    def runtime_survey(survey_id: str) -> dict[str, Any]:
        value = store.runtime_surveys.get(survey_id)
        if value is None: raise _error(404, "NOT_FOUND", f"Runtime survey {survey_id} was not found.")
        return value

    @app.get("/api/v1/runtime/surveys/{survey_id}/contacts")
    def runtime_contacts(survey_id: str) -> list[dict[str, Any]]:
        return runtime_survey(survey_id).get("contacts", [])

    @app.get("/api/v1/runtime/surveys/{survey_id}/frames/{frame_id}/raster")
    def runtime_raster(survey_id: str, frame_id: str) -> Response:
        survey = runtime_survey(survey_id)
        frame = next((item for item in survey["frames"] if item["frame_id"] == frame_id), None)
        if frame is None:
            raise _error(404, "NOT_FOUND", f"Runtime frame {frame_id} was not found.")
        path = Path(frame["source_path"])
        if not path.is_file():
            raise _error(404, "NOT_FOUND", "The retained runtime upload is unavailable.")
        if path.suffix.lower() in {".pbm", ".pgm", ".ppm"}:
            # Browsers do not decode Netpbm images. Re-encode only the HTTP
            # representation losslessly; the retained source and its pixels
            # remain untouched.
            from PIL import Image

            buffer = io.BytesIO()
            with Image.open(path) as image:
                image.save(buffer, format="PNG")
            return Response(content=buffer.getvalue(), media_type="image/png")
        return FileResponse(path)

    VERDICTS = {"CONFIRMED", "REJECTED", "RELABELLED", "UNCERTAIN"}

    @app.post("/api/v1/runtime/surveys/{survey_id}/findings/{finding_id}/reviews")
    def runtime_review(survey_id: str, finding_id: str, payload: ReviewInput) -> dict[str, Any]:
        """Append one analyst verdict. Append-only: nothing is overwritten or deleted.

        Recording a verdict re-derives the Contact's transparent recovery
        priority, because priority is a rule over available evidence and a human
        decision is one of those inputs. It never alters the raw detector class,
        the raw confidence, or any evidence measurement.
        """
        if payload.verdict not in VERDICTS:
            raise _error(422, "VALIDATION_FAILED", f"verdict must be one of {', '.join(sorted(VERDICTS))}.", {"field": "verdict"})
        with store.state_lock:
            survey = runtime_survey(survey_id)
            finding = next((item for item in survey["findings"] if item["detection_id"] == finding_id), None)
            if finding is None:
                raise _error(404, "NOT_FOUND", f"Runtime finding {finding_id} was not found.")
            event = {"review_id": f"runtime_rev_{uuid.uuid4().hex[:12]}", "verdict": payload.verdict, "corrected_class": payload.corrected_class,
                     "corrected_bbox_px": payload.corrected_bbox_px, "notes": payload.notes, "reviewer": payload.reviewer,
                     "rejection_reason": payload.rejection_reason, "created_at": datetime.now(timezone.utc).isoformat(), "append_only": True}
            finding.setdefault("review_history", []).append(event)
            finding["review_state"] = payload.verdict
            for contact in survey.get("contacts", []):
                if finding_id in contact.get("source_detection_ids", []):
                    contact.setdefault("reviews", {}).setdefault("history", []).append(event)
                    contact["reviews"]["latest_verdict"] = payload.verdict
                    contact["reviews"]["review_count"] = len(contact["reviews"]["history"])
                    if payload.rejection_reason: contact["rejection_reason"] = payload.rejection_reason
                    contact["disposition"] = payload.verdict
                    priority = prioritize(contact)
                    contact["priority_score"] = priority["priority_score"]
                    contact["priority_band"] = priority["priority_band"]
                    contact["priority_components"] = priority["priority_components"]
                    contact["recommended_action"] = priority["recommended_action"]
        store.save_runtime_surveys()
        return event

    OBSERVATION_CSV_FIELDS = ["detection_id", "source_frame_id", "raw_class", "raw_confidence", "display_class", "display_confidence", "classification_source", "production_qualified", "review_state", "bbox_px", "latitude", "longitude", "heading_deg", "timestamp_utc", "navigation_status"]
    CONTACT_CSV_FIELDS = ["contact_id", "resolved_class", "candidate_classes", "observation_count", "distinct_frame_observation_count",
                          "persistence_evidence_type", "confidence", "raw_fused_confidence", "normalized_confidence", "raw_detector_confidence", "max_raw_confidence", "evidence_strength", "evidence_score", "evidence_score_type", "confidence_method", "confidence_normalization", "confidence_normalization_range", "missing_evidence_components",
                          "priority_band", "priority_score", "recommended_action", "anomaly_score", "anomaly_threshold", "is_open_set_candidate",
                          "quality_score", "quality_flags", "latitude", "longitude", "navigation_status", "localization_uncertainty_status",
                          "review_verdict", "review_count", "source_detection_ids", "best_observation_id", "detector_model_sha"]

    def _report_provenance(survey: dict[str, Any]) -> dict[str, Any]:
        """Everything a reader needs to attribute this export, computed from the record set."""
        findings = survey.get("findings") or []
        contacts = survey.get("contacts") or []
        reviews = [event for item in findings for event in (item.get("review_history") or [])]
        open_set_scored = sum(1 for item in findings if (item.get("open_set") or {}).get("status") == "AVAILABLE")
        positioned = sum(1 for item in findings if (item.get("geo") or {}).get("lat") is not None)
        return {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "api_version": app.version,
            "survey_id": survey.get("survey_id"),
            "survey_name": survey.get("name"),
            "processed_at": survey.get("created_at"),
            "record_counts": {
                "source_frames": len(survey.get("frames") or []),
                "observations": len(findings),
                "contacts": len(contacts),
                "review_events": len(reviews),
            },
            "models": {
                "detector_model_id": findings[0].get("model_id") if findings else None,
                "detector_model_sha256": findings[0].get("model_sha256") if findings else None,
                "dataset_snapshot_id": findings[0].get("dataset_snapshot_id") if findings else None,
                "run_id": findings[0].get("run_id") if findings else None,
                "contact_fusion_policy": survey.get("contact_fusion_policy"),
                "evidence_score_type": "UNVALIDATED_EVIDENCE_FUSION",
                "registry": survey.get("model_registry"),
            },
            "navigation": {
                "status": survey.get("navigation_status") or "UNAVAILABLE",
                "observations_with_position": positioned,
                "sequential_observation_contract": bool(survey.get("sequential_observation_contract")),
                "note": "Coordinates are copied from supplied navigation metadata only. No coordinate is derived from sonar imagery.",
            },
            "evidence_availability": {
                "open_set_observations_scored": open_set_scored,
                "acoustic_pipeline_verifications": sum(1 for item in findings if item.get("pipeline_verification")),
                "sonar_condition_assessed_frames": sum(1 for frame in (survey.get("frames") or []) if frame.get("sonar_condition")),
                "note": "An absent evidence channel is excluded from fusion and reported as missing. It is never scored as zero.",
            },
            "review_state": {
                "reviewed_observations": sum(1 for item in findings if item.get("review_state")),
                "unreviewed_observations": sum(1 for item in findings if not item.get("review_state")),
                "verdicts": dict(Counter(item.get("review_state") for item in findings if item.get("review_state"))),
                "append_only": True,
                "note": "Analyst verdicts are append-only review memory for future training and calibration. No model is updated by this export.",
            },
            "limitations": [
                "The evidence score is UNVALIDATED_EVIDENCE_FUSION. It is not a calibrated probability.",
                "An open-set anomaly score is distance from a background reference memory. It is not proof that a contact is artificial.",
                "SHIPWRECK presentation is demo-only and is never production qualified.",
                "Absence of a finding inside imagery is not a statement that the area is clear.",
            ],
        }

    def _contact_report_row(contact: dict[str, Any]) -> dict[str, Any]:
        breakdown = contact.get("evidence_breakdown") or {}
        reviews = contact.get("reviews") or {}
        provenance = contact.get("provenance") or {}
        return {
            "contact_id": contact.get("contact_id"), "resolved_class": contact.get("resolved_class"),
            "candidate_classes": "|".join(contact.get("candidate_classes") or []),
            "observation_count": contact.get("observation_count"),
            "distinct_frame_observation_count": contact.get("distinct_frame_observation_count"),
            "persistence_evidence_type": contact.get("persistence_evidence_type"),
            "max_raw_confidence": contact.get("max_raw_confidence"),
            "confidence": contact.get("confidence"),
            "raw_fused_confidence": contact.get("raw_fused_confidence"),
            "normalized_confidence": contact.get("normalized_confidence"),
            "raw_detector_confidence": contact.get("raw_detector_confidence"),
            "evidence_strength": contact.get("evidence_strength"),
            "evidence_score": contact.get("evidence_score"),
            "evidence_score_type": breakdown.get("score_type"),
            "confidence_method": contact.get("confidence_method"),
            "confidence_normalization": contact.get("confidence_normalization"),
            "confidence_normalization_range": "|".join(str(value) for value in (contact.get("confidence_normalization_range") or [])),
            "missing_evidence_components": "|".join(breakdown.get("missing_components") or []),
            "priority_band": contact.get("priority_band"), "priority_score": contact.get("priority_score"),
            "recommended_action": contact.get("recommended_action"),
            "anomaly_score": contact.get("anomaly_score"), "anomaly_threshold": contact.get("anomaly_threshold"),
            "is_open_set_candidate": contact.get("is_open_set_candidate"),
            "quality_score": contact.get("quality_score"), "quality_flags": "|".join(contact.get("quality_flags") or []),
            "latitude": contact.get("latitude"), "longitude": contact.get("longitude"),
            "navigation_status": contact.get("navigation_status"),
            "localization_uncertainty_status": contact.get("localization_uncertainty_status"),
            "review_verdict": reviews.get("latest_verdict"), "review_count": reviews.get("review_count"),
            "source_detection_ids": "|".join(contact.get("source_detection_ids") or []),
            "best_observation_id": contact.get("best_observation_id"),
            "detector_model_sha": provenance.get("detector_model_sha"),
        }

    @app.get("/api/v1/runtime/surveys/{survey_id}/report")
    def runtime_report(survey_id: str, format: str = "json", scope: str = "observations") -> Any:
        """Export the survey record set.

        JSON carries the complete record plus a provenance block naming the model
        versions, navigation status, evidence availability, review state and the
        limitations that apply to every figure in it. CSV is offered at two
        scopes because the product has two objects: the Contact (operational)
        and the raw detector observation (evidence).
        """
        survey = runtime_survey(survey_id)
        if format == "json":
            payload = {**survey, "provenance": _report_provenance(survey)}
            return JSONResponse(payload, headers={"Content-Disposition": f'attachment; filename="aqualens-{survey_id}-report.json"'})
        if format == "csv":
            if scope not in {"contacts", "observations"}:
                raise _error(422, "VALIDATION_FAILED", "scope must be contacts or observations")
            buffer = io.StringIO()
            if scope == "observations":
                writer = csv.DictWriter(buffer, fieldnames=OBSERVATION_CSV_FIELDS)
                writer.writeheader()
                for item in survey["findings"]:
                    writer.writerow({key: item.get(key) for key in OBSERVATION_CSV_FIELDS})
            else:
                writer = csv.DictWriter(buffer, fieldnames=CONTACT_CSV_FIELDS)
                writer.writeheader()
                for contact in survey.get("contacts") or []:
                    writer.writerow(_contact_report_row(contact))
            return StreamingResponse(iter([buffer.getvalue()]), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="aqualens-{survey_id}-{scope}.csv"'})
        raise _error(422, "VALIDATION_FAILED", "format must be json or csv")

    @app.get("/api/v1/runtime/surveys/{survey_id}/change")
    def runtime_change(survey_id: str, baseline_survey_id: str | None = None) -> dict[str, Any]:
        """Report whether a resurvey comparison is supportable, and why not when it is not.

        Change semantics are coverage-aware and deliberately conservative:
        NEW, UNCHANGED, NOT_DETECTED, NOT_SURVEYED and REMOVED each mean
        something different, and REMOVED is never inferred from a detector
        absence. This endpoint reports the real capability gates for the two
        surveys rather than producing a comparison the evidence cannot support.
        """
        survey = runtime_survey(survey_id)
        baseline = runtime_survey(baseline_survey_id) if baseline_survey_id else None

        def gates(record: dict[str, Any] | None) -> dict[str, Any]:
            if record is None:
                return {"survey_id": None, "navigation_status": "UNAVAILABLE", "spatial_reference_level": None,
                        "coverage_polygon": False, "positioned_observations": 0, "observation_count": 0}
            findings = record.get("findings") or []
            positioned = sum(1 for item in findings if (item.get("geo") or {}).get("lat") is not None)
            navigation = record.get("navigation_status") or "UNAVAILABLE"
            return {
                "survey_id": record.get("survey_id"), "name": record.get("name"),
                "navigation_status": navigation,
                # Frame-level navigation places a frame, not an object within it.
                # That is below the track-relative level metric matching needs.
                "spatial_reference_level": "L1_FRAME_RELATIVE" if navigation == "AVAILABLE" else "L0_PIXEL_ONLY",
                "coverage_polygon": False,
                "positioned_observations": positioned,
                "observation_count": len(findings),
                "contact_count": len(record.get("contacts") or []),
            }

        new_gates = gates(survey)
        baseline_gates = gates(baseline)
        blockers: list[dict[str, str]] = []
        if baseline is None:
            blockers.append({"gate": "BASELINE_SURVEY", "reason": "No baseline survey was selected, so there is nothing to compare against."})
        for label, value in (("new", new_gates), ("baseline", baseline_gates)):
            if value["survey_id"] is None:
                continue
            if value["spatial_reference_level"] not in {"L2_TRACK_RELATIVE", "L3_SURVEYED"}:
                blockers.append({
                    "gate": "SPATIAL_REFERENCE_LEVEL",
                    "reason": f"The {label} survey is {value['spatial_reference_level']}. Metric matching between passes requires at least L2_TRACK_RELATIVE, which needs calibrated ping timing, range and platform attitude.",
                })
            if not value["coverage_polygon"]:
                blockers.append({
                    "gate": "COVERAGE_POLYGON",
                    "reason": f"The {label} survey carries no coverage polygon, so an absent contact cannot be separated into NOT_DETECTED (inside coverage) and NOT_SURVEYED (outside it).",
                })
        return {
            "supported": not blockers,
            "status": "COMPARISON_REFUSED" if blockers else "COMPARISON_SUPPORTED",
            "new_survey": new_gates,
            "baseline_survey": baseline_gates,
            "blockers": blockers,
            "semantics": [
                {"state": "NEW", "meaning": "Present in the new pass and not matched to any baseline contact inside coverage."},
                {"state": "UNCHANGED", "meaning": "Matched to a baseline contact under a supported matching rule."},
                {"state": "NOT_DETECTED", "meaning": "A baseline contact's location was resurveyed and nothing was detected there. This is a detector absence, not a removal."},
                {"state": "NOT_SURVEYED", "meaning": "A baseline contact's location falls outside the new pass's coverage. Nothing at all is claimed about it."},
                {"state": "REMOVED", "meaning": "Requires a prior contact, genuine new coverage, adequate localization and a validated matching and review decision. It is never inferred from a detector absence."},
            ],
        }

    @app.get("/api/v1/runtime/memory/stats")
    def runtime_memory_stats() -> dict[str, Any]:
        """Aggregate append-only analyst verdicts across every retained runtime survey.

        This is curated review memory for future training and calibration. No
        model is updated by recording a verdict, and nothing here retrains,
        re-weights or re-scores an existing finding.
        """
        with store.state_lock:
            surveys = list(store.runtime_surveys.values())
        verdicts: Counter[str] = Counter()
        reviewers: Counter[str] = Counter()
        events = 0
        surveys_with_review = 0
        observations = 0
        reviewed_observations = 0
        for survey in surveys:
            findings = survey.get("findings") or []
            observations += len(findings)
            touched = False
            for finding in findings:
                history = finding.get("review_history") or []
                if history:
                    touched = True
                    reviewed_observations += 1
                for event in history:
                    events += 1
                    verdicts[str(event.get("verdict"))] += 1
                    reviewers[str(event.get("reviewer") or "unattributed")] += 1
            if touched:
                surveys_with_review += 1
        queues = {
            "hard_negative": verdicts.get("REJECTED", 0),
            "confirmed_positive": verdicts.get("CONFIRMED", 0),
            "relabelled": verdicts.get("RELABELLED", 0),
            "uncertain": verdicts.get("UNCERTAIN", 0),
        }
        return {
            "append_only": True,
            "online_learning": False,
            "event_count": events,
            "verdicts": dict(verdicts),
            "queues": queues,
            "reviewers": dict(reviewers),
            "surveys_retained": len(surveys),
            "surveys_with_review": surveys_with_review,
            "observations": observations,
            "reviewed_observations": reviewed_observations,
            "export_targets": ["hard_negative_manifest.jsonl", "confirmed_positive_manifest.jsonl", "uncertain_manifest.jsonl"],
            "note": "Verdicts accumulate as training memory. They are never applied to a model at runtime.",
        }

    @app.get("/api/v1/runtime/memory/reviews")
    def runtime_memory_reviews(survey_id: str | None = None, limit: int = Query(default=100, le=500)) -> dict[str, Any]:
        """Newest-first append-only review events, optionally scoped to one survey."""
        with store.state_lock:
            surveys = [store.runtime_surveys[survey_id]] if survey_id and survey_id in store.runtime_surveys else list(store.runtime_surveys.values())
        if survey_id and not surveys:
            raise _error(404, "NOT_FOUND", f"Runtime survey {survey_id} was not found.")
        rows: list[dict[str, Any]] = []
        for survey in surveys:
            for finding in survey.get("findings") or []:
                contact_id = next(
                    (contact.get("contact_id") for contact in (survey.get("contacts") or [])
                     if finding["detection_id"] in (contact.get("source_detection_ids") or [])),
                    None,
                )
                for event in finding.get("review_history") or []:
                    rows.append({
                        **event,
                        "survey_id": survey.get("survey_id"),
                        "survey_name": survey.get("name"),
                        "detection_id": finding["detection_id"],
                        "contact_id": contact_id,
                        "raw_class": finding.get("raw_class"),
                        "raw_confidence": finding.get("raw_confidence"),
                        "model_sha256": finding.get("model_sha256"),
                        "training_memory_queue": {
                            "REJECTED": "hard_negative", "CONFIRMED": "confirmed_positive",
                            "RELABELLED": "relabelled", "UNCERTAIN": "uncertain",
                        }.get(str(event.get("verdict")), "uncategorised"),
                    })
        rows.sort(key=lambda row: str(row.get("created_at") or ""), reverse=True)
        return {"items": rows[:limit], "total": len(rows), "append_only": True, "online_learning": False}

    @app.get("/api/v1/missions/{mission_id}")
    def get_mission(mission_id: str) -> dict[str, Any]:
        mission = store.mission()
        if mission_id != mission["mission_id"]:
            raise _error(404, "NOT_FOUND", f"Mission {mission_id} was not found.")
        return {**mission, "surveys": [store.survey()]}

    @app.get("/api/v1/surveys/{survey_id}")
    def get_survey(survey_id: str) -> dict[str, Any]:
        survey = store.survey()
        if survey_id != survey["survey_id"]:
            raise _error(404, "NOT_FOUND", f"Survey {survey_id} was not found.")
        return survey

    @app.post("/api/v1/surveys/{survey_id}/ingest")
    def ingest(survey_id: str) -> dict[str, str]:
        if survey_id != store.survey()["survey_id"]:
            raise _error(404, "NOT_FOUND", f"Survey {survey_id} was not found.")
        job_id = f"job_{uuid.uuid4().hex[:12]}"
        store.jobs.create(job_id, {
            "job_id": job_id, "survey_id": survey_id, "state": "FAILED", "stage": "perceive", "phase": None,
            "progress": None, "steps": {},
            "error": {"code": "MODEL_UNAVAILABLE", "phase": None, "message": "Frozen internal_v2 inference requires the approved Ultralytics/Torch runtime; no substitute inference was run."},
        })
        return {"job_id": job_id}

    @app.get("/api/v1/surveys/{survey_id}/frames")
    def list_frames(survey_id: str, offset: int = 0, limit: int = Query(default=50, le=500)) -> list[dict[str, Any]]:
        if survey_id != store.survey()["survey_id"]:
            raise _error(404, "NOT_FOUND", f"Survey {survey_id} was not found.")
        result = []
        for index, frame in enumerate(sorted(store.frames.values(), key=lambda item: item["frame_id"])):
            geometry = frame["geometry"]
            result.append({"frame_id": frame["frame_id"], "survey_id": survey_id, "index": index, "width_px": frame["width_px"], "height_px": frame["height_px"], "sensor": frame.get("sensor"), "frequency_khz": frame.get("frequency_khz"), "geometry": geometry, "quality": None, "layers": {"raw": frame["source_path"], "enhanced": str(project_root / "data/interim/subpipe/enhanced" / f"{frame['frame_id']}.png")}, "provenance": {"dataset_id": frame["dataset_id"], "source_filename": frame["source_filename"], "licence": frame["licence"], "sha256": frame.get("sha256"), "source_url": frame.get("source_url")}})
        return result[offset:offset + limit]

    @app.get("/api/v1/frames/{frame_id}/raster")
    def frame_raster(frame_id: str, layer: str = "raw") -> FileResponse:
        frame = store.frames.get(frame_id)
        if frame is None:
            raise _error(404, "NOT_FOUND", f"Frame {frame_id} was not found.")
        path = Path(frame["source_path"]) if layer == "raw" else project_root / "data/interim/subpipe/enhanced" / f"{frame_id}.png"
        if layer not in {"raw", "enhanced", "anomaly"} or not path.is_file():
            raise _error(409, "CAPABILITY_UNAVAILABLE", f"Raster layer {layer} is unavailable for frame {frame_id}.")
        return FileResponse(path, media_type="image/png")

    @app.get("/api/v1/tiles/{tile_id}/raster")
    def tile_raster(tile_id: str, layer: str = "raw") -> FileResponse:
        path = store.snapshot_dir / "tiles" / f"{tile_id}.png"
        if layer != "raw" or not path.is_file():
            raise _error(404, "NOT_FOUND", f"Tile raster {tile_id}/{layer} was not found.")
        return FileResponse(path, media_type="image/png")

    @app.get("/api/v1/surveys/{survey_id}/detections")
    def list_detections(survey_id: str, kind: str | None = None, category: str | None = None, min_confidence: float | None = None, change_status: str | None = None, review: str | None = None, sort: str = "priority", offset: int = 0, limit: int = Query(default=50, le=500)) -> dict[str, Any]:
        if survey_id != store.survey()["survey_id"]:
            raise _error(404, "NOT_FOUND", f"Survey {survey_id} was not found.")
        values = [store.detection(key) for key in store.detections]
        values = [item for item in values if (kind is None or item["kind"] == kind) and (category is None or item["category"] == category) and (min_confidence is None or (item["class_confidence"] or 0) >= min_confidence) and (change_status is None or item["change_status"] == change_status)]
        if review == "none": values = [item for item in values if item["review"]["review_count"] == 0]
        if review == "reviewed": values = [item for item in values if item["review"]["review_count"] > 0]
        values.sort(key=lambda item: item["class_confidence"] or 0, reverse=True)
        return {"items": values[offset:offset + limit], "total": len(values)}

    @app.get("/api/v1/detections/{detection_id}")
    def get_detection(detection_id: str) -> dict[str, Any]:
        return store.detection(detection_id)

    @app.get("/api/v1/detections/{detection_id}/evidence/shadow")
    def shadow_evidence(detection_id: str) -> dict[str, Any]:
        item = store.detection(detection_id)
        evidence = item["evidence"]["shadow"]
        if not evidence["applicable"]:
            raise _error(409, "CAPABILITY_UNAVAILABLE", f"Shadow evidence is not computable: {evidence['reason']}.")
        return {"crop_png_url": None, "profile": [], "band_px": None}

    @app.get("/api/v1/detections/{detection_id}/evidence/persistence")
    def persistence_evidence(detection_id: str) -> dict[str, Any]:
        item = store.detection(detection_id)
        evidence = item["evidence"]["persistence"]
        return {"observations": [{"tile_id": item["tile_id"], "bbox_px": item["geometry"]["bbox_px"], "conf": item["class_confidence"]}], "summary": evidence}

    @app.post("/api/v1/detections/{detection_id}/reviews")
    def submit_review(detection_id: str, payload: ReviewInput) -> dict[str, Any]:
        item = store.detection(detection_id)
        try:
            review = store.reviews.append(item, payload.model_dump(), store.split)
        except ValueError as exc:
            raise _error(422, "VALIDATION_FAILED", str(exc)) from exc
        return _model_dump(review)

    @app.get("/api/v1/detections/{detection_id}/reviews")
    def reviews(detection_id: str) -> list[dict[str, Any]]:
        store.detection(detection_id)
        return store.reviews.list(detection_id)

    @app.get("/api/v1/memory/stats")
    def memory_stats() -> dict[str, Any]:
        return store.reviews.stats()

    @app.get("/api/v1/memory/reviews")
    def memory_reviews(limit: int = Query(default=500, le=1000)) -> list[dict[str, Any]]:
        events = []
        for detection_id in store.detections:
            events.extend(store.reviews.list(detection_id))
        return sorted(events, key=lambda event: event["created_at"], reverse=True)[:limit]

    @app.get("/api/v1/roles/{role}/dashboard")
    def role_dashboard(role: str) -> dict[str, Any]:
        if role not in {"field-officer", "sonar-analyst", "mission-supervisor", "decision-viewer"}:
            raise _error(404, "NOT_FOUND", f"Unknown role {role}.")
        detections = [store.detection(identifier) for identifier in store.detections]
        return {"role": role, "survey": store.survey(), "findings": detections,
                "review_backlog": sum(item["review"]["review_count"] == 0 for item in detections),
                "report_urls": {"json": "/api/v1/surveys/survey_subpipe_mini2_internal_v2/report?format=json", "csv": "/api/v1/surveys/survey_subpipe_mini2_internal_v2/report?format=csv"}}

    @app.get("/api/v1/memory/queues/{queue}")
    def memory_queue(queue: str, limit: int = Query(default=50, le=500)) -> list[dict[str, Any]]:
        if queue not in {"hard-negatives", "corrections", "hard-positives"}:
            raise _error(404, "NOT_FOUND", f"Memory queue {queue} was not found.")
        verdict = {"hard-negatives": "REJECTED", "corrections": "RELABELLED", "hard-positives": "CONFIRMED"}[queue]
        ids = {review["detection_id"] for item in store.detections.values() for review in store.reviews.list(item["detection_id"]) if review["verdict"] == verdict}
        return [store.detection(identifier) for identifier in list(ids)[:limit]]

    @app.get("/api/v1/models")
    def models() -> list[dict[str, Any]]:
        return [store.model]

    @app.get("/api/v1/models/{model_id}")
    def model(model_id: str) -> dict[str, Any]:
        if model_id != store.model["model_version_id"]:
            raise _error(404, "NOT_FOUND", f"Model {model_id} was not found.")
        return store.model

    @app.get("/api/v1/benchmarks")
    @app.get("/api/v1/benchmarks/{run_id}")
    def benchmarks(run_id: str | None = None) -> dict[str, Any]:
        if run_id is not None and run_id != store.benchmark["run_id"]:
            raise _error(404, "NOT_FOUND", f"Benchmark {run_id} was not found.")
        return store.benchmark

    @app.post("/api/v1/compare")
    def compare(payload: CompareInput) -> dict[str, Any]:
        survey = store.survey()
        if payload.baseline_survey_id != survey["survey_id"] or payload.new_survey_id != survey["survey_id"]:
            raise _error(404, "NOT_FOUND", "Only the frozen internal_v2 survey is available for comparison.")
        try:
            comparison_id, changes = compare_detections(survey["survey_id"], survey["survey_id"], survey["spatial_reference_level"], survey["spatial_reference_level"], list(store.detections.values()), list(store.detections.values()), payload.confirmed_only)
        except ComparisonRefused as exc:
            raise _error(409, "COMPARISON_REFUSED", str(exc), {"baseline_level": survey["spatial_reference_level"], "new_level": survey["spatial_reference_level"]}) from exc
        encoded = [_model_dump(item) for item in changes]
        result = {"comparison_id": comparison_id, "summary": change_summary(changes), "changes": encoded}
        store.comparisons[comparison_id] = result
        return result

    @app.get("/api/v1/comparisons/{comparison_id}")
    def comparison(comparison_id: str) -> dict[str, Any]:
        if comparison_id not in store.comparisons:
            raise _error(404, "NOT_FOUND", f"Comparison {comparison_id} was not found.")
        return store.comparisons[comparison_id]

    @app.get("/api/v1/surveys/{survey_id}/report")
    def report(survey_id: str, format: str = "json") -> Any:
        if survey_id != store.survey()["survey_id"]:
            raise _error(404, "NOT_FOUND", f"Survey {survey_id} was not found.")
        items = [store.detection(identifier) for identifier in store.detections]
        if format == "json": return JSONResponse({"survey": store.survey(), "detections": items, "rows": store.report_rows(), "manifest": store.manifest}, headers={"Content-Disposition": "attachment; filename=aqualens-survey-report.json"})
        if format == "geojson": return JSONResponse({"type": "FeatureCollection", "features": []})
        if format == "csv":
            buffer = io.StringIO(); rows = store.report_rows(); writer = csv.DictWriter(buffer, fieldnames=list(rows[0]) if rows else ["detection_id"]); writer.writeheader()
            writer.writerows(rows)
            return StreamingResponse(iter([buffer.getvalue()]), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=aqualens-survey-report.csv"})
        raise _error(422, "VALIDATION_FAILED", "format must be json, csv, or geojson")

    @app.get("/api/v1/jobs/{job_id}")
    def job(job_id: str) -> dict[str, Any]:
        """Observable job state. Counts are incremented after the work happens."""
        current = store.jobs.get(job_id)
        if current is None:
            raise _error(404, "NOT_FOUND", f"Job {job_id} was not found.")
        return render_job(current)

    @app.get("/api/v1/jobs/{job_id}/events")
    def job_events(job_id: str) -> StreamingResponse:
        current = job(job_id)
        return StreamingResponse(iter([f"event: stage\ndata: {json.dumps(current)}\n\n"]), media_type="text/event-stream")

    return app
