"""Round-2 ticket H0-2: leakage is structurally impossible (I-H0-1, I-H0-4, spec §7.1).

Split use follows spec §7.1 literally: `train` only for memory banks and probes, `val` only for fitting,
`test` only for evaluation. Reference builders never see ground truth. Every check runs against the
frozen H0-1 manifest, which is read and never modified.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from round2.guards import (
    FROZEN_MANIFEST_PATH, PURPOSE_SPLITS, GroundTruthAccessError, LeakageError, load_frozen_manifest, reference_view,
    rows_for, validate_evaluation_set, validate_manifest,
)
from round2.manifest import ManifestError


@pytest.fixture(scope="module")
def manifest() -> list[dict]:
    return load_frozen_manifest()


# --- 1. a train row injected into an evaluation set

def test_injecting_a_train_row_into_an_evaluation_set_raises(manifest):
    test_rows = rows_for(manifest, "test", "evaluate")
    train_row = next(row for row in manifest if row["split"] == "train")
    with pytest.raises(LeakageError, match="train"):
        validate_evaluation_set(test_rows + [train_row], manifest)


def test_a_train_row_relabelled_as_test_is_still_rejected(manifest):
    test_rows = rows_for(manifest, "test", "evaluate")
    disguised = {**next(row for row in manifest if row["split"] == "train"), "split": "test"}
    with pytest.raises(LeakageError, match="train"):
        validate_evaluation_set(test_rows + [disguised], manifest)


def test_a_row_absent_from_the_frozen_manifest_is_rejected(manifest):
    stranger = {**rows_for(manifest, "test", "evaluate")[0], "image_id": "not_in_the_frozen_manifest"}
    with pytest.raises(LeakageError, match="frozen manifest"):
        validate_evaluation_set([stranger], manifest)


def test_the_frozen_test_set_validates(manifest):
    assert len(validate_evaluation_set(rows_for(manifest, "test", "evaluate"), manifest)) == 2793


# --- 2. a PING augmentation sibling in two splits

def test_a_ping_augmentation_sibling_in_two_splits_raises(manifest):
    sibling = copy.deepcopy(next(row for row in manifest if row["dataset"] == "PING_GHOSTVISION" and row["split"] == "test"))
    sibling.update({"image_id": sibling["image_id"] + "_injected_sibling", "split": "train"})
    with pytest.raises(LeakageError, match="augmentation"):
        validate_manifest(manifest + [sibling])


def test_the_frozen_manifest_has_no_sibling_across_splits(manifest):
    validate_manifest(manifest)


# --- 3. fit-on-test and the rest of spec §7.1

def test_requesting_fit_on_test_raises(manifest):
    with pytest.raises(LeakageError, match="fit"):
        rows_for(manifest, "test", "fit")


@pytest.mark.parametrize("split, purpose", [
    ("train", "evaluate"), ("val", "evaluate"), ("train", "fit"),
    ("val", "memory_bank"), ("test", "memory_bank"), ("val", "probe"), ("test", "probe"),
])
def test_every_other_split_use_outside_spec_7_1_raises(manifest, split, purpose):
    with pytest.raises(LeakageError):
        rows_for(manifest, split, purpose)


def test_split_uses_allowed_by_spec_7_1(manifest):
    assert PURPOSE_SPLITS == {"memory_bank": "train", "probe": "train", "fit": "val", "evaluate": "test"}
    assert len(rows_for(manifest, "train", "memory_bank")) == 7852
    assert len(rows_for(manifest, "train", "probe")) == 7852
    assert len(rows_for(manifest, "val", "fit")) == 1199
    assert len(rows_for(manifest, "test", "evaluate")) == 2793


def test_an_unknown_purpose_raises(manifest):
    with pytest.raises(LeakageError, match="purpose"):
        rows_for(manifest, "val", "calibrate_somehow")


# --- 4. ground truth is inaccessible to reference builders

def test_ground_truth_is_inaccessible_to_reference_builders(manifest):
    def peeking_builder(rows):
        return [row["gt_boxes"] for row in rows]

    views = reference_view(rows_for(manifest, "train", "memory_bank")[:5])
    with pytest.raises(GroundTruthAccessError):
        peeking_builder(views)
    for field in ("gt_boxes", "gt_object_regions", "gt_boxes_derivation", "gt_object_regions_status"):
        with pytest.raises(GroundTruthAccessError):
            views[0].get(field)
        assert field not in views[0]
    # Everything a reference needs besides GT stays readable, and copies carry no GT.
    view = views[0]
    assert {"image_id", "dataset", "sensor", "split", "survey_id", "bootstrap_group", "source_sha256"} <= set(view)
    assert not any(key.startswith("gt_") for key in dict(view))
    assert not any(key.startswith("gt_") for key in json.loads(json.dumps(dict(view))))


# --- the frozen manifest itself

def test_the_frozen_manifest_is_the_h0_1_artifact_and_a_changed_copy_is_refused(tmp_path):
    rows = load_frozen_manifest()
    assert len(rows) == 11844
    tampered = tmp_path / "manifest.jsonl"
    lines = FROZEN_MANIFEST_PATH.read_text().splitlines(keepends=True)
    first = json.loads(lines[0])
    first["split"] = "test" if first["split"] != "test" else "val"
    tampered.write_text(json.dumps(first, sort_keys=True) + "\n" + "".join(lines[1:]))
    with pytest.raises(ManifestError, match="SHA-256"):
        load_frozen_manifest(tampered)
