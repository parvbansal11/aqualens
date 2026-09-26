# CLAIMS AND EVIDENCE

Every headline claim, the evidence that would justify it, its current status, how it is proved
live, the exact wording permitted, and the overclaim that is forbidden.

**Rule:** if a claim's status is not `PROVEN`, the allowed wording is the only wording used —
in the UI, in slides, in the report, and when answering judges.

Status values: `NOT STARTED` · `IN PROGRESS` · `PROVEN` (evidence artifact exists) ·
`BLOCKED`.

---

## Summary

| # | Claim | Status |
|---|---|---|
| 1 | Open-set / unknown anomaly detection (KING) | NOT STARTED |
| 2 | Temporal persistence verification | NOT STARTED |
| 3 | Acoustic-shadow validation | NOT STARTED |
| 4 | Survey-to-survey change detection | NOT STARTED |
| 5 | Recovery priority engine | NOT STARTED |
| 6 | Persistent intelligence / feedback memory | NOT STARTED |
| 7 | Our fine-tuned model | NOT STARTED |
| 8 | Geolocation | NOT STARTED |
| 9 | Real-data end-to-end pipeline | NOT STARTED |
| 10 | Edge / onboard readiness | NOT STARTED (finals) |

---

## 1. Open-set / unknown anomaly detection — KING USP

| | |
|---|---|
| **Evidence needed** | Leave-one-class-out run across all folds, producing region-level AUROC, AUPRC and FPR on annotation-free seabed, in `runs/<id>/metrics.json` |
| **Current status** | NOT STARTED |
| **Demo proof** | Model Lab open-set panel (per-fold + mean) · a live `UNKNOWN` detection in the Workspace rendered with distinct styling · its anomaly heatmap overlay · Inspector showing `class_confidence: null` |
| **Allowed wording** | "Surfaces regions that appear anomalous relative to the surrounding seabed and do not confidently match a trained class." · "Unknown anomaly candidate requiring review." · "Evaluated by holding out a known class and measuring whether the system flags it as unknown." |
| **Forbidden overclaim** | "Detects any unknown object." · "Zero-shot object recognition." · "Recognises objects it was never trained on." · calling an unclassified region "debris", "net", "wreck" or any class name. · quoting an AUROC before the run exists. |

## 2. Temporal persistence verification

| | |
|---|---|
| **Evidence needed** | Ablation A2 vs A0 on the same test split, reporting FP-per-km and F1; `PersistenceEvidence` populated with real `n_obs`/`n_opportunities` |
| **Current status** | NOT STARTED |
| **Demo proof** | Inspector persistence block showing `n_obs / n_opportunities`, Wilson score, mode chip, and per-window observation thumbnails · ablation row A2 |
| **Allowed wording** | "Corroborates a candidate across overlapping sonar windows covering the same physical location and suppresses single-window detections." · "Two modes: window-overlap, always available; sequential-ping, where recording order exists." |
| **Forbidden overclaim** | "Tracks objects over time." · "Video object tracking." · claiming sequential-ping persistence on a dataset whose `ping_order_recoverable` gate is false. · presenting window-overlap corroboration as multi-pass survey confirmation. |

## 3. Acoustic-shadow validation

| | |
|---|---|
| **Evidence needed** | Ablation A3 vs A2 with FP-per-km; unit tests passing on a known-object fixture (high score) and a flat-sand fixture (low score) |
| **Current status** | NOT STARTED |
| **Demo proof** | Inspector shadow block with the **actual shadow-band crop** and its measured intensity profile · `u_range` indicator in the viewport · ablation row A3 |
| **Allowed wording** | "Tests whether a candidate has the acoustic signature of a raised object: a highlight with a shadow on the far-range side, measured against a range-matched background." · "Evidence score, not a height reconstruction." |
| **Forbidden overclaim** | "3-D reconstruction." · "Measures object height" without stating it is a range-geometry estimate and listing its assumptions. · "Distinguishes man-made from natural objects" — **rocks cast shadows too**; this channel separates raised objects from texture artefacts, nothing more. |

### Pipeline acoustic verification disclosure

| | |
|---|---|
| **Current status** | NOT STARTED as a discriminative validation claim. The conservative verifier is implemented as advisory evidence only. |
| **Observed result** | One observed shadow-like raw `PIPELINE` candidate was `INSUFFICIENT_EVIDENCE` with hard return `NOT_OBSERVED` and unavailable range-side geometry. Five inspected legitimate SubPipe `PIPELINE` references were also `INSUFFICIENT_EVIDENCE`. |
| **Allowed wording** | "Records conservative local acoustic evidence for raw PIPELINE candidates." · "Insufficient evidence means the available acquisition geometry cannot independently verify this candidate." |
| **Forbidden overclaim** | "Suppresses pipeline false positives." · "Distinguishes true pipelines from shadows." · "NOT_OBSERVED proves a hard return is absent." · any precision, recall, or false-positive reduction claim for this verifier. |

Current pipeline acoustic verification is conservative and has not demonstrated discrimination between true and false `PIPELINE` candidates under missing calibrated range-side geometry. It does not change the raw detector class, confidence, or bounding box. Its `INSUFFICIENT_EVIDENCE` state is missing/neutral evidence in the unvalidated fusion score, not negative evidence.

## 4. Survey-to-survey change detection

