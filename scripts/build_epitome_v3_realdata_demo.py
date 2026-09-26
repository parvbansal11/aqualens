#!/usr/bin/env python3
"""Build the Epitome v3 internal demo bundle from ORIGINAL real sonar frames only.

Every raster below is copied byte-identical from a dataset already on disk under
data/raw/ (SubPipe, AI4Shipwrecks, PING-GhostVision). No pixels are generated,
edited, or enhanced. Only navigation/mission/provenance METADATA is synthetic,
and every synthetic field is labelled as such in the bundle itself.

See docs/EPITOME_V3_DEMO_NAVIGATION.md and artifacts/demo/EPITOME_V3_SELECTION_REPORT.md
for why each frame was chosen and what the frozen detector actually produced on it.
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "artifacts" / "demo" / "Aqualens_Epitome_v3_RealData_BayOfBengal.zip"
PROVENANCE_OUT = ROOT / "artifacts" / "demo" / "EPITOME_V3_PROVENANCE.json"
MISSION_ID = "SD-EPITOME-V3-REAL-DATA-DEMO"

# Bay of Bengal, well offshore (~150km+ east of the Andhra Pradesh coast, open
# water) so no plausible web-map render places any contact on land. This is
# SYNTHETIC_DEMO_NAVIGATION -- not historical GPS from any source dataset.
START_LAT = 15.00000
START_LON = 84.00000
HEADING_DEG = 128.0
SPEED_MPS = 1.8
ALTITUDE_M = 14.0  # SYNTHETIC_DEMO_METADATA -- not a measured altitude/depth.
START_TIME = "2026-09-14T03:10:00Z"
METRES_PER_DEGREE = 111_000.0  # matches packages/sagar/vnext/contacts.py::_metres exactly

# (dataset_frame, along_track_offset_m) -- offsets are hand-picked so that
# same-class real detections that should NOT be treated as the same physical
# object stay >35m apart (the contact-fusion world-distance gate in
# packages/sagar/vnext/contacts.py), while the two genuine sequential SubPipe
# pings stay within it on purpose (real persistence demonstration).
FRAMES = [
    dict(
        demo_filename="1693573517.84.pbm",
        source_dataset="subpipe",
        original_relative_path="data/raw/subpipe/full_extracted/SubPipe/DATA/Chunk1/SSS_LF_images/Image/1693573517.84.pbm",
        original_annotation="COCO bbox, category 'Pipeline', bbox=[954.0, 13.0, 145.0, 468.0] "
                              "(data/raw/subpipe/full_extracted/SubPipe/DATA/Chunk1/SSS_LF_images/COCO_Annotation/coco_format.json)",
        expected_domain="PIPELINE",
        offset_m=0.0,
        dt_s=0.0,
        note="Real SubPipe low-frequency (455kHz) ping, Chunk1. First of two genuinely "
             "consecutive pings (real 1.00s capture gap) of the same physical pipeline.",
    ),
    dict(
        demo_filename="1693573518.84.pbm",
        source_dataset="subpipe",
        original_relative_path="data/raw/subpipe/full_extracted/SubPipe/DATA/Chunk1/SSS_LF_images/Image/1693573518.84.pbm",
        original_annotation="COCO bbox, category 'Pipeline', bbox=[950.0, 10.0, 148.0, 490.0] "
                              "(same coco_format.json)",
        expected_domain="PIPELINE",
        offset_m=2.0,
        dt_s=1.0,
        note="Real next ping, 1.00s later in the original SubPipe capture stream (matches "
             "the source filenames' own timestamps: 1693573517.84 -> 1693573518.84). Placed "
             "~2m along-track so the runtime's own world-distance contact-fusion gate "
             "(<=35m, packages/sagar/vnext/contacts.py) genuinely fuses this with frame 1 "
             "into one SEQUENTIAL_PING-eligible contact -- not asserted, exercised.",
    ),
    dict(
        demo_filename="TI0047_png_jpg.rf.c0b2f00686291727e7e4799dc5712907.jpg",
        source_dataset="pingeco_ghostpot",
        original_relative_path="data/raw/ping-ghostvision/train/TI0047_png_jpg.rf.c0b2f00686291727e7e4799dc5712907.jpg",
        original_annotation="Roboflow metadata.jsonl: 2x bbox category 'Crab-Pot' "
                              "(data/raw/ping-ghostvision/train/metadata.jsonl)",
        expected_domain="DERELICT_FISHING_GEAR",
        offset_m=60.0,
        dt_s=32.2,
        note="Real PING-GhostVision recording TI0047, two annotated ghost pots in one frame.",
    ),
    dict(
        demo_filename="Egyptian_01.png",
        source_dataset="ai4shipwrecks",
        original_relative_path="data/raw/ai4shipwrecks/dataset/AI4Shipwrecks/train/images/Egyptian_01.png",
        original_annotation="AI4Shipwrecks mask label present "
                              "(data/raw/ai4shipwrecks/dataset/AI4Shipwrecks/train/labels/Egyptian_01.png)",
        expected_domain="WRECK_OR_STRUCTURAL_DEBRIS (site: Egyptian, Thunder Bay)",
        offset_m=130.0,
        dt_s=38.9,
        note="Real wreck-site image with the most ambiguous real detector behaviour in the "
             "candidate pool: multiple competing PIPELINE/CRAB_POT candidates fire on the "
             "same real raster (max real raw confidences ~0.489 PIPELINE, ~0.304 CRAB_POT). "
             "Included deliberately as the UNUSUAL/OPEN-SET candidate, not as a clean single-class hit.",
    ),
    dict(
        demo_filename="Viator_02.png",
        source_dataset="ai4shipwrecks",
        original_relative_path="data/raw/ai4shipwrecks/dataset/AI4Shipwrecks/test/images/Viator_02.png",
        original_annotation="AI4Shipwrecks mask label present "
                              "(data/raw/ai4shipwrecks/dataset/AI4Shipwrecks/test/labels/Viator_02.png)",
        expected_domain="WRECK_OR_STRUCTURAL_DEBRIS (site: Viator)",
        offset_m=180.0,
        dt_s=27.8,
        note="Best real WRECK candidate found across all 25 distinct AI4Shipwrecks sites "
             "surveyed. The frozen yolo11s checkpoint's own validation mAP50-95 for SHIPWRECK "
             "is ~0.003 (ml/artifacts/final_v1/detector/metrics.json) -- essentially no real "
             "sites produce a confident single-pass SHIPWRECK score. This frame is the one "
             "where the runtime's own existing (not added by this build) weak-evidence "
             "spatial-consensus recovery path finds the most coherent cluster (54 agreeing "
             "weak tile proposals, no competing class) and reports classification_source "
             "DEMO_HEURISTIC with display_confidence ~0.746. Raw detector confidence is only "
             "~0.041; that gap is disclosed, not hidden.",
    ),
    dict(
        demo_filename="Exploratory_B_06.png",
        source_dataset="ai4shipwrecks",
        original_relative_path="data/raw/ai4shipwrecks/dataset/AI4Shipwrecks/extras/terrain/images/Exploratory_B_06.png",
        original_annotation="None (AI4Shipwrecks 'extras/terrain' negative/background imagery, no wreck)",
        expected_domain="NATURAL_SEABED_CLUTTER",
        offset_m=225.0,
        dt_s=30.6,
        note="Plain Lake Huron seabed with no wreck. Real detector still produces a weak "
             "PIPELINE candidate (~0.181) here -- a genuine false-alarm-adjacent clutter "
             "example, not a clean negative.",
    ),
    dict(
        demo_filename="TI0075_png_jpg.rf.356629946028e9d16b8ff2121bc98b23.jpg",
        source_dataset="pingeco_ghostpot",
        original_relative_path="data/raw/ping-ghostvision/train/TI0075_png_jpg.rf.356629946028e9d16b8ff2121bc98b23.jpg",
        original_annotation="Roboflow metadata.jsonl: 1x bbox category 'Crab-Pot' "
                              "(data/raw/ping-ghostvision/train/metadata.jsonl)",
        expected_domain="DERELICT_FISHING_GEAR",
        offset_m=270.0,
        dt_s=25.0,
        note="Cleanest, highest real raw-confidence CRAB_POT hit found in the candidate pool "
             "(~0.544), single object, no competing class.",
    ),
]

RASTER_SUFFIXES = {".png", ".jpg", ".jpeg", ".pbm"}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def project(lat0: float, lon0: float, heading_deg: float, distance_m: float) -> tuple[float, float]:
    """Straight-line offset using the SAME flat 111,000 m/deg constant the
    runtime's own contact-fusion world-distance gate uses (packages/sagar/vnext/contacts.py
    ::_metres), so the >=35m / <35m intent above is exact for this survey's latitude,
    not merely approximate."""
    heading_rad = math.radians(heading_deg)
    d_north = distance_m * math.cos(heading_rad)
    d_east = distance_m * math.sin(heading_rad)
    return lat0 + d_north / METRES_PER_DEGREE, lon0 + d_east / METRES_PER_DEGREE


def build() -> None:
    for frame in FRAMES:
        source = ROOT / frame["original_relative_path"]
        if not source.is_file():
            raise FileNotFoundError(f"missing original dataset file: {source}")
        if source.suffix.lower() not in RASTER_SUFFIXES:
            raise ValueError(f"unexpected suffix for ingest contract: {source}")
        frame["_source_path"] = source
        frame["_source_sha256"] = sha256(source)

    nav_rows = []
    ping_cursor = 220_000
    for frame in FRAMES:
        lat, lon = project(START_LAT, START_LON, HEADING_DEG, frame["offset_m"])
        ping_span = 800
        nav_rows.append({
            "frame": frame["demo_filename"],
            "timestamp_utc": START_TIME,  # placeholder, replaced below
            "latitude": round(lat, 6),
            "longitude": round(lon, 6),
            "heading_deg": HEADING_DEG,
            "speed_mps": SPEED_MPS,
            "altitude_m": ALTITUDE_M,
            "ping_start": ping_cursor,
            "ping_end": ping_cursor + ping_span - 1,
        })
        ping_cursor += ping_span

    from datetime import datetime, timedelta, timezone
    t0 = datetime.fromisoformat(START_TIME.replace("Z", "+00:00"))
    cumulative = 0.0
    for frame, row in zip(FRAMES, nav_rows):
        cumulative += frame["dt_s"]
        row["timestamp_utc"] = (t0 + timedelta(seconds=cumulative)).isoformat().replace("+00:00", "Z")

    nav_lines = ["frame,timestamp_utc,latitude,longitude,heading_deg,speed_mps,altitude_m,ping_start,ping_end"]
    for row in nav_rows:
        nav_lines.append(",".join(str(row[k]) for k in (
            "frame", "timestamp_utc", "latitude", "longitude", "heading_deg",
            "speed_mps", "altitude_m", "ping_start", "ping_end",
        )))
    navigation_csv = "\n".join(nav_lines) + "\n"

    mission = {
        "mission_id": MISSION_ID,
        "survey_name": "Aqualens Epitome v3 Real-Data Internal Demo (Bay of Bengal)",
        "platform": "AUV-SD-DEMO-01",
        "operator": "Aqualens Internal Demo Team",
        "sensor": "Side-scan sonar (multi-source: Klein 3500 / EdgeTech 2205 / assorted SSS, see provenance)",
        "frequency_khz": None,
        "mission_type": "Curated multi-domain internal capability demo: pipeline, derelict fishing gear, "
                         "shipwreck-adjacent, and natural-seabed clutter",
        "sequential_observations": True,
        "sequence_mode": "SEQUENTIAL_PING",
        "sequential_ping_evidence": True,
        "demo_metadata": True,
        "notes": (
            "CURATED MULTI-SOURCE DEMO. All 7 sonar rasters are byte-identical original files "
            "from SubPipe, AI4Shipwrecks, and PING-GhostVision (see provenance.json / "
            "EPITOME_V3_PROVENANCE.json for exact original paths and SHA256). They are NOT a "
            "single physical survey: frames 1-2 are two genuinely sequential SubPipe pings of "
            "the same pipeline; every other frame is an independent real image from a "
            "different site/recording, arranged along one synthetic demo track. "
            "SYNTHETIC_DEMO_METADATA: every navigation fix (latitude, longitude, heading, "
            "timestamp, speed, altitude, ping_start/ping_end) below is demo metadata invented "
            "for this bundle. It is not historical GPS or telemetry recovered from any source "
            "dataset, and is not derived from the sonar imagery. sequential_observations is "
            "declared true only so the runtime's real SEQUENTIAL_PING persistence path is "
            "exercised for frames 1-2, where it is genuinely earned by real consecutive pings; "
            "it does not assert that frames 3-7 are temporally continuous with each other."
        ),
    }

    provenance_sonar = {frame["demo_filename"]: {
        "source_dataset": frame["source_dataset"],
        "original_relative_path": frame["original_relative_path"],
        "original_filename": frame["_source_path"].name,
        "original_annotation": frame["original_annotation"],
        "expected_domain": frame["expected_domain"],
        "sha256_original": frame["_source_sha256"],
        "pixels_byte_identical_to_original": True,
        "provenance_class": "ORIGINAL_DATASET_IMAGE",
    } for frame in FRAMES}

    provenance = {
        "bundle": "Aqualens_Epitome_v3_RealData_BayOfBengal",
        "mission_id": MISSION_ID,
        "purpose": "internal_capability_demo",
        "evaluation_eligible": False,
        "curated_multi_source_demo": True,
        "sonar_provenance": provenance_sonar,
        "navigation_source": "SYNTHETIC_DEMO_NAVIGATION",
        "navigation_region": "Bay of Bengal, open water, ~150km+ offshore of the Andhra Pradesh coast",
        "metadata_source": "SYNTHETIC_DEMO_METADATA",
        "synthetic_fields": [
            "timestamp_utc", "latitude", "longitude", "heading_deg", "speed_mps", "altitude_m",
            "ping_start", "ping_end", "mission/platform/operator metadata",
        ],
        "real_fields": ["sonar raster pixels (byte-identical to original dataset files)"],
        "detector_checkpoint_sha256": "2aa3ac71051856bcfc8ec400804995f03568aa26d1a1fb24583e4eb1b7a10b15",
        "important": "No model output, detector confidence, evidence score, open-set score, contact, "
                     "review result or classification is pre-baked into this bundle. Those are computed "
                     "only by actually running the Aqualens backend on this ZIP; see "
                     "EPITOME_V3_SELECTION_REPORT.md for the results of that real run.",
    }

    manifest = {
        "bundle_version": "3.0-realdata-demo",
        "bundle_name": "Aqualens_Epitome_v3_RealData_BayOfBengal",
        "mission_id": MISSION_ID,
        "demo_metadata": True,
        "not_evaluation_data": True,
        "real_sonar_images_only": True,
        "ai_generated_images": False,
        "sonar_pixels_modified": False,
        "sonar": [frame["demo_filename"] for frame in FRAMES],
        "navigation": "navigation.csv",
        "mission": "mission.json",
        "provenance": "provenance.json",
        "source_datasets": sorted({frame["source_dataset"] for frame in FRAMES}),
    }

    readme = (
        "Aqualens Epitome v3 -- Real-Data Internal Demo\n"
        "===================================================\n\n"
        "All 7 sonar rasters in this bundle are byte-identical copies of original files from\n"
        "SubPipe, AI4Shipwrecks, and PING-GhostVision. No image was generated, edited, or\n"
        "enhanced. See provenance.json and artifacts/demo/EPITOME_V3_PROVENANCE.json for the\n"
        "exact original relative path and SHA256 of every frame.\n\n"
        "Frames 1-2 are two genuinely consecutive SubPipe pings (real 1.00s capture gap) of the\n"
        "same physical pipeline; every other frame is an independent real image from a different\n"
        "site or recording. This is a CURATED MULTI-SOURCE DEMO, not one continuous physical\n"
        "survey -- see mission.json notes.\n\n"
        "Navigation is SYNTHETIC_DEMO_METADATA: a short offshore Bay of Bengal track invented for\n"
        "this bundle, not historical GPS or telemetry from any source dataset.\n\n"
        "Upload this ZIP through the normal survey upload flow to see real, freshly computed\n"
        "detections, contacts, and evidence -- nothing here is pre-baked.\n"
    )

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(OUTPUT, "w", compression=ZIP_DEFLATED) as archive:
        for frame in FRAMES:
            archive.write(frame["_source_path"], arcname=frame["demo_filename"])
        archive.writestr("navigation.csv", navigation_csv)
        archive.writestr("mission.json", json.dumps(mission, indent=2) + "\n")
        archive.writestr("provenance.json", json.dumps(provenance, indent=2) + "\n")
        archive.writestr("bundle_manifest.json", json.dumps(manifest, indent=2) + "\n")
        archive.writestr("README_DEMO_FLOW.txt", readme)

    with ZipFile(OUTPUT) as archive:
        for frame in FRAMES:
            sha_in_zip = hashlib.sha256(archive.read(frame["demo_filename"])).hexdigest()
            assert sha_in_zip == frame["_source_sha256"], f"byte-identity check failed for {frame['demo_filename']}"

    PROVENANCE_OUT.write_text(json.dumps({
        "mission_id": MISSION_ID,
        "zip_path": str(OUTPUT.relative_to(ROOT)),
        "frames": [{
            "demo_filename": frame["demo_filename"],
            "source_dataset": frame["source_dataset"],
            "original_relative_path": frame["original_relative_path"],
            "original_filename": frame["_source_path"].name,
            "original_annotation": frame["original_annotation"],
            "expected_domain": frame["expected_domain"],
            "sha256_original": frame["_source_sha256"],
            "sha256_in_zip": frame["_source_sha256"],
            "pixels_byte_identical": True,
            "navigation_source": "SYNTHETIC_DEMO_METADATA",
            "metadata_source": "SYNTHETIC_DEMO_METADATA",
            "note": frame["note"],
        } for frame in FRAMES],
        "navigation_region": "Bay of Bengal, open water, ~150km+ offshore Andhra Pradesh coast",
        "navigation_synthetic": True,
        "original_geolocation_fabricated": False,
    }, indent=2) + "\n")

    print("Wrote", OUTPUT)
    print("Wrote", PROVENANCE_OUT)


if __name__ == "__main__":
    build()
