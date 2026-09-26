"""Navigation/mission metadata ingest for uploaded survey bundles.

Parses ``navigation.csv`` and ``mission.json`` when a ZIP upload carries them
alongside its rasters. Never invents a coordinate: a frame with no matching
navigation row stays null, and malformed metadata is rejected rather than
silently dropped (see NavigationValidationError, raised with the offending
row/field so the API can surface a precise 4xx).
"""
from __future__ import annotations

import csv
import json
from datetime import datetime
from pathlib import Path
from typing import Any

REQUIRED_NAV_COLUMNS = {"frame", "timestamp_utc", "latitude", "longitude"}
OPTIONAL_NAV_FLOAT_COLUMNS = ("heading_deg", "speed_mps", "altitude_m")
OPTIONAL_NAV_INT_COLUMNS = ("ping_start", "ping_end")
MISSION_FIELDS = ("mission_id", "survey_name", "platform", "operator", "sensor", "frequency_khz", "mission_type", "notes", "sequential_observations")
# Spec B rule 6 (PID-23). Undeclared provenance is null, never inferred from coordinates existing.
NAVIGATION_PROVENANCE_VALUES = ("MEASURED", "DERIVED_FROM_SOURCE", "SYNTHETIC_DEMO")
# DERIVED_FROM_SOURCE is produced only by Aqualens after source verification (B4); an Upload may
# declare only these.
DECLARABLE_NAVIGATION_PROVENANCE = ("MEASURED", "SYNTHETIC_DEMO")
SYSTEM_ONLY_PROVENANCE_MESSAGE = (
    "DERIVED_FROM_SOURCE is assigned by Aqualens after verifying the source rasters and cannot be declared by an upload"
)
# The structured labels the internal demo bundle builders write into provenance.json.
_SYNTHETIC_DEMO_LABELS = {"SYNTHETIC_DEMO_METADATA", "SYNTHETIC_DEMO_NAVIGATION"}
# No declared navigation provenance establishes a ping relationship between Frames. MEASURED is a
# declaration, not a verification; SYNTHETIC_DEMO and null are never evidence. Frames relate only
# through the ping relationship Aqualens derives from source pixels (B4) within one Survey (A7).


class NavigationValidationError(ValueError):
    """Malformed navigation.csv/mission.json content. Carries a row/field pointer
    so the API layer can identify exactly what was wrong rather than guess."""

    def __init__(self, message: str, *, row: int | None = None, field: str | None = None) -> None:
        self.row = row
        self.field = field
        super().__init__(message)


def _require_float(raw: str | None, field: str, row: int) -> float:
    text = (raw or "").strip()
    if not text:
        raise NavigationValidationError(f"row {row}: {field} is required", row=row, field=field)
    try:
        return float(text)
    except ValueError:
        raise NavigationValidationError(f"row {row}: {field} is not a number: {raw!r}", row=row, field=field) from None


def _optional_float(raw: str | None, field: str, row: int) -> float | None:
    text = (raw or "").strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        raise NavigationValidationError(f"row {row}: {field} is not a number: {raw!r}", row=row, field=field) from None


def _optional_int(raw: str | None, field: str, row: int) -> int | None:
    text = (raw or "").strip()
    if not text:
        return None
    try:
        return int(text)
    except ValueError:
        raise NavigationValidationError(f"row {row}: {field} is not an integer: {raw!r}", row=row, field=field) from None


def _optional_timestamp(raw: str | None, row: int) -> str | None:
    text = (raw or "").strip()
    if not text:
        return None
    try:
        datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        raise NavigationValidationError(f"row {row}: timestamp_utc is not parseable: {raw!r}", row=row, field="timestamp_utc") from None
    return text


