# API CONTRACT — FROZEN

**This is the interface between Codex (backend) and Cursor (frontend). It is frozen before
frontend work begins. Neither agent changes it unilaterally; changes require an amendment
committed here first.**

Base: `http://localhost:8000/api/v1` · JSON · `snake_case` · ISO-8601 UTC timestamps.

---

## 0. Two contract-wide rules

### 0.1 Provenance is mandatory on every derived value

```
MODEL_DERIVED      produced by a trained model (class, bbox, mask, confidence, anomaly score)
HEURISTIC_DERIVED  produced by deterministic code, not learned (all evidence channels,
                   fusion output, priority score, change status)
OPERATOR_PROVIDED  supplied by a human (review verdicts, corrected labels/boxes)
DEMO_METADATA      synthetic, for demonstration only (fabricated nav where a dataset has none)
```

Every object below that carries a derived number carries its `provenance`. The UI **must**
render a provenance badge wherever a value is shown. `DEMO_METADATA` additionally forces a
persistent survey-level watermark. Calling the fusion score `MODEL_DERIVED` would be an
overclaim — it is a fitted logistic regression over model *and* heuristic inputs, and it is
labelled `HEURISTIC_DERIVED`.

### 0.2 "Unavailable" is a value, not a default

Any optional derived field is `null` **and** accompanied by a `reason`. There is no sentinel
`0.0`, no `-1`, no empty string. The canonical shape:

```jsonc
{ "applicable": false, "reason": "NADIR_NOT_RECOVERABLE", "score": null }
{ "applicable": true,  "reason": null, "score": 0.72, "...": "channel-specific fields" }
```

The frontend renders `applicable: false` as an explicit *"not computable — <reason>"* chip.
**Never as a zero, a blank, or a hidden row.** The gaps are part of the product.

---

## 1. Enumerations

```
SpatialReferenceLevel  L0_PIXEL_ONLY | L1_TILE_RELATIVE | L2_TRACK_RELATIVE | L3_SURVEYED
Provenance             MODEL_DERIVED | HEURISTIC_DERIVED | OPERATOR_PROVIDED | DEMO_METADATA | NONE
DetectionKind          KNOWN | UNKNOWN
DetectionSource        KNOWN_DETECTOR | KNOWN_SEGMENTER | OPEN_WORLD
UnifiedClass           PIPELINE | WRECK_OR_STRUCTURAL_DEBRIS | DERELICT_FISHING_GEAR
                       | ENGINEERING_STRUCTURE | UNKNOWN_ANOMALY_CANDIDATE
LabelCertainty         CERTAIN | UNCERTAIN
ReviewVerdict          CONFIRMED | REJECTED | RELABELLED | UNCERTAIN
ChangeStatus           NEW | UNCHANGED | REMOVED | NOT_SURVEYED
PersistenceMode        WINDOW_OVERLAP | SEQUENTIAL_PING
Channel                PORT | STARBOARD | DUAL | UNKNOWN
JobState               QUEUED | RUNNING | SUCCEEDED | FAILED
```

**`Detection` and `Anomaly` are one resource, discriminated by `kind`.** This is deliberate:
two parallel types would drift, and a single type lets the schema *enforce* that an
`UNKNOWN` never carries a class confidence. There is no `/anomalies` endpoint — filter
`/detections?kind=UNKNOWN`.

---

## 2. Canonical objects

### `Mission`
```jsonc
{
  "mission_id": "msn_porto_2026",
  "name": "Porto Pipeline Corridor",
  "operator": "NIOT Demo Operator",
  "created_at": "2026-08-30T09:00:00Z",
  "survey_ids": ["sv_001", "sv_002"],
  "notes": null
}
```
A Mission groups Surveys of the same area over time. It is the object survey-to-survey change
detection is scoped by.

### `Survey`
```jsonc
{
  "survey_id": "sv_001",
  "mission_id": "msn_porto_2026",
  "name": "Porto Pipeline — Baseline",
  "dataset_id": "subpipe",
  "sensor": "Klein 3500",
  "frequency_khz": 900.0,
  "acquired_at": "2024-05-14T00:00:00Z",
  "is_demo": false,
  "demo_banner": null,
  "spatial_reference_level": "L2_TRACK_RELATIVE",
  "level_reason": "nav CSV present; range scale not supplied",
  "frame_count": 512, "tile_count": 9216,
  "coverage_polygon": { "type": "Polygon", "coordinates": [] },
  "coverage_provenance": "HEURISTIC_DERIVED",
  "track": { "type": "LineString", "coordinates": [], "provenance": "NAV_DERIVED" },
  "capability_gates": {
    "nav_available": true, "ping_order_recoverable": true,
    "nadir_recoverable": true, "range_scale_known": false
  },
  "latest_run_id": "run_20260830_1412"
}
```
`capability_gates` drives the UI: **no surface may offer a control for a capability whose gate
is false.** When `is_demo` is true, `demo_banner` is non-null and must be rendered persistently.

