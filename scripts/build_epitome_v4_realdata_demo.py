#!/usr/bin/env python3
"""Build Epitome v4 from seven byte-identical originals in the 60-frame corpus."""
from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = Path.home() / "Desktop" / "Aqualens_Demo_60_Real"
SOURCE_MANIFEST = SOURCE_ROOT / "metadata" / "selection_manifest.json"
OUTPUT = ROOT / "artifacts" / "demo" / "Aqualens_Epitome_v4_RealData_VariedConfidence.zip"
PROVENANCE_OUT = ROOT / "artifacts" / "demo" / "EPITOME_V4_PROVENANCE.json"
MISSION_ID = "SD-EPITOME-V4-REAL-DATA-VARIED-CONFIDENCE"

# Explicitly synthetic Bay of Bengal demo navigation. These are not source
# coordinates and are never represented as such.
NAVIGATION_SOURCE = "SYNTHETIC_DEMO_NAVIGATION"
START_LAT = 15.0
START_LON = 84.0
HEADING_DEG = 128.0
METRES_PER_DEGREE = 111_000.0
START_TIME = datetime(2026, 9, 14, 3, 10, tzinfo=timezone.utc)

SELECTED = [
    "1693569590.819.pbm",
    "Grecian_02.png",
    "Rec19_wcp_ss_star_00021_png_jpg.rf.4904518a51b091fe344095bef0f9d582.jpg",
    "Rec13_wcp_ss_star_00029_png_jpg.rf.89f531857e353d477c6de79b141fe4a7.jpg",
    "Rec17_wcp_ss_port_00030_png_jpg.rf.f3be22b92e9a682663d1f7daba4b397c.jpg",
    "Rec9_wcp_ss_star_00051_png_jpg.rf.5e4c3a8abd081b4de636fccb57b67425.jpg",
    "Rec15_wcp_ss_star_00024_png_jpg.rf.7b9252e75bfcf81bdfc1f783cc9bef76.jpg",
]

