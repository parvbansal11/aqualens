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
    parsed = {field: raw.get(field) for field in MISSION_FIELDS}
    parsed["sequential_observations"] = sequential
    return parsed


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
