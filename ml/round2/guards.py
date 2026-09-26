"""H0-2: leakage guards over the frozen H0-1 manifest (I-H0-1, I-H0-4, spec §7.1).

- Split use follows spec §7.1 literally: `train` only for memory banks and probes, `val` only for fitting,
  `test` only for evaluation (evaluated once per pre-registered configuration). Any other use raises.
- An evaluation set is checked row by row against the frozen manifest, so a train row cannot be injected or
  relabelled into it.
- PING augmentation siblings stay in one split and one bootstrap group (spec §7.3).
- Reference builders get ground-truth-free views: every ``gt_*`` field is inaccessible (I-H0-4).

The frozen manifest is read only, and only if its bytes match the H0-1 artifact.
"""
from __future__ import annotations

import hashlib
import json
from collections.abc import Iterator, Mapping
from pathlib import Path
from typing import Any

from round2.manifest import REPO, SPLITS, ManifestError

# H0-1 artifact (iter-2; its manifest.jsonl is byte-identical to iter-1's).
FROZEN_MANIFEST_PATH = REPO / "artifacts/round2/H0/manifest/iter-2/manifest.jsonl"
FROZEN_MANIFEST_SHA256 = "68e52c1072329bbdd31accaaa3fa1c662373643a4b20fee7ceabcd80d14ee815"
# Spec §7.1: the one split each purpose may use.
PURPOSE_SPLITS = {"memory_bank": "train", "probe": "train", "fit": "val", "evaluate": "test"}
GROUND_TRUTH_PREFIX = "gt_"


class LeakageError(ManifestError):
    """A split, sibling or ground-truth boundary would be crossed."""


class GroundTruthAccessError(LeakageError, KeyError):
    """A reference builder asked for ground truth (I-H0-4)."""


def load_frozen_manifest(path: Path = FROZEN_MANIFEST_PATH, sha256: str = FROZEN_MANIFEST_SHA256) -> list[dict[str, Any]]:
    """The H0-1 manifest rows, refused unless the file's SHA-256 is the frozen one."""
    data = Path(path).read_bytes()
    if hashlib.sha256(data).hexdigest() != sha256:
        raise ManifestError(f"{path} is not the frozen H0-1 manifest (SHA-256 mismatch)")
    rows = [json.loads(line) for line in data.decode().splitlines() if line.strip()]
    validate_manifest(rows)
    return rows


def validate_manifest(rows: list[dict[str, Any]]) -> None:
    """Unique images, known splits, and PING augmentation siblings in one split and one bootstrap group."""
    ids = [row["image_id"] for row in rows]
    if len(set(ids)) != len(ids):
        raise LeakageError("an image appears more than once in the manifest")
    unknown = sorted({row["split"] for row in rows} - set(SPLITS))
    if unknown:
        raise LeakageError(f"unknown split(s) in the manifest: {unknown}")
    siblings: dict[str, set[tuple[str, str]]] = {}
    for row in rows:
        if row.get("augmentation_parent"):
            siblings.setdefault(row["augmentation_parent"], set()).add((row["split"], row["bootstrap_group"]))
    crossing = sorted(parent for parent, places in siblings.items() if len(places) > 1)
    if crossing:
        raise LeakageError(f"augmentation siblings span splits or bootstrap groups: {', '.join(crossing[:5])}")


def rows_for(manifest: list[dict[str, Any]], split: str, purpose: str) -> list[dict[str, Any]]:
    """The rows of ``split`` for ``purpose``, only where spec §7.1 allows that use."""
    if purpose not in PURPOSE_SPLITS:
        raise LeakageError(f"unknown purpose {purpose!r}; spec §7.1 defines {sorted(PURPOSE_SPLITS)}")
    if split not in SPLITS:
        raise LeakageError(f"unknown split {split!r}")
    allowed = PURPOSE_SPLITS[purpose]
    if split != allowed:
        raise LeakageError(f"{purpose}-on-{split} is not allowed: spec §7.1 reserves {purpose} for {allowed}")
    return [row for row in manifest if row["split"] == split]


def validate_evaluation_set(rows: list[dict[str, Any]], manifest: list[dict[str, Any]], split: str = PURPOSE_SPLITS["evaluate"]) -> list[dict[str, Any]]:
    """Every row must be a frozen-manifest image of the evaluation split, whatever its own split field says."""
    frozen = {row["image_id"]: row["split"] for row in manifest}
    seen: set[str] = set()
    for row in rows:
        image_id = row["image_id"]
        if image_id not in frozen:
            raise LeakageError(f"{image_id} is not in the frozen manifest")
        if frozen[image_id] == "train":
            raise LeakageError(f"{image_id} is a train row; train is never evaluated (I-H0-1)")
        if frozen[image_id] != split or row.get("split") != split:
            raise LeakageError(f"{image_id} is a {frozen[image_id]} row, not part of the {split} evaluation set")
        if image_id in seen:
            raise LeakageError(f"{image_id} appears twice in the evaluation set")
        seen.add(image_id)
    return rows


class GroundTruthFreeRow(Mapping[str, Any]):
    """A read-only manifest row without ground truth: any ``gt_*`` field raises GroundTruthAccessError."""

    __slots__ = ("__fields",)

    def __init__(self, row: Mapping[str, Any]):
        self.__fields = {key: value for key, value in row.items() if not key.startswith(GROUND_TRUTH_PREFIX)}

    def __getitem__(self, key: str) -> Any:
        if key.startswith(GROUND_TRUTH_PREFIX):
            raise GroundTruthAccessError(f"{key} is ground truth and is inaccessible to reference builders (I-H0-4)")
        return self.__fields[key]

    def get(self, key: str, default: Any = None) -> Any:
        if key.startswith(GROUND_TRUTH_PREFIX):
            raise GroundTruthAccessError(f"{key} is ground truth and is inaccessible to reference builders (I-H0-4)")
        return self.__fields.get(key, default)

    def __contains__(self, key: object) -> bool:
        return key in self.__fields

    def __iter__(self) -> Iterator[str]:
        return iter(self.__fields)

    def __len__(self) -> int:
        return len(self.__fields)

    def __repr__(self) -> str:
        return f"GroundTruthFreeRow({self.__fields!r})"


def reference_view(rows: list[Mapping[str, Any]]) -> list[GroundTruthFreeRow]:
    """What a reference builder may see of ``rows``: everything except ground truth."""
    return [GroundTruthFreeRow(row) for row in rows]
