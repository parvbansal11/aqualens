"""Deterministic multi-frame association; raw findings remain immutable observations."""
from __future__ import annotations
from dataclasses import dataclass
from statistics import mean, pstdev
from typing import Any
import hashlib

@dataclass(frozen=True)
class ContactFusionPolicy:
    version: str = "contact_fusion@v1.1_point_target_guard"
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
# A7: the only ping relationship that relates Frames is the one Aqualens derives from the source
# pixels (B4) for the Frames of one VERIFIED Survey. Declared navigation of any provenance does not.
_VERIFIED_RELATIONSHIP=("VERIFIED","DERIVED_FROM_SOURCE")
def _ping_bounds(f:dict[str,Any])->tuple[int,int] | None:
    """The Observation's Frame on its Survey's ping axis, when a verified relationship places it there."""
    if f.get("sequential_observation_supported") is not True or not f.get("survey_ref"): return None
    if (f.get("survey_membership_provenance"),f.get("ping_relationship_provenance"))!=_VERIFIED_RELATIONSHIP: return None
    try: start,end=int(f["survey_ping_start"]),int(f["survey_ping_end"])
    except (KeyError,TypeError,ValueError): return None
    return (start,end) if start<=end else None
def _same_raster_geometry(a:dict[str,Any],b:dict[str,Any])->bool:
    dims=a.get("pixel_dimensions")
    return bool(dims) and list(dims)==list(b.get("pixel_dimensions") or [])
def _slant_range_match(a:dict[str,Any],b:dict[str,Any],policy:ContactFusionPolicy)->bool:
    """Spec A req 2(b) with PID-24: |x̄₁ − x̄₂| ≤ max(0.25·min(w₁, w₂), 20 px).

    x̄ is the box centre column and w the box width, in source-raster pixel columns (Slant-range
    samples), a shared axis only within one raster geometry. The narrower box sets the tolerance, so
    the test is symmetric and one oversized box cannot widen it. The 20 px floor is a pixel quantity:
    this is neither a metric nor a calibrated distance.
    """
    if not _same_raster_geometry(a,b): return False
    ba,bb=a["bbox_px"],b["bbox_px"]
    offset_px=abs((ba[0]+ba[2])/2-(bb[0]+bb[2])/2)
    w=min(ba[2]-ba[0],bb[2]-bb[0])
    return offset_px<=max(policy.slant_range_match_width_fraction*w,policy.min_slant_range_match_px)
def _mapped_boxes_overlap(a:dict[str,Any],b:dict[str,Any],pa:tuple[int,int],pb:tuple[int,int])->bool:
    """Spec A req 2(a): the boxes overlap (positive area) on the Survey's ping axis (row + Frame
    offset) and range axis (column)."""
    if not _same_raster_geometry(a,b): return False
    ba,bb=a["bbox_px"],b["bbox_px"]
    columns=min(ba[2],bb[2])-max(ba[0],bb[0])
    pings=min(pa[0]+ba[3],pb[0]+bb[3])-max(pa[0]+ba[1],pb[0]+bb[1])
    return columns>0 and pings>0
def _association_relation(a:dict[str,Any],b:dict[str,Any],policy:ContactFusionPolicy)->str | None:
    """Why two Observations may join one Contact, or None if they may not.

    A Look is an observation of seabed independent in pings from another Look (spec Q8).
    Tile-overlap duplicates and overlapping ping windows are the SAME Look; ping-contiguous
    disjoint windows are INDEPENDENT Looks.
    """
    if policy.min_class_compatibility and a.get("raw_class") != b.get("raw_class"): return None
    if a.get("source_frame_id") == b.get("source_frame_id"):
        return "TILE_OVERLAP_DUPLICATE" if _tile_overlap_duplicate(a,b,policy) else None
    # Different Frames relate only within one Survey, through a verified ping relationship whose
    # windows overlap or are directly contiguous (spec A req 2, I-A2). Frame-level navigation,
    # declared ping bounds, frame index and upload order never associate Frames.
    pa,pb=_ping_bounds(a),_ping_bounds(b)
    if pa is None or pb is None or a["survey_ref"]!=b["survey_ref"]: return None
    gap=max(pa[0],pb[0])-min(pa[1],pb[1])
    if gap<=0: return "SAME_LOOK_OVERLAPPING_WINDOWS" if _mapped_boxes_overlap(a,b,pa,pb) else None
    # Post-freeze safety correction: along-track continuity is supported for PIPELINE only.
    # A point target at the same range in disjoint pings is not a repeated observation.
    if gap==1 and a.get("raw_class") == "PIPELINE": return "INDEPENDENT_LOOKS_ALONG_TRACK" if _slant_range_match(a,b,policy) else None
    return None
