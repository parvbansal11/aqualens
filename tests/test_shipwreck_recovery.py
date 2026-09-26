import importlib.util
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("shipdiag", ROOT / "scripts" / "diagnose_shipwreck_v1.py")
assert SPEC and SPEC.loader
shipdiag = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(shipdiag)


def test_component_parser_and_filtering(tmp_path, monkeypatch):
    root = tmp_path / "v11"; (root / "masks").mkdir(parents=True)
    a = np.zeros((20, 20), dtype=np.uint8); a[1:3, 1:3] = 255; a[5:19, 5:19] = 255
    Image.fromarray(a).save(root / "masks/a.png")
    monkeypatch.setattr(shipdiag, "V11", root)
    c = shipdiag.component_rows({"segmentation_mask_path":"masks/a.png","sample_id":"a","split":"train","source_group_id":"g","image_width":20,"image_height":20})
    assert len(c) == 2 and sum(x["kept_v12"] for x in c) == 0  # both are below the conservative 256px cutoff
    assert all(x["width"] > 0 and x["height"] > 0 and x["bbox_area"] >= x["component_area"] for x in c)


def test_train_only_sampling_manifest_and_experiment_a_has_no_test_payload():
    candidates = sorted((ROOT / "data/processed").glob("multidomain_sonar_v1_2_shipwreck_recovery_*"))
    if not candidates: return  # diagnostic not yet run in a fresh checkout
    out = candidates[-1]
    # The immutable snapshot contains mechanically regenerated sealed-test
    # labels; the recovery-tuning Experiment-A representation must not.
    assert (out / "kaggle_detection/images/test").exists()
    assert not (out / "kaggle_detection_3x/images/test").exists()
    assert not (out / "kaggle_detection_3x/labels/test").exists()
    assert all('"repeat_index"' in x for x in (out / "shipwreck_train_sampling_3x.jsonl").read_text().splitlines())


def test_group_integrity_and_validation_membership_are_preserved():
    candidates = sorted((ROOT / "data/processed").glob("multidomain_sonar_v1_2_shipwreck_recovery_*"))
    if not candidates: return
    import json
    candidate_rows = [json.loads(x) for x in (candidates[-1] / "canonical/metadata_trainval.jsonl").read_text().splitlines()]
    parent_rows = [json.loads(x) for x in (ROOT / "data/processed/multidomain_sonar_v1_1_20260831/canonical/metadata.jsonl").read_text().splitlines()]
    parent_split = {r["sample_id"]: r["split"] for r in parent_rows if r["split"] in {"train", "val"}}
    assert all(parent_split[r["sample_id"]] == r["split"] for r in candidate_rows)
    groups = {}
    for row in candidate_rows:
        groups.setdefault((row["source_dataset"], row["source_group_id"]), set()).add(row["split"])
    assert all(len(splits) == 1 for splits in groups.values())
