import hashlib
import json
from pathlib import Path
import numpy as np
import pytest
from sagar.vnext import SonarConditionEngine, fuse_contact_confidence, fuse_contacts, normalize_demo_confidence, score_contact
from sagar.vnext.interfaces import ModelRegistry
from sagar.vnext.openset import OpenSetEvidence, OpenSetMemoryBank
from sagar.vnext.physics import verify_candidate, verify_pipeline_acoustics
from sagar.mission.change import compare_detections
from sagar.core.models import SpatialReferenceLevel, ChangeStatus

def finding(identifier, frame, confidence=.5):
    return {"detection_id":identifier,"source_frame_id":f"f{frame}","frame_index":frame,"raw_class":"PIPELINE","raw_confidence":confidence,"bbox_px":[64.,64.,128.,128.],"bbox_normalized":[.1,.1,.2,.2],"pixel_dimensions":[640,640],"geo":{"lat":None,"lon":None},"model_sha256":"sha"}

def on_verified_axis(item, start, end, survey="survey.verified.f0"):
    """Round-2 A7: Frames relate only on a VERIFIED Survey's pixel-derived (DERIVED_FROM_SOURCE) ping
    axis, which ingest records on each Observation; declared ping bounds relate nothing."""
    item.update({"survey_ref": survey, "survey_membership_provenance": "VERIFIED", "ping_relationship_provenance": "DERIVED_FROM_SOURCE",
                 "survey_ping_start": start, "survey_ping_end": end, "sequential_observation_supported": True})
    return item

def test_contact_association_preserves_raw_confidence_and_persistence():
    raw=[finding("a",0,.4),finding("b",1,.8)]
    on_verified_axis(raw[0], 100, 199); on_verified_axis(raw[1], 200, 299)
    contact=fuse_contacts(raw,"survey")[0]
    assert contact["observation_count"] == 2 and contact["max_raw_confidence"] == .8
    assert raw[0]["raw_confidence"] == .4 and contact["persistence_score"] > .15

def test_single_observation_penalty_and_missing_evidence_are_explicit():
    contact=fuse_contacts([finding("a",0)],"survey")[0]
    result=score_contact(contact)
    assert contact["persistence_score"] == .15 and "physics" in result["missing_components"]

def test_condition_and_unknown_physics_are_honest():
    image=np.zeros((30,40),dtype=np.uint8); image[10:12]=255
    condition=SonarConditionEngine().assess(image)
    assert "HORIZONTAL_DARK_BAND" in condition["quality_flags"]
    assert verify_candidate(image,[2,2,8,8],None,condition)["physics_consistency"] is None

def test_openset_never_declares_known_class_and_optional_absence_is_safe():
    evidence=OpenSetEvidence(anomaly_score=.9, threshold=.8)
    assert evidence.is_open_set_candidate and ModelRegistry(False).health()["rfdetr"]["available"] is False

def test_open_set_artifact_is_frozen_provenance_and_score_is_deterministic():
    root = Path(__file__).parents[1]
    artifact = root / "ml/artifacts/vnext/open_set_v1"
    bank = OpenSetMemoryBank.load(artifact)
    config = json.loads((artifact / "config.json").read_text())
    assert config["test_set_used"] is False
    assert config["feature_extractor_sha256"] == "2aa3ac71051856bcfc8ec400804995f03568aa26d1a1fb24583e4eb1b7a10b15"
    query = bank.embeddings[0]
    assert bank.score(query) == bank.score(query)
    evidence = bank.evidence(query)
    assert evidence["status"] == "AVAILABLE"
    assert evidence["is_open_set_candidate"] is False
    assert evidence["anomaly_score"] == 0.0

def test_distant_incompatible_nonconsecutive_and_duplicate_observations():
    distant=finding("distant",1); distant["bbox_normalized"]=[.7,.7,.8,.8]
    other=finding("class",1); other["raw_class"]="CRAB_POT"
    late=finding("late",5)
    assert len(fuse_contacts([finding("a",0),distant],"s")) == 2
    assert len(fuse_contacts([finding("a",0),other],"s")) == 2
    assert len(fuse_contacts([finding("a",0),late],"s")) == 2
    duplicate=finding("a",0)
    assert fuse_contacts([finding("a",0),duplicate],"s")[0]["observation_count"] == 1

