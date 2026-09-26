"""PID-02 water-column annotation tool (pre-registration PID02-WCREF-v1): a human-only interface.

Records are validated against the frozen schema, appended (never rewritten), superseded by later records with
provenance, and kept per annotator role; the display transforms are the two frozen deterministic ones; the module
imports no detector, estimator or ground-truth code.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from round2.wc_annotate import ROLES, VIEWS, AnnotationError, AnnotationStore, render, validate_annotation

ENTRY = {"opaque_id": "abc123", "source_sha256": "f" * 64, "image_width": 100, "image_height": 50}


def _seg(start, end, state, x0=None, x1=None):
    return {"row_start": start, "row_end": end, "state": state, "x_start": x0, "x_end": x1}


def _payload(left=None, right=None, view="NATIVE"):
    return {"opaque_id": "abc123", "view": view,
            "sides": {"IMAGE_LEFT": [_seg(0, 49, "AVAILABLE", 30, 40)] if left is None else left,
                      "IMAGE_RIGHT": [_seg(0, 49, "NOT_VISIBLE")] if right is None else right}}


def test_roles_and_views_are_the_frozen_ones():
    assert ROLES == ("ANNOTATOR_A", "ANNOTATOR_B")
    assert VIEWS == ("NATIVE", "CONTRAST_HISTEQ")


def test_a_valid_annotation_passes():
    validate_annotation(_payload(), ENTRY)


@pytest.mark.parametrize("left", [
    [_seg(0, 49, "AVAILABLE", 40, 30)],                       # start after end
    [_seg(0, 49, "AVAILABLE", -1, 30)],                       # outside the image
    [_seg(0, 49, "AVAILABLE", 30, 100)],                      # x = W is outside
    [_seg(0, 49, "AVAILABLE", 30, None)],                     # AVAILABLE needs an interval
    [_seg(0, 49, "AVAILABLE", 30.5, 40)],                     # native integer columns only
    [_seg(0, 49, "NOT_VISIBLE", 30, 40)],                     # NOT_VISIBLE never carries a location
    [_seg(0, 49, "AMBIGUOUS", 30, None)],                     # AMBIGUOUS interval is both-or-neither
    [_seg(0, 49, "MAYBE")],                                   # unknown state
    [_seg(0, 20, "NOT_VISIBLE"), _seg(22, 49, "NOT_VISIBLE")],  # gap in rows
    [_seg(0, 20, "NOT_VISIBLE"), _seg(20, 49, "NOT_VISIBLE")],  # overlap in rows
    [_seg(0, 48, "NOT_VISIBLE")],                             # does not reach the last row
    [],                                                       # no segments
])
def test_invalid_segments_are_rejected(left):
    with pytest.raises(AnnotationError):
        validate_annotation(_payload(left=left), ENTRY)


def test_ambiguous_may_carry_a_broad_interval_or_none():
    validate_annotation(_payload(left=[_seg(0, 49, "AMBIGUOUS", 10, 60)]), ENTRY)
    validate_annotation(_payload(left=[_seg(0, 49, "AMBIGUOUS")]), ENTRY)


def test_row_segments_may_split_a_side():
    validate_annotation(_payload(left=[_seg(0, 19, "AVAILABLE", 30, 35), _seg(20, 49, "AMBIGUOUS")]), ENTRY)


def test_unknown_view_side_or_image_is_rejected():
    with pytest.raises(AnnotationError):
        validate_annotation(_payload(view="SHARPENED"), ENTRY)
    bad = _payload()
    bad["sides"]["PORT"] = bad["sides"].pop("IMAGE_LEFT")
    with pytest.raises(AnnotationError):
        validate_annotation(bad, ENTRY)
    with pytest.raises(AnnotationError):
        validate_annotation({**_payload(), "opaque_id": "other"}, ENTRY)


def test_store_appends_and_supersedes_without_rewriting(tmp_path):
    store = AnnotationStore(tmp_path, "ANNOTATOR_A", protocol_version="P", protocol_sha256="s" * 64)
    first = store.append_annotation(_payload(), ENTRY)
    before = store.path.read_bytes()
    second = store.append_annotation(_payload(right=[_seg(0, 49, "AVAILABLE", 60, 70)]), ENTRY)
    assert store.path.read_bytes().startswith(before)                  # append-only
    assert second["supersedes"] == first["record_id"] and first["supersedes"] is None
    assert store.latest()["abc123"]["record_id"] == second["record_id"]
    for record in (first, second):
        assert record["annotator"] == "ANNOTATOR_A" and record["protocol_version"] == "P"
        assert record["protocol_sha256"] == "s" * 64 and record["source_sha256"] == "f" * 64
        assert record["submitted_at"].endswith("+00:00") and record["view"] == "NATIVE"
    lines = [json.loads(line) for line in store.path.read_text().splitlines()]
    assert [line["record_id"] for line in lines] == [first["record_id"], second["record_id"]]


def test_store_is_per_role_and_never_reads_another_role(tmp_path):
    a = AnnotationStore(tmp_path, "ANNOTATOR_A", protocol_version="P", protocol_sha256="s" * 64)
    b = AnnotationStore(tmp_path, "ANNOTATOR_B", protocol_version="P", protocol_sha256="s" * 64)
    a.append_annotation(_payload(), ENTRY)
    assert a.path != b.path and "ANNOTATOR_A" in str(a.path) and "ANNOTATOR_B" in str(b.path)
    assert b.latest() == {}
    with pytest.raises(AnnotationError):
        AnnotationStore(tmp_path, "ANNOTATOR_C", protocol_version="P", protocol_sha256="s" * 64)


def test_store_refuses_records_from_another_protocol_or_role(tmp_path):
    store = AnnotationStore(tmp_path, "ANNOTATOR_A", protocol_version="P", protocol_sha256="s" * 64)
    store.append_annotation(_payload(), ENTRY)
    with pytest.raises(AnnotationError):
        AnnotationStore(tmp_path, "ANNOTATOR_A", protocol_version="Q", protocol_sha256="s" * 64).latest()


def test_declaration_is_recorded_with_the_required_fields(tmp_path):
    store = AnnotationStore(tmp_path, "ANNOTATOR_B", protocol_version="P", protocol_sha256="s" * 64)
    record = store.declare(prior_sonar_experience="LIMITED", participated_in_estimator_development=False)
    assert record["record_type"] == "annotator_declaration" and record["role"] == "independent annotator"
    assert record["prior_sonar_experience"] == "LIMITED" and record["participated_in_estimator_development"] is False
    assert store.declaration()["record_id"] == record["record_id"]
    with pytest.raises(AnnotationError):
        store.declare(prior_sonar_experience="EXPERT", participated_in_estimator_development=False)


def test_native_view_is_the_stored_8_bit_values():
    pixels = np.array([[0, 10], [200, 255]], dtype=np.uint8)
    assert np.array_equal(render(pixels, "NATIVE"), pixels)


def test_contrast_view_is_global_histogram_equalization():
    pixels = np.array([[0, 0, 10, 10], [10, 10, 200, 255]], dtype=np.uint8)
    # cdf over sorted levels 0:2, 10:6, 200:7, 255:8; cdf_min = 2; v' = round(255 (cdf - 2) / (8 - 2))
    expected = np.array([[0, 0, 170, 170], [170, 170, 212, 255]], dtype=np.uint8)
    assert np.array_equal(render(pixels, "CONTRAST_HISTEQ"), expected)
    flat = np.full((2, 2), 7, dtype=np.uint8)
    assert np.array_equal(render(flat, "CONTRAST_HISTEQ"), flat)          # constant image: unchanged


def test_render_keeps_shape_and_rejects_unknown_views():
    pixels = np.zeros((3, 5), dtype=np.uint8)
    assert render(pixels, "CONTRAST_HISTEQ").shape == (3, 5)
    with pytest.raises(AnnotationError):
        render(pixels, "GAMMA")


def test_tool_imports_no_model_estimator_or_ground_truth_code():
    source = (Path(__file__).resolve().parents[1] / "ml/round2/wc_annotate.py").read_text()
    for forbidden in ("ultralytics", "torch", "round2.infer", "round2.features", "round2.baseline", "sagar.perception",
                      "gt_boxes", "gt_object_regions", "estimator_output", "detections"):
        assert forbidden not in source


def test_server_serves_one_role_end_to_end(tmp_path):
    import hashlib
    import threading
    import urllib.error
    import urllib.request

    from PIL import Image

    from round2.wc_annotate import make_server

    pixels = (np.arange(50 * 100) % 256).astype(np.uint8).reshape(50, 100)
    (tmp_path / "img.png").write_bytes(b"")
    Image.fromarray(pixels, mode="L").save(tmp_path / "img.png")
    entry = {**ENTRY, "source_path": "img.png", "source_sha256": hashlib.sha256((tmp_path / "img.png").read_bytes()).hexdigest(),
             "presentation_rank": 0}
    other = AnnotationStore(tmp_path / "ann", "ANNOTATOR_B", protocol_version="P", protocol_sha256="s" * 64)
    other.declare(prior_sonar_experience="NONE", participated_in_estimator_development=False)
    store = AnnotationStore(tmp_path / "ann", "ANNOTATOR_A", protocol_version="P", protocol_sha256="s" * 64)
    server = make_server(store, [entry], "instr", tmp_path, 0)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_address[1]}"

    def post(path, body):
        request = urllib.request.Request(base + path, data=json.dumps(body).encode(), method="POST")
        try:
            return urllib.request.urlopen(request).status, None
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read())

    try:
        session = json.loads(urllib.request.urlopen(base + "/api/session").read())
        assert session["role"] == "ANNOTATOR_A" and session["declared"] is False and session["latest"] == {}
        assert [i["opaque_id"] for i in session["items"]] == ["abc123"]
        for view in ("NATIVE", "CONTRAST_HISTEQ"):
            png = urllib.request.urlopen(f"{base}/image/abc123/{view}").read()
            from io import BytesIO
            assert np.array_equal(np.asarray(Image.open(BytesIO(png))), render(pixels, view))
        assert post("/api/annotate", _payload())[0] == 400                 # declaration comes first
        assert post("/api/declare", {"prior_sonar_experience": "LIMITED", "participated_in_estimator_development": True})[0] == 200
        assert post("/api/annotate", _payload())[0] == 200
        assert post("/api/annotate", _payload(left=[_seg(0, 49, "AVAILABLE", 40, 30)]))[0] == 400
        assert len(store.latest()) == 1 and other.latest() == {}
        for path in ("/../ANNOTATOR_B/annotations.jsonl", "/image/abc123/GAMMA", "/api/records"):
            with pytest.raises(urllib.error.HTTPError):
                urllib.request.urlopen(base + path)
    finally:
        server.shutdown()
