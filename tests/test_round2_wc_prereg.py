"""PID-02 water-column reference pre-registration (spec Amendment E-2): train-only, label-free, content-free selection.

SubPipe: per (channel, train Survey), frames sorted by (source timestamp, image_id); the first frame, then repeatedly
the earliest frame at least 25 s after the last selected one (25 s = 500 rows at the B4 row shift of 20 rows/s, so
selected frames share no pings). AI4: census of every train image. PING: never selected. Selection reads no pixels,
no ground truth and no detector output; presentation order and opaque ids come from SHA-256(salt | image_id).
"""
from __future__ import annotations

import json
import random
from decimal import Decimal
from pathlib import Path

import pytest

from round2.guards import GroundTruthAccessError, reference_view
from round2.wc_prereg import (
    FRAME_SECONDS, PROTOCOL_VERSION, PreregError, build_protocol, lattice, opaque_id, select_sample,
)

ROOT = Path(__file__).resolve().parents[1]
CORPUS = Path.home() / "Desktop/sagardrishti/data/processed/multidomain_sonar_v1_1_20260831"


def _row(image_id, dataset, split, survey=None, group=None, channel=None, width=100, height=50):
    return {"image_id": image_id, "dataset": dataset, "sensor": "s", "channel": channel, "split": split,
            "survey_id": survey or f"{dataset}:{image_id}", "augmentation_parent": None,
            "bootstrap_group": group or f"g_{image_id}", "source_path": f"canonical/images/{image_id}.png",
            "source_sha256": (image_id * 64)[:64], "image_width": width, "image_height": height,
            "gt_boxes": [{"class": "X", "xyxy_px": [0, 0, 1, 1]}], "gt_object_regions": None,
            "gt_object_regions_status": "NOT_APPLICABLE", "gt_boxes_derivation": "BBOX"}


def test_frame_seconds_is_the_b4_derived_frame_duration():
    assert FRAME_SECONDS == Decimal(25)          # 500 rows / 20 rows per second


def test_lattice_takes_the_first_frame_then_the_earliest_frame_25_s_later():
    frames = [(Decimal(t), f"f{t:03d}") for t in range(0, 61)]
    assert lattice(frames) == ["f000", "f025", "f050"]


def test_lattice_is_inclusive_at_25_s_and_skips_gaps():
    assert lattice([(Decimal(0), "a"), (Decimal(25), "b")]) == ["a", "b"]
    frames = [(Decimal(str(t)), f"f{t}") for t in (0, 10, 24.99, 30, 31, 54.99, 55, 56)]
    assert lattice(frames) == ["f0", "f30", "f55"]


def test_lattice_is_independent_of_input_order_and_breaks_time_ties_by_image_id():
    frames = [(Decimal(0), "b"), (Decimal(0), "a"), (Decimal(25), "d"), (Decimal(25), "c")]
    for seed in range(5):
        random.Random(seed).shuffle(frames)
        assert lattice(frames) == ["a", "c"]


def _manifest():
    rows = []
    for split in ("train", "val", "test"):
        for t in range(0, 60):
            image_id = f"sp_{split}_hf_{t:03d}"
            rows.append(_row(image_id, "SUBPIPE", split, survey=f"SUBPIPE:HF:{split}", group=f"SUBPIPE:HF:{split}:block0", channel="HF"))
    rows += [_row(f"ai4_{split}_{i}", "AI4SHIPWRECKS", split, group=f"wreck_{i % 2}") for split in ("train", "val", "test") for i in range(3)]
    rows += [_row(f"ping_{split}", "PING_GHOSTVISION", split) for split in ("train", "val", "test")]
    stamps = {row["image_id"]: ("HF", Decimal(int(row["image_id"][-3:]))) for row in rows if row["dataset"] == "SUBPIPE"}
    return rows, stamps


def test_selection_is_train_only_subpipe_lattice_plus_ai4_census_and_no_ping():
    rows, stamps = _manifest()
    sample = select_sample(reference_view(rows), stamps)
    ids = [entry["image_id"] for entry in sample]
    assert sorted(i for i in ids if i.startswith("sp_")) == ["sp_train_hf_000", "sp_train_hf_025", "sp_train_hf_050"]
    assert sorted(i for i in ids if i.startswith("ai4_")) == ["ai4_train_0", "ai4_train_1", "ai4_train_2"]
    assert not any(i.startswith("ping_") for i in ids)
    assert {entry["split"] for entry in sample} == {"train"}