def test_window_overlap_within_one_frame_is_not_temporal_persistence():
    # Two detections sharing the SAME frame_index simulate overlapping tiles of one
    # static raster (e.g. an object straddling a tile boundary), not independent
    # sequential pings. This must never be scored as true multi-frame persistence.
    # Round-2 A2: only tiled detections from different tiles can be duplicates of one object.
    tile_a=finding("tile_a",3); tile_b=finding("tile_b",3); tile_b["bbox_normalized"]=[.11,.11,.21,.21]
    tile_a.update({"inference_mode":"TILED","tile_id":"tile_r00_c00_x00000_y00000"})
    tile_b.update({"inference_mode":"TILED","tile_id":"tile_r00_c01_x00538_y00000"})
    contact=fuse_contacts([tile_a,tile_b],"survey")[0]
    assert contact["observation_count"] == 2
    assert contact["distinct_frame_observation_count"] == 1
    assert contact["window_overlap_duplicate_count"] == 1
    assert contact["persistence_evidence_type"] == "WINDOW_OVERLAP_ONLY"
    assert contact["persistence_score"] == .15
    # Genuine cross-frame observations (different frame_index) remain true persistence.
    x,y=on_verified_axis(finding("x",0),100,199),on_verified_axis(finding("y",1),200,299)
    cross=fuse_contacts([x,y],"survey")[0]
    assert cross["persistence_evidence_type"] == "SEQUENTIAL_PING"
    assert cross["persistence_score"] > .15

def test_navigation_association_and_stable_ids():
    # Round-2 A3: this test previously asserted that frame fixes ~1.5 m apart merge two
    # non-sequential Frames, which is defect KD-1. Frame-level navigation never associates
    # Frames (spec I-A6, A-AC10); Contact ids stay deterministic.
    a,b=finding("a",0),finding("b",1); a["geo"]={"lat":10.,"lon":20.}; b["geo"]={"lat":10.00001,"lon":20.00001}
    one=fuse_contacts([a,b],"s"); two=fuse_contacts([a,b],"s")
    assert [c["observation_count"] for c in one] == [1, 1]
    assert [c["contact_id"] for c in one] == [c["contact_id"] for c in two]

def test_condition_matrix_and_candidate_overlap():
    normal=np.tile(np.arange(50,dtype=np.uint8),(40,1)); engine=SonarConditionEngine()
    assert engine.assess(normal)["motion_quality"] == "UNKNOWN"
    black=engine.assess(np.zeros((40,50),dtype=np.uint8)); assert "HIGH_INVALID_PIXEL_FRACTION" in black["quality_flags"]
    bands=np.full((40,50),120,dtype=np.uint8); bands[10:12]=0; bands[25:27]=0
    q=engine.assess(bands); assert "HORIZONTAL_DARK_BAND" in q["quality_flags"]
    assert engine.candidate_overlap([1,10,10,12],bands.shape,q)["dropout_overlap"] == 1
    central=np.full((40,50),120,dtype=np.uint8); central[:,23:27]=0; cq=engine.assess(central)
    assert cq["nadir_fraction"] > 0 and engine.candidate_overlap([23,1,27,4],central.shape,cq)["nadir_overlap"] == 1

def test_physics_deterministic_and_non_artificiality_claim():
    image=np.full((30,40),100,dtype=np.uint8); image[10:15,20:24]=220; image[10:15,24:30]=20
    condition=SonarConditionEngine().assess(image)
    a=verify_candidate(image,[20,10,24,15],10,condition); b=verify_candidate(image,[20,10,24,15],10,condition)
    assert a == b and "SHADOW_IS_NOT_ARTIFICIALITY" in a["physics_flags"]
    assert verify_candidate(image,[20,10,24,15],None,condition)["reason"] == "SONAR_ORIENTATION_UNAVAILABLE"

def test_dark_pipeline_candidate_is_not_silently_changed_or_supported():
    image=np.full((80,120),120,dtype=np.uint8); image[20:60,40:50]=5
    raw={"raw_class":"PIPELINE","raw_confidence":.35,"bbox_px":[40,20,50,60]}
    evidence=verify_pipeline_acoustics(image,raw["bbox_px"])
    assert raw == {"raw_class":"PIPELINE","raw_confidence":.35,"bbox_px":[40,20,50,60]}
    assert evidence["status"] != "SUPPORTED" and "DARK_CANDIDATE_WITHOUT_COHERENT_HARD_RETURN" in evidence["reasons"]

def test_pipeline_hard_return_and_missing_raster_are_explicit():
    image=np.full((80,120),90,dtype=np.uint8); image[20:60,40:50]=220
    assert verify_pipeline_acoustics(image,[40,20,50,60])["status"] == "SUPPORTED"
    assert verify_pipeline_acoustics(None,[1,1,8,8])["status"] == "INSUFFICIENT_EVIDENCE"

def test_insufficient_pipeline_evidence_is_neutral_not_negative_physics():
    raw = {"raw_class": "PIPELINE", "raw_confidence": .3075626790523529, "bbox_px": [1, 1, 12, 20]}
    verification = verify_pipeline_acoustics(np.full((40, 40), 100, dtype=np.uint8), raw["bbox_px"])
    assert verification["status"] == "INSUFFICIENT_EVIDENCE"
    assert verification["hard_return_status"] == "NOT_OBSERVED"
    assert verification["shadow_status"] == "UNAVAILABLE"
    assert raw == {"raw_class": "PIPELINE", "raw_confidence": .3075626790523529, "bbox_px": [1, 1, 12, 20]}
    contact = fuse_contacts([finding("a", 0, raw["raw_confidence"])], "survey")[0]
    contact.update({"quality_score": .8, "physics_consistency": .01, "pipeline_verification": verification})
    fused = score_contact(contact)
    assert "physics" in fused["missing_components"]
    assert "physics" not in fused["components"]
    assert contact["max_raw_confidence"] == raw["raw_confidence"]

