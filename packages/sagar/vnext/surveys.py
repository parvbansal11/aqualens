"""Survey membership: every Frame of an Upload belongs to exactly one Survey.

A Survey is one contiguous recording from one sonar during one pass; an Upload may hold several.
Membership provenance is DECLARED, VERIFIED or SINGLETON. Until membership is declared or
verified from acquisition evidence, each Frame is its own SINGLETON Survey.
"""
from __future__ import annotations
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any
import hashlib

import numpy as np

def singleton_surveys(upload_survey_id:str, frames:list[dict[str,Any]], channel_layouts:dict[str,str] | None=None,
                      navigation_provenance:dict[str,str | None] | None=None) -> list[dict[str,Any]]:
    """Give every Frame its own SINGLETON Survey and record the Frame's ``survey_ref``.

    ``upload_survey_id`` is the legacy Upload identifier; a Survey ref extends it with the Frame id,
    so refs are deterministic and unique across retained Uploads. Navigation provenance is null unless
    the Upload declared it for a Frame with navigation, and an unrecorded channel layout stays null.
    """
    surveys=[]
    for frame in frames:
        survey_ref=f"{upload_survey_id}.{frame['frame_id']}"
        frame["survey_ref"]=survey_ref
        surveys.append({"survey_ref":survey_ref,"frame_ids":[frame["frame_id"]],"membership_provenance":"SINGLETON",
                        "geometry_signature":{"width_px":frame.get("width_px"),"height_px":frame.get("height_px"),
                                              "channel_layout":(channel_layouts or {}).get(frame["frame_id"])},
                        "navigation_provenance":(navigation_provenance or {}).get(frame["frame_id"])})
    return surveys

def duplicate_rasters(raster_sha256_by_frame:dict[str,str]) -> dict[str,dict[str,Any]]:
    """Flag Frames whose rasters are byte-identical within one Upload (spec B rule 5).

    Every member of a duplicate group is flagged DUPLICATE_RASTER and lists the whole group, so the
    result does not depend on which copy came first in the Upload.
    """
    groups:dict[str,list[str]]={}
    for frame_id,digest in raster_sha256_by_frame.items(): groups.setdefault(digest,[]).append(frame_id)
    return {frame_id:{"raster_sha256":digest,
                      "raster_duplicate_status":"DUPLICATE_RASTER" if len(groups[digest])>1 else "UNIQUE",
                      "duplicate_raster_frame_ids":sorted(groups[digest]) if len(groups[digest])>1 else []}
            for frame_id,digest in raster_sha256_by_frame.items()}

# A Frame whose raster cannot be read has no established identity: it is neither UNIQUE nor a
# DUPLICATE_RASTER, and so can never be relied on as a separate Look or a verification candidate.
UNESTABLISHED_RASTER_IDENTITY = {"raster_sha256": None, "raster_duplicate_status": None, "duplicate_raster_frame_ids": []}

def raster_identities(paths:Mapping[str,Path | None]) -> dict[str,dict[str,Any]]:
    """B2 raster identity for each Frame from its raster file; the one rule for ingest and stored-record rebuild."""
    readable={frame_id:hashlib.sha256(path.read_bytes()).hexdigest() for frame_id,path in paths.items() if path is not None and path.is_file()}
    identity=duplicate_rasters(readable)
    return {frame_id:identity.get(frame_id,dict(UNESTABLISHED_RASTER_IDENTITY)) for frame_id in paths}

def load_native_pixels(path:Path) -> np.ndarray:
    """Pixels as stored; palette images are compared by the colours they show."""
    from PIL import Image
    with Image.open(path) as image:
        return np.asarray(image.convert("RGBA") if image.mode in {"P","PA"} else image)

@dataclass(frozen=True)
class RowShiftPolicy:
    version: str = "row_shift_identity@v1"
    # A shared-ping claim needs the Frames to share at least half their rows (SubPipe shares 480 of 500).
    max_shift_fraction: float = .5

def _row_shift(later:list[bytes], earlier:list[bytes], max_shift:int) -> list[int]:
    """Every k in [0, max_shift] with later[k:] == earlier[:-k] by row digest."""
    height=len(later)
    return [k for k in range(max_shift+1) if later[k]==earlier[0] and later[k:]==earlier[:height-k]]

