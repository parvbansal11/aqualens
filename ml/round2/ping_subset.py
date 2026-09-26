"""H0-7: the PING one-image-per-augmentation-parent subset (spec H0 item 5, H0-AC6, PID-03).

PID-03 (locked): within each split, each PING augmentation parent is represented by the sibling whose full source
path string is lexicographically smallest under code-point ordering. The source path is the frozen corpus metadata
field ``original_filename``. The rule reads only identity fields (labels are dropped as the metadata is loaded); it
uses no pixels, detections, hashes, row order or file-system order, and the chosen sibling claims no physical
priority. Its only purpose is to stop augmentation siblings being counted as independent observations. PING's range
axis stays UNKNOWN. A missing source path or parent, or a parent spanning splits, is an error, never guessed.

The subset is a view over the frozen H0-1 manifest: every representative keeps its manifest identity and its full
sibling list, and the manifest itself is untouched.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
import shutil
import subprocess
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping

from round2.geometry import RANGE_AXIS
from round2.guards import FROZEN_MANIFEST_SHA256, GroundTruthFreeRow, load_frozen_manifest
from round2.manifest import REPO, TRACKED_METADATA, ManifestError

PING = "PING_GHOSTVISION"
SELECTION_METHOD = "ping_min_original_filename_codepoint_per_split_and_parent@v1"
SELECTION_FIELDS = ("sample_id", "source_dataset", "split", "augmentation_parent_id", "original_filename")
FROZEN_METADATA_SHA256 = "5ae1e94cad76d6dcb7c4f2af27e31c5d4ab57dfd28362719c98cb7d7cf2a10e4"   # recorded by H0-1
H0_6_GEOMETRY = REPO / "artifacts/round2/H0/geometry/iter-1/geometry.jsonl"
PID_03 = ("Within each split, each PING augmentation parent is represented by the sibling whose full source path string is "
          "lexicographically smallest under code-point ordering. The rule uses no labels and makes no claim that the selected "
          "sibling is the original or physically preferred orientation; it exists only to prevent augmentation siblings from being "
          "counted as independent observations.")


class SubsetError(ManifestError):
    """The one-per-parent subset cannot be built without guessing."""


def load_selection_metadata(path: Path) -> list[dict[str, Any]]:
    """Corpus metadata rows reduced to the identity fields PID-03 needs; labels never leave the loader."""
    with Path(path).open() as handle:
        return [{field: row.get(field) for field in SELECTION_FIELDS} for row in (json.loads(line) for line in handle if line.strip())]


def select_representatives(manifest_rows: Iterable[Mapping[str, Any]], metadata_rows: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """One representative per (split, PING augmentation parent), sorted by split and parent."""
    metadata: dict[str, dict[str, Any]] = {}
    for row in metadata_rows:
        row = {field: row.get(field) for field in SELECTION_FIELDS}
        if row["source_dataset"] != PING:
            continue
        if row["sample_id"] in metadata:
            raise SubsetError(f"{row['sample_id']} appears twice in the corpus metadata")
        metadata[row["sample_id"]] = row
    ping = [GroundTruthFreeRow(row) for row in manifest_rows if row["dataset"] == PING]
    if {row["image_id"] for row in ping} != set(metadata):
        raise SubsetError("the PING rows of the manifest and the corpus metadata are not the same images")

    groups: dict[tuple[str, str], list[tuple[str, GroundTruthFreeRow]]] = defaultdict(list)
    for row in ping:
        parent, meta = row["augmentation_parent"], metadata[row["image_id"]]
        if not parent:
            raise SubsetError(f"{row['image_id']} has no augmentation parent")
        if meta["augmentation_parent_id"] != parent:
            raise SubsetError(f"{row['image_id']}: manifest parent {parent!r} differs from the metadata parent {meta['augmentation_parent_id']!r}")
        if meta["split"] != row["split"]:
            raise SubsetError(f"{row['image_id']}: manifest split {row['split']!r} differs from the metadata split {meta['split']!r}")
        path = meta["original_filename"]
        if not isinstance(path, str) or not path:
            raise SubsetError(f"{row['image_id']} has no source path (original_filename)")
        groups[(row["split"], parent)].append((path, row))

    splits_of: dict[str, set[str]] = defaultdict(set)
    for split, parent in groups:
        splits_of[parent].add(split)
    crossing = sorted(parent for parent, splits in splits_of.items() if len(splits) > 1)
    if crossing:
        raise SubsetError(f"augmentation parents in more than one split: {', '.join(crossing[:5])}")

    representatives = []
    for (split, parent), members in sorted(groups.items()):
        paths = [path for path, _ in members]
        if len(set(paths)) != len(paths):
            raise SubsetError(f"two siblings of {parent!r} share a source path")
        path, chosen = min(members, key=lambda member: member[0])   # str order is code-point order
        representatives.append({
            "split": split, "augmentation_parent": parent, "image_id": chosen["image_id"], "source_path": path,
            "sibling_count": len(members), "sibling_image_ids": sorted(row["image_id"] for _, row in members),
            "dataset": PING, "sensor": chosen["sensor"], "survey_id": chosen["survey_id"], "bootstrap_group": chosen["bootstrap_group"],
            "range_axis": RANGE_AXIS[PING], "selection_method": SELECTION_METHOD,
        })
    return representatives


def _sha(path: Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_subset(out_dir: Path, *, manifest_rows: list[dict[str, Any]] | None = None, metadata_path: Path = TRACKED_METADATA,
                 manifest_sha256: str = FROZEN_MANIFEST_SHA256, metadata_sha256: str | None = FROZEN_METADATA_SHA256,
                 geometry_path: Path | None = None, argv: list[str] | None = None) -> dict[str, Any]:
    """Write the subset and its provenance to a new iteration, only once complete."""
    out_dir = Path(out_dir)
    partial = out_dir.with_name(out_dir.name + ".partial")
    if (out_dir.exists() and any(out_dir.iterdir())) or partial.exists():
        raise SubsetError(f"{out_dir} (or its .partial) already exists; artifacts are immutable, use a new iteration")
    started = datetime.now(timezone.utc).isoformat()
    if metadata_sha256 is not None and _sha(metadata_path) != metadata_sha256:
        raise SubsetError("the corpus metadata is not the frozen copy H0-1 used")
    rows = load_frozen_manifest() if manifest_rows is None else manifest_rows
    representatives = select_representatives(rows, load_selection_metadata(metadata_path))
    geometry_sha = None
    if geometry_path is not None:
        axes = {}
        with Path(geometry_path).open() as handle:
            for line in handle:
                record = json.loads(line)
                axes[record["image_id"]] = record["range_axis"]
        if any(axes.get(rep["image_id"]) != "UNKNOWN" for rep in representatives):
            raise SubsetError("a PING representative is not RANGE_AXIS UNKNOWN in the H0-6 geometry records")
        geometry_sha = _sha(geometry_path)
    ping_images = Counter(row["split"] for row in rows if row["dataset"] == PING)
    by_split = Counter(rep["split"] for rep in representatives)
    distribution: dict[str, Counter] = defaultdict(Counter)
    for rep in representatives:
        distribution[rep["split"]][str(rep["sibling_count"])] += 1
    partial.mkdir(parents=True)
    try:
        with (partial / "ping_one_per_parent.jsonl").open("w") as handle:
            for rep in representatives:
                handle.write(json.dumps(rep, sort_keys=True) + "\n")
        git = lambda *args: subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True).stdout.strip()  # noqa: E731
        provenance = {
            "ticket": "H0-7", "artifact": "PING one-image-per-augmentation-parent subset", "iteration": out_dir.name,
            "git_sha": git("rev-parse", "HEAD"), "git_dirty": bool(git("status", "--porcelain")),
            "harness_source_sha256": {name: _sha(Path(__file__).parent / name) for name in ("__init__.py", "manifest.py", "guards.py", "geometry.py", "ping_subset.py")},
            "source_manifest_sha256": manifest_sha256, "corpus_metadata": str(metadata_path), "corpus_metadata_sha256": _sha(metadata_path),
            "h0_6_geometry_sha256": geometry_sha, "selection_method": SELECTION_METHOD, "pid_03": PID_03,
            "selection_key": "corpus metadata original_filename (full source path); Python str ordering = Unicode code points",
            "fields_read": list(SELECTION_FIELDS), "labels_used": False, "pixels_used": False, "detections_used": False,
            "ping_images_by_split": dict(sorted(ping_images.items())), "representatives_by_split": dict(sorted(by_split.items())),
            "total_representatives": len(representatives),
            "sibling_count_distribution": {split: dict(sorted(counts.items(), key=lambda kv: int(kv[0]))) for split, counts in sorted(distribution.items())},
            "versions": {"python": platform.python_version()},
            "command": argv if argv is not None else ["PYTHONPATH=packages:ml", "python", "-m", "round2.ping_subset", *sys.argv[1:]],
            "started_at": started, "finished_at": datetime.now(timezone.utc).isoformat(), "outputs": ["ping_one_per_parent.jsonl"],
        }
        (partial / "artifact_manifest.json").write_text(json.dumps(provenance, indent=2) + "\n")
    except BaseException:
        shutil.rmtree(partial, ignore_errors=True)
        raise
    out_dir.parent.mkdir(parents=True, exist_ok=True)
    if out_dir.exists():
        out_dir.rmdir()
    partial.rename(out_dir)
    return provenance


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--out", type=Path, default=REPO / "artifacts/round2/H0/ping_one_per_parent/iter-1")
    args = parser.parse_args()
    provenance = write_subset(args.out, geometry_path=H0_6_GEOMETRY)
    print(json.dumps({key: provenance[key] for key in ("ping_images_by_split", "representatives_by_split", "total_representatives",
                                                         "sibling_count_distribution")}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
