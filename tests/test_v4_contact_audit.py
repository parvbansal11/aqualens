"""Round-2 ticket A6: the retained v4 Contact audit re-runs association read-only (spec A-AC8).

The audit reads retained runtime state and rasters, re-runs today's association on copies of the retained
Observations, and writes its report elsewhere. It must never change the runtime state or any raster.
"""
from __future__ import annotations

import hashlib
import importlib.util
import io
import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location("audit_v4_contacts", ROOT / "scripts" / "audit_v4_contacts.py")
audit_v4_contacts = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(audit_v4_contacts)

MISSION = "SD-EPITOME-V4-REAL-DATA-VARIED-CONFIDENCE"


def _observation(survey_id: str, frame_id: str, number: int, path: Path, box: list[float]) -> dict:
    width, height = 640, 640
    x1, y1, x2, y2 = box
    return {"detection_id": f"det_{survey_id}_{frame_id}_{number:04d}", "source_frame_id": frame_id, "source_image_path": str(path),
            "raw_class": "CRAB_POT", "raw_confidence": .4, "bbox_px": box, "bbox_normalized": [x1 / width, y1 / height, x2 / width, y2 / height],
            "pixel_dimensions": [width, height], "inference_mode": "FULL_FRAME", "tile_id": None, "geo": {"lat": 15.5, "lon": 83.1},
            "model_sha256": "sha", "sequential_observation_supported": True, "ping_start": 0, "ping_end": 499}


def _retained_state(tmp_path: Path) -> tuple[Path, Path]:
    """A v4-like retained record: one Frame whose two distinct FULL_FRAME boxes were merged into one Contact."""
    uploads = tmp_path / "runtime" / "uploads" / "upload_v4"
    uploads.mkdir(parents=True)
    raster = uploads / "frame_a.png"
    buffer = io.BytesIO()
    Image.fromarray(np.random.default_rng(1).integers(0, 256, (640, 640, 3), dtype=np.uint8)).save(buffer, format="PNG")
    raster.write_bytes(buffer.getvalue())
    survey_id = "survey_upload_v4"
    findings = [_observation(survey_id, "frame_0000", 0, raster, [10., 10., 60., 60.]),
                _observation(survey_id, "frame_0000", 1, raster, [400., 400., 450., 450.])]
    record = {"survey_id": survey_id, "name": "v4", "mission": {"mission_id": MISSION},
              "frames": [{"frame_id": "frame_0000", "source_path": str(raster), "width_px": 640, "height_px": 640, "inference_mode": "FULL_FRAME",
                          "tile_count": 0, "navigation": {"navigation_status": "AVAILABLE"}}],
              "findings": findings,
              "contacts": [{"contact_id": "contact_merged", "source_detection_ids": [f["detection_id"] for f in findings],
                            "source_frame_ids": ["frame_0000", "frame_0000"], "persistence_evidence_type": "WINDOW_OVERLAP_ONLY"}]}
    other = {"survey_id": "survey_upload_other", "name": "other", "mission": None, "frames": [], "findings": [], "contacts": []}
    state = tmp_path / "runtime" / "runtime_surveys.json"
    state.write_text(json.dumps({survey_id: record, "survey_upload_other": other}))
    return state, raster


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_audit_never_changes_runtime_state_or_rasters(tmp_path):
    state, raster = _retained_state(tmp_path)
    before = (_sha(state), _sha(raster), state.stat().st_mtime_ns)
    audit_v4_contacts.run(state, tmp_path / "out", MISSION)
    assert (_sha(state), _sha(raster), state.stat().st_mtime_ns) == before
    assert sorted(path.name for path in (tmp_path / "out").iterdir()) == ["manifest.json", "report.json", "report.md"]


def test_audit_reports_the_same_frame_merge_before_and_its_absence_after(tmp_path):
    state, _ = _retained_state(tmp_path)
    report = audit_v4_contacts.run(state, tmp_path / "out", MISSION)
    assert report["state_unchanged"] is True
    (record,) = report["records"]   # only records of the requested mission
    assert record["survey_id"] == "survey_upload_v4"
    assert record["before"]["same_frame_full_frame_merges"] == 1
    assert record["after"]["same_frame_full_frame_merges"] == 0
    assert [c["association_basis"] for c in record["after"]["contacts"]] == ["SINGLE", "SINGLE"]
    assert [c["contact_id"] for c in record["changed"]["removed"]] == ["contact_merged"]
    assert len(record["changed"]["added"]) == 2
    assert report["acceptance"]["A-AC8"] is True
    # The retained Observations carried a declared sequence; it relates nothing today.
    assert all(c["look_count"] == 1 for c in record["after"]["contacts"])