NOTES = {
    "1693569590.819.pbm": (
        "Strong annotated SubPipe pipeline morphology selected after the current-runtime candidate screen."
    ),
    "Grecian_02.png": (
        "Visually strong expert-annotated shipwreck/structural example retained despite weak "
        "detector performance; the hull, ribs, and acoustic shadow are plainly visible."
    ),
    "Rec19_wcp_ss_star_00021_png_jpg.rf.4904518a51b091fe344095bef0f9d582.jpg": (
        "Annotated derelict fishing gear from recording Rec19; selected from the actual current-runtime screen."
    ),
    "Rec13_wcp_ss_star_00029_png_jpg.rf.89f531857e353d477c6de79b141fe4a7.jpg": (
        "Annotated derelict fishing gear from distinct recording Rec13; selected for morphology and measured confidence."
    ),
    "Rec17_wcp_ss_port_00030_png_jpg.rf.f3be22b92e9a682663d1f7daba4b397c.jpg": (
        "Strong annotated derelict fishing gear from distinct recording Rec17."
    ),
    "Rec9_wcp_ss_star_00051_png_jpg.rf.5e4c3a8abd081b4de636fccb57b67425.jpg": (
        "Upper-tail annotated derelict fishing gear example from the held-out test split, recording Rec9."
    ),
    "Rec15_wcp_ss_star_00024_png_jpg.rf.7b9252e75bfcf81bdfc1f783cc9bef76.jpg": (
        "Clutter-dominant textured seabed example from distinct recording Rec15. Source crab-pot returns "
        "are faint among the texture; retained as an honest difficult/clutter scene."
    ),
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def project(distance_m: float) -> tuple[float, float]:
    heading = math.radians(HEADING_DEG)
    return (
        START_LAT + distance_m * math.cos(heading) / METRES_PER_DEGREE,
        START_LON + distance_m * math.sin(heading) / METRES_PER_DEGREE,
    )


def build() -> None:
    source_rows = json.loads(SOURCE_MANIFEST.read_text())
    by_name = {row["demo_filename"]: row for row in source_rows}
    if len(SELECTED) != 7 or len(set(SELECTED)) != 7:
        raise RuntimeError("Epitome v4 must contain exactly seven unique source frames")

    frames = []
    for index, filename in enumerate(SELECTED):
        row = by_name[filename]
        source = Path(row["copied_absolute_path"])
        try:
            source.relative_to(SOURCE_ROOT)
        except ValueError as exc:
            raise RuntimeError(f"source is outside the required 60-frame corpus: {source}") from exc
        if not source.is_file():
            raise FileNotFoundError(source)
        checksum = sha256(source)
        if checksum != row["SHA256"] or not row["source_bytes_identical"]:
            raise RuntimeError(f"source identity check failed: {source}")
        latitude, longitude = project(index * 250.0)
        frames.append(
            {
                **row,
                "source_path": source,
                "sha256_original": checksum,
                "offset_m": index * 250.0,
                "latitude": round(latitude, 6),
                "longitude": round(longitude, 6),
                "timestamp_utc": (START_TIME + timedelta(seconds=index * 140)).isoformat().replace("+00:00", "Z"),
                "note": NOTES[filename],
            }
        )

    navigation_lines = [
        "frame,timestamp_utc,latitude,longitude,heading_deg,speed_mps,altitude_m,ping_start,ping_end"
    ]
    for index, frame in enumerate(frames):
        navigation_lines.append(
            f"{frame['demo_filename']},{frame['timestamp_utc']},{frame['latitude']},{frame['longitude']},"
            f"{HEADING_DEG},1.8,14.0,{220_000 + index * 2000},{220_799 + index * 2000}"
        )

    mission = {
        "mission_id": MISSION_ID,
        "survey_name": "Aqualens Epitome v4 Real-Data Varied-Confidence Demo",
        "platform": "AUV-SD-DEMO-01",
        "operator": "Aqualens Internal Demo Team",
        "sensor": "Side-scan sonar (multi-source; see provenance.json)",
        "mission_type": "Curated real-data multi-domain internal capability demo",
        "sequential_observations": False,
        "demo_metadata": True,
        "navigation_source": NAVIGATION_SOURCE,
        "notes": (
            "CURATED MULTI-SOURCE DEMO, not a continuous physical survey. All seven raster files are "
            "byte-identical originals from ~/Desktop/Aqualens_Demo_60_Real. No pixels, confidence "
            "logic, detections, or outputs are modified or pre-baked. SYNTHETIC_DEMO_NAVIGATION: all "
            "coordinates, timestamps, heading, speed, altitude, and ping bounds are invented demo metadata "
            "for an offshore Bay of Bengal track, not historical source telemetry."
        ),
    }

    sonar_provenance = {
        frame["demo_filename"]: {
            "source_dataset": frame["dataset"],
            "source_corpus_path": str(frame["source_path"]),
            "upstream_original_path_recorded_by_corpus": frame["original_absolute_path"],
            "original_filename": frame["original_filename"],
            "ground_truth_class": frame["ground_truth_class"],
            "annotation_present": frame["annotation_present"],
            "ground_truth_bbox_count": frame["ground_truth_bbox_count"],
            "ground_truth_mask_present": frame["ground_truth_mask_present"],
            "sha256_original": frame["sha256_original"],
            "sha256_bundled": frame["sha256_original"],
            "source_bytes_identical": True,
            "pixels_modified": False,
            "provenance_class": "ORIGINAL_REAL_SONAR_SOURCE_FILE",
            "navigation_source": NAVIGATION_SOURCE,
            "note": frame["note"],
        }
        for frame in frames
    }
    provenance = {
        "bundle": "Aqualens_Epitome_v4_RealData_VariedConfidence",
        "mission_id": MISSION_ID,
        "purpose": "internal_capability_demo",
        "evaluation_eligible": False,
        "curated_multi_source_demo": True,
        "source_corpus": str(SOURCE_ROOT),
        "source_corpus_manifest": str(SOURCE_MANIFEST),
        "sonar_provenance": sonar_provenance,
        "navigation_source": NAVIGATION_SOURCE,
        "navigation_region": "Bay of Bengal, open water, ~150km+ offshore of the Andhra Pradesh coast",
        "navigation_is_synthetic": True,
        "synthetic_fields": [
            "timestamp_utc", "latitude", "longitude", "heading_deg", "speed_mps", "altitude_m",
            "ping_start", "ping_end", "mission/platform/operator metadata",
        ],
        "real_fields": ["seven sonar raster files, byte-identical to the supplied original corpus"],
        "no_ai_generated_imagery": True,
        "no_augmentation": True,
        "no_pixel_changes": True,
        "no_prebaked_detections": True,
        "important": (
            "The ZIP contains no detector outputs or forced scores. Selection was based on a prior real "
            "current-runtime screen of all 60 candidates; final results must be measured by uploading this ZIP."
        ),
    }
    manifest = {
        "bundle_version": "4.0-realdata-varied-confidence",
        "bundle_name": provenance["bundle"],
        "mission_id": MISSION_ID,
        "frame_count": 7,
        "real_sonar_images_only": True,
        "ai_generated_images": False,
        "augmented_images": False,
        "sonar_pixels_modified": False,
        "prebaked_detections": False,
        "navigation_source": NAVIGATION_SOURCE,
        "sonar": [frame["demo_filename"] for frame in frames],
        "frames": [
            {
                "filename": frame["demo_filename"],
                "source_dataset": frame["dataset"],
                "source_corpus_path": str(frame["source_path"]),
                "sha256_original": frame["sha256_original"],
                "sha256_bundled": frame["sha256_original"],
                "source_bytes_identical": True,
                "navigation_source": NAVIGATION_SOURCE,
            }
            for frame in frames
        ],
        "navigation": "navigation.csv",
        "mission": "mission.json",
        "provenance": "provenance.json",
        "source_datasets": sorted({frame["dataset"] for frame in frames}),
    }
    readme = (
        "Aqualens Epitome v4 — Real Data, Varied Confidence\n"
        "=======================================================\n\n"
        "Seven byte-identical original real sonar files from SubPipe, AI4Shipwrecks, and PING/GhostVision.\n"
        "No generated imagery, augmentation, pixel edits, score forcing, or pre-baked detections.\n"
        "Upload through the normal backend to compute outputs.\n\n"
        "SYNTHETIC_DEMO_NAVIGATION: navigation.csv is an invented offshore Bay of Bengal demo track,\n"
        "not source geolocation or telemetry. See provenance.json for every original path and SHA256.\n"
    )

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(OUTPUT, "w", compression=ZIP_DEFLATED) as archive:
        for frame in frames:
            archive.write(frame["source_path"], arcname=frame["demo_filename"])
        archive.writestr("navigation.csv", "\n".join(navigation_lines) + "\n")
        archive.writestr("mission.json", json.dumps(mission, indent=2) + "\n")
        archive.writestr("provenance.json", json.dumps(provenance, indent=2) + "\n")
        archive.writestr("bundle_manifest.json", json.dumps(manifest, indent=2) + "\n")
        archive.writestr("README_DEMO_FLOW.txt", readme)

    with ZipFile(OUTPUT) as archive:
        raster_names = [name for name in archive.namelist() if Path(name).suffix.lower() in {".pbm", ".png", ".jpg", ".jpeg"}]
        if len(raster_names) != 7:
            raise RuntimeError(f"bundle has {len(raster_names)} rasters instead of seven")
        for frame in frames:
            bundled = hashlib.sha256(archive.read(frame["demo_filename"])).hexdigest()
            if bundled != frame["sha256_original"]:
                raise RuntimeError(f"bundled checksum mismatch: {frame['demo_filename']}")

    external = {
        "mission_id": MISSION_ID,
        "bundle": provenance["bundle"],
        "zip_path": str(OUTPUT.relative_to(ROOT)),
        "source_corpus": str(SOURCE_ROOT),
        "source_corpus_manifest": str(SOURCE_MANIFEST),
        "frame_count": 7,
        "navigation_source": NAVIGATION_SOURCE,
        "navigation_region": provenance["navigation_region"],
        "navigation_is_synthetic": True,
        "original_geolocation_fabricated": False,
        "no_ai_generated_imagery": True,
        "no_augmentation": True,
        "no_pixel_changes": True,
        "no_prebaked_detections": True,
        "frames": [
            {
                "demo_filename": frame["demo_filename"],
                "source_dataset": frame["dataset"],
                "source_corpus_path": str(frame["source_path"]),
                "upstream_original_path_recorded_by_corpus": frame["original_absolute_path"],
                "ground_truth_class": frame["ground_truth_class"],
                "annotation_present": frame["annotation_present"],
                "ground_truth_bbox_count": frame["ground_truth_bbox_count"],
                "ground_truth_mask_present": frame["ground_truth_mask_present"],
                "sha256_original": frame["sha256_original"],
                "sha256_bundled_copy": frame["sha256_original"],
                "sha256_match": True,
                "source_bytes_identical": True,
                "pixels_modified": False,
                "navigation_source": NAVIGATION_SOURCE,
                "note": frame["note"],
            }
            for frame in frames
        ],
    }
    PROVENANCE_OUT.write_text(json.dumps(external, indent=2) + "\n")
    print(f"wrote {OUTPUT}")
    print(f"wrote {PROVENANCE_OUT}")


if __name__ == "__main__":
    build()