def test_evidence_renormalization_and_raw_confidence_immutable():
    c=fuse_contacts([finding("a",0,.63)],"s")[0]; c.update({"quality_score":.8,"physics_consistency":None})
    result=score_contact(c)
    assert result["components"]["detector"]["normalized_weight"] > result["components"]["detector"]["weight"]
    assert c["max_raw_confidence"] == .63 and result["score_type"] == "UNVALIDATED_EVIDENCE_FUSION"


def test_contact_confidence_is_bounded_deterministic_and_preserves_raw_score():
    contact = fuse_contacts([finding("a", 0, .63)], "s")[0]
    contact.update({"quality_score": .8, "physics_consistency": None})
    first = fuse_contact_confidence(contact)
    second = fuse_contact_confidence(contact)
    assert first == second
    assert 0.70 < first["normalized_confidence"] < 0.90
    assert first["confidence"] == first["normalized_confidence"]
    assert first["raw_fused_confidence"] < first["normalized_confidence"]
    assert first["confidence_method"] == "CONTACT_EVIDENCE_FUSION_V1"
    assert first["confidence_normalization"] == "DEMO_BOUNDED_SIGMOID_V1"
    assert first["confidence_normalization_range"] == [.70, .90]
    assert first["raw_detector_confidence"] == .63
    assert contact["max_raw_confidence"] == .63
    assert json.loads(json.dumps(first))["raw_fused_confidence"] == first["raw_fused_confidence"]


def test_contact_confidence_is_monotonic_for_supporting_evidence():
    contact = fuse_contacts([finding("a", 0, .4)], "s")[0]
    low = fuse_contact_confidence(contact)
    contact["quality_score"] = .8
    conditioned = fuse_contact_confidence(contact)
    contact["persistence_score"] = .85
    persistent = fuse_contact_confidence(contact)
    contact["pipeline_verification"] = {"status": "SUPPORTED", "evidence_strength": .9}
    acoustic = fuse_contact_confidence(contact)
    assert low["raw_fused_confidence"] <= conditioned["raw_fused_confidence"] <= persistent["raw_fused_confidence"] <= acoustic["raw_fused_confidence"]
    assert low["normalized_confidence"] < conditioned["normalized_confidence"] < persistent["normalized_confidence"] < acoustic["normalized_confidence"]


def test_contact_confidence_missing_channels_are_neutral_and_open_set_is_advisory():
    contact = fuse_contacts([finding("a", 0, .5)], "s")[0]
    missing = fuse_contact_confidence(contact)
    contact["anomaly_score"] = .2
    contact["anomaly_threshold"] = .8
    below_open_set_threshold = fuse_contact_confidence(contact)
    assert missing["raw_fused_confidence"] == below_open_set_threshold["raw_fused_confidence"]
    assert missing["normalized_confidence"] == below_open_set_threshold["normalized_confidence"]
    assert missing["confidence_components"]["acoustic_shadow"]["available"] is False
    assert below_open_set_threshold["confidence_components"]["open_set_anomaly"]["role"] == "ADVISORY_OPEN_SET_EVIDENCE"


def test_unknown_contact_class_is_never_changed_by_confidence_fusion():
    contact = fuse_contacts([finding("a", 0, .8)], "s")[0]
    contact["resolved_class"] = "UNKNOWN"
    contact["candidate_classes"] = ["UNKNOWN"]
    result = fuse_contact_confidence(contact)
    assert result["normalized_confidence"] > .70
    assert contact["resolved_class"] == "UNKNOWN"


def test_multi_observation_persistence_increases_contact_confidence():
    single = fuse_contacts([finding("a", 0, .5)], "s")[0]
    first, second = finding("a", 0, .5), finding("b", 1, .5)
    for item, start, end in ((first, 100, 199), (second, 200, 299)):
        on_verified_axis(item, start, end)
    sequential = fuse_contacts([first, second], "s")[0]
    assert fuse_contact_confidence(sequential)["raw_fused_confidence"] > fuse_contact_confidence(single)["raw_fused_confidence"]


def test_demo_normalization_is_strictly_monotonic_bounded_and_has_no_randomness():
    raw_values = [.2374133673091056, .3139777305538386, .7736724150538692]
    normalized = [normalize_demo_confidence(value) for value in raw_values]
    assert all(.70 < value < .90 for value in normalized)
    assert normalized == sorted(normalized)
    assert len(set(normalized)) == len(normalized)
    assert normalized == [normalize_demo_confidence(value) for value in raw_values]


