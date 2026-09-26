#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages"))
from sagar.core import load_class_mapper
from sagar.io import ingest_subpipe

frames = ingest_subpipe(ROOT / "data/raw/subpipe/extracted", ROOT / "data/interim/subpipe", load_class_mapper(ROOT / "configs/classes.yaml"))
print(f"Canonical SubPipe frames: {len(frames)}")