def _compatible(a:dict[str,Any],b:dict[str,Any],policy:ContactFusionPolicy)->bool:
    return _association_relation(a,b,policy) is not None

def _ping_order(group:list[dict[str,Any]]) -> tuple[list[dict[str,Any]], bool]:
    """Return observations in Survey ping-axis order only when every one has a verified place on it.

    Frame indices are upload-processing positions and deliberately never become sequential
    evidence. Only a verified ping relationship (see _ping_bounds) orders Observations.
    """
    bounds = [_ping_bounds(item) for item in group]
    if not group or any(item is None for item in bounds):
        return group, False
    return [item for _, item in sorted(zip(bounds, group), key=lambda pair: (pair[0][0], pair[1]["detection_id"]))], True

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
        # Each consecutive pair in `group` was verified compatible when the chain was built
        # (matches[0] is always g[-1]), so the relation between neighbours tells us why the
        # whole chain associated and how many independent Looks it spans (spec A req 5, Q8).
        if len(group)==1:
            association_basis,look_count="SINGLE",1
        else:
            relations=[_association_relation(group[i],group[i+1],policy) for i in range(len(group)-1)]
            look_count=1+sum(1 for r in relations if r=="INDEPENDENT_LOOKS_ALONG_TRACK")
            if look_count>1: association_basis="INDEPENDENT_LOOKS_ALONG_TRACK"
            elif all(r=="TILE_OVERLAP_DUPLICATE" for r in relations): association_basis="TILE_OVERLAP_DUPLICATE"
            else: association_basis="SAME_LOOK_OVERLAPPING_WINDOWS"
        ordered_group, genuine_ping_order = _ping_order(group)
        cs=[_centre(x) for x in ordered_group]; conf=[float(x["raw_confidence"]) for x in ordered_group]
        frames=[x["source_frame_id"] for x in ordered_group]; idx=[int(x.get("frame_index",0)) for x in ordered_group]
        distinct_idx=sorted(set(idx)); n_frames=len(distinct_idx)
        sequential_supported=genuine_ping_order
        consecutive=1
        if sequential_supported:
            ordered_pings = [_ping_bounds(item) for item in ordered_group]
            for (_, previous_end), (next_start, _) in zip(ordered_pings, ordered_pings[1:]):
                consecutive = consecutive + 1 if next_start == previous_end + 1 else 1
        # Persistence is re-observation across independent Looks, not Frames (spec Q8): a
        # tile-overlap duplicate or an overlapping-window re-read of the same Look is one
        # Look regardless of how many Frames or Observations produced it.
        window_overlap_duplicate_count=len(ordered_group)-look_count
        persistence_evidence_type=("SEQUENTIAL_PING" if look_count>1 and sequential_supported
                                    else "WINDOW_OVERLAP_ONLY" if window_overlap_duplicate_count>0
                                    else "UNKNOWN" if look_count > 1 else "SINGLE_OBSERVATION")
        variance=(pstdev([p[0] for p in cs])+pstdev([p[1] for p in cs]))/2 if len(cs)>1 else None
        persistence=0.15 if look_count<=1 or not sequential_supported else min(1., .35+.13*look_count+.25*(consecutive/look_count))
        digest=hashlib.sha256("|".join(x["detection_id"] for x in ordered_group).encode()).hexdigest()[:12]
        classes=[x["raw_class"] for x in ordered_group]; nav=[_world(x) for x in ordered_group]
        contacts.append({"contact_id":f"contact_{survey_id}_{digest}","survey_id":survey_id,
          "resolved_class":classes[0] if len(set(classes))==1 else None,"candidate_classes":sorted(set(classes)),"open_set_candidate":False,
          "classification_source":"FROZEN_YOLO11S_CANDIDATE_GENERATOR","production_qualified":False,
          "observation_count":len(group),"distinct_frame_observation_count":n_frames,"window_overlap_duplicate_count":window_overlap_duplicate_count,
          "association_basis":association_basis,"look_count":look_count,
          "persistence_evidence_type":persistence_evidence_type,
          "first_frame":frames[0],"last_frame":frames[-1],"first_ping":_ping_bounds(ordered_group[0])[0] if sequential_supported else None,"last_ping":_ping_bounds(ordered_group[-1])[1] if sequential_supported else None,"source_frame_ids":frames,"source_detection_ids":[x["detection_id"] for x in ordered_group],"best_observation_id":ordered_group[conf.index(max(conf))]["detection_id"],
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
