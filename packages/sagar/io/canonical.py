"""Dataset-specific readers that emit a single documented canonical frame representation."""
from __future__ import annotations

import csv
import json
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

import numpy as np
from PIL import Image

from sagar.core.classes import ClassMapper
from sagar.core.models import CapabilityGates, Channel, Geometry, LabelCertainty, SpatialReferenceLevel

from .common import sha256_file, stable_id, write_json, write_jsonl


@dataclass
class CanonicalAnnotation:
    annotation_id: str
    source_annotation_id: str
    source_class: str
    category: str
    label_certainty: str
    bbox_xywh: tuple[float, float, float, float]
    source_geometry: dict[str, Any]
    transformation_lineage: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "annotation_id": self.annotation_id, "source_annotation_id": self.source_annotation_id,
            "source_class": self.source_class, "category": self.category,
            "label_certainty": self.label_certainty, "bbox_xywh": list(self.bbox_xywh),
            "source_geometry": self.source_geometry,
            "transformation_lineage": self.transformation_lineage,
        }


@dataclass
class CanonicalFrame:
    frame_id: str
    dataset_id: str
    source_filename: str
    source_path: str
    sha256: str
    width_px: int
    height_px: int
    sensor: str | None
    frequency_khz: float | None
    mission_id: str | None
    site_id: str | None
    group_key: str
    geometry: Geometry
    annotation_type: str
    licence: str
    capability_gates: CapabilityGates
    annotations: list[CanonicalAnnotation]
    official_split: str | None = None
    eval_eligible: bool = True
    dataset_version: str | None = None
    source_url: str | None = None
    nav_ref: str | None = None
    sequence_id: str | None = None
    split_hint: str | None = None
    excluded_reason: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "frame_id": self.frame_id, "dataset_id": self.dataset_id,
            "source_filename": self.source_filename, "source_path": self.source_path,
            "sha256": self.sha256, "width_px": self.width_px, "height_px": self.height_px,
            "sensor": self.sensor, "frequency_khz": self.frequency_khz,
            "mission_id": self.mission_id, "site_id": self.site_id, "group_key": self.group_key,
            "geometry": self.geometry.model_dump(mode="json"), "annotation_type": self.annotation_type,
            "licence": self.licence, "capability_gates": self.capability_gates.model_dump(mode="json"),
            "annotations": [a.to_dict() for a in self.annotations], "official_split": self.official_split,
            "eval_eligible": self.eval_eligible, "dataset_version": self.dataset_version,
            "source_url": self.source_url, "nav_ref": self.nav_ref,
            "sequence_id": self.sequence_id, "split_hint": self.split_hint,
            "excluded_reason": self.excluded_reason,
        }


