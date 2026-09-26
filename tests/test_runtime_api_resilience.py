"""Deployment-resilience and evidence-presentation contracts for the runtime API.

These cover the behaviours an operator depends on when something goes wrong:
a rejected upload is distinguishable from a failed processing run, job state is
counted rather than estimated, runtime state survives a lost session, review
memory is append-only and never described as retraining, and every export
carries the provenance and limitations that apply to it.

The frozen detector is faked so these assertions are about API behaviour, not
about what the real model happens to see in a synthetic raster.
"""
from __future__ import annotations

import io
import json
import os
import time
import zipfile
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from sagar.api import create_app
from sagar.api.jobs import JobRegistry, PHASES, new_job, render_job
from sagar.perception.runtime import FinalDetector

ROOT = Path(__file__).resolve().parents[1]


def _png_bytes(size: tuple[int, int] = (8, 8)) -> bytes:
    buffer = io.BytesIO()
    Image.fromarray(np.zeros((size[1], size[0], 3), dtype=np.uint8)).save(buffer, format="PNG")
    return buffer.getvalue()


def _ppm_bytes() -> bytes:
    pixels = np.array(
        [[[0, 17, 255], [31, 127, 63]], [[255, 0, 91], [8, 9, 10]]],
        dtype=np.uint8,
    )
    buffer = io.BytesIO()
    Image.fromarray(pixels).save(buffer, format="PPM")
    return buffer.getvalue()


