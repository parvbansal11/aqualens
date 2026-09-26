"""Round-2 ticket H0-1: the held-out manifest (spec H0 item 1, §6 manifest row, §7.3, H0-AC1).

One row per corpus image, built only from the detector's own split field in the frozen corpus metadata:
sensor, dataset, split, Survey id, augmentation parent, bootstrap group, GT boxes, AI4 merged object
regions and source SHA-256. Decisions for this ticket (recorded in the artifact):
  - PID-01 deferred: AI4 merged object regions are UNAVAILABLE; GT boxes keep their connected-component
    derivation label. Nothing is merged or filtered.
  - SubPipe Survey = maximal chain of time-adjacent frames of one channel whose every link is confirmed
    by the frozen B4 row-shift verifier. Timestamps choose which pairs to test; pixels decide.
  - SubPipe bootstrap group = 60-s block anchored at the first frame of its Survey (never spans Surveys).
"""
from __future__ import annotations

import hashlib
import io
import json
import random
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from round2.manifest import (
    MANIFEST_FIELDS, SENSORS, ManifestError, build_manifest, evaluation_set, load_corpus_rows, split_counts,
)

ROOT = Path(__file__).resolve().parents[1]
FROZEN_METADATA = ROOT / "data/processed/multidomain_sonar_v1_1_20260831/canonical/metadata.jsonl"


# --------------------------------------------------------------- frozen corpus

def test_split_counts_of_the_frozen_corpus_equal_its_qa():
    """H0-AC1. Expected values are the frozen corpus QA file (qa/qa.json "counts")."""
    counts = split_counts(load_corpus_rows(FROZEN_METADATA))
    assert counts["splits"] == {"train": 7852, "val": 1199, "test": 2793}
    assert counts["datasets"] == {"SUBPIPE": 4884, "AI4SHIPWRECKS": 286, "PING_GHOSTVISION": 6674}


def test_every_dataset_keeps_its_own_sensor():
    # Spec D item 1 names the three sensors; each supervised class comes from one sensor (confound kept visible).
    assert SENSORS == {"SUBPIPE": "Klein 3500", "AI4SHIPWRECKS": "EdgeTech 2205", "PING_GHOSTVISION": "Humminbird"}


# ------------------------------------------------------------ synthetic corpus

def _png(pixels: np.ndarray) -> bytes:
    buffer = io.BytesIO()
    Image.fromarray(pixels).save(buffer, format="PNG")
    return buffer.getvalue()


class _Corpus:
    """A tiny corpus laid out like the frozen one: canonical/images/<file> plus metadata rows."""

    def __init__(self, root: Path):
        self.root = root
        (root / "canonical" / "images").mkdir(parents=True)
        self.rows: list[dict] = []

    def add(self, sample_id: str, dataset: str, split: str, pixels: np.ndarray, *, original: str, group: str | None,
            parent: str | None = None, boxes: list | None = None, derivation: str = "BBOX", sha: str | None = None) -> None:
        data = _png(pixels)
        (self.root / "canonical" / "images" / f"{sample_id}.png").write_bytes(data)
        self.rows.append({
            "sample_id": sample_id, "source_dataset": dataset, "split": split, "original_filename": original,
            "canonical_filename": f"canonical/images/{sample_id}.png", "image_sha256": sha or hashlib.sha256(data).hexdigest(),
            "image_width": pixels.shape[1], "image_height": pixels.shape[0], "source_group_id": group,
            "augmentation_parent_id": parent, "class_name": {"SUBPIPE": "PIPELINE", "AI4SHIPWRECKS": "SHIPWRECK",
                                                              "PING_GHOSTVISION": "CRAB_POT"}[dataset] if boxes else None,
            "bbox_xyxy_px": boxes or [], "is_background": not boxes, "derived_annotation_type": derivation,
            "source_split_original": "IGNORED_BY_THE_MANIFEST",
        })


H, W = 40, 8


def _waterfall(rows: int, seed: int) -> np.ndarray:
    return np.random.default_rng(seed).integers(0, 256, (rows, W), dtype=np.uint8)


def _subpipe(corpus: _Corpus, channel: str, times: list[str], waterfall: np.ndarray, rows_per_second: int, split: str = "test",
             prefix: str = "sp") -> None:
    """Frames of one channel; the frame at time t starts ``rows_per_second·(t_last − t)`` rows into the waterfall,
    so later frames hold newer pings at the top, as in SubPipe (B[k:] == A[:-k])."""
    last = float(times[-1])
    for stamp in times:
        start = int(round((last - float(stamp)) * rows_per_second))
        corpus.add(f"{prefix}_{channel}_{stamp}", "SUBPIPE", split, waterfall[start:start + H].copy(),
                   original=f"SubPipe/DATA/Chunk4/SSS_{channel}_images/Image/{stamp}.pbm", group="subpipe_temporal",
                   boxes=[[1.0, 2.0, 5.0, 9.0]])