def test_selection_never_reads_ground_truth():
    rows, stamps = _manifest()
    view = reference_view(rows)
    with pytest.raises(GroundTruthAccessError):
        view[0]["gt_boxes"]
    select_sample(view, stamps)                                     # would raise if it touched gt_*


def test_selection_refuses_raw_rows_that_expose_ground_truth():
    rows, stamps = _manifest()
    with pytest.raises(PreregError):
        select_sample(rows, stamps)


def test_selection_records_grouping_hashes_and_is_independent_of_row_order():
    rows, stamps = _manifest()
    first = select_sample(reference_view(rows), stamps)
    random.Random(3).shuffle(rows)
    assert select_sample(reference_view(rows), stamps) == first
    entry = next(e for e in first if e["dataset"] == "SUBPIPE")
    for key in ("opaque_id", "image_id", "dataset", "sensor", "channel", "split", "survey_id", "bootstrap_group",
                "source_sha256", "source_path", "image_width", "image_height", "source_timestamp", "presentation_rank"):
        assert key in entry
    assert [e["presentation_rank"] for e in first] == list(range(len(first)))


def test_opaque_ids_hide_the_image_id_and_are_unique():
    rows, stamps = _manifest()
    sample = select_sample(reference_view(rows), stamps)
    opaque = [entry["opaque_id"] for entry in sample]
    assert len(set(opaque)) == len(opaque)
    assert all(entry["image_id"] not in entry["opaque_id"] and "subpipe" not in entry["opaque_id"].lower() for entry in sample)
    assert opaque_id("x") == opaque_id("x") != opaque_id("y")


def test_protocol_is_deterministic_and_carries_the_frozen_rules():
    rows, stamps = _manifest()
    sample = select_sample(reference_view(rows), stamps)
    hashes = {"sample.jsonl": "a" * 64, "instructions.md": "b" * 64}
    one = json.dumps(build_protocol(sample, hashes, inputs={"x": "y"}), sort_keys=True)
    two = json.dumps(build_protocol(sample, hashes, inputs={"x": "y"}), sort_keys=True)
    assert one == two
    protocol = json.loads(one)
    assert protocol["protocol_version"] == PROTOCOL_VERSION
    assert protocol["annotators"]["roles"] == ["ANNOTATOR_A", "ANNOTATOR_B"]
    assert protocol["annotation_schema"]["states"] == ["AVAILABLE", "AMBIGUOUS", "NOT_VISIBLE"]
    assert protocol["ping"]["status"] == "UNAVAILABLE"
    assert protocol["ai4"]["reference_status"] == "ANNOTATION_REFERENCED_NOT_PHYSICALLY_VALIDATED"
    assert protocol["confidence"]["numeric_confidence"] == "UNAVAILABLE"
    assert protocol["open_criteria"] == []
    for key in ("human_benchmark", "estimator_acceptance", "dvl_secondary_check", "display", "blinding",
                "adjudication", "data_governance", "leakage_prohibitions", "catastrophic_errors"):
        assert protocol[key]


@pytest.mark.skipif(not CORPUS.is_dir(), reason="frozen corpus not available")
def test_real_selection_counts():
    from round2.wc_prereg import load_inputs
    rows, stamps = load_inputs()
    sample = select_sample(reference_view(rows), stamps)
    by = lambda key: {k: sum(1 for e in sample if (e["dataset"], e["channel"]) == k) for k in key}  # noqa: E731
    assert by([("SUBPIPE", "HF"), ("SUBPIPE", "LF"), ("AI4SHIPWRECKS", None)]) == {
        ("SUBPIPE", "HF"): 56, ("SUBPIPE", "LF"): 61, ("AI4SHIPWRECKS", None): 140}
    assert {e["split"] for e in sample} == {"train"}
    assert not any(e["dataset"] == "PING_GHOSTVISION" for e in sample)
    assert len({e["bootstrap_group"] for e in sample if e["dataset"] == "AI4SHIPWRECKS"}) == 13
    assert len({e["bootstrap_group"] for e in sample if e["channel"] == "HF"}) == 24
    assert len({e["bootstrap_group"] for e in sample if e["channel"] == "LF"}) == 26
