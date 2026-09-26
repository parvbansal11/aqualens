"""Deterministic multi-frame association; raw findings remain immutable observations."""
from __future__ import annotations
from dataclasses import dataclass
from statistics import mean, pstdev
from typing import Any
import hashlib

@dataclass(frozen=True)
class ContactFusionPolicy:
    version: str = "contact_fusion@v1"
    min_class_compatibility: bool = True
    min_tile_duplicate_iou: float = .30
    slant_range_match_width_fraction: float = .25
    min_slant_range_match_px: float = 20.

def _centre(f: dict[str, Any]) -> tuple[float,float]:
    b=f["bbox_normalized"]; return ((b[0]+b[2])/2,(b[1]+b[3])/2)
def _iou(a:list[float],b:list[float])->float:
    w=min(a[2],b[2])-max(a[0],b[0]); h=min(a[3],b[3])-max(a[1],b[1])
    if w<=0 or h<=0: return 0.
    return w*h/((a[2]-a[0])*(a[3]-a[1])+(b[2]-b[0])*(b[3]-b[1])-w*h)
def _contains_centre(box:list[float],other:list[float])->bool:
    cx,cy=(other[0]+other[2])/2,(other[1]+other[3])/2; return box[0]<=cx<=box[2] and box[1]<=cy<=box[3]
def _tile_overlap_duplicate(a:dict[str,Any],b:dict[str,Any],policy:ContactFusionPolicy)->bool:
    # Two detections in one Frame are independent object hypotheses unless they are duplicate
    # predictions of one object made by overlapping inference tiles. Frame-normalized boxes
    # give the same IoU and containment as pixel boxes.
    if a.get("inference_mode") != "TILED" or b.get("inference_mode") != "TILED": return False
    if a.get("tile_id") is None or b.get("tile_id") is None or a["tile_id"] == b["tile_id"]: return False
    ba,bb=a["bbox_normalized"],b["bbox_normalized"]
    return _iou(ba,bb)>=policy.min_tile_duplicate_iou or _contains_centre(ba,bb) or _contains_centre(bb,ba)
def _world(f: dict[str, Any]) -> tuple[float,float] | None:
    g=f.get("geo") or {}; return (g["lat"],g["lon"]) if g.get("lat") is not None and g.get("lon") is not None else None
def _ping_bounds(f:dict[str,Any])->tuple[int,int] | None:
    if f.get("sequential_observation_supported") is not True: return None
    try: start,end=int(f["ping_start"]),int(f["ping_end"])
    except (KeyError,TypeError,ValueError): return None
    return (start,end) if start<=end else None
def _slant_range_match(a:dict[str,Any],b:dict[str,Any],policy:ContactFusionPolicy)->bool:
    # Raster columns are Slant range, a shared axis only within one raster geometry. The narrower
    # box sets the tolerance so the test is symmetric.
    width=(a.get("pixel_dimensions") or [None])[0]
    if not width or width != (b.get("pixel_dimensions") or [None])[0]: return False
    ba,bb=a["bbox_normalized"],b["bbox_normalized"]
    offset_px=abs((ba[0]+ba[2])-(bb[0]+bb[2]))/2*width
    box_width_px=min(ba[2]-ba[0],bb[2]-bb[0])*width
    return offset_px<=max(policy.slant_range_match_width_fraction*box_width_px,policy.min_slant_range_match_px)
def _compatible(a:dict[str,Any],b:dict[str,Any],policy:ContactFusionPolicy)->bool:
    if policy.min_class_compatibility and a.get("raw_class") != b.get("raw_class"): return False
    if a.get("source_frame_id") == b.get("source_frame_id"): return _tile_overlap_duplicate(a,b,policy)
    # Different Frames relate only through declared ping bounds that overlap or are directly
    # contiguous. Frame-level navigation, frame index and upload order never associate Frames.
    pa,pb=_ping_bounds(a),_ping_bounds(b)
    if pa is None or pb is None or max(pa[0],pb[0])>min(pa[1],pb[1])+1: return False
    return _slant_range_match(a,b,policy)

def _ping_order(group:list[dict[str,Any]]) -> tuple[list[dict[str,Any]], bool]:
    """Return observations in declared ping order only when that order is real.

    Frame indices are upload-processing positions and deliberately never become
    sequential evidence.  Ping bounds are supplied navigation/acquisition
    metadata, so they are the only accepted order for this runtime path.
    """
    if not group or not all(item.get("sequential_observation_supported") is True for item in group):
        return group, False
    try:
        ordered = sorted(group, key=lambda item: int(item["ping_start"]))
        valid = all(
            int(item["ping_start"]) <= int(item["ping_end"])
            for item in ordered
        )
    except (KeyError, TypeError, ValueError):
        return group, False
    return ordered, valid

def _processing_order(f:dict[str,Any]) -> tuple[tuple[int,int],int,str]:
    # Frames are compared in declared ping order, so filename or upload order cannot decide
    # which Frames a chain of Observations joins.
    bounds=_ping_bounds(f)
    return ((0,bounds[0]) if bounds else (1,0)),int(f.get("frame_index",0)),f["detection_id"]