def _base_corpus(tmp_path: Path) -> _Corpus:
    corpus = _Corpus(tmp_path / "corpus")
    # HF: 1000.5–1003.5 s, 2 rows per second; the 1003.5 frame follows a 2-s gap but its pixels still overlap.
    _subpipe(corpus, "HF", ["1000.5", "1001.5", "1003.5"], _waterfall(H + 6, 1), 2)
    # A time-adjacent HF frame from an unrelated recording: a new Survey.
    corpus.add("sp_HF_1004.5", "SUBPIPE", "test", _waterfall(H, 9), original="SubPipe/DATA/Chunk4/SSS_HF_images/Image/1004.5.pbm",
               group="subpipe_temporal", boxes=[[1.0, 2.0, 5.0, 9.0]])
    # LF of the same seconds is its own channel.
    _subpipe(corpus, "LF", ["1000.5", "1001.5"], _waterfall(H + 2, 2), 2)
    # PING: two augmentation siblings of one parent (same recording) and one other image.
    rng = np.random.default_rng(3)
    for sample, parent in (("ping_a1", "Rec2_parent_0001"), ("ping_a2", "Rec2_parent_0001"), ("ping_b1", "Rec2_parent_0002")):
        corpus.add(sample, "PING_GHOSTVISION", "test", rng.integers(0, 256, (16, 16), dtype=np.uint8),
                   original=f"test/{sample}.jpg", group="ping_recording_rec2", parent=parent, boxes=[[1.0, 1.0, 4.0, 4.0]])
    # AI4: a fragmented wreck (two connected components) and a background image of another site.
    corpus.add("ai4_wreck", "AI4SHIPWRECKS", "val", rng.integers(0, 256, (16, 16), dtype=np.uint8), original="val/images/W.png",
               group="wreck_w", boxes=[[1.0, 1.0, 4.0, 4.0], [5.0, 5.0, 9.0, 9.0]], derivation="BBOX_FROM_CONNECTED_COMPONENTS")
    corpus.add("ai4_bg", "AI4SHIPWRECKS", "train", rng.integers(0, 256, (16, 16), dtype=np.uint8), original="train/images/T.png",
               group="terrain_t", derivation="BBOX_FROM_CONNECTED_COMPONENTS")
    return corpus


def _by_id(manifest: list[dict]) -> dict[str, dict]:
    return {row["image_id"]: row for row in manifest}


def test_every_row_has_the_spec_fields_and_keeps_dataset_sensor_and_split(tmp_path):
    corpus = _base_corpus(tmp_path)
    manifest = build_manifest(corpus.rows, corpus.root)
    assert len(manifest) == len(corpus.rows)
    for row in manifest:
        assert set(MANIFEST_FIELDS) <= set(row)
        assert row["sensor"] == SENSORS[row["dataset"]]
    rows = _by_id(manifest)
    assert rows["ai4_bg"]["split"] == "train" and rows["ai4_wreck"]["split"] == "val"   # the detector's split field, not the source's
    assert rows["sp_HF_1000.5"]["channel"] == "HF" and rows["ping_a1"]["channel"] is None


def test_gt_boxes_are_carried_with_their_derivation_and_ai4_regions_are_unavailable(tmp_path):
    corpus = _base_corpus(tmp_path)
    rows = _by_id(build_manifest(corpus.rows, corpus.root))
    wreck = rows["ai4_wreck"]
    assert wreck["gt_boxes"] == [{"class": "SHIPWRECK", "xyxy_px": [1.0, 1.0, 4.0, 4.0]}, {"class": "SHIPWRECK", "xyxy_px": [5.0, 5.0, 9.0, 9.0]}]
    assert wreck["gt_boxes_derivation"] == "BBOX_FROM_CONNECTED_COMPONENTS"
    assert wreck["gt_object_regions"] is None and wreck["gt_object_regions_status"] == "UNAVAILABLE_PENDING_PID_01"
    assert rows["ai4_bg"]["gt_boxes"] == [] and rows["ai4_bg"]["gt_object_regions_status"] == "UNAVAILABLE_PENDING_PID_01"
    assert rows["ping_a1"]["gt_object_regions"] is None and rows["ping_a1"]["gt_object_regions_status"] == "NOT_APPLICABLE"


def test_subpipe_surveys_are_pixel_verified_chains_per_channel(tmp_path):
    corpus = _base_corpus(tmp_path)
    rows = _by_id(build_manifest(corpus.rows, corpus.root))
    chain = {rows[f"sp_HF_{t}"]["survey_id"] for t in ("1000.5", "1001.5", "1003.5")}
    assert chain == {"SUBPIPE:HF:1000.5"}                    # a 2-s gap does not split what the pixels link
    assert rows["sp_HF_1004.5"]["survey_id"] == "SUBPIPE:HF:1004.5"   # time-adjacent, unrelated pixels: a new Survey
    assert {rows["sp_LF_1000.5"]["survey_id"], rows["sp_LF_1001.5"]["survey_id"]} == {"SUBPIPE:LF:1000.5"}


def test_other_datasets_have_one_image_surveys(tmp_path):
    corpus = _base_corpus(tmp_path)
    rows = _by_id(build_manifest(corpus.rows, corpus.root))
    assert rows["ai4_wreck"]["survey_id"] == "AI4SHIPWRECKS:ai4_wreck"
    assert rows["ping_a1"]["survey_id"] == "PING_GHOSTVISION:ping_a1"


