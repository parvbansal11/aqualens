"""Transparent acoustic evidence. A shadow is not evidence of artificiality."""
from __future__ import annotations
from typing import Any
import numpy as np

def verify_pipeline_acoustics(image: np.ndarray | None, bbox: list[float], orientation_available: bool = False) -> dict[str, Any]:
    """Conservative local hard-return evidence for a raw PIPELINE candidate.

    This is not a classifier: it never changes the detector's label/confidence.
    Axis-aligned boxes provide elongation only, not object orientation.
    """
    base = {"verification_version": "pipeline_acoustic@v1", "orientation_deg": None,
            "adjacent_shadow_score": None, "hard_return_status": "UNAVAILABLE",
            "shadow_status": "UNAVAILABLE", "missing_inputs": [], "reasons": []}
    if image is None:
        return {**base, "status": "INSUFFICIENT_EVIDENCE", "evidence_strength": None,
                "missing_inputs": ["SOURCE_RASTER"], "reasons": ["SOURCE_RASTER_UNAVAILABLE"]}
    gray = image[..., :3].mean(axis=2) if image.ndim == 3 else image
    a = np.asarray(gray, dtype=np.float32)
    x1,y1,x2,y2 = map(int, bbox); x1=max(0,x1); y1=max(0,y1); x2=min(a.shape[1],x2); y2=min(a.shape[0],y2)
    crop=a[y1:y2,x1:x2]
    if crop.size < 16:
        return {**base, "status":"INSUFFICIENT_EVIDENCE", "evidence_strength":None,
                "missing_inputs":["CANDIDATE_PIXELS"], "reasons":["CANDIDATE_TOO_SMALL"]}
    pad=max(3, int(max(x2-x1,y2-y1)*.5)); context=a[max(0,y1-pad):min(a.shape[0],y2+pad),max(0,x1-pad):min(a.shape[1],x2+pad)]
    bg=float(np.median(context)); scale=max(1., float(np.median(np.abs(context-bg))*1.4826))
    mean=float(crop.mean()); median=float(np.median(crop)); bright=float((crop >= bg+scale).mean()); dark=float((crop <= bg-scale).mean())
    contrast=(mean-bg)/scale; elongation=max(x2-x1,y2-y1)/max(1,min(x2-x1,y2-y1))
    # Elevated pixels are measured against local seabed, not declared pipeline.
    hard=float(np.clip((bright-.08)/.45,0,1)); overwhelmingly_dark=dark >= .70 and bright <= .08
    # These are observational states, not verdicts. In particular, NOT_OBSERVED
    # means this local measurement did not observe a coherent elevated return; it
    # is never a claim that a hard return is confirmed absent.
    hard_return_status = "PRESENT" if hard >= .55 else "WEAK" if hard > 0 else "NOT_OBSERVED"
    status="SUPPORTED" if hard >= .55 and elongation >= 3 else "WEAK_SUPPORT" if hard > .10 else "ACOUSTICALLY_INCONSISTENT" if overwhelmingly_dark else "INSUFFICIENT_EVIDENCE"
    reasons=[]
    if overwhelmingly_dark: reasons.append("DARK_CANDIDATE_WITHOUT_COHERENT_HARD_RETURN")
    if elongation < 3: reasons.append("LOW_BBOX_ELONGATION")
    if not orientation_available: reasons.append("SHADOW_GEOMETRY_UNAVAILABLE")
    return {**base, "status":status,"hard_return_status":hard_return_status,
            "shadow_status":"UNAVAILABLE" if not orientation_available else "NOT_ASSESSED",
            "candidate_mean_intensity":mean,"candidate_median_intensity":median,
            "candidate_bright_fraction":bright,"candidate_dark_fraction":dark,"local_background_mean":bg,
            "local_contrast":contrast,"elongation":elongation,"adjacent_bright_return_score":hard,
            "highlight_shadow_consistency":None,"evidence_strength":hard,"reasons":reasons,
            "missing_inputs": [] if orientation_available else ["CALIBRATED_RANGE_SIDE_ORIENTATION"]}

def verify_candidate(image: np.ndarray, bbox: list[float], nadir_x: float | None,
                     condition: dict[str, Any]) -> dict[str, Any]:
    # ``nadir_x`` is a COLUMN position: this function assumes the image's horizontal
    # axis is across-track/range (standard side-scan waterfall layout, nadir line
    # vertical). This does NOT match every geometry convention in this codebase --
    # packages/sagar/pipeline/internal_v2.py's PICS block treats the horizontal axis
    # as along-track and derives port/starboard from a ROW-based nadir_offset_px.
    # Never pass a row-based nadir offset here without first confirming this raster's
    # actual axis layout; the runtime path below always passes None until that is
    # verified for arbitrary uploaded rasters.
    if nadir_x is None:
        return {"highlight_score": None, "shadow_presence_score": None, "shadow_direction_score": None,
                "shadow_geometry_score": None, "physics_consistency": None,
                "physics_flags": ["UNKNOWN_ORIENTATION"], "reason": "SONAR_ORIENTATION_UNAVAILABLE"}
    gray = image[..., :3].mean(axis=2) if image.ndim == 3 else image
    x1,y1,x2,y2 = map(int, bbox); x1=max(0,x1); y1=max(0,y1); x2=min(gray.shape[1],x2); y2=min(gray.shape[0],y2)
    crop=gray[y1:y2,x1:x2]
    if crop.size == 0: return {"highlight_score": None,"shadow_presence_score":None,"shadow_direction_score":None,"shadow_geometry_score":None,"physics_consistency":None,"physics_flags":["INVALID_BBOX"],"reason":"INVALID_CANDIDATE_GEOMETRY"}
    direction = 1 if (x1+x2)/2 > nadir_x else -1
    span=max(2, x2-x1); sx1, sx2=(x2,min(gray.shape[1],x2+span)) if direction > 0 else (max(0,x1-span),x1)
    shadow=gray[y1:y2,sx1:sx2]; baseline=float(np.median(gray)); highlight=float(np.clip((crop.mean()-baseline)/max(1,gray.std()*2),0,1))
    shadow_score=float(np.clip((baseline-shadow.mean())/max(1,gray.std()*2),0,1)) if shadow.size else None
    direction_score=1.0 if shadow.size and sx2>sx1 else None
    geometry=float(min(1., shadow.shape[1]/max(1,span))) if shadow.size else None
    scores=[v for v in [highlight,shadow_score,direction_score,geometry] if v is not None]
    dropout_rows=set(condition.get("dropout_rows", [])); bbox_rows=set(range(y1,y2))
    nadir_overlap=bool(condition.get("nadir_fraction")) and abs(((x1+x2)/2)-gray.shape[1]/2) <= condition["nadir_fraction"]*gray.shape[1]/2
    flags=[]
    if nadir_overlap: flags.append("NADIR_OVERLAP")
    if dropout_rows & bbox_rows: flags.append("DROPOUT_OVERLAP")
    flags.append("SHADOW_IS_NOT_ARTIFICIALITY")
    return {"highlight_score":highlight,"shadow_presence_score":shadow_score,"shadow_direction_score":direction_score,"shadow_geometry_score":geometry,
            "physics_consistency":float(sum(scores)/len(scores)) if scores else None,
            "physics_flags":flags, "reason":None}
