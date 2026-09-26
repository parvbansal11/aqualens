"""Round-2 ticket H0-7: the PING one-image-per-augmentation-parent subset (spec H0 item 5, H0-AC6, PID-03).

PID-03: within each split, each PING augmentation parent is represented by the sibling whose full source path
string (corpus metadata ``original_filename``) is lexicographically smallest under code-point ordering. No labels,
pixels, detections, hashes, row order or file-system order enter the choice, and the chosen sibling claims no
physical priority: the subset only stops siblings from counting as independent observations.
"""
from __future__ import annotations

import json
import random
from pathlib import Path

import pytest

from round2.ping_subset import (
    SELECTION_METHOD, SubsetError, load_selection_metadata, select_representatives, write_subset,
)

ROOT = Path(__file__).resolve().parents[1]
FROZEN_METADATA = ROOT / "data/processed/multidomain_sonar_v1_1_20260831/canonical/metadata.jsonl"


def _pair(image_id: str, parent: str | None, split: str, path: str | None, **meta) -> tuple[dict, dict]:
    manifest = {"image_id": image_id, "dataset": "PING_GHOSTVISION", "sensor": "Humminbird", "channel": None, "split": split,
                "survey_id": f"PING_GHOSTVISION:{image_id}", "augmentation_parent": parent, "bootstrap_group": "ping_recording_rec2",
                "source_path": f"canonical/images/{image_id}.png", "source_sha256": "0" * 64, "image_width": 640, "image_height": 640,
                "gt_boxes": [{"class": "CRAB_POT", "xyxy_px": [1.0, 1.0, 5.0, 5.0]}], "gt_object_regions": None,
                "gt_object_regions_status": "NOT_APPLICABLE", "gt_boxes_derivation": "BBOX"}
    metadata = {"sample_id": image_id, "source_dataset": "PING_GHOSTVISION", "split": split, "augmentation_parent_id": parent,
                "original_filename": path, "bbox_xyxy_px": [[1.0, 1.0, 5.0, 5.0]], "class_name": "CRAB_POT", "is_background": False, **meta}
    return manifest, metadata


def _corpus():
    pairs = [
        _pair("id_z", "Rec2_a", "test", "test/Rec2_a_png_jpg.rf.0003.jpg"),
        _pair("id_a", "Rec2_a", "test", "test/Rec2_a_png_jpg.rf.0001.jpg"),   # smallest path, but not the first row
        _pair("id_m", "Rec2_a", "test", "test/Rec2_a_png_jpg.rf.0002.jpg"),
        _pair("id_b", "Rec2_b", "test", "test/Rec2_b_png_jpg.rf.9999.jpg"),   # a single-image parent
        _pair("id_c", "Rec3_c", "val", "valid/Rec3_c_png_jpg.rf.0500.jpg"),
        _pair("id_d", "Rec3_c", "val", "valid/Rec3_c_png_jpg.rf.0400.jpg"),
        _pair("sp_1", None, "test", None),                                       # SubPipe: unaffected
    ]
    pairs[-1][0].update({"dataset": "SUBPIPE", "sensor": "Klein 3500"})
    pairs[-1][1].update({"source_dataset": "SUBPIPE"})
    return [m for m, _ in pairs], [d for _, d in pairs]


def _by_parent(result: list[dict]) -> dict[tuple[str, str], dict]:
    return {(r["split"], r["augmentation_parent"]): r for r in result}


# --- the rule

def test_one_representative_per_split_and_parent_by_smallest_full_source_path():
    manifest, metadata = _corpus()
    result = _by_parent(select_representatives(manifest, metadata))
    assert set(result) == {("test", "Rec2_a"), ("test", "Rec2_b"), ("val", "Rec3_c")}
    assert result[("test", "Rec2_a")]["image_id"] == "id_a" and result[("test", "Rec2_a")]["sibling_count"] == 3
    assert result[("test", "Rec2_a")]["sibling_image_ids"] == ["id_a", "id_m", "id_z"]
    assert result[("test", "Rec2_a")]["source_path"] == "test/Rec2_a_png_jpg.rf.0001.jpg"
    assert result[("test", "Rec2_b")]["image_id"] == "id_b" and result[("test", "Rec2_b")]["sibling_count"] == 1
    assert result[("val", "Rec3_c")]["image_id"] == "id_d"
    assert all(r["range_axis"] == "UNKNOWN" and r["selection_method"] == SELECTION_METHOD for r in result.values())


def test_the_full_path_decides_where_basename_image_id_or_hash_would_not():
    # Basenames sort "a.jpg" < "b.jpg"; full paths sort "x/b.jpg" < "y/a.jpg"; image ids and any hash sort the other way.
    pairs = [_pair("id_1", "P", "test", "y/a.jpg"), _pair("id_2", "P", "test", "x/b.jpg")]
    (only,) = select_representatives([m for m, _ in pairs], [d for _, d in pairs])
    assert only["image_id"] == "id_2" and only["source_path"] == "x/b.jpg"


