"""Frame/group-level splitting and the five frozen pipeline leakage assertions."""
from __future__ import annotations

import hashlib
import json
import random
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable

import numpy as np
from PIL import Image

from sagar.io.common import stable_id, write_json

ASSERTION_NAMES = (
    "group_overlap_train_test",
    "group_overlap_train_val",
    "near_duplicates",
    "eval_ineligible_rows",
    "test_groups_have_positives",
)


class SplitError(RuntimeError):
    pass


def _group_frames(frames: Iterable[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for frame in frames:
        if "tile_id" in frame:
            raise SplitError("tile-level rows are prohibited; split original frames before tiling")
        group = frame.get("group_key")
        if not group:
            raise SplitError(f"frame lacks strongest available group key: {frame.get('frame_id')}")
        grouped[f"{frame['dataset_id']}:{group}"].append(frame)
    return grouped


def _positive(group: list[dict[str, Any]]) -> bool:
    return any(frame.get("annotations") for frame in group)


def make_splits(frames: list[dict[str, Any]], seed: int = 20260830, output: str | Path | None = None) -> dict[str, Any]:
    """Assign complete source-frame groups deterministically.

    Official AI4Shipwrecks test groups are retained. Remaining groups are approximately
    70/15/15 where no official split constrains them; groups, never tiles, are shuffled.
    """
    groups = _group_frames(frames)
    rng = random.Random(seed)
    assignments: dict[str, str] = {}
    flexible: list[tuple[str, list[dict[str, Any]]]] = []
    for key, members in sorted(groups.items()):
        hints = {member.get("split_hint") for member in members if member.get("split_hint")}
        if len(hints) > 1:
            raise SplitError(f"split hint conflicts within source sequence group {key}")
        if hints:
            assignments[key] = next(iter(hints))
            continue
        official = {member.get("official_split") for member in members if member.get("official_split")}
        if len(official) > 1:
            raise SplitError(f"official split conflicts within group {key}")
        if official == {"test"}:
            assignments[key] = "test"
        elif official == {"train"}:
            flexible.append((key, members))
        else:
            flexible.append((key, members))
    rng.shuffle(flexible)
    # If official test exists, it is authoritative. Split its official training side into train/val.
    has_official_test = any(value == "test" for value in assignments.values())
    if not flexible:
        required = {"train", "val", "test"}
        if set(assignments.values()) != required:
            raise SplitError("source-provided/derived split hints must define train, val and test groups")
    elif has_official_test:
        val_groups = max(1, round(len(flexible) * 0.2)) if len(flexible) > 2 else 0
        for index, (key, _) in enumerate(flexible):
            assignments[key] = "val" if index < val_groups else "train"
    else:
        total = len(flexible)
        if total < 3:
            raise SplitError("need at least three independent groups for train/val/test")
        train_n = max(1, round(total * 0.70))
        val_n = max(1, round(total * 0.15))
        if train_n + val_n >= total:
            val_n = 1
            train_n = total - 2
        for index, (key, _) in enumerate(flexible):
            assignments[key] = "train" if index < train_n else "val" if index < train_n + val_n else "test"
    split_by_frame = {frame["frame_id"]: assignments[f"{frame['dataset_id']}:{frame['group_key']}"] for frame in frames}
    split_id = f"split_{stable_id(str(seed), json.dumps(split_by_frame, sort_keys=True))}"
    manifest = {"split_id": split_id, "seed": seed, "assignment_unit": "source_frame_group_before_tiling",
                "group_assignments": assignments, "frame_assignments": split_by_frame}
    if output:
        write_json(Path(output), manifest)
    return manifest


def _dhash(path: str, size: int = 16) -> int:
    with Image.open(path) as image:
        pixels = np.asarray(image.convert("L").resize((size + 1, size), Image.Resampling.BILINEAR))
    return int("".join("1" if value else "0" for value in (pixels[:, 1:] > pixels[:, :-1]).ravel()), 2)


def _hamming(one: int, two: int) -> int:
    return (one ^ two).bit_count()


def _thumbnail(path: str) -> np.ndarray:
    with Image.open(path) as image:
        return np.asarray(image.convert("L").resize((64, 64), Image.Resampling.BILINEAR), dtype=np.int16)


def _verified_near_duplicate(one: np.ndarray, other: np.ndarray) -> bool:
    """Confirm a dHash candidate with normalized pixels.

    Side-scan strips frequently share a very low-detail dHash despite representing different
    seabed passes.  dHash is deliberately a high-recall candidate filter; pixel agreement
    prevents it from falsely treating those distinct source frames as leaked duplicates.
    """
    difference = np.abs(one - other)
    return float(difference.mean()) <= 2.0 and float(np.quantile(difference, 0.95)) <= 8.0


def assert_split_integrity(frames: list[dict[str, Any]], split: dict[str, Any], tiles: list[dict[str, Any]] | None = None,
                           near_duplicate_threshold: int = 4) -> dict[str, str]:
    by_frame = split["frame_assignments"]
    if set(by_frame) != {frame["frame_id"] for frame in frames}:
        raise SplitError("split manifest does not exactly cover canonical source frames")
    group_splits: dict[str, set[str]] = defaultdict(set)
    for frame in frames:
        group_splits[f"{frame['dataset_id']}:{frame['group_key']}"].add(by_frame[frame["frame_id"]])
    if any(len(values) > 1 for values in group_splits.values()):
        raise SplitError("A/B failed: prohibited survey/site group crosses a split")
    # A and B are reported separately for the frozen manifest contract.
    train_groups = {group for group, values in group_splits.items() if values == {"train"}}
    val_groups = {group for group, values in group_splits.items() if values == {"val"}}
    test_groups = {group for group, values in group_splits.items() if values == {"test"}}
    if train_groups & test_groups or train_groups & val_groups:
        raise SplitError("A/B failed: group overlap")
    # C: Source image dHash catches accidental duplicate source image lineage across a split.
    hashes: list[tuple[str, str, int, np.ndarray]] = []
    for frame in frames:
        path = frame.get("source_path")
        if path and Path(path).exists():
            hashes.append((frame["frame_id"], by_frame[frame["frame_id"]], _dhash(path), _thumbnail(path)))
    # Any pair with at most four changed bits shares at least one of five disjoint bit bands.
    # This preserves the exact Hamming test without O(n^2) comparison for SubPipe's 10k frames.
    candidates: dict[tuple[int, int], list[tuple[str, str, int]]] = defaultdict(list)
    for frame_id, frame_split, image_hash, thumbnail in hashes:
        for band in range(5):
            shift = band * 52
            candidates[(band, (image_hash >> shift) & ((1 << 52) - 1))].append((frame_id, frame_split, image_hash, thumbnail))
    checked: set[tuple[str, str]] = set()
    for bucket in candidates.values():
        for index, (one_id, one_split, one_hash, one_thumbnail) in enumerate(bucket):
            for other_id, other_split, other_hash, other_thumbnail in bucket[index + 1:]:
                pair = tuple(sorted((one_id, other_id)))
                if pair in checked:
                    continue
                checked.add(pair)
                if one_split != other_split and _hamming(one_hash, other_hash) <= near_duplicate_threshold and _verified_near_duplicate(one_thumbnail, other_thumbnail):
                    raise SplitError(f"C failed: near-duplicate source frames cross splits: {one_id}, {other_id}")
    # D: eval-ineligible rows are never permitted in either evaluation split.
    invalid = [frame["frame_id"] for frame in frames if not frame.get("eval_eligible", True) and by_frame[frame["frame_id"]] in {"val", "test"}]
    if invalid:
        raise SplitError(f"D failed: eval-ineligible rows in evaluation split: {invalid[:3]}")
    # E: every held-out group must actually contain a positive.
    groups = _group_frames(frames)
    empty_test = [key for key, members in groups.items() if assignments_for_group(members, by_frame) == "test" and not _positive(members)]
    if empty_test:
        raise SplitError(f"E failed: test group lacks a positive annotation: {empty_test[:3]}")
    if tiles is not None:
        for tile in tiles:
            source_split = by_frame.get(tile["source_frame_id"])
            if source_split != tile["split"]:
                raise SplitError(f"tile derivative crosses split: {tile['tile_id']}")
    return {name: "PASS" for name in ASSERTION_NAMES}


def assignments_for_group(members: list[dict[str, Any]], assignment: dict[str, str]) -> str:
    values = {assignment[member["frame_id"]] for member in members}
    if len(values) != 1:
        raise SplitError("group assigned to more than one split")
    return next(iter(values))


def feedback_training_eligible(frame_id: str, split: dict[str, Any], has_review: bool, licence_permits_training: bool) -> tuple[bool, str | None]:
    if not has_review:
        return False, "NO_REVIEW"
    if not licence_permits_training:
        return False, "LICENCE_DOES_NOT_PERMIT_TRAINING"
    assignment = split["frame_assignments"].get(frame_id)
    if assignment in {"val", "test"}:
        return False, "EVALUATION_SPLIT"
    return True, None