def test_epitome_v2_normalization_regression_median_is_demo_center():
    # Raw fused values materialized by the Epitome v2 regression upload. They
    # exercise only the global transformation; no Contact IDs/classes are used.
    raw_values = sorted([.2374133673091056, .3139777305538386, .7736724150538692])
    normalized = sorted(normalize_demo_confidence(value) for value in raw_values)
    assert .70 <= normalized[0] <= .74
    assert normalized[1] == pytest.approx(.80)
    assert .85 <= normalized[1] + .8 * (normalized[2] - normalized[1]) <= .90
    assert normalized[-1] < .90

def test_change_absence_is_not_removed_without_explicit_coverage():
    old={"detection_id":"old","review":{}}
    _, no_coverage=compare_detections("a","b",SpatialReferenceLevel.L2_TRACK_RELATIVE,SpatialReferenceLevel.L2_TRACK_RELATIVE,[old],[])
    _, covered=compare_detections("a","b",SpatialReferenceLevel.L2_TRACK_RELATIVE,SpatialReferenceLevel.L2_TRACK_RELATIVE,[old],[],coverage_by_baseline_id={"old":True})
    _, matched=compare_detections("a","b",SpatialReferenceLevel.L2_TRACK_RELATIVE,SpatialReferenceLevel.L2_TRACK_RELATIVE,[old],[{"detection_id":"new","matched_baseline_id":"old"}])
    _, new=compare_detections("a","b",SpatialReferenceLevel.L2_TRACK_RELATIVE,SpatialReferenceLevel.L2_TRACK_RELATIVE,[],[{"detection_id":"new"}])
    assert no_coverage[0].status is ChangeStatus.NOT_SURVEYED
    assert covered[0].status is ChangeStatus.NOT_DETECTED
    assert matched[0].status is ChangeStatus.UNCHANGED and new[0].status is ChangeStatus.NEW

def test_unrelated_frames_cannot_gain_sequential_persistence():
    contacts=fuse_contacts([finding("a",0),finding("b",1)],"s")
    assert len(contacts) == 2
    assert all(contact["persistence_evidence_type"] == "SINGLE_OBSERVATION" for contact in contacts)
    assert all(contact["persistence_score"] == .15 for contact in contacts)

def test_declared_ping_order_not_filename_or_frame_order_controls_persistence():
    # Deliberately reverse frame indices: the ping axis (since A7, the verified Survey axis),
    # not file order, establishes first/last observation and sequential support.
    later, earlier = finding("later", 0), finding("earlier", 9)
    for item, start, end in ((later, 200, 299), (earlier, 100, 199)):
        on_verified_axis(item, start, end)["geo"] = {"lat": 18.0, "lon": 72.0}
    contact = fuse_contacts([later, earlier], "survey")[0]
    assert contact["persistence_evidence_type"] == "SEQUENTIAL_PING"
    assert contact["first_ping"] == 100 and contact["last_ping"] == 299

def test_declared_sequence_without_ping_bounds_remains_unavailable():
    # Round-2 A3: without ping bounds there is no ping relationship, so the Frames are not
    # associated at all. The earlier expectation (one Contact with UNKNOWN persistence) relied
    # on frame-index adjacency, which no longer associates Frames.
    a, b = finding("a", 0), finding("b", 1)
    a["sequential_observation_supported"] = b["sequential_observation_supported"] = True
    contacts = fuse_contacts([a, b], "survey")
    assert [c["observation_count"] for c in contacts] == [1, 1]
    assert all(c["persistence_evidence_type"] == "SINGLE_OBSERVATION" for c in contacts)
    assert all(c["persistence_score"] == .15 for c in contacts)

def test_rejected_clutter_is_serialized_advisory_and_never_a_veto():
    contact=fuse_contacts([finding("a",0,.61)],"s")[0]
    clutter=contact["natural_clutter"]
    assert clutter["status"] == "REJECTED_FOR_AUTOMATIC_SUPPRESSION"
    assert clutter["mode"] == "ADVISORY_ONLY" and clutter["score"] is None
    result=score_contact(contact)
    assert "artificiality" not in result["components"]
    assert contact["max_raw_confidence"] == .61
    health=ModelRegistry(False).health()["natural_clutter"]
    assert health["automatic_veto_permitted"] is False

# --- Round-2 ticket A1: Contact association regression characterization -------------
# Each test asserts the outcome required by docs/ROUND2_HARDENING_SPEC.md Workstream A.

PING_FRAME = (640, 640)          # FULL_FRAME PING raster (retained survey_upload_c4c56e532038)
SUBPIPE_FRAME = (5000, 500)      # tiled wide waterfall: 768-px tiles, origins 0, 538, ..., 1614, 2152, ...
CASE1_BOXES = ((113, 103, 199, 207), (457, 32, 532, 126))   # two crab pots, centres 338 px apart in x
CASE1_FIX = (14.99584, 84.005324)

