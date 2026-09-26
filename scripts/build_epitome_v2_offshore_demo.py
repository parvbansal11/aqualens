#!/usr/bin/env python3
"""Build the internal Epitome v2 bundle with clearly synthetic offshore navigation.

The source rasters, names, and archive order are copied unchanged. Only demo
metadata is replaced; it is never represented as image-derived navigation.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = Path.home() / "Desktop" / "Aqualens_Epitome_v2_RealSonar_FullFeature.zip"
DEFAULT_OUTPUT = ROOT / "data" / "runtime" / "demo" / "Aqualens_Epitome_v2_Offshore_Demo.zip"
NAVIGATION = ROOT / "tests" / "fixtures" / "epitome_v2_offshore_navigation.csv"


def build(source: Path, output: Path) -> None:
    rows = NAVIGATION.read_text()
    with ZipFile(source) as source_zip:
        names = source_zip.namelist()
        required = {"navigation.csv", "mission.json", "provenance.json", "bundle_manifest.json"}
        missing = required - set(names)
        if missing:
            raise ValueError(f"source bundle is missing: {', '.join(sorted(missing))}")
        mission = json.loads(source_zip.read("mission.json"))
        mission["survey_name"] = "Aqualens Epitome v2 Offshore Internal Demo"
        mission["notes"] = (
            "SYNTHETIC DEMO METADATA: navigation, timestamps, vehicle state and ping ranges "
            "exist only to exercise runtime map and persistence paths. They are not field measurements "
            "and are not derived from the sonar imagery."
        )
        provenance = json.loads(source_zip.read("provenance.json"))
        provenance["bundle"] = "Aqualens_Epitome_v2_Offshore_Demo"
        provenance["navigation_provenance"] = "SYNTHETIC_DEMO_METADATA"
        provenance["synthetic_navigation_area"] = "Arabian Sea, visibly offshore west of Mumbai"
        manifest = json.loads(source_zip.read("bundle_manifest.json"))
        manifest["bundle_version"] = "2.2-offshore-demo"
        manifest["bundle_name"] = "Aqualens_Epitome_v2_Offshore_Demo"
        readme = source_zip.read("README_DEMO_FLOW.txt").decode()
        readme += "\nOFFSHORE NAVIGATION\n--------------------\nThis bundle uses SYNTHETIC DEMO METADATA on a consistent offshore Arabian Sea track west of Mumbai. These coordinates are not derived from sonar imagery and are not field measurements.\n"
        replacements = {
            "navigation.csv": rows.encode(),
            "mission.json": (json.dumps(mission, indent=2) + "\n").encode(),
            "provenance.json": (json.dumps(provenance, indent=2) + "\n").encode(),
            "bundle_manifest.json": (json.dumps(manifest, indent=2) + "\n").encode(),
            "README_DEMO_FLOW.txt": readme.encode(),
        }
        output.parent.mkdir(parents=True, exist_ok=True)
        with ZipFile(output, "w", compression=ZIP_DEFLATED) as destination:
            for name in names:
                destination.writestr(name, replacements.get(name, source_zip.read(name)))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    build(args.source, args.output)
    print(args.output)


if __name__ == "__main__":
    main()