### `SonarFrame`
```jsonc
{
  "frame_id": "subpipe_hf_000412",
  "survey_id": "sv_001",
  "index": 412,
  "width_px": 5000, "height_px": 500,
  "sensor": "Klein 3500", "frequency_khz": 900.0,
  "geometry": {
    "along_track_axis": "COLS", "along_sign": 1,
    "across_origin": "NADIR_CENTRE", "channel": "DUAL",
    "range_geometry": "UNKNOWN",
    "nadir_offset_px": 248, "nadir_confidence": 0.91,
    "range_scale_m_per_px": null, "altitude_m": 6.4,
    "level": "L1_TILE_RELATIVE", "level_reason": "range scale unknown"
  },
  "quality": {
    "speckle_index": 0.42, "dropout_fraction": 0.01,
    "attitude_banding_score": 0.08, "usable": true, "reason": null
  },
  "layers": { "raw": "/api/v1/frames/subpipe_hf_000412/raster?layer=raw",
              "enhanced": "…?layer=enhanced", "anomaly": "…?layer=anomaly" },
  "provenance": { "dataset_id": "subpipe", "source_filename": "…",
                  "licence": "GPL-3.0", "sha256": "…" }
}
```

### `Detection` — the central object
```jsonc
{
  "detection_id": "det_0f3a91",
  "run_id": "run_20260830_1412",
  "survey_id": "sv_001",
  "frame_id": "subpipe_hf_000412",
  "tile_id": "subpipe_hf_000412_t07",

  "kind": "KNOWN",
  "source": "KNOWN_DETECTOR",
  "category": "PIPELINE",
  "class_confidence": 0.81,
  "label_certainty": "CERTAIN",
  "anomaly_score": 0.34,

  "geometry": {
    "bbox_px": [1240.5, 188.0, 96.2, 41.7],
    "bbox_frame_px": [1240.5, 188.0, 96.2, 41.7],
    "mask_rle": null,
    "pics": { "ping_centre": 12408.0, "ping_span": 96.0,
              "range_centre_m": null, "range_span_m": null,
              "side": "STARBOARD",
              "along_centre_px": 1288.6, "across_centre_px": 208.8 }
  },

  "evidence": {
    "persistence": { "applicable": true, "reason": null, "score": 0.78,
                     "mode": "WINDOW_OVERLAP", "n_obs": 3, "n_opportunities": 4,
                     "support_ratio": 0.75, "scatter_px": 4.1, "scatter_m": null,
                     "track_id": "trk_119" },
    "shadow":      { "applicable": true, "reason": null, "score": 0.66,
                     "contrast_z": 2.4, "continuity": 0.71, "ordering_ok": true,
                     "shadow_len_px": 38.0, "implied_height_m": null,
                     "height_assumptions": [] },
    "context":     { "applicable": true, "reason": null, "score": 0.55,
                     "background_z": 1.9, "clutter_density": 0.12 },
    "completeness": []
  },

  "fusion": {
    "final_confidence": 0.87,
    "contributions": { "calibrated_det_logit": 1.42, "persistence_wilson": 0.61,
                       "shadow_score": 0.33, "context_z": 0.12,
                       "anomaly_score": 0.04, "log_opportunities": 0.09,
                       "shadow_applicable": 0.05, "clutter_density": -0.18 },
    "intercept": -1.85,
    "calibration_id": "cal_iso_v1",
    "fusion_model_id": "fusion_lr_v1"
  },

  "dimensions": {
    "length_px": 96.2, "width_px": 41.7,
    "length_m": null, "width_m": null, "area_m2": null,
    "estimator": "NONE", "reason": "range_scale_m_per_px unknown"
  },

  "geo": {
    "lat": 41.1421, "lon": -8.6702,
    "position_uncertainty_m": 12.0,
    "heading_deg": 78.4,
    "provenance": "HEURISTIC_DERIVED",
    "nav_source": "SubPipe INS EstimatedState",
    "spatial_reference_level": "L2_TRACK_RELATIVE",
    "reason": null
  },

  "model": { "model_version_id": "mv_003", "model_id": "sagar-yolo-s",
             "weights_sha256": "…", "confidence_at_prediction": 0.81,
             "device": "mps" },

  "review": { "latest_verdict": "CONFIRMED", "review_count": 1,
              "reviewed_at": "2026-08-30T15:02:00Z", "reviewer": "operator_1" },

  "change_status": "NEW",
  "priority": { "score": 0.74, "rank": 3 },

  "provenance": {
    "class": "MODEL_DERIVED", "evidence": "HEURISTIC_DERIVED",
    "fusion": "HEURISTIC_DERIVED", "geo": "HEURISTIC_DERIVED",
    "review": "OPERATOR_PROVIDED"
  }
}
```