def a1_observation(frame_index, number, box_px, frame=PING_FRAME, fix=None, mode="FULL_FRAME",
                   tile_id=None, raw_class="CRAB_POT"):
    """An Observation shaped like the runtime's (ids derive from the processing position)."""
    width, height = frame; x1, y1, x2, y2 = box_px
    return {"detection_id": f"det_a1_frame_{frame_index:04d}_{number:04d}", "source_frame_id": f"frame_{frame_index:04d}",
            "frame_index": frame_index, "raw_class": raw_class, "raw_confidence": .3, "bbox_px": list(box_px),
            "bbox_normalized": [x1 / width, y1 / height, x2 / width, y2 / height], "pixel_dimensions": [width, height],
            "inference_mode": mode, "tile_id": tile_id, "geo": {"lat": fix[0], "lon": fix[1]} if fix else {"lat": None, "lon": None},
            "sequential_observation_supported": False, "model_sha256": "sha"}

def a1_case1():
    return [a1_observation(0, n, box, fix=CASE1_FIX) for n, box in enumerate(CASE1_BOXES)]

def a1_case2():
    return [a1_observation(0, n, box) for n, box in enumerate(CASE1_BOXES)]

def a1_case3():
    # Two Frames, frame-level fixes ~20 m apart, unrelated image positions, no declared sequence.
    return [a1_observation(0, 0, (10, 10, 60, 60), fix=(15.0, 84.0)),
            a1_observation(1, 0, (580, 580, 630, 630), fix=(15.00018, 84.0))]

def a1_tile_duplicate():
    # One object straddling the right edge of tile c00 (x 0-768): truncated there, whole on tile c01
    # (x 538-1306). IoU 0.34 survives the runtime's 0.45 cross-tile NMS.
    return [a1_observation(0, 0, (700, 100, 768, 200), SUBPIPE_FRAME, mode="TILED",
                           tile_id="tile_r00_c00_x00000_y00000", raw_class="PIPELINE"),
            a1_observation(0, 1, (700, 100, 900, 200), SUBPIPE_FRAME, mode="TILED",
                           tile_id="tile_r00_c01_x00538_y00000", raw_class="PIPELINE")]

def a1_nearby_distinct_wide_frame():
    # Two distinct objects on different tiles, 400 px apart (0.08 of the frame width), no overlap.
    return [a1_observation(0, 0, (2000, 100, 2060, 400), SUBPIPE_FRAME, mode="TILED",
                           tile_id="tile_r00_c03_x01614_y00000", raw_class="PIPELINE"),
            a1_observation(0, 1, (2400, 100, 2460, 400), SUBPIPE_FRAME, mode="TILED",
                           tile_id="tile_r00_c04_x02152_y00000", raw_class="PIPELINE")]

def a1_memberships(contacts):
    return sorted(sorted(contact["source_detection_ids"]) for contact in contacts)

def a1_describe(contacts):
    return [(contact["source_detection_ids"], contact["persistence_evidence_type"]) for contact in contacts]

def test_a1_same_frame_distinct_objects_with_frame_fix_stay_separate_contacts():
    # Spec A-AC1 (CASE 1): each FULL_FRAME box is its own Contact, a single Observation.
    observations = a1_case1()
    contacts = fuse_contacts(observations, "s")
    assert a1_memberships(contacts) == [[item["detection_id"]] for item in observations], a1_describe(contacts)
    assert all(contact["persistence_evidence_type"] == "SINGLE_OBSERVATION" for contact in contacts), a1_describe(contacts)

def test_a1_same_frame_distinct_objects_without_navigation_stay_separate_contacts():
    # Spec A-AC2 (CASE 2): the same boxes with no navigation.
    observations = a1_case2()
    contacts = fuse_contacts(observations, "s")
    assert a1_memberships(contacts) == [[item["detection_id"]] for item in observations], a1_describe(contacts)
    assert all(contact["persistence_evidence_type"] == "SINGLE_OBSERVATION" for contact in contacts), a1_describe(contacts)

def test_a1_unrelated_frames_with_nearby_frame_fixes_stay_separate_contacts():
    # Spec A-AC3 (CASE 3): frame-level fixes never associate Frames (I-A6).
    observations = a1_case3()
    contacts = fuse_contacts(observations, "s")
    assert a1_memberships(contacts) == [[item["detection_id"]] for item in observations], a1_describe(contacts)

def test_a1_nearby_distinct_objects_on_wide_frame_without_navigation_stay_separate_contacts():
    # Spec A req 1 / I-A1: non-overlapping boxes on one Frame are not tile-overlap duplicates.
    observations = a1_nearby_distinct_wide_frame()
    contacts = fuse_contacts(observations, "s")
    assert a1_memberships(contacts) == [[item["detection_id"]] for item in observations], a1_describe(contacts)

def test_a1_tile_overlap_duplicate_of_one_object_is_one_contact():
    # Spec A-AC4 (count only; the association basis arrives with ticket A4).
    observations = a1_tile_duplicate()
    contacts = fuse_contacts(observations, "s")
    assert a1_memberships(contacts) == [sorted(item["detection_id"] for item in observations)], a1_describe(contacts)

