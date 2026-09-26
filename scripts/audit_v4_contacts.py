#!/usr/bin/env python3
"""Round-2 A6: read-only audit of Contacts on the retained v4 Observations (spec A-AC8).

For each retained record of the given mission it re-runs today's association, on deep copies of the
retained Observations, under the same rules as ingest: B2 raster identity, B4/B5 Survey membership and
the A7 ping relationship, then ``fuse_contacts``. It reports the retained ("before") and re-run
("after") Contacts, each Contact that holds two FULL_FRAME boxes from one Frame, the basis of every
re-run Contact, and every changed Contact. It never writes runtime state or rasters: it hashes the state
file and every raster before and after, and fails if anything changed. Detector inference is not re-run.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import platform
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages"))

from sagar.vnext import fuse_contacts  # noqa: E402
from sagar.vnext.surveys import (  # noqa: E402
    NO_PING_RELATIONSHIP, form_surveys, load_native_pixels, ping_relationships, raster_identities, verified_survey_groups,
)

V4_MISSION = "SD-EPITOME-V4-REAL-DATA-VARIED-CONFIDENCE"
DEFAULT_STATE = Path.home() / "Desktop/sagardrishti/data/runtime/runtime_surveys.json"
DEFAULT_OUT = ROOT / "artifacts/round2/A/v4_contact_audit/iter-1"


def _sha(path: Path) -> str | None:
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None


def _same_frame_full_frame_merges(contacts: list[dict[str, Any]], findings: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """Contacts holding two or more FULL_FRAME Observations of one Frame (the KD-1 defect, A-AC8)."""
    merged = []
    for contact in contacts:
        by_frame: dict[str, list[str]] = {}
        for detection_id in contact.get("source_detection_ids") or []:
            finding = findings.get(detection_id) or {}
            if finding.get("inference_mode") == "FULL_FRAME":
                by_frame.setdefault(finding.get("source_frame_id"), []).append(detection_id)
        frames = {frame: ids for frame, ids in by_frame.items() if len(ids) > 1}
        if frames:
            merged.append({"contact_id": contact.get("contact_id"), "frames": frames})
    return merged


def _summary(contact: dict[str, Any]) -> dict[str, Any]:
    return {"contact_id": contact.get("contact_id"), "source_detection_ids": sorted(contact.get("source_detection_ids") or []),
            "association_basis": contact.get("association_basis"), "look_count": contact.get("look_count"),
            "persistence_evidence_type": contact.get("persistence_evidence_type"),
            "classes": sorted({c for c in contact.get("candidate_classes") or []})}


def _rerun(record: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Today's Survey membership and Contacts for one retained record, computed on copies."""
    from PIL import Image

    frames = copy.deepcopy(record.get("frames") or [])
    findings = copy.deepcopy(record.get("findings") or [])
    paths = {frame["frame_id"]: Path(frame["source_path"]) if frame.get("source_path") else None for frame in frames}
    identities = raster_identities(paths)
    layouts: dict[str, str | None] = {}
    for frame in frames:
        frame.update(identities[frame["frame_id"]])
        try:
            with Image.open(paths[frame["frame_id"]]) as image:
                layouts[frame["frame_id"]] = image.mode
        except Exception:  # noqa: BLE001 -- an unreadable raster is simply not evidence
            layouts[frame["frame_id"]] = None
    verified = verified_survey_groups(frames, layouts, lambda frame_id: load_native_pixels(paths[frame_id]))
    surveys = form_surveys(record.get("survey_id"), frames, layouts, {}, verified)
    relationships = ping_relationships(frames, surveys)
    for finding in findings:
        finding.update(relationships.get(finding.get("source_frame_id"), NO_PING_RELATIONSHIP))
    return surveys, fuse_contacts(findings, record.get("survey_id"))


def _audit_record(record: dict[str, Any]) -> dict[str, Any]:
    findings = {item["detection_id"]: item for item in record.get("findings") or []}
    before = record.get("contacts") or []
    surveys, after = _rerun(record)
    before_sets = {frozenset(c.get("source_detection_ids") or []) for c in before}
    after_sets = {frozenset(c.get("source_detection_ids") or []) for c in after}
    return {
        "survey_id": record.get("survey_id"), "name": record.get("name"), "created_at": record.get("created_at"),
        "frame_count": len(record.get("frames") or []), "observation_count": len(findings),
        "surveys_after": [{"survey_ref": s["survey_ref"], "frame_ids": s["frame_ids"], "membership_provenance": s["membership_provenance"]}
                          for s in surveys],
        "before": {"contact_count": len(before), "contacts": [_summary(c) for c in before],
                   "same_frame_full_frame_merges": len(_same_frame_full_frame_merges(before, findings)),
                   "merged_contacts": _same_frame_full_frame_merges(before, findings)},
        "after": {"contact_count": len(after), "contacts": [_summary(c) for c in after],
                  "same_frame_full_frame_merges": len(_same_frame_full_frame_merges(after, findings)),
                  "merged_contacts": _same_frame_full_frame_merges(after, findings)},
        "changed": {"removed": [_summary(c) for c in before if frozenset(c.get("source_detection_ids") or []) not in after_sets],
                    "added": [_summary(c) for c in after if frozenset(c.get("source_detection_ids") or []) not in before_sets]},
    }