def test_bootstrap_groups_follow_spec_7_3(tmp_path):
    corpus = _base_corpus(tmp_path)
    rows = _by_id(build_manifest(corpus.rows, corpus.root))
    assert rows["ping_a1"]["bootstrap_group"] == rows["ping_a2"]["bootstrap_group"] == "ping_recording_rec2"   # siblings together
    assert rows["ping_a1"]["augmentation_parent"] == "Rec2_parent_0001"
    assert rows["ai4_wreck"]["bootstrap_group"] == "wreck_w"
    assert rows["sp_HF_1003.5"]["bootstrap_group"] == "SUBPIPE:HF:1000.5:block0"


def test_subpipe_60_s_blocks_are_anchored_at_the_first_frame_of_their_survey(tmp_path):
    corpus = _Corpus(tmp_path / "corpus")
    times = [f"{1000.5 + second:.1f}" for second in range(62)]            # 1000.5 … 1061.5, one Survey
    _subpipe(corpus, "HF", times, _waterfall(H + 61, 5), 1)
    rows = _by_id(build_manifest(corpus.rows, corpus.root))
    assert {rows[f"sp_HF_{t}"]["survey_id"] for t in times} == {"SUBPIPE:HF:1000.5"}
    # Epoch-anchored blocks would change at 1020.0 (17·60); Survey-anchored blocks change at t0 + 60 = 1060.5.
    assert rows["sp_HF_1059.5"]["bootstrap_group"] == "SUBPIPE:HF:1000.5:block0"
    assert rows["sp_HF_1060.5"]["bootstrap_group"] == "SUBPIPE:HF:1000.5:block1"
    assert rows["sp_HF_1020.5"]["bootstrap_group"] == "SUBPIPE:HF:1000.5:block0"


def test_output_is_deterministic_and_independent_of_input_order(tmp_path):
    corpus = _base_corpus(tmp_path)
    expected = json.dumps(build_manifest(corpus.rows, corpus.root), sort_keys=True)
    for seed in range(3):
        shuffled = list(corpus.rows)
        random.Random(seed).shuffle(shuffled)
        assert json.dumps(build_manifest(shuffled, corpus.root), sort_keys=True) == expected


def test_a_source_whose_bytes_do_not_match_its_recorded_sha256_is_rejected(tmp_path):
    corpus = _base_corpus(tmp_path)
    corpus.rows[0]["image_sha256"] = "0" * 64
    with pytest.raises(ManifestError, match="SHA-256"):
        build_manifest(corpus.rows, corpus.root)


def test_a_missing_source_is_rejected(tmp_path):
    corpus = _base_corpus(tmp_path)
    (corpus.root / corpus.rows[-1]["canonical_filename"]).unlink()
    with pytest.raises(ManifestError, match="missing"):
        build_manifest(corpus.rows, corpus.root)


def test_augmentation_siblings_in_different_recording_groups_are_rejected(tmp_path):
    corpus = _base_corpus(tmp_path)
    next(row for row in corpus.rows if row["sample_id"] == "ping_a2")["source_group_id"] = "ping_recording_rec9"
    with pytest.raises(ManifestError, match="augmentation"):
        build_manifest(corpus.rows, corpus.root)


def test_a_verified_subpipe_chain_that_crosses_a_split_is_rejected(tmp_path):
    corpus = _Corpus(tmp_path / "corpus")
    _subpipe(corpus, "HF", ["1000.5", "1001.5"], _waterfall(H + 2, 7), 2)
    corpus.rows[0]["split"] = "val"
    with pytest.raises(ManifestError, match="split"):
        build_manifest(corpus.rows, corpus.root)


def test_a_row_without_a_bootstrap_group_source_is_rejected(tmp_path):
    corpus = _base_corpus(tmp_path)
    next(row for row in corpus.rows if row["sample_id"] == "ai4_wreck")["source_group_id"] = None
    with pytest.raises(ManifestError, match="group"):
        build_manifest(corpus.rows, corpus.root)


def test_train_rows_are_never_an_evaluation_set(tmp_path):
    """H0-AC1: 'a unit test asserts rejection of train rows'."""
    corpus = _base_corpus(tmp_path)
    manifest = build_manifest(corpus.rows, corpus.root)
    with pytest.raises(ManifestError, match="train"):
        evaluation_set(manifest, "train")
    assert {row["image_id"] for row in evaluation_set(manifest, "val")} == {"ai4_wreck"}
    assert all(row["split"] == "test" for row in evaluation_set(manifest, "test"))
    with pytest.raises(ManifestError, match="split"):
        evaluation_set(manifest, "holdout")


def test_the_summary_counts_subpipe_channels_over_subpipe_rows_only(tmp_path):
    from round2.manifest import _summary
    corpus = _base_corpus(tmp_path)
    summary = _summary(build_manifest(corpus.rows, corpus.root))
    assert summary["subpipe_images_by_channel_split"] == {"HF|test": 4, "LF|test": 2}
    assert summary["subpipe_surveys_by_channel_split"] == {"HF|test": 2, "LF|test": 1}