def a1_reversed_upload(observations):
    """Upload order reaches this seam only as input order and frame_index (the processing
    position). Observation identity (detection and frame ids) is held fixed."""
    last = max(item["frame_index"] for item in observations)
    return [{**item, "frame_index": last - item["frame_index"]} for item in reversed(observations)]

@pytest.mark.parametrize("scenario", [
    pytest.param(a1_case1, id="case1"),
    pytest.param(a1_case2, id="case2"),
    pytest.param(a1_case3, id="case3"),
    pytest.param(a1_nearby_distinct_wide_frame, id="nearby_distinct_wide_frame"),
    pytest.param(a1_tile_duplicate, id="tile_duplicate"),
])
def test_a1_reversed_upload_order_yields_identical_contact_ids_and_memberships(scenario):
    # Spec A-AC7 / I-A5.
    forward = fuse_contacts(scenario(), "s")
    reversed_order = fuse_contacts(a1_reversed_upload(scenario()), "s")
    assert (sorted((contact["contact_id"], sorted(contact["source_detection_ids"])) for contact in reversed_order)
            == sorted((contact["contact_id"], sorted(contact["source_detection_ids"])) for contact in forward))

# --- Round-2 ticket A2: same-Frame association merges only tile-overlap duplicates -----
# Boxes on SUBPIPE_FRAME; tile c00 spans x 0-768 and tile c01 spans x 538-1306.

TILE_C00, TILE_C01 = "tile_r00_c00_x00000_y00000", "tile_r00_c01_x00538_y00000"

def a2_pair(box_a, box_b, tile_a=TILE_C00, tile_b=TILE_C01, mode_a="TILED", mode_b="TILED"):
    return [a1_observation(0, 0, box_a, SUBPIPE_FRAME, mode=mode_a, tile_id=tile_a, raw_class="PIPELINE"),
            a1_observation(0, 1, box_b, SUBPIPE_FRAME, mode=mode_b, tile_id=tile_b, raw_class="PIPELINE")]

def a2_separate(observations):
    return [[item["detection_id"]] for item in observations]

def a2_merged(observations):
    return [sorted(item["detection_id"] for item in observations)]

def test_a2_different_tile_iou_duplicate_is_one_contact():
    # IoU 48/152 = 0.316 >= 0.30; neither centre (x 650, x 702) lies inside the other box.
    observations = a2_pair((600, 100, 700, 200), (652, 100, 752, 200))
    assert a1_memberships(fuse_contacts(observations, "s")) == a2_merged(observations)

def test_a2_different_tile_centre_inside_duplicate_is_one_contact():
    # Truncated at the c00 edge vs whole on c01: IoU 28/200 = 0.14, truncated centre x 754 inside.
    observations = a2_pair((740, 100, 768, 200), (700, 100, 900, 200))
    assert a1_memberships(fuse_contacts(observations, "s")) == a2_merged(observations)

def test_a2_same_tile_tiled_observations_stay_separate_contacts():
    # Duplicate geometry (IoU 0.34, centre inside) but one tile: two predictions, two hypotheses.
    observations = a2_pair((700, 100, 768, 200), (700, 100, 900, 200), tile_a=TILE_C01)
    assert a1_memberships(fuse_contacts(observations, "s")) == a2_separate(observations)

def a2_missing_inference_mode():
    observations = a2_pair((700, 100, 768, 200), (700, 100, 900, 200))
    for item in observations:
        del item["inference_mode"]
    return observations

@pytest.mark.parametrize("scenario", [
    pytest.param(a2_missing_inference_mode, id="missing_inference_mode"),
    pytest.param(lambda: a2_pair((700, 100, 768, 200), (700, 100, 900, 200), tile_b=None, mode_b="FULL_FRAME"),
                 id="tiled_with_full_frame"),
    pytest.param(lambda: a2_pair((700, 100, 768, 200), (700, 100, 900, 200), tile_b=None), id="missing_tile_id"),
])
def test_a2_observations_not_established_as_tile_duplicates_stay_separate_contacts(scenario):
    # Duplicate geometry is not enough when tiled inference on different tiles is not established.
    observations = scenario()
    assert a1_memberships(fuse_contacts(observations, "s")) == a2_separate(observations)

def test_a2_declared_sequence_does_not_merge_same_frame_non_duplicates():
    # Frame-level acquisition metadata is not same-Frame association evidence.
    observations = a1_nearby_distinct_wide_frame()
    for item in observations:
        item.update({"sequential_observation_supported": True, "ping_start": 0, "ping_end": 499})
    assert a1_memberships(fuse_contacts(observations, "s")) == a2_separate(observations)

# --- Round-2 ticket A3: cross-Frame association rule ---------------------------------
# Different Frames associate only when both carry ping bounds that overlap or are directly
# contiguous. Since A7 those bounds are the verified Survey ping axis (on_verified_axis): overlapping
# windows need their mapped boxes to overlap, and contiguous windows need Slant-range (column)
# positions within max(0.25·min(w₁, w₂), 20 px). PIPE is 60 px wide, so its tolerance is 20 px.