def test_ordering_is_code_point_order_not_locale_or_case_folding():
    pairs = [_pair("id_lower", "P", "test", "test/a.jpg"), _pair("id_upper", "P", "test", "test/B.jpg"),
             _pair("id_accent", "P", "test", "test/à.jpg")]
    (only,) = select_representatives([m for m, _ in pairs], [d for _, d in pairs])
    assert only["image_id"] == "id_upper"          # "B" (U+0042) < "a" (U+0061) < "à" (U+00E0)


# --- invariance

def test_row_order_never_changes_the_representatives():
    manifest, metadata = _corpus()
    expected = select_representatives(manifest, metadata)
    for seed in range(6):
        rng = random.Random(seed)
        shuffled_manifest, shuffled_metadata = list(manifest), list(metadata)
        rng.shuffle(shuffled_manifest)
        rng.shuffle(shuffled_metadata)
        assert select_representatives(shuffled_manifest, shuffled_metadata) == expected


def test_labels_detections_dimensions_and_augmentation_hints_never_change_the_representatives():
    manifest, metadata = _corpus()
    expected = select_representatives(manifest, metadata)
    for row in manifest:
        row.update({"gt_boxes": [], "detections": [{"raw_class": "CRAB_POT"}], "image_width": 1, "image_height": 9999})
    for row in metadata:
        row.update({"bbox_xyxy_px": [], "is_background": True, "class_name": None, "augmentation": "rot90"})
    assert select_representatives(manifest, metadata) == expected


# --- fail closed

def test_a_missing_source_path_fails_closed():
    manifest, metadata = _corpus()
    metadata[1]["original_filename"] = None
    with pytest.raises(SubsetError, match="source path"):
        select_representatives(manifest, metadata)


def test_a_missing_parent_fails_closed():
    manifest, metadata = _corpus()
    manifest[0]["augmentation_parent"] = None
    with pytest.raises(SubsetError, match="parent"):
        select_representatives(manifest, metadata)


def test_a_parent_in_two_splits_fails_closed():
    manifest, metadata = _corpus()
    manifest[3]["augmentation_parent"] = metadata[3]["augmentation_parent_id"] = "Rec3_c"
    with pytest.raises(SubsetError, match="split"):
        select_representatives(manifest, metadata)


def test_manifest_and_metadata_must_agree_one_to_one():
    manifest, metadata = _corpus()
    with pytest.raises(SubsetError, match="metadata"):
        select_representatives(manifest, metadata[1:])
    manifest, metadata = _corpus()
    metadata[0]["augmentation_parent_id"] = "Other"
    with pytest.raises(SubsetError, match="parent"):
        select_representatives(manifest, metadata)


def test_selection_metadata_keeps_no_labels():
    rows = load_selection_metadata(FROZEN_METADATA)
    assert all(set(row) == {"sample_id", "source_dataset", "split", "augmentation_parent_id", "original_filename"} for row in rows)


# --- the frozen corpus (metadata only)

def test_frozen_corpus_gives_324_test_representatives_and_the_expected_per_split_counts():
    """H0-AC6. The frozen manifest and the frozen corpus metadata; no labels or pixels."""
    from round2.guards import load_frozen_manifest
    result = select_representatives(load_frozen_manifest(), load_selection_metadata(FROZEN_METADATA))
    counts = {split: sum(1 for r in result if r["split"] == split) for split in ("train", "val", "test")}
    assert counts == {"train": 1521, "val": 294, "test": 324}
    assert sum(r["sibling_count"] for r in result if r["split"] == "test") == 873
    assert len({(r["split"], r["augmentation_parent"]) for r in result}) == len(result) == 2139


# --- the artifact

def test_the_artifact_is_deterministic_order_invariant_and_immutable(tmp_path):
    manifest, metadata = _corpus()
    meta_path = tmp_path / "metadata.jsonl"
    meta_path.write_text("".join(json.dumps(row) + "\n" for row in metadata))
    reversed_meta = tmp_path / "metadata_reversed.jsonl"
    reversed_meta.write_text("".join(json.dumps(row) + "\n" for row in reversed(metadata)))
    first, second = tmp_path / "a" / "iter-1", tmp_path / "b" / "iter-1"
    provenance = write_subset(first, manifest_rows=manifest, metadata_path=meta_path, manifest_sha256="f" * 64, metadata_sha256=None)
    write_subset(second, manifest_rows=list(reversed(manifest)), metadata_path=reversed_meta, manifest_sha256="f" * 64, metadata_sha256=None)
    assert (first / "ping_one_per_parent.jsonl").read_bytes() == (second / "ping_one_per_parent.jsonl").read_bytes()
    assert provenance["representatives_by_split"] == {"test": 2, "val": 1}
    assert provenance["sibling_count_distribution"] == {"test": {"1": 1, "3": 1}, "val": {"2": 1}}
    records = [json.loads(line) for line in (first / "ping_one_per_parent.jsonl").read_text().splitlines()]
    assert not any(key.startswith("gt_") for record in records for key in record)
    with pytest.raises(SubsetError, match="immutable"):
        write_subset(first, manifest_rows=manifest, metadata_path=meta_path, manifest_sha256="f" * 64, metadata_sha256=None)
