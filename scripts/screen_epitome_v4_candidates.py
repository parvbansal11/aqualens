#!/usr/bin/env python3
"""Run all 60 original Epitome v4 candidates through the real backend.

This is a selection utility, not a fixture or inference shortcut. It builds a
temporary upload bundle containing byte-identical source rasters, uploads that
bundle through ``POST /api/v1/surveys/upload``, waits for the real worker, and
writes the returned report. Candidate frames are spaced 250 m apart on the
synthetic Bay of Bengal demo track so contacts cannot fuse across frames.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path.home() / "Desktop" / "Aqualens_Demo_60_Real"
MANIFEST = SOURCE / "metadata" / "selection_manifest.json"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def project(distance_m: float) -> tuple[float, float]:
    heading = math.radians(128.0)
    return (
        15.0 + distance_m * math.cos(heading) / 111_000.0,
        84.0 + distance_m * math.sin(heading) / 111_000.0,
    )


def build_screening_bundle(path: Path, rows: list[dict]) -> None:
    navigation = [
        "frame,timestamp_utc,latitude,longitude,heading_deg,speed_mps,altitude_m,ping_start,ping_end"
    ]
    start = datetime(2026, 9, 14, 3, 10, tzinfo=timezone.utc)
    with ZipFile(path, "w", compression=ZIP_DEFLATED) as archive:
        for index, row in enumerate(rows):
            source = Path(row["copied_absolute_path"])
            if not source.is_file():
                raise FileNotFoundError(source)
            actual = sha256(source)
            if actual != row["SHA256"]:
                raise RuntimeError(f"source checksum mismatch: {source}")
            archive.write(source, arcname=source.name)
            latitude, longitude = project(index * 250.0)
            timestamp = (start + timedelta(seconds=index * 140)).isoformat().replace("+00:00", "Z")
            navigation.append(
                f"{source.name},{timestamp},{latitude:.6f},{longitude:.6f},128.0,1.8,14.0,"
                f"{220_000 + index * 2000},{220_799 + index * 2000}"
            )
        archive.writestr("navigation.csv", "\n".join(navigation) + "\n")
        archive.writestr(
            "mission.json",
            json.dumps(
                {
                    "mission_id": "SD-EPITOME-V4-CANDIDATE-SCREEN",
                    "survey_name": "Epitome v4 60-frame real candidate screening",
                    "mission_type": "candidate_selection_only",
                    "sequential_observations": False,
                    "demo_metadata": True,
                    "navigation_source": "SYNTHETIC_DEMO_NAVIGATION",
                    "notes": (
                        "All rasters are byte-identical originals from the supplied 60-frame corpus. "
                        "SYNTHETIC_DEMO_NAVIGATION spaces candidates apart solely to prevent cross-frame fusion."
                    ),
                },
                indent=2,
            )
            + "\n",
        )


def await_job(client, job_id: str, timeout: float) -> dict:
    deadline = time.monotonic() + timeout
    last_completed = -1
    while time.monotonic() < deadline:
        job = client.get(f"/api/v1/jobs/{job_id}").json()
        completed = int(job.get("frames_completed") or 0)
        if completed != last_completed:
            print(f"candidate screening: {completed}/60 frames; state={job['state']}", flush=True)
            last_completed = completed
        if job["state"] in {"COMPLETED", "FAILED"}:
            return job
        time.sleep(2.0)
    raise TimeoutError(f"job {job_id} exceeded {timeout:.0f}s")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, help="JSON path for the actual backend report")
    parser.add_argument("--timeout", type=float, default=7200.0)
    args = parser.parse_args()

    rows = json.loads(MANIFEST.read_text())
    if len(rows) != 60:
        raise RuntimeError(f"expected 60 candidates, found {len(rows)}")

    # Isolate this selection run from retained demo runtime state. This must be
    # set before create_app constructs its Store.
    with tempfile.TemporaryDirectory(prefix="sagardrishti-v4-screen-") as temp_name:
        temp = Path(temp_name)
        os.environ["SAGARDRISHTI_RUNTIME_DIR"] = str(temp / "runtime")
        bundle = temp / "epitome-v4-candidate-screen.zip"
        build_screening_bundle(bundle, rows)

        from fastapi.testclient import TestClient
        from sagar.api import create_app

        with TestClient(create_app(ROOT)) as client, bundle.open("rb") as payload:
            response = client.post(
                "/api/v1/surveys/upload",
                files={"file": (bundle.name, payload, "application/zip")},
            )
            response.raise_for_status()
            accepted = response.json()
            print(
                f"accepted real backend job {accepted['job_id']} / survey {accepted['survey_id']}",
                flush=True,
            )
            job = await_job(client, accepted["job_id"], args.timeout)
            if job["state"] != "COMPLETED":
                raise RuntimeError(json.dumps(job, indent=2))
            report_response = client.get(
                f"/api/v1/runtime/surveys/{accepted['survey_id']}/report?format=json"
            )
            report_response.raise_for_status()
            report = report_response.json()

        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2) + "\n")
        print(f"wrote actual runtime report: {args.output}")


if __name__ == "__main__":
    main()