def verify_row_shift_groups(frame_ids:Iterable[str], load:Callable[[str],np.ndarray], policy:RowShiftPolicy=RowShiftPolicy()) -> list[dict[str,Any]]:
    """Group Frames that share pings by exact row-shift identity (spec B rule 3b).

    In a waterfall export rows are pings, so a later Frame that repeats an earlier Frame's rows
    shifted by k (``later[k:] == earlier[:-k]``) re-reads the same pings. Only Frames of identical
    geometry (shape and dtype) are compared. Row digests find candidates; a pair is verified only when
    exactly one shift k >= 1 matches and a full pixel comparison confirms it. Pixel-identical,
    uniform and row-periodic Frames match at several shifts and are never verified. Each group
    records per-Frame ping offsets (row 0 of each Frame on one shared ping axis, the earliest-row
    Frame at 0); a group whose pairwise shifts disagree is not verified. The result depends only on
    pixels, never on Frame names or input order.
    """
    ids=sorted(frame_ids)
    rows:dict[str,list[bytes]]={}; geometry:dict[str,tuple]={}
    for frame_id in ids:
        pixels=np.ascontiguousarray(load(frame_id))
        geometry[frame_id]=(pixels.shape,pixels.dtype.str)
        rows[frame_id]=[hashlib.sha256(row.tobytes()).digest() for row in pixels]
    edges:list[tuple[str,str,int]]=[]  # (later, earlier, k)
    for index,a in enumerate(ids):
        for b in ids[index+1:]:
            if geometry[a]!=geometry[b] or not rows[a]: continue
            max_shift=int(len(rows[a])*policy.max_shift_fraction)
            matches={(x,y,k) if k else (None,None,0) for x,y in ((a,b),(b,a)) for k in _row_shift(rows[x],rows[y],max_shift)}
            if len(matches)!=1: continue
            ((later,earlier,k),)=matches
            if k and np.array_equal(load(later)[k:],load(earlier)[:-k]): edges.append((later,earlier,k))
    neighbours:dict[str,list[tuple[str,int]]]={}
    for later,earlier,k in edges:
        neighbours.setdefault(later,[]).append((earlier,k)); neighbours.setdefault(earlier,[]).append((later,-k))
    groups=[]; seen:set[str]=set()
    for start in ids:
        if start in seen or start not in neighbours: continue
        offsets={start:0}; queue=[start]
        while queue:
            frame_id=queue.pop()
            for other,k in neighbours[frame_id]:
                if other not in offsets: offsets[other]=offsets[frame_id]+k; queue.append(other)
        seen.update(offsets)
        if any(offsets[earlier]-offsets[later]!=k for later,earlier,k in edges if later in offsets): continue
        base=min(offsets.values()); offsets={frame_id:value-base for frame_id,value in offsets.items()}
        members=sorted(offsets,key=lambda frame_id:(offsets[frame_id],frame_id))
        groups.append({"frame_ids":members,"ping_offsets":{frame_id:offsets[frame_id] for frame_id in members},
                       "verified_pairs":[{"frame_ids":[later,earlier],"row_shift":k} for later,earlier,k in sorted(edges) if later in offsets],
                       "method":"ROW_SHIFT_IDENTITY","policy":policy.version})
    return groups

def form_surveys(upload_survey_id:str, frames:list[dict[str,Any]], channel_layouts:dict[str,str] | None=None,
                 navigation_provenance:dict[str,str | None] | None=None, verified_groups:list[dict[str,Any]] | None=None,
                 declared_groups:list[list[str]] | None=None) -> list[dict[str,Any]]:
    """Survey membership for an Upload: DECLARED groups, VERIFIED groups from row-shift identity, SINGLETON otherwise.

    A DECLARED Survey groups the Frames an Upload declared (spec B rule 3a) and nothing else: its
    ``frame_ids`` are sorted and carry no order, and it has no ``ping_relationship``. The caller
    guarantees declared groups are disjoint, share one geometry and are not also verified.

    A VERIFIED Survey lists its Frames in ping order and carries a ``ping_relationship`` whose
    provenance is DERIVED_FROM_SOURCE; that is the only place the system produces that value. The
    declared ``navigation_provenance`` is kept separate: it is the Upload's declaration when every
    member Frame has navigation, else null.
    """
    by_id={frame["frame_id"]:frame for frame in frames}
    surveys=[]; grouped:set[str]=set()
    for group in declared_groups or []:
        members=sorted(group); first=by_id[members[0]]
        survey_ref=f"{upload_survey_id}.declared.{members[0]}"
        declared={(navigation_provenance or {}).get(frame_id) for frame_id in members}
        for frame_id in members: by_id[frame_id]["survey_ref"]=survey_ref
        surveys.append({"survey_ref":survey_ref,"frame_ids":members,"membership_provenance":"DECLARED",
                        "geometry_signature":{"width_px":first.get("width_px"),"height_px":first.get("height_px"),
                                              "channel_layout":(channel_layouts or {}).get(members[0])},
                        "navigation_provenance":declared.pop() if len(declared)==1 else None})
        grouped.update(members)
    for group in verified_groups or []:
        members=group["frame_ids"]; first=by_id[members[0]]
        survey_ref=f"{upload_survey_id}.verified.{min(members)}"
        declared={(navigation_provenance or {}).get(frame_id) for frame_id in members}
        for frame_id in members: by_id[frame_id]["survey_ref"]=survey_ref
        surveys.append({"survey_ref":survey_ref,"frame_ids":list(members),"membership_provenance":"VERIFIED",
                        "geometry_signature":{"width_px":first.get("width_px"),"height_px":first.get("height_px"),
                                              "channel_layout":(channel_layouts or {}).get(members[0])},
                        "navigation_provenance":declared.pop() if len(declared)==1 else None,
                        "ping_relationship":{"provenance":"DERIVED_FROM_SOURCE","method":group["method"],"policy":group["policy"],
                                             "ping_offsets":dict(group["ping_offsets"]),"verified_pairs":list(group["verified_pairs"])}})
        grouped.update(members)
    surveys+=singleton_surveys(upload_survey_id,[frame for frame in frames if frame["frame_id"] not in grouped],channel_layouts,navigation_provenance)
    return sorted(surveys,key=lambda item:min(item["frame_ids"]))