PIPE = (2000, 0, 2060, 500)

def a3_observation(frame_index, pings, box_px=PIPE, frame=SUBPIPE_FRAME, fix=None, sequential=True):
    item = a1_observation(frame_index, 0, box_px, frame, fix=fix, mode="TILED",
                          tile_id="tile_r00_c03_x01614_y00000", raw_class="PIPELINE")
    item["sequential_observation_supported"] = sequential
    if pings:
        item.update({"ping_start": pings[0], "ping_end": pings[1]})
        if sequential:
            on_verified_axis(item, *pings)  # A7: the relationship is the verified Survey axis
    return item

def a3_at_positions(observations, positions):
    """Same Observations (ids fixed), processed at different positions (filename order)."""
    return [{**item, "frame_index": position} for item, position in zip(observations, positions)]

def a3_pipeline_pass():
    return [a3_observation(0, (0, 499)), a3_observation(1, (500, 999)), a3_observation(2, (1000, 1499))]

def test_a3_different_frames_with_identical_fixes_and_no_declared_sequence_stay_separate():
    observations = [a3_observation(0, None, fix=CASE1_FIX, sequential=False),
                    a3_observation(1, None, fix=CASE1_FIX, sequential=False)]
    assert a1_memberships(fuse_contacts(observations, "s")) == a2_separate(observations)

def test_a3_adjacent_frames_with_a_ping_gap_stay_separate():
    observations = [a3_observation(0, (0, 499)), a3_observation(1, (600, 1099))]
    assert a1_memberships(fuse_contacts(observations, "s")) == a2_separate(observations)

@pytest.mark.parametrize("pings", [pytest.param((20, 519), id="overlapping"), pytest.param((500, 999), id="contiguous")])
def test_a3_declared_ping_relationship_with_slant_range_match_is_one_contact(pings):
    # Positions 0 and 5 are deliberately not adjacent: pings, not frame index, relate the Frames.
    # Centres x 2030 and x 2040: 10 px apart, within 20 px.
    observations = [a3_observation(0, (0, 499)), a3_observation(5, pings, box_px=(2010, 0, 2070, 500))]
    assert a1_memberships(fuse_contacts(observations, "s")) == a2_merged(observations)

@pytest.mark.parametrize("pings", [pytest.param((20, 519), id="overlapping"), pytest.param((500, 999), id="contiguous")])
def test_a3_declared_ping_relationship_with_slant_range_mismatch_stays_separate(pings):
    # Centres 100 px apart: beyond max(0.25*60, 20) = 20 px, though only 0.02 of the frame width.
    observations = [a3_observation(0, (0, 499)), a3_observation(1, pings, box_px=(2100, 0, 2160, 500))]
    assert a1_memberships(fuse_contacts(observations, "s")) == a2_separate(observations)

def test_a3_slant_range_tolerance_scales_with_box_width():
    # 200-px-wide boxes: tolerance max(0.25*200, 20) = 50 px; centres 40 px apart match.
    observations = [a3_observation(0, (0, 499), box_px=(2000, 0, 2200, 500)),
                    a3_observation(5, (500, 999), box_px=(2040, 0, 2240, 500))]
    assert a1_memberships(fuse_contacts(observations, "s")) == a2_merged(observations)

def test_a3_frames_of_different_raster_width_never_associate():
    # Pixel columns are a common Slant-range axis only within one raster geometry.
    observations = [a3_observation(0, (0, 499)), a3_observation(1, (500, 999), frame=(4000, 500))]
    assert a1_memberships(fuse_contacts(observations, "s")) == a2_separate(observations)

def test_a3_reversed_processing_order_yields_identical_contacts():
    forward = fuse_contacts(a3_pipeline_pass(), "s")
    reversed_order = fuse_contacts(a1_reversed_upload(a3_pipeline_pass()), "s")
    assert a1_memberships(forward) == [sorted(item["detection_id"] for item in a3_pipeline_pass())]
    assert ([(c["contact_id"], sorted(c["source_detection_ids"])) for c in reversed_order]
            == [(c["contact_id"], sorted(c["source_detection_ids"])) for c in forward])

def test_a3_filename_order_does_not_change_contacts():
    # Filenames "img_10" < "img_11" < "img_9" put the first pings last in processing order.
    ping_ordered = fuse_contacts(a3_pipeline_pass(), "s")
    filename_ordered = fuse_contacts(a3_at_positions(a3_pipeline_pass(), [2, 0, 1]), "s")
    assert ([(c["contact_id"], sorted(c["source_detection_ids"])) for c in filename_ordered]
            == [(c["contact_id"], sorted(c["source_detection_ids"])) for c in ping_ordered])

def a3_without_fixes(observations):
    return [{**item, "geo": {"lat": None, "lon": None}} for item in observations]

def a3_with_one_shared_fix(observations):
    return [{**item, "geo": {"lat": CASE1_FIX[0], "lon": CASE1_FIX[1]}} for item in observations]

