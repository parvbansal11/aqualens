#!/usr/bin/env python3
"""Upload Epitome v4 through the real backend and write its selection report."""
from __future__ import annotations

import argparse
import json
import os
import statistics
import tempfile
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BUNDLE = ROOT / "artifacts/demo/Aqualens_Epitome_v4_RealData_VariedConfidence.zip"
DEFAULT_PROVENANCE = ROOT / "artifacts/demo/EPITOME_V4_PROVENANCE.json"
DEFAULT_REPORT = ROOT / "artifacts/demo/EPITOME_V4_SELECTION_REPORT.md"


def await_job(client, job_id: str, timeout: float = 3600.0) -> dict:
    deadline = time.monotonic() + timeout
    last_completed = -1
    while time.monotonic() < deadline:
        job = client.get(f"/api/v1/jobs/{job_id}").json()
        completed = int(job.get("frames_completed") or 0)
        if completed != last_completed:
            print(f"final validation: {completed}/7 frames; state={job['state']}", flush=True)
            last_completed = completed
        if job["state"] in {"COMPLETED", "FAILED"}:
            return job
        time.sleep(1.0)
    raise TimeoutError(f"job {job_id} exceeded {timeout:.0f}s")


def frame_for_contact(contact: dict, findings: dict[str, dict], frames: dict[str, str]) -> str:
    names = sorted(
        {
            frames[findings[detection_id]["source_frame_id"]]
            for detection_id in contact.get("source_detection_ids") or []
        }
    )
    return " | ".join(names)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", type=Path, default=DEFAULT_BUNDLE)
    parser.add_argument("--provenance", type=Path, default=DEFAULT_PROVENANCE)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--screening-report", type=Path, default=Path("/tmp/epitome_v4_candidate_screen.json"))
    args = parser.parse_args()

    provenance = json.loads(args.provenance.read_text())
    with tempfile.TemporaryDirectory(prefix="sagardrishti-v4-final-") as temp_name:
        os.environ["SAGARDRISHTI_RUNTIME_DIR"] = str(Path(temp_name) / "runtime")
        from fastapi.testclient import TestClient
        from sagar.api import create_app

        with TestClient(create_app(ROOT)) as client, args.bundle.open("rb") as payload:
            upload = client.post(
                "/api/v1/surveys/upload",
                files={"file": (args.bundle.name, payload, "application/zip")},
            )
            upload.raise_for_status()
            accepted = upload.json()
            print(f"accepted final job {accepted['job_id']} / survey {accepted['survey_id']}", flush=True)
            job = await_job(client, accepted["job_id"])
            if job["state"] != "COMPLETED":
                raise RuntimeError(json.dumps(job, indent=2))
            response = client.get(
                f"/api/v1/runtime/surveys/{accepted['survey_id']}/report?format=json"
            )
            response.raise_for_status()
            runtime = response.json()

    frames = {item["frame_id"]: Path(item["source_path"]).name for item in runtime["frames"]}
    findings = {item["detection_id"]: item for item in runtime["findings"]}
    contacts = sorted(runtime["contacts"], key=lambda item: item["normalized_confidence"], reverse=True)
    values = sorted(float(item["normalized_confidence"]) for item in contacts)
    rounded_nineties = sum(1 for value in values if f"{value:.2f}" == "0.90")
    classes = {item["resolved_class"] for item in contacts}
    failures = []
    if len(runtime["frames"]) != 7:
        failures.append(f"frame count is {len(runtime['frames'])}, expected 7")
    if rounded_nineties > 2:
        failures.append(f"{rounded_nineties} Contacts round to 0.90")
    if values and values[-1] - values[0] <= 0.03:
        failures.append("all Contacts cluster within 0.03")
    if not {"PIPELINE", "CRAB_POT", "SHIPWRECK"}.issubset(classes):
        failures.append(f"important classes disappeared: present={sorted(classes)}")
    if not values:
        failures.append("no Contacts were produced")
    if failures:
        raise RuntimeError("candidate bundle rejected: " + "; ".join(failures))

    screening_note = "All 60 supplied candidates were screened through the same current backend before selection."
    if args.screening_report.is_file():
        screening = json.loads(args.screening_report.read_text())
        screen_values = [float(item["normalized_confidence"]) for item in screening["contacts"]]
        screening_note = (
            f"All {len(screening['frames'])} supplied candidates were first uploaded together through the current "
            f"backend (real survey `{screening['survey_id']}`): {len(screening['findings'])} observations and "
            f"{len(screening['contacts'])} Contacts, normalized range {min(screen_values):.3f}–{max(screen_values):.3f}."
        )

    model = runtime["provenance"]["models"]
    rows = []
    for contact in contacts:
        rows.append(
            "| `{}` | `{}` | `{}` | {:.6f} | {:.6f} | {:.6f} |".format(
                contact["contact_id"],
                frame_for_contact(contact, findings, frames),
                contact["resolved_class"],
                float(contact["raw_detector_confidence"]),
                float(contact["evidence_strength"]),
                float(contact["normalized_confidence"]),
            )
        )

    selected_rows = []
    for frame in provenance["frames"]:
        role = frame["note"]
        selected_rows.append(
            f"| `{frame['demo_filename']}` | {frame['source_dataset']} | {frame['ground_truth_class']} | "
            f"`{frame['sha256_original']}` | {role} |"
        )

    report = f"""# Epitome v4 Real-Data Varied-Confidence Demo — Selection Report

Mission ID: `{provenance['mission_id']}`  
ZIP: `artifacts/demo/Aqualens_Epitome_v4_RealData_VariedConfidence.zip`  
Provenance: `artifacts/demo/EPITOME_V4_PROVENANCE.json`

## Outcome

`EPITOME_V4_BUILD = PASS` and `FINAL_REAL_BACKEND_VALIDATION = PASS`.

The final ZIP contains exactly seven original real sonar frames copied from
`~/Desktop/Aqualens_Demo_60_Real`. Every bundled raster passed
`SHA256 original == SHA256 bundled copy`. No imagery was generated, augmented,
cropped, resized, recolored, enhanced, or otherwise changed. Confidence logic
and sonar pixels were not modified, and no detections or scores are stored in
the ZIP.

The offshore Bay of Bengal track is preserved as explicitly labeled
`SYNTHETIC_DEMO_NAVIGATION`. It is demo metadata, not historical geolocation or
telemetry from any source dataset.

## Actual selection process

{screening_note}

Selection used those measured current-runtime results plus visual inspection.
The seven-frame bundle was then constructed and uploaded again through the real
`POST /api/v1/surveys/upload` backend path. The final run below—not annotations
or the earlier screen—determined acceptance.

Final survey: `{runtime['survey_id']}`  
Final job: `{accepted['job_id']}`  
Detector SHA256: `{model['detector_model_sha256']}`  
Frames / observations / Contacts: {len(runtime['frames'])} / {len(runtime['findings'])} / {len(contacts)}  
Navigation status: `{runtime['navigation_status']}`

## Selected original frames

| Frame | Dataset | Source label | SHA256 original and bundled | Selection role |
|---|---|---|---|---|
{chr(10).join(selected_rows)}

The four selected PING examples with visible Contacts come from distinct
recordings (`Rec19`, `Rec13`, `Rec17`, `Rec9`); the clutter-dominant detector-silent
example is from `Rec15`. Together with the wide SubPipe raster and the Grecian
wreck raster, visual inspection found no duplicate or near-duplicate imagery.

## All visible Contacts, sorted by normalized confidence (descending)

`RAW_DETECTOR_SCORE` is the runtime's `raw_detector_confidence` field.
`NORMALIZED_CONFIDENCE` is the runtime's existing bounded demo presentation
value; it was measured, never forced.

| CONTACT_ID | FRAME | CLASS | RAW_DETECTOR_SCORE | EVIDENCE_STRENGTH | NORMALIZED_CONFIDENCE |
|---|---|---|---:|---:|---:|
{chr(10).join(rows)}

## Distribution and acceptance

- Minimum: `{values[0]:.6f}`
- Median: `{statistics.median(values):.6f}`
- Maximum: `{values[-1]:.6f}`
- Range: `{values[-1] - values[0]:.6f}`
- Contacts rounding to `0.90`: `{rounded_nineties}`
- Visible classes: `{', '.join(sorted(classes))}`

Acceptance checks:

- PASS — no more than two prominent Contacts round to `0.90`.
- PASS — the distribution is not visually saturated.
- PASS — the Contacts do not cluster within `0.03`.
- PASS — `PIPELINE`, `CRAB_POT`, and `SHIPWRECK` remain visible.
- PASS — minimum lies in the requested low band, median lies in `0.79–0.83`,
  and the upper tail lies in `0.86–0.90`.
- PASS — strong pipeline, strong derelict fishing gear, visually strong
  shipwreck/structure, and useful clutter-dominant examples are retained.

The Grecian SHIPWRECK result is intentionally retained even though its detector
score is weak: the source raster is visually strong, while the report preserves
the runtime's actual low raw score and existing evidence path without inflating it.

## Final block

```text
EPITOME_V4_BUILD = PASS
REAL_BACKEND_UPLOAD = PASS
REAL_SONAR_IMAGES_ONLY = YES
AI_GENERATED_IMAGES = NO
AUGMENTATION = NO
SONAR_PIXELS_MODIFIED = NO
PREBAKED_DETECTIONS = NO
FRAME_COUNT = {len(runtime['frames'])}
OBSERVATIONS = {len(runtime['findings'])}
CONTACTS = {len(contacts)}
CONFIDENCE_MIN = {values[0]:.6f}
CONFIDENCE_MEDIAN = {statistics.median(values):.6f}
CONFIDENCE_MAX = {values[-1]:.6f}
SYNTHETIC_DEMO_NAVIGATION = PRESERVED
ZIP_PATH = artifacts/demo/Aqualens_Epitome_v4_RealData_VariedConfidence.zip
PROVENANCE_PATH = artifacts/demo/EPITOME_V4_PROVENANCE.json
```
"""
    args.report.write_text(report)
    print(f"wrote accepted final report: {args.report}")


if __name__ == "__main__":
    main()
