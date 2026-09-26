#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages"))
from sagar.core import load_class_mapper
from sagar.io import ingest_ai4shipwrecks

frames = ingest_ai4shipwrecks(ROOT / "data/raw/ai4shipwrecks/extracted", ROOT / "data/interim/ai4shipwrecks", load_class_mapper(ROOT / "configs/classes.yaml"))
print(f"Canonical AI4Shipwrecks frames: {len(frames)}")