def _copy_frame(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not destination.exists():
        shutil.copy2(source, destination)


def _image_size(path: Path) -> tuple[int, int]:
    with Image.open(path) as image:
        return image.size


def _parse_yolo(path: Path, width: int, height: int, mapper: ClassMapper) -> list[CanonicalAnnotation]:
    result: list[CanonicalAnnotation] = []
    if not path.exists():
        return result
    for number, line in enumerate(path.read_text().splitlines()):
        tokens = line.split()
        if len(tokens) < 5:
            continue
        # SubPipe's source label is one class, but retain its native identity rather than index.
        mapping = mapper.map("subpipe", "pipeline")
        cx, cy, bw, bh = (float(value) for value in tokens[1:5])
        box = ((cx - bw / 2) * width, (cy - bh / 2) * height, bw * width, bh * height)
        result.append(CanonicalAnnotation(
            annotation_id=f"{path.stem}:{number}", source_annotation_id=f"{path.name}:{number}",
            source_class="pipeline", category=mapping.category.value, label_certainty=mapping.certainty.value,
            bbox_xywh=box, source_geometry={"format": "YOLO", "raw": line},
        ))
    return result


def _load_coco_annotations(directory: Path, mapper: ClassMapper) -> dict[str, list[CanonicalAnnotation]]:
    """Load source COCO boxes keyed by image filename without discarding original geometry."""
    path = directory / "COCO_Annotation" / "coco_format.json"
    if not path.exists():
        return {}
    payload = json.loads(path.read_text())
    images = {item["id"]: item for item in payload.get("images", [])}
    categories = {item["id"]: item["name"] for item in payload.get("categories", [])}
    result: dict[str, list[CanonicalAnnotation]] = {}
    for annotation in payload.get("annotations", []):
        image = images.get(annotation["image_id"])
        if image is None or len(annotation.get("bbox", [])) != 4:
            continue
        source_class = categories.get(annotation.get("category_id"))
        if source_class is None:
            raise ValueError(f"COCO annotation {annotation.get('id')} has no category")
        mapping = mapper.map("subpipe", source_class.lower())
        file_name = Path(image["file_name"]).name
        result.setdefault(file_name, []).append(CanonicalAnnotation(
            annotation_id=f"coco:{annotation['id']}", source_annotation_id=f"coco:{annotation['id']}",
            source_class=source_class, category=mapping.category.value, label_certainty=mapping.certainty.value,
            bbox_xywh=tuple(float(value) for value in annotation["bbox"]),
            source_geometry={
                "format": "COCO", "source_file": str(path), "image_id": annotation["image_id"],
                "category_id": annotation.get("category_id"), "bbox": annotation["bbox"],
                "segmentation": annotation.get("segmentation"), "area": annotation.get("area"),
                "iscrowd": annotation.get("iscrowd"),
            },
        ))
    return result


def _find_subpipe_images(raw: Path) -> Iterable[tuple[Path, str, float]]:
    for path in sorted(raw.rglob("*")):
        lowered = path.name.lower()
        parent = str(path.parent).lower()
        if path.is_file() and path.suffix.lower() in {".pbm", ".png", ".jpg", ".jpeg"} and "sss_" in parent:
            if "hf" in parent:
                yield path, "HF", 900.0
            elif "lf" in parent:
                yield path, "LF", 455.0


def _timestamp(path: Path) -> float | None:
    try:
        return float(path.stem)
    except ValueError:
        return None


def _mini2_sequence_plan(images: list[tuple[Path, str, float]]) -> dict[Path, tuple[str, str | None, str | None]]:
    """Derive protected source-frame sequence blocks from Mini2's observed timestamp gap.

    Mini2 has one long recording and one later independent recording. Waterfall strips are
    emitted every ~20 pings and are 5,000 px long; 300 source-frame seconds are embargoed
    between the long-recording train and validation blocks, exceeding its overlap extent.
    """
    timed = sorted((timestamp, path) for path, _, _ in images if (timestamp := _timestamp(path)) is not None)
    if not timed:
        return {}
    boundaries = [timed[0][0]]
    for (previous, _), (current, _) in zip(timed, timed[1:]):
        if current - previous > 30:
            boundaries.append(current)
    plan: dict[Path, tuple[str, str | None, str | None]] = {}
    first_start = boundaries[0]
    second_start = boundaries[1] if len(boundaries) > 1 else None
    for path, _, _ in images:
        timestamp = _timestamp(path)
        if timestamp is None:
            continue
        if second_start is not None and timestamp >= second_start:
            plan[path] = ("mini2_sequence_002", "test", None)
        else:
            offset = timestamp - first_start
            if offset < 200:
                # This source block has the smaller positive count. Hold it out as validation;
                # the later positive-rich block becomes training. This is label-balanced only at
                # source-block level and does not use model metrics or move individual tiles.
                plan[path] = ("mini2_sequence_001_val", "val", None)
            elif offset < 500:
                plan[path] = ("mini2_sequence_001_embargo_1", None, "TEMPORAL_OVERLAP_EMBARGO")
            elif offset < 700:
                plan[path] = ("mini2_sequence_001_train", "train", None)
            else:
                plan[path] = ("mini2_sequence_001_embargo_2", None, "TEMPORAL_OVERLAP_EMBARGO")
    return plan


def _normalise_nav(chunk: Path, output: Path) -> str | None:
    state = next(iter(chunk.glob("EstimatedState.csv")), None)
    if state is None:
        return None
    # Many side-scan frames share one chunk-level navigation file.  Preserve a single
    # normalized copy rather than re-reading and rewriting it once per frame.
    if output.exists():
        return str(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with state.open(newline="") as source, output.open("w", newline="") as target:
        reader = csv.DictReader(source)
        fields = ["t", "lat", "lon", "heading_deg", "altitude_m", "speed_mps"]
        writer = csv.DictWriter(target, fieldnames=fields)
        writer.writeheader()
        for row in reader:
            # Source headers vary across release versions; preserve null rather than fabricate.
            lowered = {key.lower(): value for key, value in row.items()}
            writer.writerow({
                "t": lowered.get("timestamp") or lowered.get("t") or "",
                "lat": lowered.get("lat") or lowered.get("latitude") or "",
                "lon": lowered.get("lon") or lowered.get("longitude") or "",
                "heading_deg": lowered.get("heading") or lowered.get("yaw") or "",
                "altitude_m": "", "speed_mps": lowered.get("speed") or "",
            })
    return str(output)


def ingest_subpipe(raw_root: str | Path, interim_root: str | Path, mapper: ClassMapper) -> list[CanonicalFrame]:
    raw, interim = Path(raw_root), Path(interim_root)
    frames: list[CanonicalFrame] = []
    images = list(_find_subpipe_images(raw))
    mini2 = any("subpipeminisss" in str(source).lower() for source, _, _ in images)
    mini2_plan = _mini2_sequence_plan(images) if mini2 else {}
    coco_by_directory = {
        directory: _load_coco_annotations(directory, mapper)
        for directory in {source.parent.parent for source, _, _ in images}
    }
    for source, band, frequency in images:
        chunk_dir = next((parent for parent in source.parents if parent.name.lower().startswith("chunk")), None)
        data_dir = next((parent for parent in source.parents if parent.name == "DATA"), None)
        if chunk_dir is None and data_dir is None:
            continue
        mission_id = chunk_dir.name.lower() if chunk_dir else "subpipe_mini2"
        group_key, split_hint, excluded_reason = mini2_plan.get(source, (mission_id, None, None))
        width, height = _image_size(source)
        frame_id = f"subpipe_{band.lower()}_{stable_id(str(source.relative_to(raw)))}"
        target = interim / "frames" / f"{frame_id}.png"
        # PBM is converted only into the canonical copy; the raw source remains intact.
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            with Image.open(source) as image:
                image.convert("L").save(target)
        yolo_parent = source.parent.parent / "YOLO_Annotation"
        yolo = yolo_parent / f"{source.stem}.txt"
        # Mini2's HF YOLO filenames do not all match the exported image filenames. Its COCO
        # files are used as source annotation authority; YOLO is only a fallback for releases
        # where COCO is absent.
        annotations = coco_by_directory[source.parent.parent].get(source.name)
        if annotations is None:
            annotations = _parse_yolo(yolo, width, height, mapper)
        nav_ref = _normalise_nav(chunk_dir or data_dir, interim / "nav" / f"{mission_id}.csv")
        # A source path remains traceable; image values were not manipulated in the raw tree.
        frame = CanonicalFrame(
            frame_id=frame_id, dataset_id="subpipe", source_filename=str(source.relative_to(raw)),
            source_path=str(target), sha256=sha256_file(source), width_px=width, height_px=height,
            sensor="Klein 3500", frequency_khz=frequency, mission_id=mission_id, site_id="porto_pipeline",
            group_key=group_key, geometry=Geometry(
                channel=Channel.DUAL, level=SpatialReferenceLevel.L0_PIXEL_ONLY,
                level_reason="nadir not yet estimated", range_geometry="UNKNOWN",
            ), annotation_type="BBOX", licence="GPL-3.0",
            capability_gates=CapabilityGates(nav_available=nav_ref is not None, ping_order_recoverable=True,
                                             nadir_recoverable=None, range_scale_known=False),
            annotations=annotations, dataset_version="Zenodo:10.5281/zenodo.12666132",
            source_url="https://zenodo.org/records/12666132", nav_ref=nav_ref,
            sequence_id=group_key.rsplit("_", 1)[0] if mini2 else mission_id,
            split_hint=split_hint, excluded_reason=excluded_reason,
        )
        write_json(interim / "frames" / f"{frame_id}.json", frame.to_dict())
        frames.append(frame)
    write_jsonl(interim / "frames.jsonl", (frame.to_dict() for frame in frames))
    return frames


def _mask_box(mask_path: Path) -> tuple[float, float, float, float] | None:
    with Image.open(mask_path) as image:
        array = np.asarray(image.convert("L"))
    ys, xs = np.where(array > 0)
    if len(xs) == 0:
        return None
    return float(xs.min()), float(ys.min()), float(xs.max() - xs.min() + 1), float(ys.max() - ys.min() + 1)


def ingest_ai4shipwrecks(raw_root: str | Path, interim_root: str | Path, mapper: ClassMapper) -> list[CanonicalFrame]:
    raw, interim = Path(raw_root), Path(interim_root)
    frames: list[CanonicalFrame] = []
    image_paths = sorted(path for path in raw.rglob("*.png") if path.parent.name.lower() == "images")
    for source in image_paths:
        split_dir = next((parent.name.lower() for parent in source.parents if parent.name.lower() in {"train", "test"}), None)
        site_id = source.stem.rsplit("_", 1)[0]
        mask = source.parent.parent / "labels" / source.name
        width, height = _image_size(source)
        frame_id = f"ai4shipwrecks_{stable_id(str(source.relative_to(raw)))}"
        target = interim / "frames" / f"{frame_id}.png"
        _copy_frame(source, target)
        annotations: list[CanonicalAnnotation] = []
        box = _mask_box(mask) if mask.exists() else None
        if box is not None:
            mapping = mapper.map("ai4shipwrecks", "wreck")
            annotations.append(CanonicalAnnotation(
                annotation_id=f"{frame_id}:mask:0", source_annotation_id=str(mask.relative_to(raw)),
                source_class="wreck", category=mapping.category.value, label_certainty=mapping.certainty.value,
                bbox_xywh=box, source_geometry={"format": "BINARY_MASK", "mask_path": str(mask.relative_to(raw))},
                transformation_lineage=[{"operation": "mask_to_bbox", "parameters": {"threshold": 0}}],
            ))
        frame = CanonicalFrame(
            frame_id=frame_id, dataset_id="ai4shipwrecks", source_filename=str(source.relative_to(raw)),
            source_path=str(target), sha256=sha256_file(source), width_px=width, height_px=height,
            sensor="EdgeTech 2205 dual-frequency ultra-high resolution sidescan sonar", frequency_khz=None,
            mission_id=None, site_id=site_id, group_key=site_id,
            geometry=Geometry(channel=Channel.DUAL, level=SpatialReferenceLevel.L0_PIXEL_ONLY,
                              level_reason="no navigation metadata supplied", range_geometry="UNKNOWN"),
            annotation_type="MASK", licence="CC-BY-4.0",
            capability_gates=CapabilityGates(nav_available=False, ping_order_recoverable=False,
                                             nadir_recoverable=None, range_scale_known=False),
            annotations=annotations, official_split=split_dir, dataset_version="DOI:10.7302/dmf4-x492",
            source_url="https://deepblue.lib.umich.edu/data/concern/data_sets/8623hz41x?locale=en",
        )
        write_json(interim / "frames" / f"{frame_id}.json", frame.to_dict())
        frames.append(frame)
    write_jsonl(interim / "frames.jsonl", (frame.to_dict() for frame in frames))
    return frames


def load_frames(path: str | Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in Path(path).read_text().splitlines() if line]