def verified_survey_groups(frames:list[dict[str,Any]], channel_layouts:Mapping[str,str | None], load:Callable[[str],np.ndarray],
                           excluded:Iterable[str]=()) -> list[dict[str,Any]]:
    """B4 verification candidates and groups; the one rule for ingest and stored-record rebuild.

    Candidates are Frames with an established, UNIQUE raster identity (B2) and a known channel layout,
    minus ``excluded`` (declared Frames, B5). Only Frames with the same geometry signature (width,
    height, channel layout) are compared (rule 4, I-B2).
    """
    skip=set(excluded); by_geometry:dict[tuple[Any,...],list[str]]={}
    for frame in frames:
        layout=channel_layouts.get(frame["frame_id"])
        if frame.get("raster_duplicate_status")=="UNIQUE" and layout is not None and frame["frame_id"] not in skip:
            by_geometry.setdefault((frame.get("width_px"),frame.get("height_px"),layout),[]).append(frame["frame_id"])
    return [group for _,frame_ids in sorted(by_geometry.items(),key=lambda item:min(item[1])) for group in verify_row_shift_groups(frame_ids,load)]

# An Observation whose Frame has no verified place on a Survey ping axis.
NO_PING_RELATIONSHIP = {"ping_relationship_provenance":None,"survey_ping_start":None,"survey_ping_end":None,
                        "sequential_observation_supported":False}

def ping_relationships(frames:list[dict[str,Any]], surveys:list[dict[str,Any]]) -> dict[str,dict[str,Any]]:
    """Each Frame's Survey and, when verified, its place on that Survey's ping axis (A7).

    The only relationship that places a Frame is a VERIFIED Survey's DERIVED_FROM_SOURCE ping
    offsets (B4), for a Frame whose raster identity is established and UNIQUE (B2). Row r of such a
    Frame is ping ``survey_ping_start + r`` on the axis. Declared navigation never places a Frame,
    and every other Frame gets no relationship.
    """
    membership:dict[str,tuple[str,str]]={}; offsets:dict[str,int]={}
    for survey in surveys:
        for frame_id in survey.get("frame_ids") or []: membership[frame_id]=(survey["survey_ref"],survey.get("membership_provenance"))
        relationship=survey.get("ping_relationship") or {}
        if survey.get("membership_provenance")=="VERIFIED" and relationship.get("provenance")=="DERIVED_FROM_SOURCE":
            offsets.update(relationship.get("ping_offsets") or {})
    result={}
    for frame in frames:
        frame_id=frame["frame_id"]; survey_ref,provenance=membership.get(frame_id,(None,None)); height=frame.get("height_px")
        placed=(frame_id in offsets and frame.get("raster_duplicate_status")=="UNIQUE" and isinstance(height,int) and height>0)
        start=int(offsets[frame_id]) if placed else None
        result[frame_id]={"survey_ref":survey_ref,"survey_membership_provenance":provenance,
                          "ping_relationship_provenance":"DERIVED_FROM_SOURCE" if placed else None,
                          "survey_ping_start":start,"survey_ping_end":start+height-1 if placed else None,
                          "sequential_observation_supported":placed}
    return result
