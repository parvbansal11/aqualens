"""Transparent operational triage; it makes no ecological claim without metadata."""
from __future__ import annotations
from typing import Any
def prioritize(contact: dict[str, Any], ecological_metadata: dict[str, Any] | None = None) -> dict[str, Any]:
    parts={"evidence":contact.get("evidence_score"),"persistence":contact.get("persistence_score"),"quality":contact.get("quality_score")}
    available={k:v for k,v in parts.items() if v is not None}; score=sum(available.values())/len(available) if available else None
    change=contact.get("change_state"); nav=contact.get("navigation_status")=="AVAILABLE"; review=contact.get("reviews",{}).get("latest_verdict")
    if score is None: action="REVIEW"
    elif contact.get("quality_score",0)<.45: action="REACQUIRE" if nav else "REVIEW"
    elif review=="CONFIRMED" and score>=.75: action="RECOVERY_CANDIDATE"
    elif score>=.6: action="INSPECT"
    else: action="REVIEW"
    return {"priority_score":score,"priority_band":"HIGH" if score is not None and score>=.75 else "MEDIUM" if score is not None and score>=.5 else "LOW" if score is not None else "UNAVAILABLE","priority_components":available,"missing_components":sorted(set(parts)-set(available)),"recommended_action":action,"ecological_rule_metadata_used":bool(ecological_metadata)}
