"""Export append-only review memory into training-preparation manifests; never trains."""
from __future__ import annotations
import argparse, json
from pathlib import Path
from sagar.memory.repository import ReviewRepository
def main() -> None:
    p=argparse.ArgumentParser(); p.add_argument("database"); p.add_argument("detections_json"); p.add_argument("output_dir"); a=p.parse_args()
    detections={x["detection_id"]:x for x in json.loads(Path(a.detections_json).read_text())}
    print(json.dumps(ReviewRepository(a.database).export_training_manifests(a.output_dir,detections),indent=2))
if __name__ == "__main__": main()
