#!/usr/bin/env python3
"""Fail closed Gate 2 verifier for a generated real-data snapshot."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("snapshot")
    args = parser.parse_args()
    source = ROOT / "data/processed" / args.snapshot
    snapshot = json.loads((source / "snapshot.json").read_text())
    qa = json.loads((source / "qa_report.json").read_text())
    expected = {
        "group_overlap_train_test", "group_overlap_train_val", "near_duplicates",
        "eval_ineligible_rows", "test_groups_have_positives",
    }
    if set(snapshot["split_assertions"]) != expected or any(value != "PASS" for value in snapshot["split_assertions"].values()):
        raise RuntimeError("Gate 2 refused: a frozen split assertion is missing or failed")
    if qa.get("status") != "PASS":
        raise RuntimeError("Gate 2 refused: data QA did not pass")
    required = ["tiles.jsonl", "split.json", "snapshot.json", "audit.json", "qa_report.json"]
    missing = [name for name in required if not (source / name).exists()]
    if missing:
        raise RuntimeError(f"Gate 2 refused: missing snapshot artifacts: {missing}")
    print(f"GATE_2_PASS snapshot={args.snapshot}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