def parse_navigation_csv(path: Path) -> dict[str, dict[str, Any]]:
    """Returns {frame_basename: navigation_record}. Raises NavigationValidationError
    on the first invalid row/field; never returns a partially-invalid table."""
    with path.open(newline="") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames:
            raise NavigationValidationError("navigation.csv has no header row")
        missing = REQUIRED_NAV_COLUMNS - set(reader.fieldnames)
        if missing:
            raise NavigationValidationError(f"navigation.csv is missing required column(s): {', '.join(sorted(missing))}")
        by_frame: dict[str, dict[str, Any]] = {}
        for row_index, row in enumerate(reader, start=2):  # header occupies row 1
            frame = (row.get("frame") or "").strip()
            if not frame:
                raise NavigationValidationError(f"row {row_index}: frame is required", row=row_index, field="frame")
            if frame in by_frame:
                raise NavigationValidationError(f"row {row_index}: duplicate navigation row for frame {frame!r}", row=row_index, field="frame")
            latitude = _require_float(row.get("latitude"), "latitude", row_index)
            if not -90.0 <= latitude <= 90.0:
                raise NavigationValidationError(f"row {row_index}: latitude {latitude} is out of range [-90,90]", row=row_index, field="latitude")
            longitude = _require_float(row.get("longitude"), "longitude", row_index)
            if not -180.0 <= longitude <= 180.0:
                raise NavigationValidationError(f"row {row_index}: longitude {longitude} is out of range [-180,180]", row=row_index, field="longitude")
            record: dict[str, Any] = {
                "frame": frame,
                "timestamp_utc": _optional_timestamp(row.get("timestamp_utc"), row_index),
                "latitude": latitude,
                "longitude": longitude,
            }
            for column in OPTIONAL_NAV_FLOAT_COLUMNS:
                record[column] = _optional_float(row.get(column), column, row_index)
            for column in OPTIONAL_NAV_INT_COLUMNS:
                record[column] = _optional_int(row.get(column), column, row_index)
            by_frame[frame] = record
        return by_frame


def parse_mission_json(path: Path) -> dict[str, Any]:
    try:
        raw = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise NavigationValidationError(f"mission.json is not valid JSON: {exc}") from exc
    if not isinstance(raw, dict):
        raise NavigationValidationError("mission.json must be a JSON object")
    sequential = raw.get("sequential_observations")
    if sequential is not None and not isinstance(sequential, bool):
        raise NavigationValidationError("mission.json field sequential_observations must be boolean when supplied", field="sequential_observations")
    # The prepared Epitome contract names the same explicit assertion with a
    # mode plus evidence flag.  Both are required: neither ZIP member order nor
    # filenames establish a recording sequence.
    sequence_mode = raw.get("sequence_mode")
    sequential_ping_evidence = raw.get("sequential_ping_evidence")
    if sequence_mode is not None and not isinstance(sequence_mode, str):
        raise NavigationValidationError("mission.json field sequence_mode must be a string when supplied", field="sequence_mode")
    if sequential_ping_evidence is not None and not isinstance(sequential_ping_evidence, bool):
        raise NavigationValidationError("mission.json field sequential_ping_evidence must be boolean when supplied", field="sequential_ping_evidence")
    if sequential is None:
        sequential = sequence_mode == "SEQUENTIAL_PING" and sequential_ping_evidence is True
    provenance = raw.get("navigation_provenance")
    if provenance == "DERIVED_FROM_SOURCE":
        raise NavigationValidationError(f"mission.json: {SYSTEM_ONLY_PROVENANCE_MESSAGE}", field="navigation_provenance")
    if provenance is not None and provenance not in DECLARABLE_NAVIGATION_PROVENANCE:
        raise NavigationValidationError(
            f"mission.json field navigation_provenance must be one of {', '.join(DECLARABLE_NAVIGATION_PROVENANCE)} when supplied",
            field="navigation_provenance",
        )
    parsed = {field: raw.get(field) for field in MISSION_FIELDS}
    parsed["sequential_observations"] = sequential
    parsed["navigation_provenance"] = provenance
    parsed["declared_surveys"] = _declared_surveys(raw.get("declared_surveys"))
    return parsed