**Schema-enforced invariants** (validator rejects violations; `tests/test_contract_invariants.py`):
1. `kind == "UNKNOWN"` ⟹ `category == "UNKNOWN_ANOMALY_CANDIDATE"` **and** `class_confidence == null`
2. `kind == "KNOWN"` ⟹ `category != "UNKNOWN_ANOMALY_CANDIDATE"`
3. any evidence channel with `applicable == false` ⟹ `reason != null` **and** `score == null`
4. `geo.lat != null` ⟹ `geo.provenance != "NONE"`; if `geo.provenance == "DEMO_METADATA"` then the parent survey has `is_demo == true`
5. `dimensions.length_m == null` ⟹ `dimensions.reason != null`
6. every `fusion.contributions` key exists in the registered fusion model's feature list

### `Review`
```jsonc
{
  "review_id": "rev_88af",
  "detection_id": "det_0f3a91",
  "verdict": "RELABELLED",
  "corrected_class": "WRECK_OR_STRUCTURAL_DEBRIS",
  "corrected_bbox_px": [1238.0, 186.0, 101.0, 44.0],
  "notes": "linear return is a debris field edge, not pipe",
  "reviewer": "operator_1",
  "created_at": "2026-08-30T15:02:00Z",
  "model_version_id_at_prediction": "mv_003",
  "confidence_at_prediction": 0.81,
  "training_eligible": true,
  "training_eligible_reason": null,
  "included_in_snapshots": ["snap_004"],
  "provenance": "OPERATOR_PROVIDED"
}
```
**Append-only.** A new verdict creates a new `Review`; it never mutates the Detection or a prior
Review. `Detection.review` is a derived summary of the latest one.
`training_eligible` is `false` with a reason when the source frame is in the active val/test
split — this is the feedback-leakage guard.

### `ModelVersion`
```jsonc
{
  "model_version_id": "mv_003", "model_id": "sagar-yolo-s", "version": "0.3.0",
  "parent_model_version_id": "mv_002",
  "architecture": "YOLOv12-s", "init_from": "coco-pretrained | gv-yolo12-safetensors",
  "framework": "ultralytics", "device_trained": "mps",
  "weights_sha256": "…", "size_mb": 21.4,
  "snapshot_id": "snap_004", "split_id": "split_002", "train_run_id": "run_20260830_1412",
  "classes": ["PIPELINE", "WRECK_OR_STRUCTURAL_DEBRIS"],
  "metrics_ref": "runs/run_20260830_1412/metrics.json",
  "calibration_id": "cal_iso_v1",
  "review_examples_included": 0,
  "is_active": true, "registered_at": "2026-08-30T14:12:00Z"
}
```

### `Benchmark` — served verbatim, never authored
```jsonc
{
  "run_id": "run_20260830_1412", "git_sha": "a91f0c2", "generated_at": "…",
  "device": "mps", "split_id": "split_002",
  "split_assertions": { "group_overlap_train_test": "PASS", "group_overlap_train_val": "PASS",
                        "near_duplicates": "PASS", "eval_ineligible_rows": "PASS",
                        "test_groups_have_positives": "PASS" },
  "detection": { "overall": { "precision": 0.0, "recall": 0.0, "f1": 0.0,
                              "map50": 0.0, "map50_95": 0.0 },
                 "per_class": {}, "per_dataset": {}, "per_site": {}, "per_frequency": {} },
  "open_set": { "folds": [], "mean_auroc": 0.0, "mean_auprc": 0.0, "fpr_on_seabed": 0.0 },
  "segmentation": { "iou": null, "dice": null },
  "operational": { "fp_per_km": 0.0, "latency_ms_p50": 0.0, "latency_ms_p95": 0.0,
                   "fps": 0.0, "model_size_mb": 0.0, "peak_rss_mb": 0.0 },
  "ablations": []
}
```
**Any metric key absent from this payload must not appear in the UI.** The frontend renders
`run_id` and `git_sha` beside every metrics table.