| | |
|---|---|
| **Evidence needed** | Two ingested surveys of one mission, a persisted comparison with all four statuses represented, coverage polygons computed from real track geometry |
| **Current status** | NOT STARTED |
| **Demo proof** | Comparison surface: four status tiles, coverage overlay showing the non-surveyed region, `confirmed_only` toggle changing the result |
| **Allowed wording** | "Compares a new survey against prior survey history and reports objects as new, unchanged or removed, and marks locations the new survey did not cover as not surveyed." |
| **Forbidden overclaim** | Reporting `REMOVED` for anything outside the new coverage polygon — **this is the single most demo-fatal error in the project.** · "Pixel-level change detection." · "Detects that debris was recovered" (we detect that it is no longer observed). |

## 5. Recovery priority engine

| | |
|---|---|
| **Evidence needed** | Priority score reproducible from its stored component breakdown; editing `configs/priority_weights.yaml` changes scores and the UI reflects it |
| **Current status** | NOT STARTED |
| **Demo proof** | Inspector priority block with per-component weight × value → contribution · sorted detection list · live weight edit |
| **Allowed wording** | "Transparent, configurable decision-support ranking over confidence, persistence, anomaly evidence, footprint, class and newness." · "Every score is reproducible from its published components." |
| **Forbidden overclaim** | "Learned risk model." · "Ecological risk assessment." · "Predicts environmental harm." · any implication that the weights were derived from data rather than chosen and published. |

## 6. Persistent intelligence / feedback memory

| | |
|---|---|
| **Evidence needed** | Reviews persisted across restart; queues populated from real verdicts; `training_eligible` correctly false for val/test frames; model registry with lineage |
| **Current status** | NOT STARTED |
| **Demo proof** | Submit verdicts → reload → history intact · hard-negative queue populated · a `training_eligible: false` reason shown for an evaluation-split frame · model lineage in Model Lab |
| **Allowed wording** | "Persistent feedback memory with an active-learning queue, model versioning and an operator-triggered retraining pathway." · "The system retains prior surveys, detections, operator corrections and the model version behind every prediction." |
| **Forbidden overclaim** | "Self-learning." · "Continuously improves." · "Learns from every interaction." · "Online learning." · **any present-tense learning claim** — v1 stores feedback and can retrain on demand; it does not learn autonomously. |

## 7. Our fine-tuned model

| | |
|---|---|
| **Evidence needed** | `metrics.json` from a run with all five split assertions PASS; model card with weights sha256, snapshot and split ids |
| **Current status** | NOT STARTED |
| **Demo proof** | Model Lab metrics with `run_id` + `git_sha` · split-assertion rows · failure-case gallery |
| **Allowed wording** | "Fine-tuned on a group-wise, leakage-asserted split of [datasets], evaluated on a held-out test split." · "Compared against the released GhostVision model as an off-the-shelf sonar baseline." |
| **Forbidden overclaim** | **"We beat GhostVision."** The baseline is a single-class crab-pot model and our test split contains other target types — the comparison measures transfer, not superiority. · quoting GhostVision's F1 as a benchmark we exceeded. · any "N % accuracy" claim. · reporting a number from a run with a failed assertion. |

## 8. Geolocation

| | |
|---|---|
| **Evidence needed** | Detections at `L2_TRACK_RELATIVE` derived from SubPipe's real INS navigation |
| **Current status** | NOT STARTED |
| **Demo proof** | Inspector geo block with provenance badge and `spatial_reference_level` · map placement · a demo-metadata survey visibly badged `DEMO` |
| **Allowed wording** | "Positions are derived from the survey's navigation metadata combined with sonar range geometry." · For synthetic tracks: "Demonstration navigation metadata — not derived from the sonar imagery." |
| **Forbidden overclaim** | Presenting any `DEMO_METADATA` coordinate as sonar-derived or real. · quoting position accuracy without `position_uncertainty_m`. · claiming geolocation on an `L0`/`L1` survey. |

## 9. Real-data end-to-end pipeline

| | |
|---|---|
| **Evidence needed** | `scripts/demo.sh` runs cold-checkout → real dataset → detections with evidence → report, with a run manifest |
| **Current status** | NOT STARTED |
| **Demo proof** | Live ingest with the stage-by-stage progress list · resulting detections · downloaded JSON/CSV report |
| **Allowed wording** | "Real side-scan sonar data through preprocessing, model inference, sonar-specific validation, fusion, geolocation and reporting." |
| **Forbidden overclaim** | Any hardcoded detection presented as inference. · describing the pipeline as running on NIOT or Indian-waters data. · implying real-time onboard operation. |

## 10. Edge / onboard readiness

| | |
|---|---|
| **Evidence needed** | Core ML / INT8 export with measured on-device latency — **finals scope** |
| **Current status** | NOT STARTED (deliberately deferred) |
| **Demo proof** | None for internal. Architectural argument only: the `Detector` protocol is framework-agnostic. |
| **Allowed wording** | "The architecture keeps inference behind a framework-agnostic interface so export to Core ML or ONNX for edge deployment is a swap rather than a rewrite. We have not yet measured on-device performance." |
| **Forbidden overclaim** | "Runs on an AUV." · "Edge-ready." · "Deployable onboard today." · any latency figure attributed to hardware we have not tested. |

---

## Cross-cutting forbidden statements

- Any metric not present in `benchmarks.json`.
- Any latency figure without the device that executed it (ORT on macOS runs on CPU).
- "Accuracy" as a headline metric.
- Citing GhostNetZero's ~90 % centroid figure as a comparable benchmark (small *n*, no reserved
  test set). Its **domain-shift finding** may be cited; its headline number may not.
- Any AI4Shipwrecks site count until the ⚠️ in `docs/DATA_STRATEGY.md` is resolved on download.
- Any claim that a capability works on a dataset whose capability gate is false.