@pytest.mark.parametrize("scenario", [
    pytest.param(a1_case1, id="case1"),
    pytest.param(a1_case3, id="case3"),
    pytest.param(lambda: [a3_observation(0, (0, 499)), a3_observation(1, (600, 1099))], id="ping_gap"),
    pytest.param(a3_pipeline_pass, id="pipeline_pass"),
])
def test_a3_frame_level_navigation_never_changes_memberships(scenario):
    as_given = a1_memberships(fuse_contacts(scenario(), "s"))
    assert a1_memberships(fuse_contacts(a3_without_fixes(scenario()), "s")) == as_given
    assert a1_memberships(fuse_contacts(a3_with_one_shared_fix(scenario()), "s")) == as_given

# --- Round-2 ticket A4: association basis and Look count ---------------------------
# Look semantics (spec Q8, A req 5): tile-overlap duplicates and overlapping ping windows
# are one Look; ping-contiguous disjoint windows are independent Looks.

def test_a4_single_observation_has_single_basis_and_one_look():
    contact = fuse_contacts([finding("a", 0)], "survey")[0]
    assert contact["association_basis"] == "SINGLE"
    assert contact["look_count"] == 1

def test_a4_tile_overlap_duplicate_basis_is_one_look():
    observations = a1_tile_duplicate()
    contact = fuse_contacts(observations, "s")[0]
    assert contact["association_basis"] == "TILE_OVERLAP_DUPLICATE"
    assert contact["look_count"] == 1
    assert contact["persistence_evidence_type"] == "WINDOW_OVERLAP_ONLY"

def test_a4_overlapping_ping_ranges_are_one_same_look_contact():
    # Same fixture as test_a3_declared_ping_relationship_with_slant_range_match_is_one_contact
    # (overlapping case): this is re-reading the same pings, not persistence (spec Q8).
    observations = [a3_observation(0, (0, 499)), a3_observation(5, (20, 519), box_px=(2010, 0, 2070, 500))]
    contact = fuse_contacts(observations, "s")[0]
    assert contact["association_basis"] == "SAME_LOOK_OVERLAPPING_WINDOWS"
    assert contact["look_count"] == 1
    assert contact["persistence_evidence_type"] == "WINDOW_OVERLAP_ONLY"
    assert contact["persistence_score"] == .15

def test_a4_contiguous_disjoint_ping_ranges_are_independent_looks():
    observations = [a3_observation(0, (0, 499)), a3_observation(5, (500, 999), box_px=(2010, 0, 2070, 500))]
    contact = fuse_contacts(observations, "s")[0]
    assert contact["association_basis"] == "INDEPENDENT_LOOKS_ALONG_TRACK"
    assert contact["look_count"] == 2
    assert contact["persistence_evidence_type"] == "SEQUENTIAL_PING"
    assert contact["persistence_score"] > .15

def test_a4_mixed_contact_counts_independent_looks_not_frames_or_observations():
    # Two Observations are a same-Frame tile-overlap duplicate (one Look); the third is a
    # ping-contiguous independent Look chained off the second. 3 Observations, 2 Looks.
    dup1, dup2 = a1_tile_duplicate()
    for item in (dup1, dup2):
        on_verified_axis(item, 0, 499)
    third = a3_observation(1, (500, 999), box_px=(770, 100, 870, 200))
    contacts = fuse_contacts([dup1, dup2, third], "s")
    assert a1_memberships(contacts) == [sorted(item["detection_id"] for item in (dup1, dup2, third))]
    assert contacts[0]["look_count"] == 2

@pytest.mark.parametrize("scenario", [
    pytest.param(a1_tile_duplicate, id="tile_duplicate"),
    pytest.param(lambda: [a3_observation(0, (0, 499)), a3_observation(5, (20, 519), box_px=(2010, 0, 2070, 500))],
                 id="overlapping_windows"),
    pytest.param(lambda: [a3_observation(0, (0, 499)), a3_observation(5, (500, 999), box_px=(2010, 0, 2070, 500))],
                 id="contiguous_independent_looks"),
])
def test_a4_association_basis_and_look_count_are_order_invariant(scenario):
    forward = fuse_contacts(scenario(), "s")[0]
    reversed_order = fuse_contacts(list(reversed(scenario())), "s")[0]
    assert reversed_order["association_basis"] == forward["association_basis"]
    assert reversed_order["look_count"] == forward["look_count"]

def test_kaggle_provenance_did_not_use_test_and_detector_is_frozen():
    root=Path(__file__).parents[1]
    decision=json.loads((root/'ml/artifacts/vnext/kaggle_20260902_final/experiment_decision.json').read_text())
    assert decision["test_set_used"] is False
    weight=root/'ml/artifacts/final_v1/detector/best.pt'
    assert hashlib.sha256(weight.read_bytes()).hexdigest() == '2aa3ac71051856bcfc8ec400804995f03568aa26d1a1fb24583e4eb1b7a10b15'