def fuse_contacts(findings:list[dict[str,Any]], survey_id:str, policy:ContactFusionPolicy=ContactFusionPolicy()) -> list[dict[str,Any]]:
    # Detector IDs identify observations. Repeated transport/API records are not new evidence.
    unique = {item["detection_id"]: item for item in findings}
    groups:list[list[dict[str,Any]]]=[]
    for finding in sorted(unique.values(),key=_processing_order):
        matches=[g for g in groups if _compatible(g[-1],finding,policy)]
        (matches[0] if matches else groups.append([]) or groups[-1]).append(finding)
    contacts=[]
    for group in groups:
        ordered_group, genuine_ping_order = _ping_order(group)
        cs=[_centre(x) for x in ordered_group]; conf=[float(x["raw_confidence"]) for x in ordered_group]
        frames=[x["source_frame_id"] for x in ordered_group]; idx=[int(x.get("frame_index",0)) for x in ordered_group]
        # frame_index identifies the source raster/ping, not the tile. Several observations
        # sharing one frame_index are overlapping-tile detections of the SAME static image and
        # must never be scored as sequential ping/frame persistence (window overlap != temporal
        # persistence). Only distinct frame_index values count as independent opportunities.
        distinct_idx=sorted(set(idx)); n_frames=len(distinct_idx)
        sequential_supported=genuine_ping_order
        consecutive=1
        if sequential_supported:
            ordered_pings = [(int(item["ping_start"]), int(item["ping_end"])) for item in ordered_group]
            for (_, previous_end), (next_start, _) in zip(ordered_pings, ordered_pings[1:]):
                consecutive = consecutive + 1 if next_start == previous_end + 1 else 1
        window_overlap_duplicate_count=len(ordered_group)-n_frames
        persistence_evidence_type=("SEQUENTIAL_PING" if n_frames>1 and sequential_supported
                                    else "WINDOW_OVERLAP_ONLY" if window_overlap_duplicate_count>0
                                    else "UNKNOWN" if n_frames > 1 else "SINGLE_OBSERVATION")
        variance=(pstdev([p[0] for p in cs])+pstdev([p[1] for p in cs]))/2 if len(cs)>1 else None
        persistence=0.15 if n_frames<=1 or not sequential_supported else min(1., .35+.13*n_frames+.25*(consecutive/n_frames))
        digest=hashlib.sha256("|".join(x["detection_id"] for x in ordered_group).encode()).hexdigest()[:12]
        classes=[x["raw_class"] for x in ordered_group]; nav=[_world(x) for x in ordered_group]
        contacts.append({"contact_id":f"contact_{survey_id}_{digest}","survey_id":survey_id,
          "resolved_class":classes[0] if len(set(classes))==1 else None,"candidate_classes":sorted(set(classes)),"open_set_candidate":False,
          "classification_source":"FROZEN_YOLO11S_CANDIDATE_GENERATOR","production_qualified":False,
          "observation_count":len(group),"distinct_frame_observation_count":n_frames,"window_overlap_duplicate_count":window_overlap_duplicate_count,
          "persistence_evidence_type":persistence_evidence_type,
          "first_frame":frames[0],"last_frame":frames[-1],"first_ping":ordered_group[0].get("ping_start") if sequential_supported else None,"last_ping":ordered_group[-1].get("ping_end") if sequential_supported else None,"source_frame_ids":frames,"source_detection_ids":[x["detection_id"] for x in ordered_group],"best_observation_id":ordered_group[conf.index(max(conf))]["detection_id"],
          "max_raw_confidence":max(conf),"mean_raw_confidence":mean(conf),"class_consistency":1.0 if len(set(classes))==1 else 0.0,
          "bbox_stability":None if variance is None else max(0.,1-variance/.12),"normalized_position_stability":None if variance is None else max(0.,1-variance/.12),"world_position_variance":None,
          "persistence_score":persistence,"consecutive_observation_count":consecutive,"observation_span":max(distinct_idx)-min(distinct_idx)+1,
          "physics_consistency":None,"highlight_score":None,"shadow_score":None,"dropout_overlap":None,"nadir_overlap":None,
          "anomaly_score":None,"anomaly_source":None,"anomaly_threshold_provenance":None,"anomaly_threshold":None,"anomaly_feature_source":None,"anomaly_memory_version":None,"is_open_set_candidate":False,"open_set":None,
          "natural_clutter":{"score":None,"model_version":"natural_clutter_v1","status":"REJECTED_FOR_AUTOMATIC_SUPPRESSION","mode":"ADVISORY_ONLY","experimental":True,"reason":"MODEL_NOT_LOADED_ADVISORY_EXPERIMENT_ONLY"},
          "quality_score":None,"quality_flags":[],"latitude":nav[0][0] if nav and nav[0] else None,"longitude":nav[0][1] if nav and nav[0] else None,
          "localization_uncertainty_m":None,"localization_uncertainty_status":"UNAVAILABLE","navigation_status":"AVAILABLE" if any(nav) else "UNAVAILABLE",
          "evidence_score":None,"evidence_strength":None,"evidence_breakdown":{},"confidence":None,"raw_fused_confidence":None,"normalized_confidence":None,"raw_detector_confidence":max(conf),"confidence_components":{},"confidence_method":None,"confidence_normalization":None,"confidence_normalization_range":None,"disposition":"UNREVIEWED","recommended_action":"REVIEW",
          "provenance":{"detector_model_sha":ordered_group[0].get("model_sha256"),"runtime_version":policy.version,"processing_configuration":policy.__dict__,"source_raster_identities":[x.get("source_image_path") for x in ordered_group]},
          "reviews":{"history":[],"latest_verdict":None,"review_count":0}})
    return contacts
