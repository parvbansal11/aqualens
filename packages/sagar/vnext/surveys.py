"""Survey membership: every Frame of an Upload belongs to exactly one Survey.

A Survey is one contiguous recording from one sonar during one pass; an Upload may hold several.
Membership provenance is DECLARED, VERIFIED or SINGLETON. Until membership is declared or
verified from acquisition evidence, each Frame is its own SINGLETON Survey.
"""
from __future__ import annotations
from typing import Any

def singleton_surveys(upload_survey_id:str, frames:list[dict[str,Any]], channel_layouts:dict[str,str] | None=None) -> list[dict[str,Any]]:
    """Give every Frame its own SINGLETON Survey and record the Frame's ``survey_ref``.

    ``upload_survey_id`` is the legacy Upload identifier; a Survey ref extends it with the Frame id,
    so refs are deterministic and unique across retained Uploads. Navigation provenance stays null
    until an Upload can declare it, and an unrecorded channel layout stays null.
    """
    surveys=[]
    for frame in frames:
        survey_ref=f"{upload_survey_id}.{frame['frame_id']}"
        frame["survey_ref"]=survey_ref
        surveys.append({"survey_ref":survey_ref,"frame_ids":[frame["frame_id"]],"membership_provenance":"SINGLETON",
                        "geometry_signature":{"width_px":frame.get("width_px"),"height_px":frame.get("height_px"),
                                              "channel_layout":(channel_layouts or {}).get(frame["frame_id"])},
                        "navigation_provenance":None})
    return surveys