def _declared_surveys(raw: Any) -> list[list[str]] | None:
    """Explicit Survey groups (spec B rule 3a): a list of groups, each a list of raster file names.

    Only the structure is checked here; whether the names exist in the Upload and share one geometry
    is checked against the rasters. A Frame may be declared in at most one Survey (I-B1).
    """
    if raw is None:
        return None
    problem = "mission.json field declared_surveys must be a list of non-empty lists of raster file names"
    if not isinstance(raw, list) or not all(isinstance(group, list) and group for group in raw):
        raise NavigationValidationError(problem, field="declared_surveys")
    if not all(isinstance(name, str) and name.strip() for group in raw for name in group):
        raise NavigationValidationError(problem, field="declared_surveys")
    names = [name for group in raw for name in group]
    repeated = sorted({name for name in names if names.count(name) > 1})
    if repeated:
        raise NavigationValidationError(f"mission.json declared_surveys names a Frame more than once: {', '.join(repeated)}", field="declared_surveys")
    return [list(group) for group in raw]


def parse_bundle_provenance(path: Path) -> str | None:
    """Navigation provenance stated by a bundle's provenance.json, or None when it states none.

    The existing demo labels (``navigation_provenance: SYNTHETIC_DEMO_METADATA``, ``navigation_source:
    SYNTHETIC_DEMO_NAVIGATION``, ``navigation_is_synthetic: true``) normalize to SYNTHETIC_DEMO.
    """
    try:
        raw = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise NavigationValidationError(f"provenance.json is not valid JSON: {exc}") from exc
    if not isinstance(raw, dict):
        raise NavigationValidationError("provenance.json must be a JSON object")
    labels = {raw.get("navigation_provenance"), raw.get("navigation_source")}
    if "DERIVED_FROM_SOURCE" in labels:
        raise NavigationValidationError(f"provenance.json: {SYSTEM_ONLY_PROVENANCE_MESSAGE}", field="navigation_provenance")
    if raw.get("navigation_is_synthetic") is True or labels & (_SYNTHETIC_DEMO_LABELS | {"SYNTHETIC_DEMO"}):
        return "SYNTHETIC_DEMO"
    declared = raw.get("navigation_provenance")
    return declared if declared in DECLARABLE_NAVIGATION_PROVENANCE else None


def resolve_navigation_provenance(mission_value: str | None, bundle_value: str | None) -> str | None:
    """One Upload-level provenance; two different declarations are contradictory metadata and rejected."""
    if mission_value is not None and bundle_value is not None and mission_value != bundle_value:
        raise NavigationValidationError(
            f"mission.json declares navigation_provenance {mission_value} but provenance.json declares {bundle_value}",
            field="navigation_provenance",
        )
    return mission_value if mission_value is not None else bundle_value



def frame_navigation_view(record: dict[str, Any] | None) -> dict[str, Any]:
    """Frame-level navigation snapshot stored on the runtime survey record."""
    if record is None:
        return {"latitude": None, "longitude": None, "heading_deg": None, "timestamp_utc": None, "navigation_status": "UNAVAILABLE"}
    return {
        "latitude": record["latitude"], "longitude": record["longitude"], "heading_deg": record.get("heading_deg"),
        "timestamp_utc": record.get("timestamp_utc"), "navigation_status": "AVAILABLE",
    }


def finding_navigation_view(record: dict[str, Any] | None) -> dict[str, Any]:
    """Fields every finding inherits from its source frame's navigation row.
    Never invents a coordinate: absent record -> null lat/lon and UNAVAILABLE."""
    view = frame_navigation_view(record)
    return {
        "geo": {"lat": view["latitude"], "lon": view["longitude"]},
        "latitude": view["latitude"], "longitude": view["longitude"],
        "heading_deg": view["heading_deg"], "timestamp_utc": view["timestamp_utc"],
        "navigation_status": view["navigation_status"],
    }