### `SurveyChange`
```jsonc
{
  "change_id": "chg_01", "comparison_id": "cmp_07",
  "baseline_survey_id": "sv_001", "new_survey_id": "sv_002",
  "status": "REMOVED",
  "baseline_detection_id": "det_0f3a91", "new_detection_id": null,
  "distance_m": null, "match_score": null,
  "inside_new_coverage": true,
  "baseline_confirmed_by_operator": true,
  "provenance": "HEURISTIC_DERIVED"
}
```
`status == "REMOVED"` requires `inside_new_coverage == true`. Outside coverage yields
`NOT_SURVEYED`. `baseline_confirmed_by_operator` lets the UI show whether the comparison ran
against human-confirmed history — the visible payoff of the memory layer.

### `RecoveryPriority`
```jsonc
{
  "detection_id": "det_0f3a91", "score": 0.74, "rank": 3,
  "config_version": "priority_weights@v1",
  "components": {
    "confidence":       { "weight": 0.30, "value": 0.87, "contribution": 0.261 },
    "persistence":      { "weight": 0.20, "value": 0.78, "contribution": 0.156 },
    "anomaly_evidence": { "weight": 0.15, "value": 0.66, "contribution": 0.099 },
    "footprint":        { "weight": 0.15, "value": 0.40, "contribution": 0.060 },
    "class_weight":     { "weight": 0.12, "value": 0.60, "contribution": 0.072 },
    "newness":          { "weight": 0.08, "value": 1.00, "contribution": 0.080 }
  },
  "provenance": "HEURISTIC_DERIVED",
  "disclaimer": "Transparent decision support. Not a learned ecological-risk model."
}
```
`components` must sum to `score`; asserted in tests and reproducible from the stored breakdown.

---

## 3. Endpoints

```
GET    /health

# Missions & surveys
GET    /missions                                   → Mission[]
POST   /missions                                   → Mission
GET    /missions/{id}                              → Mission (+ embedded surveys)
GET    /surveys/{id}                               → Survey
POST   /surveys/{id}/ingest                        → { job_id }
GET    /surveys/{id}/frames?offset&limit           → SonarFrame[] (paged)

# Rasters
GET    /frames/{frame_id}/raster?layer=raw|enhanced|anomaly   → image/png
GET    /tiles/{tile_id}/raster?layer=…                        → image/png

# Detections
GET    /surveys/{id}/detections
         ?kind=KNOWN|UNKNOWN &category &min_confidence &change_status
         &review=none|reviewed|confirmed|rejected &sort=priority|confidence &offset&limit
                                                   → { items: Detection[], total }
GET    /detections/{id}                            → Detection
GET    /detections/{id}/evidence/shadow            → { crop_png_url, profile: number[], band_px }
GET    /detections/{id}/evidence/persistence       → { observations: [{tile_id, bbox_px, conf}] }

# Memory / feedback
POST   /detections/{id}/reviews                    → Review
GET    /detections/{id}/reviews                    → Review[]   (full history)
GET    /memory/queues/hard-negatives?limit         → Detection[]
GET    /memory/queues/corrections?limit            → Detection[]
GET    /memory/queues/hard-positives?limit         → Detection[]
GET    /memory/stats                               → { reviewed, confirmed, rejected,
                                                       relabelled, training_eligible,
                                                       by_model_version: {} }

# Models & benchmarks
GET    /models                                     → ModelVersion[]
GET    /models/{id}                                → ModelVersion
GET    /benchmarks                                 → Benchmark        (active run)
GET    /benchmarks/{run_id}                        → Benchmark

# Change detection
POST   /compare  { baseline_survey_id, new_survey_id, confirmed_only?: bool }
                                                   → { comparison_id, summary, changes[] }
GET    /comparisons/{id}                           → { summary, changes: SurveyChange[] }

# Reports
GET    /surveys/{id}/report?format=json|csv|geojson  → file download

# Jobs
GET    /jobs/{job_id}                              → { job_id, state, stage, progress, error }
GET    /jobs/{job_id}/events                       → text/event-stream
```

### Error envelope
```jsonc
{ "error": { "code": "COMPARISON_REFUSED",
             "message": "Both surveys must reach L2_TRACK_RELATIVE to compare.",
             "detail": { "baseline_level": "L1_TILE_RELATIVE" } } }
```
Codes: `NOT_FOUND` · `VALIDATION_FAILED` · `COMPARISON_REFUSED` · `CAPABILITY_UNAVAILABLE` ·
`MODEL_UNAVAILABLE` · `JOB_FAILED` · `INTERNAL`.
Messages are operator-facing: what went wrong and what would fix it. No stack traces, no
apologies.

### Pagination
List endpoints take `offset` / `limit` (default 50, max 500) and return `{ items, total }`.
A survey can hold thousands of detections; the frontend must never assume it can fetch them all.