def _markdown(report: dict[str, Any]) -> str:
    lines = ["# Retained v4 Contact audit (Round-2 A6, read-only)", "",
             f"- State: `{report['state_path']}`", f"- State SHA-256 before = after: `{report['state_sha256_before']}` "
             f"({'unchanged' if report['state_unchanged'] else 'CHANGED'})",
             f"- Rasters unchanged: {report['rasters_unchanged']} ({len(report['raster_sha256'])} files)",
             f"- Records audited (mission `{report['mission_id']}`): {len(report['records'])}",
             f"- **A-AC8** (no re-run Contact holds two same-Frame FULL_FRAME boxes): **{'PASS' if report['acceptance']['A-AC8'] else 'FAIL'}**",
             "- Association re-run under today's rules (B2 identity, B4/B5 membership, A7 relationship); detector not re-run.", ""]
    for record in report["records"]:
        lines += [f"## {record['survey_id']} ({record['created_at']})", "",
                  f"{record['frame_count']} Frames, {record['observation_count']} Observations. "
                  f"Surveys after: {', '.join(sorted({s['membership_provenance'] for s in record['surveys_after']}))} "
                  f"×{len(record['surveys_after'])}.", "",
                  f"| | Contacts | Same-Frame FULL_FRAME merges |", "|---|---|---|",
                  f"| Before (retained) | {record['before']['contact_count']} | {record['before']['same_frame_full_frame_merges']} |",
                  f"| After (re-run) | {record['after']['contact_count']} | {record['after']['same_frame_full_frame_merges']} |", "",
                  "Retained Contacts merging same-Frame FULL_FRAME boxes:", ""]
        lines += [f"- `{m['contact_id']}`: " + "; ".join(f"{frame}: {', '.join(ids)}" for frame, ids in m["frames"].items())
                  for m in record["before"]["merged_contacts"]] or ["- none"]
        lines += ["", "Changed Contacts (removed = retained Contact whose membership no longer exists; added = new membership):", ""]
        lines += [f"- removed `{c['contact_id']}` ({len(c['source_detection_ids'])} Observations: {', '.join(c['source_detection_ids'])})"
                  for c in record["changed"]["removed"]]
        lines += [f"- added `{c['contact_id']}` ({', '.join(c['source_detection_ids'])}) basis {c['association_basis']}, Looks {c['look_count']}"
                  for c in record["changed"]["added"]]
        lines += ["", "Re-run Contacts and basis:", "", "| Contact | Observations | Basis | Looks | Persistence |", "|---|---|---|---|---|"]
        lines += [f"| `{c['contact_id']}` | {len(c['source_detection_ids'])} | {c['association_basis']} | {c['look_count']} | "
                  f"{c['persistence_evidence_type']} |" for c in record["after"]["contacts"]]
        lines.append("")
    return "\n".join(lines).rstrip("\n") + "\n"


def run(state_path: Path, out_dir: Path, mission_id: str = V4_MISSION) -> dict[str, Any]:
    """Audit every retained record of ``mission_id``; write report.json, report.md and manifest.json to ``out_dir``."""
    if out_dir.exists() and any(out_dir.iterdir()):
        raise SystemExit(f"{out_dir} already holds an audit; artifacts are immutable, use a new iteration directory")
    if state_path.parent.resolve() in out_dir.resolve().parents or out_dir.resolve() == state_path.parent.resolve():
        raise SystemExit("the audit never writes inside the runtime state directory")
    started = datetime.now(timezone.utc).isoformat()
    raw = state_path.read_bytes()
    state_before = hashlib.sha256(raw).hexdigest()
    records = [record for record in json.loads(raw).values() if (record.get("mission") or {}).get("mission_id") == mission_id]
    rasters = sorted({frame["source_path"] for record in records for frame in record.get("frames") or [] if frame.get("source_path")})
    raster_before = {path: _sha(Path(path)) for path in rasters}
    audited = [_audit_record(record) for record in sorted(records, key=lambda item: item.get("survey_id") or "")]
    state_after = _sha(state_path)
    raster_after = {path: _sha(Path(path)) for path in rasters}
    report = {
        "ticket": "A6", "acceptance_criterion": "spec A-AC8", "mission_id": mission_id, "state_path": str(state_path),
        "state_sha256_before": state_before, "state_sha256_after": state_after, "state_unchanged": state_before == state_after,
        "raster_sha256": raster_before, "rasters_unchanged": raster_before == raster_after,
        "records": audited,
        "acceptance": {"A-AC8": bool(audited) and all(r["after"]["same_frame_full_frame_merges"] == 0 for r in audited)},
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    (out_dir / "report.md").write_text(_markdown(report))
    git = lambda *args: subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True).stdout.strip()  # noqa: E731
    (out_dir / "manifest.json").write_text(json.dumps({
        "ticket": "A6", "script": "scripts/audit_v4_contacts.py", "command": sys.argv, "iteration": out_dir.name,
        "started_at": started, "finished_at": datetime.now(timezone.utc).isoformat(),
        "git_commit": git("rev-parse", "HEAD"), "working_tree_dirty": bool(git("status", "--porcelain")),
        "python": platform.python_version(), "machine": platform.platform(), "state_path": str(state_path),
        "state_sha256": state_before, "state_unchanged": report["state_unchanged"], "rasters_unchanged": report["rasters_unchanged"],
        "detector_rerun": False, "outputs": ["report.json", "report.md"],
    }, indent=2) + "\n")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", type=Path, default=DEFAULT_STATE)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--mission", default=V4_MISSION)
    args = parser.parse_args()
    report = run(args.state, args.out, args.mission)
    for record in report["records"]:
        print(f"{record['survey_id']}: contacts {record['before']['contact_count']} -> {record['after']['contact_count']}, "
              f"same-Frame FULL_FRAME merges {record['before']['same_frame_full_frame_merges']} -> {record['after']['same_frame_full_frame_merges']}")
    print(f"A-AC8={'PASS' if report['acceptance']['A-AC8'] else 'FAIL'} state_unchanged={report['state_unchanged']} "
          f"rasters_unchanged={report['rasters_unchanged']}")
    return 0 if report["acceptance"]["A-AC8"] and report["state_unchanged"] and report["rasters_unchanged"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