def _zip_bytes(entries: dict[str, bytes | str]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, content in entries.items():
            archive.writestr(name, content)
    return buffer.getvalue()


def _fake_infer(self, image_path, survey_id, source_image_id):
    with Image.open(image_path) as image:
        width, height = image.size
    finding = {
        "detection_id": f"det_{survey_id}_{source_image_id}_0000", "survey_id": survey_id,
        "source_frame_id": source_image_id, "source_image_path": str(image_path), "tile_id": None,
        "raw_class_id": 1, "raw_class": "SHIPWRECK", "raw_confidence": 0.42,
        "display_class": "SHIPWRECK", "display_confidence": 0.5, "classification_source": "MODEL",
        "production_qualified": True, "anomaly_score": None, "bbox_px": [1.0, 2.0, 3.0, 4.0],
        "bbox_normalized": [0.1, 0.2, 0.3, 0.4], "pixel_dimensions": [width, height],
        "geo": {"lat": None, "lon": None}, "review_state": None, "review_history": [],
        "model_id": "test_model", "model_sha256": "deadbeef", "dataset_snapshot_id": "test_snapshot",
        "run_id": f"runtime_{survey_id}", "inference_mode": "FULL_FRAME", "tile_size": None, "tile_overlap": None,
    }
    meta = {"width_px": width, "height_px": height, "inference_mode": "FULL_FRAME", "tile_count": 0}
    return meta, [finding]


@pytest.fixture()
def client(monkeypatch, tmp_path) -> TestClient:
    """An isolated runtime directory: these tests never touch developer state."""
    monkeypatch.setattr(FinalDetector, "infer", _fake_infer)
    monkeypatch.setenv("SAGARDRISHTI_RUNTIME_DIR", str(tmp_path / "runtime"))
    return TestClient(create_app(ROOT))


def _await(client: TestClient, job_id: str, timeout: float = 60.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job = client.get(f"/api/v1/jobs/{job_id}").json()
        if job["state"] in {"COMPLETED", "FAILED"}:
            return job
        time.sleep(0.02)
    raise AssertionError("job did not reach a terminal state")


def _upload(client: TestClient, name: str, payload: bytes, content_type: str) -> tuple[dict, dict]:
    response = client.post("/api/v1/surveys/upload", files={"file": (name, payload, content_type)})
    assert response.status_code == 200, response.text
    body = response.json()
    return body, _await(client, body["job_id"])


# ------------------------------------------------- failure-class separation

def test_unsupported_extension_is_a_rejected_upload_not_a_failed_run(client):
    response = client.post("/api/v1/surveys/upload", files={"file": ("notes.txt", b"hello", "text/plain")})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_FAILED"


def test_unreadable_raster_is_rejected_before_any_job_exists(client):
    response = client.post("/api/v1/surveys/upload", files={"file": ("broken.png", b"not-an-image", "image/png")})
    assert response.status_code == 422
    body = response.json()["error"]
    assert body["code"] == "UNREADABLE_RASTER"
    # A rejected upload creates no job and no survey to clean up.
    assert "job_id" not in response.json()


def test_netpbm_runtime_raster_is_browser_compatible_without_changing_pixels(client):
    source = _ppm_bytes()
    body, job = _upload(client, "sonar.pbm", source, "image/x-portable-bitmap")
    assert job["state"] == "COMPLETED"

    response = client.get(
        f"/api/v1/runtime/surveys/{body['survey_id']}/frames/frame_0000/raster"
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    with Image.open(io.BytesIO(source)) as original, Image.open(io.BytesIO(response.content)) as served:
        np.testing.assert_array_equal(np.asarray(served), np.asarray(original))


def test_bundle_with_no_raster_is_rejected_with_its_own_code(client):
    payload = _zip_bytes({"navigation.csv": "frame,timestamp_utc,latitude,longitude\n"})
    response = client.post("/api/v1/surveys/upload", files={"file": ("empty.zip", payload, "application/zip")})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "EMPTY_BUNDLE"


def test_corrupt_zip_is_rejected_as_an_unreadable_bundle(client):
    response = client.post("/api/v1/surveys/upload", files={"file": ("broken.zip", b"PK-not-really", "application/zip")})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "UNREADABLE_BUNDLE"


def test_empty_upload_is_rejected(client):
    response = client.post("/api/v1/surveys/upload", files={"file": ("empty.png", b"", "image/png")})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_FAILED"


def test_processing_failure_is_reported_on_the_job_not_the_upload(client, monkeypatch):
    def _boom(self, image_path, survey_id, source_image_id):
        raise RuntimeError("detector unavailable on this host")

    monkeypatch.setattr(FinalDetector, "infer", _boom)
    body, job = _upload(client, "sonar.png", _png_bytes(), "image/png")
    assert body["state"] == "QUEUED"          # the upload itself was accepted
    assert job["state"] == "FAILED"
    assert job["error"]["code"] == "PROCESSING_FAILED"
    assert "detector unavailable" in job["error"]["message"]
    # A failed run leaves no half-written survey behind.
    assert client.get(f"/api/v1/runtime/surveys/{body['survey_id']}").status_code == 404


# --------------------------------------------------------- observable jobs

def test_job_reports_counted_progress_and_never_a_percentage(client):
    names = [f"sonar_{index:04d}.png" for index in range(1, 4)]
    payload = _zip_bytes({name: _png_bytes() for name in names})
    body, job = _upload(client, "bundle.zip", payload, "application/zip")

    assert body["source_frame_count"] == 3
    assert job["source_frame_count"] == 3
    assert job["frames_completed"] == 3
    assert job["contacts_fused"] == len(client.get(f"/api/v1/runtime/surveys/{body['survey_id']}").json()["contacts"])
    assert job["report_ready"] is True
    # No estimated completion figure is published anywhere in the payload.
    assert "progress_percent" not in job and "percent" not in json.dumps(job)


def test_job_steps_are_named_ordered_and_bound_to_real_component_state(client):
    body, job = _upload(client, "sonar.png", _png_bytes(), "image/png")
    assert [step["id"] for step in job["steps"]] == [phase for phase, _ in PHASES]
    by_id = {step["id"]: step for step in job["steps"]}
    assert by_id["upload_decoded"]["state"] == "done"
    assert by_id["inference"]["state"] == "done"
    assert by_id["contact_fusion"]["state"] == "done"
    assert by_id["report"]["state"] == "done"
    # Open-set is reported from real availability, never assumed either way.
    assert by_id["open_set"]["state"] in {"done", "unavailable"}
    registry_state = client.get("/api/v1/runtime/health").json()["optional_models"]["open_set"]["availability"]
    assert by_id["open_set"]["state"] == ("done" if registry_state == "AVAILABLE" else "unavailable")
    assert job["upload"]["decoded"] is True
    assert job["metadata"]["navigation"] == "UNAVAILABLE"


def test_metadata_step_names_what_was_actually_supplied(client):
    nav = "frame,timestamp_utc,latitude,longitude\nsonar_0001.png,2026-09-01T15:30:00Z,18.0,72.0\n"
    payload = _zip_bytes({"sonar_0001.png": _png_bytes(), "navigation.csv": nav})
    _, job = _upload(client, "bundle.zip", payload, "application/zip")
    step = next(item for item in job["steps"] if item["id"] == "metadata_read")
    assert step["state"] == "done"
    assert "navigation.csv" in step["detail"]
    assert job["metadata"]["navigation"] == "AVAILABLE"


def test_unknown_job_is_a_404(client):
    assert client.get("/api/v1/jobs/job_missing").status_code == 404


def test_job_registry_is_bounded_and_hands_back_detached_copies():
    registry = JobRegistry(limit=2)
    for index in range(3):
        registry.create(f"job_{index}", new_job(
            job_id=f"job_{index}", survey_id=f"survey_{index}",
            upload={"raster_count": 1}, detector={}, open_set={},
        ))
    assert registry.get("job_0") is None       # oldest evicted
    assert registry.get("job_2") is not None
    snapshot = registry.get("job_2")
    snapshot["steps"]["inference"] = {"state": "done"}
    assert registry.get("job_2")["steps"] == {}   # the copy cannot mutate the store


def test_render_job_fills_unreached_phases_as_queued():
    job = new_job(job_id="j", survey_id="s", upload={"raster_count": 2}, detector={}, open_set={})
    rendered = render_job(job)
    assert {step["state"] for step in rendered["steps"]} == {"queued"}
    assert len(rendered["steps"]) == len(PHASES)


# ------------------------------------------------------ reconnect/recovery

def test_runtime_survey_index_supports_reconnect_after_a_lost_session(client):
    first, _ = _upload(client, "first.png", _png_bytes(), "image/png")
    second, _ = _upload(client, "second.png", _png_bytes(), "image/png")
    listing = client.get("/api/v1/runtime/surveys").json()
    ids = [row["survey_id"] for row in listing["items"]]
    assert second["survey_id"] in ids and first["survey_id"] in ids
    assert ids[0] == second["survey_id"]        # newest first
    row = listing["items"][0]
    assert row["finding_count"] == 1 and row["frame_count"] == 1
    assert row["navigation_status"] == "UNAVAILABLE"
    assert listing["total"] >= 2


def test_health_reports_real_component_availability_and_retained_state(client):
    body = client.get("/api/v1/runtime/health").json()
    assert body["status"] in {"ok", "degraded"}
    assert set(body["optional_models"]) == {"yolo11s", "rfdetr", "natural_clutter", "mask_refiner", "open_set"}
    assert body["optional_models"]["rfdetr"]["availability"] == "NOT_CONFIGURED"
    assert body["optional_models"]["natural_clutter"]["automatic_veto_permitted"] is False
    assert body["uptime_seconds"] >= 0
    assert "runtime_surveys_retained" in body
    # Health must never leak a filesystem path or a secret.
    assert "/" not in str(body.get("model_sha256") or "")


# --------------------------------------------------------- review memory

def test_review_is_append_only_and_recomputes_only_transparent_priority(client):
    body, _ = _upload(client, "sonar.png", _png_bytes(), "image/png")
    survey_id = body["survey_id"]
    survey = client.get(f"/api/v1/runtime/surveys/{survey_id}").json()
    finding_id = survey["findings"][0]["detection_id"]
    raw_class = survey["findings"][0]["raw_class"]
    raw_confidence = survey["findings"][0]["raw_confidence"]

    for verdict in ("UNCERTAIN", "CONFIRMED"):
        response = client.post(
            f"/api/v1/runtime/surveys/{survey_id}/findings/{finding_id}/reviews",
            json={"verdict": verdict, "reviewer": "test operator"},
        )
        assert response.status_code == 200
        assert response.json()["append_only"] is True

    updated = client.get(f"/api/v1/runtime/surveys/{survey_id}").json()
    finding = updated["findings"][0]
    assert [event["verdict"] for event in finding["review_history"]] == ["UNCERTAIN", "CONFIRMED"]
    assert finding["review_state"] == "CONFIRMED"
    # A verdict never rewrites the immutable detector observation.
    assert finding["raw_class"] == raw_class
    assert finding["raw_confidence"] == raw_confidence
    contact = updated["contacts"][0]
    assert contact["reviews"]["review_count"] == 2
    assert contact["reviews"]["latest_verdict"] == "CONFIRMED"


def test_unknown_verdict_is_rejected(client):
    body, _ = _upload(client, "sonar.png", _png_bytes(), "image/png")
    survey = client.get(f"/api/v1/runtime/surveys/{body['survey_id']}").json()
    response = client.post(
        f"/api/v1/runtime/surveys/{body['survey_id']}/findings/{survey['findings'][0]['detection_id']}/reviews",
        json={"verdict": "DEFINITELY_A_WRECK", "reviewer": "test operator"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["detail"]["field"] == "verdict"


def test_memory_stats_bucket_verdicts_without_claiming_online_learning(client):
    body, _ = _upload(client, "sonar.png", _png_bytes(), "image/png")
    survey = client.get(f"/api/v1/runtime/surveys/{body['survey_id']}").json()
    finding_id = survey["findings"][0]["detection_id"]
    client.post(f"/api/v1/runtime/surveys/{body['survey_id']}/findings/{finding_id}/reviews",
                json={"verdict": "REJECTED", "reviewer": "test operator"})

    stats = client.get("/api/v1/runtime/memory/stats").json()
    assert stats["append_only"] is True
    assert stats["online_learning"] is False
    assert stats["queues"]["hard_negative"] == 1
    assert stats["event_count"] == 1

    events = client.get("/api/v1/runtime/memory/reviews").json()
    assert events["items"][0]["training_memory_queue"] == "hard_negative"
    assert events["items"][0]["detection_id"] == finding_id
    assert events["items"][0]["contact_id"] is not None
    assert events["online_learning"] is False


# ------------------------------------------------------------- exports

def test_json_report_carries_provenance_versions_and_limitations(client):
    body, _ = _upload(client, "sonar.png", _png_bytes(), "image/png")
    report = client.get(f"/api/v1/runtime/surveys/{body['survey_id']}/report?format=json").json()
    provenance = report["provenance"]
    assert provenance["models"]["detector_model_sha256"] == "deadbeef"
    assert provenance["models"]["evidence_score_type"] == "UNVALIDATED_EVIDENCE_FUSION"
    assert provenance["navigation"]["status"] == "UNAVAILABLE"
    assert provenance["review_state"]["append_only"] is True
    assert provenance["record_counts"]["observations"] == 1
    assert any("not a calibrated probability" in line for line in provenance["limitations"])
    assert any("never proof" in line or "not proof" in line for line in provenance["limitations"])


def test_contact_scope_csv_exports_the_operational_object(client):
    body, _ = _upload(client, "sonar.png", _png_bytes(), "image/png")
    response = client.get(f"/api/v1/runtime/surveys/{body['survey_id']}/report?format=csv&scope=contacts")
    assert response.status_code == 200
    header = response.text.splitlines()[0].split(",")
    for column in ("contact_id", "evidence_score", "evidence_score_type", "priority_band", "review_verdict"):
        assert column in header
    row = response.text.splitlines()[1]
    assert "UNVALIDATED_EVIDENCE_FUSION" in row


def test_unknown_report_scope_is_rejected(client):
    body, _ = _upload(client, "sonar.png", _png_bytes(), "image/png")
    response = client.get(f"/api/v1/runtime/surveys/{body['survey_id']}/report?format=csv&scope=nonsense")
    assert response.status_code == 422


# -------------------------------------------------------------- change

def test_change_endpoint_refuses_rather_than_inventing_a_comparison(client):
    body, _ = _upload(client, "sonar.png", _png_bytes(), "image/png")
    result = client.get(f"/api/v1/runtime/surveys/{body['survey_id']}/change").json()
    assert result["supported"] is False
    assert result["status"] == "COMPARISON_REFUSED"
    gates = {blocker["gate"] for blocker in result["blockers"]}
    assert "BASELINE_SURVEY" in gates
    states = {item["state"] for item in result["semantics"]}
    assert states == {"NEW", "UNCHANGED", "NOT_DETECTED", "NOT_SURVEYED", "REMOVED"}
    removed = next(item for item in result["semantics"] if item["state"] == "REMOVED")
    assert "never inferred from a detector absence" in removed["meaning"]


def test_change_endpoint_names_every_missing_capability_gate(client):
    baseline, _ = _upload(client, "baseline.png", _png_bytes(), "image/png")
    latest, _ = _upload(client, "latest.png", _png_bytes(), "image/png")
    result = client.get(
        f"/api/v1/runtime/surveys/{latest['survey_id']}/change",
        params={"baseline_survey_id": baseline["survey_id"]},
    ).json()
    assert result["supported"] is False
    gates = {blocker["gate"] for blocker in result["blockers"]}
    assert gates == {"SPATIAL_REFERENCE_LEVEL", "COVERAGE_POLYGON"}
    assert result["baseline_survey"]["survey_id"] == baseline["survey_id"]
    assert result["new_survey"]["spatial_reference_level"] == "L0_PIXEL_ONLY"


# ------------------------------------------- serving-host hardening

def test_the_service_never_attempts_a_package_install_while_serving():
    """Ultralytics patches PIL.Image.open to pip-install pi-heif on any decode
    failure. On a serving host that turns an unreadable upload into two network
    install attempts and a ModuleNotFoundError. Auto-install is disabled before
    ultralytics is imported, so a bad file stays a fast, precise 4xx."""
    import sagar.perception.runtime  # noqa: F401  -- import sets the guard

    assert os.environ["YOLO_AUTOINSTALL"] == "false"


def test_an_undecodable_upload_is_rejected_even_when_pil_raises_something_exotic(client, monkeypatch):
    """The rejection path does not depend on which exception the decoder chose."""
    from PIL import Image

    real_open = Image.open

    def exotic_open(path, *args, **kwargs):
        try:
            return real_open(path, *args, **kwargs)
        except Exception as exc:  # noqa: BLE001
            raise ModuleNotFoundError("No module named 'pi_heif'") from exc

    monkeypatch.setattr(Image, "open", exotic_open)
    response = client.post("/api/v1/surveys/upload", files={"file": ("weird.png", b"not-an-image", "image/png")})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "UNREADABLE_RASTER"


# ------------------------------------------------- A5 · review isolation (KD-4)

_A5_OBJECT_BOXES = {"A": [4.0, 4.0, 16.0, 16.0], "B": [44.0, 40.0, 58.0, 56.0]}
_A5_NAV_CSV = (
    "frame,timestamp_utc,latitude,longitude,heading_deg\n"
    "sonar_0001.png,2026-09-01T15:30:00Z,18.921840,72.834660,128.4\n"
)


def _two_object_infer(order: tuple[str, str]):
    """Fake detector: two distinct FULL_FRAME boxes on one Frame, emitted in ``order``."""
    def infer(self, image_path, survey_id, source_image_id):
        meta, (template,) = _fake_infer(self, image_path, survey_id, source_image_id)
        width, height = meta["width_px"], meta["height_px"]
        findings = []
        for index, label in enumerate(order):
            box = _A5_OBJECT_BOXES[label]
            findings.append({
                **template, "detection_id": f"det_{survey_id}_{source_image_id}_{index:04d}",
                "bbox_px": list(box),
                "bbox_normalized": [box[0] / width, box[1] / height, box[2] / width, box[3] / height],
                "review_history": [],
            })
        return meta, findings
    return infer


def _contact_holding(survey: dict, detection_id: str) -> dict:
    (contact,) = [item for item in survey["contacts"] if detection_id in item["source_detection_ids"]]
    return contact


@pytest.mark.parametrize("order", [("A", "B"), ("B", "A")], ids=["A_first", "B_first"])
def test_a5_one_verdict_changes_exactly_the_contact_holding_the_reviewed_observation(client, monkeypatch, order):
    monkeypatch.setattr(FinalDetector, "infer", _two_object_infer(order))
    payload = _zip_bytes({"sonar_0001.png": _png_bytes((64, 64)), "navigation.csv": _A5_NAV_CSV})
    body, job = _upload(client, "bundle.zip", payload, "application/zip")
    assert job["state"] == "COMPLETED"
    survey_id = body["survey_id"]
    before = client.get(f"/api/v1/runtime/surveys/{survey_id}").json()

    by_box = {tuple(item["bbox_px"]): item["detection_id"] for item in before["findings"]}
    obs_a = by_box[tuple(_A5_OBJECT_BOXES["A"])]
    obs_b = by_box[tuple(_A5_OBJECT_BOXES["B"])]
    # Two distinct FULL_FRAME objects on one Frame are two Contacts (A2).
    assert len(before["contacts"]) == 2
    contact_a_before = _contact_holding(before, obs_a)
    contact_b_before = _contact_holding(before, obs_b)
    assert contact_a_before["contact_id"] != contact_b_before["contact_id"]
    assert obs_b not in contact_a_before["source_detection_ids"]
    finding_b_before = next(item for item in before["findings"] if item["detection_id"] == obs_b)

    for verdict in ("UNCERTAIN", "REJECTED"):
        response = client.post(
            f"/api/v1/runtime/surveys/{survey_id}/findings/{obs_a}/reviews",
            json={"verdict": verdict, "reviewer": "test operator", "rejection_reason": "clutter" if verdict == "REJECTED" else None},
        )
        assert response.status_code == 200, response.text
        assert response.json()["append_only"] is True

    for _ in range(2):  # repeated reads preserve the isolation
        after = client.get(f"/api/v1/runtime/surveys/{survey_id}").json()
        contact_a = _contact_holding(after, obs_a)
        contact_b = _contact_holding(after, obs_b)
        assert contact_a["contact_id"] == contact_a_before["contact_id"]
        # Contact A carries the verdict, append-only and in order.
        assert contact_a["disposition"] == "REJECTED"
        assert contact_a["reviews"]["latest_verdict"] == "REJECTED"
        assert contact_a["reviews"]["review_count"] == 2
        assert [event["verdict"] for event in contact_a["reviews"]["history"]] == ["UNCERTAIN", "REJECTED"]
        assert contact_a["rejection_reason"] == "clutter"
        # Contact B, and its Observation, are exactly as they were.
        assert contact_b == contact_b_before
        finding_b = next(item for item in after["findings"] if item["detection_id"] == obs_b)
        assert finding_b == finding_b_before
        assert finding_b["review_history"] == [] and finding_b["review_state"] is None
        # Only Contact A holds review history anywhere in the Survey.
        holders = [item["contact_id"] for item in after["contacts"] if (item.get("reviews") or {}).get("history")]
        assert holders == [contact_a["contact_id"]]


# ------------------------------------------------ B2 · duplicate rasters (KD-6)

def _textured_png_bytes(seed: int, size: tuple[int, int] = (32, 32)) -> bytes:
    """A deterministic raster whose bytes differ per seed (and are not uniform)."""
    pixels = np.random.default_rng(seed).integers(0, 256, size=(size[1], size[0], 3), dtype=np.uint8)
    buffer = io.BytesIO()
    Image.fromarray(pixels).save(buffer, format="PNG")
    return buffer.getvalue()


def _declared_sequence_bundle(rasters: dict[str, bytes], reverse_entries: bool = False) -> bytes:
    """Rasters with contiguous MEASURED ping bounds (by filename) and a sequential contract.

    Before A7 these declared bounds, with the fake detector's repeated box, would have been
    INDEPENDENT_LOOKS_ALONG_TRACK. Since A7 declared bounds relate nothing; the duplicate-raster guard
    on the verified (pixel-derived) relationship is tested in test_a7_association.py.
    """
    names = sorted(rasters)
    navigation = "frame,timestamp_utc,latitude,longitude,heading_deg,ping_start,ping_end\n" + "".join(
        f"{name},2026-09-01T15:30:{index:02d}Z,18.92184,72.83466,128.4,{120000 + index * 800},{120799 + index * 800}\n"
        for index, name in enumerate(names)
    )
    entries = list(rasters.items())
    if reverse_entries:
        entries.reverse()
    return _zip_bytes({
        **dict(entries), "navigation.csv": navigation,
        "mission.json": '{"sequence_mode":"SEQUENTIAL_PING","sequential_ping_evidence":true,"navigation_provenance":"MEASURED"}',
    })


def _frames_by_filename(survey: dict) -> dict[str, dict]:
    return {Path(frame["source_path"]).name: frame for frame in survey["frames"]}


@pytest.mark.parametrize("names", [
    ("sonar_0001.png", "sonar_0002.png", "sonar_0003.png"),
    ("pass_a.png", "renamed copy.png", "zz_export.png"),
], ids=["sequential_names", "renamed"])
def test_b2_byte_identical_rasters_are_flagged_and_never_form_independent_looks(client, names):
    raster = _png_bytes()
    body, job = _upload(client, "bundle.zip", _declared_sequence_bundle({name: raster for name in names}), "application/zip")
    assert job["state"] == "COMPLETED"
    survey = client.get(f"/api/v1/runtime/surveys/{body['survey_id']}").json()

    frames = _frames_by_filename(survey)
    assert sorted(frames) == sorted(names)
    frame_ids = sorted(frame["frame_id"] for frame in frames.values())
    for frame in frames.values():
        assert frame["raster_duplicate_status"] == "DUPLICATE_RASTER"
        assert frame["raster_sha256"] == frames[names[0]]["raster_sha256"]
        assert frame["duplicate_raster_frame_ids"] == frame_ids
    # I-B4: duplicate rasters never yield independent Looks.
    assert survey["contacts"]
    for contact in survey["contacts"]:
        assert contact["look_count"] == 1
        assert contact["association_basis"] != "INDEPENDENT_LOOKS_ALONG_TRACK"
        assert contact["persistence_evidence_type"] != "SEQUENTIAL_PING"
    # Duplicates stay inspectable: every Frame, Observation and raster is still served.
    assert len(survey["findings"]) == len(names)
    for frame in frames.values():
        assert client.get(f"/api/v1/runtime/surveys/{body['survey_id']}/frames/{frame['frame_id']}/raster").status_code == 200
    # B1 membership is untouched: one SINGLETON Survey per Frame, referenced by survey_ref.
    assert [item["membership_provenance"] for item in survey["surveys"]] == ["SINGLETON"] * len(names)
    assert {frame["survey_ref"] for frame in frames.values()} == {item["survey_ref"] for item in survey["surveys"]}


def test_b2_byte_different_rasters_are_not_duplicates(client):
    names = ("sonar_0001.png", "sonar_0002.png", "sonar_0003.png")
    rasters = {name: _textured_png_bytes(seed) for seed, name in enumerate(names)}
    body, job = _upload(client, "bundle.zip", _declared_sequence_bundle(rasters), "application/zip")
    assert job["state"] == "COMPLETED"
    survey = client.get(f"/api/v1/runtime/surveys/{body['survey_id']}").json()

    frames = _frames_by_filename(survey)
    assert len({frame["raster_sha256"] for frame in frames.values()}) == 3
    for frame in frames.values():
        assert frame["raster_duplicate_status"] == "UNIQUE"
        assert frame["duplicate_raster_frame_ids"] == []
    # B2 does not flag them; and since A7 their declared MEASURED contiguous pings relate nothing.
    assert [contact["look_count"] for contact in survey["contacts"]] == [1, 1, 1]


def test_b2_duplicate_flags_and_contacts_do_not_depend_on_upload_order(client):
    duplicate = _textured_png_bytes(7)
    rasters = {"sonar_0001.png": duplicate, "sonar_0002.png": _textured_png_bytes(8), "sonar_0003.png": duplicate}
    results = []
    for reverse in (False, True):
        body, job = _upload(client, "bundle.zip", _declared_sequence_bundle(rasters, reverse_entries=reverse), "application/zip")
        assert job["state"] == "COMPLETED"
        survey = client.get(f"/api/v1/runtime/surveys/{body['survey_id']}").json()
        frames = _frames_by_filename(survey)
        results.append({
            "flags": {name: frame["raster_duplicate_status"] for name, frame in frames.items()},
            "contacts": sorted((contact["look_count"], contact["association_basis"],
                                tuple(sorted(Path(frames_by_id).name for frames_by_id in contact["provenance"]["source_raster_identities"])))
                               for contact in survey["contacts"]),
        })
        assert all(contact["look_count"] == 1 for contact in survey["contacts"])
    assert results[0] == results[1]
    assert results[0]["flags"] == {"sonar_0001.png": "DUPLICATE_RASTER", "sonar_0002.png": "UNIQUE", "sonar_0003.png": "DUPLICATE_RASTER"}
