#!/usr/bin/env python3
"""Print Contact Confidence distributions from retained runtime surveys or JSON fixtures.

This is a diagnostic only. It reads Contact records and never reruns inference,
changes a survey, or touches frozen evaluation artifacts.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]


def _percentile(values: list[float], fraction: float) -> float:
    if len(values) == 1:
        return values[0]
    position = (len(values) - 1) * fraction
    lower, upper = int(position), min(len(values) - 1, int(position) + 1)
    return values[lower] + (values[upper] - values[lower]) * (position - lower)


def _contacts(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, dict) and "contacts" in payload:
        return list(payload["contacts"] or [])
    if isinstance(payload, dict):
        return [contact for survey in payload.values() for contact in survey.get("contacts", [])]
    raise ValueError("expected a survey report or runtime_surveys.json object")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", nargs="?", type=Path, default=ROOT / "data" / "runtime" / "runtime_surveys.json")
    parser.add_argument("--examples", type=int, default=8)
    args = parser.parse_args()
    contacts = _contacts(json.loads(args.path.read_text()))
    raw_values = sorted(float(item["raw_fused_confidence"]) for item in contacts if item.get("raw_fused_confidence") is not None)
    normalized_values = sorted(float(item["normalized_confidence"]) for item in contacts if item.get("normalized_confidence") is not None)
    if not raw_values or not normalized_values:
        print("CONTACT_CONFIDENCE_DIAGNOSTIC: no materialized confidence values")
        return
    print("CONTACT_CONFIDENCE_DIAGNOSTIC")
    for label, values in (("RAW", raw_values), ("NORMALIZED", normalized_values)):
        print(label)
        print(f"minimum={values[0]:.6f}")
        print(f"p10={_percentile(values, .10):.6f}")
        print(f"median={_percentile(values, .50):.6f}")
        print(f"p90={_percentile(values, .90):.6f}")
        print(f"maximum={values[-1]:.6f}")
    print("CONTACT_ID | RAW_FUSED | NORMALIZED")
    for contact in sorted(contacts, key=lambda item: float(item.get("raw_fused_confidence") or -1), reverse=True)[:args.examples]:
        print(f"{contact.get('contact_id')} | {contact.get('raw_fused_confidence'):.6f} | {contact.get('normalized_confidence'):.6f}")


if __name__ == "__main__":
    main()
