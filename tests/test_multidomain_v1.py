import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("multidomain", ROOT / "scripts" / "build_multidomain_v1.py")
assert SPEC and SPEC.loader
multidomain = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(multidomain)


def test_ping_group_removes_augmentation_hash_and_keeps_recording():
    group, parent = multidomain.ping_group("Rec09_wcp_ss_port_00049_png_jpg.rf.abcdef.jpg")
    assert group == "ping_recording_rec9"
    assert parent == "Rec09_wcp_ss_port_00049_png_jpg"


def test_ai_image_mask_pairing_is_one_to_one():
    root = ROOT / "data/raw/ai4shipwrecks/dataset/AI4Shipwrecks"
    locations = (("train", root / "train"), ("test", root / "test"), ("extras_terrain", root / "extras/terrain"))
    images = {(split, path.name) for split, base in locations for path in (base / "images").glob("*.png")}
    masks = {(split, path.name) for split, base in locations for path in (base / "labels").glob("*.png")}
    assert len(images) == len(masks) == 286
    assert images == masks


def test_mask_box_derivation_has_positive_geometry():
    mask = next((ROOT / "data/raw/ai4shipwrecks/dataset/AI4Shipwrecks/train/labels").glob("*.png"))
    assert all(width > 0 and height > 0 for _x, _y, width, height in multidomain.mask_boxes(mask))


def test_group_assignment_never_splits_a_group():
    groups = {"a": [{"id": 1}, {"id": 2}], "b": [{"id": 3}], "c": [{"id": 4}]}
    assigned = multidomain.assign_groups(groups)
    assert set(assigned) == set(groups)
    assert set(assigned.values()) <= {"train", "val", "test"}


def test_canonical_manifest_and_yolo_export_integrity():
    snapshot = ROOT / "data/processed/multidomain_sonar_v1_20260831"
    rows = [__import__("json").loads(line) for line in (snapshot / "canonical/metadata.jsonl").read_text().splitlines()]
    assert {row["class_name"] for row in rows} == {"PIPELINE", "SHIPWRECK", "CRAB_POT"}
    assert all(row["class_id"] in {0, 1, 2} for row in rows)
    qa = __import__("json").loads((snapshot / "qa/qa.json").read_text())
    assert qa["assertions"]["cross_split_near_duplicates"] == "PASS"
    assert qa["assertions"]["augmentation_parent_leakage"] == "PASS"
    labels = list((snapshot / "kaggle_detection/labels").rglob("*.txt"))
    images = list((snapshot / "kaggle_detection/images").rglob("*.*"))
    assert len(labels) == len(images) == 98800


def test_v11_training_split_keeps_temporal_and_class_holds():
    import json
    snapshot = ROOT / "data/processed/multidomain_sonar_v1_1_20260831"
    rows = [json.loads(line) for line in (snapshot / "canonical/metadata.jsonl").read_text().splitlines()]
    subpipe = [row for row in rows if row["source_dataset"] == "SUBPIPE"]
    assert {row["source_group_id"] for row in subpipe if row["split"] == "train"} == {"subpipe_full_v11_temporal_train"}
    assert all(any(row["class_name"] == klass and row["split"] == split and row["bbox_xywh_px"] for row in rows) for klass in ("PIPELINE", "SHIPWRECK", "CRAB_POT") for split in ("train", "val", "test"))
