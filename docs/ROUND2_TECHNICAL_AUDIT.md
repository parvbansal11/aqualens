# Aqualens — Round-2 Technical Audit

**Scope:** Smart India Hackathon 2026, PS 26057 (MoES / NIOT), Round 2 (PPT / technical evaluation).
**Audited state:** branch `main`, HEAD `4d4b18e` plus untracked `artifacts/`, `scripts/build_epitome_v{2,3,4}_*`, `scripts/screen_epitome_v4_candidates.py`, `scripts/validate_epitome_v4_bundle.py`, `tests/fixtures/`.
**Audit date:** 2026-09-25.
**Mode:** read-only. No code, model, runtime, or configuration was changed. Nothing was committed or pushed. This file is the only thing written.

---

## 0. Method and evidence standard

1. **Source code and artifacts decide; documentation is only a claim.** Where docs and code disagree, the code wins, and the disagreement is reported as a finding.
2. Every number in this audit comes from a file in the repository or from a read-only calculation over retained artifacts (`data/runtime/runtime_surveys.json`, frozen metrics, dataset metadata). Each is cited.
3. Where the repository cannot establish something, this audit says **UNKNOWN**. It does not guess.
4. **Not done in this pass:** no test suite run, no model inference, no frontend build. The test counts quoted come from repository docs and a `grep` count. The deployed (Vercel/Railway) frontend build was not inspected.
5. **The exact PS 26057 text is not in the repository.** The PS matrix (§5) is rebuilt from `docs/RESEARCH.md §1`, the numbered "official requirement" references in `docs/ML_PLAN.md` and `docs/EVALUATION_PROTOCOL.md`, and the checklist you supplied. Paste the verbatim PS into the repository before Round 2 (P0-9).

Status vocabulary (Phase 2):

| Status | Meaning used here |
|---|---|
| **VALIDATED** | A reproducible measurement or test in the repository backs the specific claim. |
| **IMPLEMENTED_BUT_UNVALIDATED** | Code runs on the live path. Nothing measures whether it is correct or useful. |
| **EXPERIMENTAL** | Code or artifacts exist off the live path, or were tried and rejected or failed. |
| **DEMO_ONLY** | Exists to make the demo presentable. Not a measurement. |
| **PLANNED** | Designed in docs, not implemented. |
| **UNAVAILABLE** | Neither implemented nor designed for the current build. |

---

## EXECUTIVE VERDICT: what decides Round 2

Aqualens's **engineering discipline is real and unusual for a hackathon**. It has leakage-aware splits with temporal embargoes, checksum-pinned frozen artifacts, nullable evidence channels that are never zero-filled, refusal gates, a Contact/observation separation, and an honest rejection of its own Natural Clutter model. That discipline is the strongest asset, and it is defensible.

The **perception core is weak and none of the five differentiators has a quantitative validation.** Worse, several demo-facing artifacts would fail a hostile inspection. These are the eight facts a technical judge could use to sink the submission:

| # | Finding | Evidence |
|---|---|---|
| **F1** | **The documented internal-round "Epitome" bundle is synthetic, and its flagship persistence Contact comes from one image uploaded three times.** `sonar_0001/0002/0003.png` are byte-identical (SHA-256 `5e678df8…`). Frames 0001–0005 are clean geometric renderings (a line with dots, circles with rectangular "shadows", a polygon "wreck") that match no dataset in the repository. The mission file declares `SEQUENTIAL_PING` with invented contiguous ping ranges. README and `INTERNAL_HACK_FREEZE.md` still describe it as the verified baseline, and `JUDGE_DEMO_RUNBOOK.md` calls its coordinates "real recorded". | `data/runtime/demo/Aqualens_Epitome_v2_Offshore_Demo.zip` (`image_inventory.json`, `mission.json`, `provenance.json`); `docs/JUDGE_DEMO_RUNBOOK.md` "EPITOME DEMO FILE"; `docs/INTERNAL_HACK_FREEZE.md` "Known-working demo" |
| **F2** | **The user-facing Contact "confidence" is a display sigmoid that forces every Contact into 70–90 %.** A raw 0.044 SHIPWRECK shows 70.7 %. A raw 0.181 PIPELINE on a natural-terrain frame with no object shows 89.9 %. Its centre was fitted to the median of the synthetic Epitome v2 run. | `packages/sagar/vnext/evidence.py` (`DemoConfidenceNormalizationPolicy`, `normalize_demo_confidence`); retained surveys `survey_upload_c4c56e532038`, `survey_upload_d4509c0858c8` |
| **F3** | **SHIPWRECK held-out recall is 0.** The headline "overall precision 0.734" is a macro-average that includes SHIPWRECK's degenerate precision of 1.0 at zero recall. Excluding it, mean precision is 0.60 and mean recall is 0.49. | `ml/artifacts/final_v1/detector/metrics.json` |
| **F4** | **Consecutive SubPipe frames are sliding windows of the same pings.** Frame *t+1* is frame *t* shifted 20 rows, so 480 of 500 rows are identical (mean absolute difference 0.0). "Sequential-ping persistence" across adjacent SubPipe frames therefore re-observes the same pixels. The v3 demo's synthetic ping bounds nonetheless declare the frames disjoint. | Read-only check on `1693573517.84.pbm` → `1693573518.84.pbm` (LF and HF); `artifacts/demo/EPITOME_V3_SELECTION_REPORT.md` |
| **F5** | **When navigation is present, Contact association merges distinct objects on the same frame.** Two crab pots 340 px apart, found by full-frame inference, become one Contact labelled `WINDOW_OVERLAP_ONLY`. | `packages/sagar/vnext/contacts.py:25`; `survey_upload_c4c56e532038` |
| **F6** | **Six of the seven v4 "real-data" demo frames are in the detector's own training split.** The selection report says the Rec9 frame comes "from the held-out test split". It is in the detector's *train* split: it sat in the raw PING `test/` folder but was reassigned. | `artifacts/demo/EPITOME_V4_SELECTION_REPORT.md` vs `data/processed/multidomain_sonar_v1_1_20260831/canonical/metadata.jsonl` |
| **F7** | **The open-set ("KING USP") threshold does not transfer to how runtime scores observations.** The memory and the q99.5 threshold use per-patch unit vectors from 512² SubPipe tiles. Runtime scores the *mean* of 16 unit vectors from a padded bbox crop. All 86 calibration frames are in the detector's training split. On 70 retained runtime observations, 21 % are flagged against a 0.5 % design rate, 64 % of PING crab-pot observations are flagged, and Spearman ρ(score, crop size) = 0.71. The channel appears to respond to domain and crop geometry. No positive evaluation exists. | `ml/experiments/build_open_set_v1.py`; `packages/sagar/perception/runtime.py:203`; `packages/sagar/api/app.py:561`; `ml/artifacts/vnext/open_set_v1/metrics.json` |
| **F8** | **Acoustic-shadow validation never runs.** Runtime always passes `nadir_x=None`. The fusion component called `acoustic_shadow` is really a bright-pixel fraction for PIPELINE boxes. Survey change detection always refuses: `coverage_polygon` is hard-coded `False`. Recovery priority cannot reach HIGH for any Contact without declared sequential pings. | `packages/sagar/api/app.py:556, 937–947`; `packages/sagar/vnext/priority.py` |

**Bottom line:** Round 2 is winnable only if the PPT **stops presenting unvalidated evidence as validated**, **retires the synthetic and training-set demo material**, and **replaces claims with 4–6 measured figures** (§10). None of that needs a new model or feature. It needs measurements the codebase is already close to producing.

---

# PHASE 1 — System reconstruction

## 1.1 Two stacks live in one repository

| Stack | Detector | Where | Status |
|---|---|---|---|
| **Runtime (VNEXT)**: what the workstation and judges see | `final_v1` YOLO11s, 3 classes, SHA `2aa3ac71…0b15` | `packages/sagar/perception/runtime.py`, `packages/sagar/vnext/*`, `packages/sagar/api/app.py` (`/api/v1/runtime/*`, `/api/v1/surveys/upload`) | Live |
| **Legacy Stage 3C**: frozen evidence run | `internal_v2` YOLO11s, PIPELINE only, SHA `f94d9346…` | `packages/sagar/pipeline/stage3c.py`, `packages/sagar/evidence/*`, `packages/sagar/fusion/calibration.py`, `packages/sagar/mission/priority.py`; outputs in `runs/run_stage3c_v4/` | Loaded at API startup and served by legacy endpoints (`/api/v1/benchmarks`, `/api/v1/surveys/survey_subpipe_mini2_internal_v2/*`). Not the workstation path. |

The **scientifically richer components** (Wilson-bound window persistence, range-matched shadow, isotonic + logistic fusion, config-driven priority) exist **only in the legacy stack**. There they either never became applicable (shadow: `NADIR_NOT_RECOVERABLE` on 100 % of rows) or failed to fit (calibration: 0 positive validation matches). The runtime stack uses simpler heuristic substitutes.

## 1.2 End-to-end runtime path, as executed

```
UPLOAD (PNG/JPEG/PBM or ZIP[+navigation.csv][+mission.json])          app.py upload_survey/_decode_upload
  │  4xx on unreadable raster / bad metadata; no raw XTF/JSF support
  ▼
INGEST  rasters sorted by filename; navigation rows keyed by filename;             perception/navigation.py
        sequential contract only if mission.json declares it AND ping_start/end given
  ▼
PREPROCESS  none. PIL → RGB (gray replicated), no despeckle/TVG/slant-range correction.  runtime.py infer()
  ▼
DETECT  if w>1024 or h>1024 or aspect>1.6 → TILED: 768² tiles, 30 % overlap (stride 538),
        conf ≥ 0.12, class-aware NMS IoU 0.45; else FULL_FRAME at Ultralytics default conf (0.25).
        imgsz 640. Device: CUDA → MPS → CPU.                                            runtime.py
        + DEMO: if tiled and no SHIPWRECK survived → second tiled pass at conf 0.01,
          SHIPWRECK-only, union-find cluster ≥3 proposals IoU≥0.15 → injected SHIPWRECK    runtime.py:247–316
  ▼
CONDITION  per frame: dynamic range, entropy, near-black rows, central dark band → quality_score  vnext/conditions.py
  ▼
VERIFY  physics: verify_candidate(..., nadir_x=None) → ALL NULL, "UNKNOWN_ORIENTATION"   app.py:556
        PIPELINE only: verify_pipeline_acoustics → bright/dark fraction, elongation       vnext/physics.py
  ▼
OPEN-SET  per observation: padded crop → YOLO layer-16 → 4×4 pool → mean of unit vectors
          → nearest-neighbour distance to 2,048-vector SubPipe background memory; flag if ≥ 0.4617  app.py:559–567
  ▼
ASSOCIATE  greedy grouping into Contacts (class match; 35 m if both geo; else same frame or
           declared-sequential adjacent frame; normalized centre ≤ 0.12)                   vnext/contacts.py
  ▼
PERSIST  persistence_score = 0.15 unless declared SEQUENTIAL_PING across ≥2 distinct frames   contacts.py:85
  ▼
FUSE  evidence_score (weighted mean, UNVALIDATED_EVIDENCE_FUSION)                         evidence.py score_contact
      confidence (noisy-OR + agreement → DEMO_BOUNDED_SIGMOID 0.70–0.90)                  evidence.py fuse_contact_confidence
  ▼
LOCALIZE  every observation inherits its frame's navigation row (lat/lon copied); bbox position ignored  navigation.py
  ▼
PRIORITIZE  mean(evidence_score, persistence_score, quality_score) → band/action           vnext/priority.py
  ▼
REVIEW  append verdict to finding.review_history in runtime_surveys.json; re-prioritize   app.py:757
  ▼
MEMORY  /runtime/memory/stats tallies verdicts into 4 named queues; no export for runtime reviews
  ▼
REPORT  JSON (record + provenance) / CSV (contacts | observations). No PDF.               app.py runtime_report
  ▼
CHANGE  /runtime/surveys/{id}/change → always COMPARISON_REFUSED (level ≤ L1, coverage False)  app.py:925–1000
```

## 1.3 Component-by-component real state

| Component | What really happens |
|---|---|
| Sonar ingestion | Rasters only (PNG/JPEG/PBM, or ZIP). **No XTF/JSF/SDF/raw ping parsing.** Navigation CSV requires `frame, timestamp_utc, latitude, longitude`. `heading_deg, speed_mps, altitude_m, ping_start, ping_end` are optional. `altitude_m` and `speed_mps` are parsed then **dropped**: `frame_navigation_view` does not carry them. |
| Preprocessing | Runtime: none. Training data: tiles built from **raw** grayscale (`sagar/io/tiling.py`). A median+equalize "enhanced" layer is written but not used for training tiles. Runtime and training both use raw pixels, which is consistent. Sonar-specific augmentation (speckle, TVG jitter, ping dropout) is specified in `ML_PLAN.md §4`, but **the final_v1 training augmentation config is not in the repository (UNKNOWN)**. |
| Frozen detector | YOLO11s `final_v1`, checksum enforced at load (`runtime.py FinalDetector.load`). |
| Known-class detection | PIPELINE, SHIPWRECK, CRAB_POT. Raw class and confidence are immutable per observation. |
| Contact abstraction | Implemented (`fuse_contacts`), with the association bug in F5. |
| Temporal persistence | Only when the uploader declares it and supplies ping bounds. The score is a hand formula (§3.5). No count of missed opportunities. |
| Acoustic-shadow verification | **Not executed.** Physics is always null at runtime. |
| Open-set evidence | Executed per observation (§3.6). Advisory flag. |
| Evidence fusion | Two parallel scores: `evidence_score` (weighted mean) and `confidence` (noisy-OR + demo sigmoid). |
| Contact confidence normalization | `DEMO_BOUNDED_SIGMOID_V1`, always 0.70–0.90. |
| Geolocation | Frame-level copy of supplied coordinates. Every demo coordinate in the repository is synthetic. |
| Navigation | Parsed, validated, displayed. Not used geometrically (no heading/range/layback projection). |
| Survey comparison / change | Runtime endpoint always refuses. `compare_detections` is unit-tested but only wired to a legacy endpoint that compares the frozen survey with itself. |
| Recovery priority | Runtime: 3-term mean. The documented config engine (`configs/priority_weights.yaml`, `mission/priority.py`) is used only by legacy Stage 3C, where it returns `None` because metric area is unavailable. |
| Analyst review | Append-only verdict events on the runtime JSON state. |
| Training memory | Runtime: verdict tallies only. The export script (`scripts/export_review_memory.py`) reads **only the legacy SQLite DB**. The feedback-leakage guard (`feedback_training_eligible`) applies **only to legacy detections**. |
| Reports | JSON + CSV (contacts / observations). Provenance block is real. |
| Model Lab | Reads `ml/artifacts/final_v1/detector/metrics.json`. Shows overall P/R/F1, including the degenerate SHIPWRECK macro effect. |
| Offline / edge | Local FastAPI + PyTorch (MPS/CPU). No edge-device, ONNX, INT8, or Core ML measurement. A cloud deployment (Railway + Vercel) is documented. |

---

# PHASE 2 — Implementation truth table

## 2.1 Summary

| # | Capability | Status |
|---|---|---|
| 1 | Raster survey ingestion (PNG/JPEG/PBM/ZIP) | VALIDATED (functional) |
| 2 | Native sonar formats (XTF/JSF/SDF) and ping-level metadata | UNAVAILABLE |
| 3 | Navigation / mission metadata ingest | VALIDATED (functional parsing) |
| 4 | Runtime sonar preprocessing (despeckle, TVG, slant-range correction) | UNAVAILABLE |
| 5 | Sonar-specific training augmentation | PLANNED (use in final_v1 unrecorded) |
| 6 | Sonar Condition Engine | IMPLEMENTED_BUT_UNVALIDATED |
| 7 | Frozen YOLO11s: PIPELINE and CRAB_POT (dataset representation) | VALIDATED |
| 8 | SHIPWRECK supervised detection | EXPERIMENTAL (failed held-out test) |
| 9 | SHIPWRECK recovery pass and display policy | DEMO_ONLY |
| 10 | Runtime inference path (768 tiling, NMS, thresholds) | IMPLEMENTED_BUT_UNVALIDATED |
| 11 | Contact association | IMPLEMENTED_BUT_UNVALIDATED (defect F5) |
| 12 | Temporal persistence (SEQUENTIAL_PING) | IMPLEMENTED_BUT_UNVALIDATED |
| 13 | Window-overlap persistence with Wilson bound | EXPERIMENTAL (legacy only) |
| 14 | Acoustic-shadow validation | UNAVAILABLE (runtime); EXPERIMENTAL (legacy, never applicable) |
| 15 | Pipeline acoustic hard-return verifier | IMPLEMENTED_BUT_UNVALIDATED |
| 16 | Open-set anomaly evidence (`open_set_v1`) | IMPLEMENTED_BUT_UNVALIDATED |
| 17 | Natural Clutter Suppressor v1 | EXPERIMENTAL (rejected) |
| 18 | Evidence Score (`UNVALIDATED_EVIDENCE_FUSION`) | IMPLEMENTED_BUT_UNVALIDATED |
| 19 | Contact Confidence raw fusion (`CONTACT_EVIDENCE_FUSION_V1`) | IMPLEMENTED_BUT_UNVALIDATED |
| 20 | Confidence normalization (`DEMO_BOUNDED_SIGMOID_V1`) | DEMO_ONLY |
| 21 | Probability calibration (isotonic + logistic fusion) | EXPERIMENTAL (fit never succeeded) |
| 22 | Geolocation: frame-level coordinate copy | IMPLEMENTED_BUT_UNVALIDATED |
| 23 | Geolocation: object-level (pixel → world) | UNAVAILABLE |
| 24 | Real INS navigation from SubPipe (L2 track-relative) | PLANNED |
| 25 | Metric dimensions | UNAVAILABLE |
| 26 | Change detection (NEW/UNCHANGED/NOT_DETECTED/NOT_SURVEYED) | PLANNED |
| 27 | Comparison refusal gates | VALIDATED (deterministic; always refuses today) |
| 28 | Recovery priority (runtime rule) | IMPLEMENTED_BUT_UNVALIDATED (ceiling defect) |
| 29 | Recovery priority (config engine, 6 components) | EXPERIMENTAL (legacy only; returns None) |
| 30 | Analyst review (append-only verdicts) | VALIDATED (functional) |
| 31 | Persistent training memory (runtime) | IMPLEMENTED_BUT_UNVALIDATED |
| 32 | Feedback-leakage guard | VALIDATED (legacy path only); UNAVAILABLE on runtime path |
| 33 | Curated retraining from memory | PLANNED |
| 34 | JSON / CSV reports | VALIDATED |
| 35 | PDF reports | UNAVAILABLE |
| 36 | Model Lab | VALIDATED (displays frozen artifact; content caveat) |
| 37 | Offline / local execution | IMPLEMENTED_BUT_UNVALIDATED (no edge benchmark) |
| 38 | Segmentation / masks | EXPERIMENTAL (S1 failed); UNAVAILABLE in runtime |
| 39 | RF-DETR | UNAVAILABLE |

## 2.2 Details

Each block gives: SOURCE · ARTIFACTS · ALGORITHM · INPUT → OUTPUT · VALIDATION · LIMITATION · SAFE CLAIM · UNSAFE CLAIM.

### 1. Raster survey ingestion — VALIDATED (functional)
- **Source:** `packages/sagar/api/app.py` (`upload_survey`, `_decode_upload`, `_open_raster_size`)
- **Artifacts:** none
- **Algorithm:** stream to disk (512 MiB cap), ZIP path-traversal guard, decode check per raster, sort by filename
- **I/O:** file → job id plus classified failure codes (`UNREADABLE_RASTER`, `EMPTY_BUNDLE`, `UNSAFE_ARCHIVE`, …)
- **Validation:** `tests/test_runtime_api_resilience.py` (25 tests), `tests/test_navigation_ingest.py` (17)
- **Limitation:** rasters only. Frame order is filename order. Grayscale sonar is replicated to RGB.
- **Safe claim:** "Ingests PNG/JPEG/PBM rasters or ZIP survey bundles, validates them before inference, and reports classified failures."
- **Unsafe claim:** "Ingests raw sonar data" or "reads sonar metadata" (no XTF/JSF; §5).

### 2. Native sonar formats / ping metadata — UNAVAILABLE
- **Safe claim:** "Raster-level ingest today. Native formats are future work (PINGMapper-style decoding)."
- **Unsafe claim:** any claim of reading `.xtf/.jsf/.sdf` or per-ping attitude/altitude.

### 3. Navigation / mission ingest — VALIDATED (functional)
- **Source:** `packages/sagar/perception/navigation.py`
- **Algorithm:** strict CSV schema, range checks, duplicate-frame rejection. `mission.json` sequential contract.
- **I/O:** `navigation.csv` → per-frame `{lat, lon, heading, timestamp}`
- **Validation:** 17 Python tests plus frontend tests
- **Limitation:** `altitude_m` and `speed_mps` are parsed but not propagated. One fix per frame, not per ping. **Every navigation file shipped in the repository's demo bundles is synthetic.**
- **Safe claim:** "Attaches supplied navigation to frames. Never invents coordinates."
- **Unsafe claim:** "Real recorded coordinates" for any Epitome bundle. "Geolocates targets."

### 4. Runtime preprocessing — UNAVAILABLE
- **Source:** `runtime.py infer()` (RGB conversion only). `sagar/preprocess/pipeline.py` is dataset-build only, and its output is not used for training tiles.
- **Safe claim:** "Raw pixels are preserved end-to-end. Image condition is measured, not cosmetically enhanced."
- **Unsafe claim:** "Speckle removal", "TVG correction", "slant-range correction".

### 5. Sonar-specific augmentation — PLANNED (use in final_v1 UNKNOWN)
- **Source:** `docs/ML_PLAN.md §4`. The final_v1 training notebook and args are not in the repository. `ml/artifacts/shipwreck_diagnosis_v1/README.md` notes that Ultralytics applies default Albumentations regardless.
- **Unsafe claim:** "Trained with speckle / ping-dropout augmentation mapped to PS requirements 3, 4, 6." Nothing in the repository shows this happened.

### 6. Sonar Condition Engine — IMPLEMENTED_BUT_UNVALIDATED
- **Source:** `packages/sagar/vnext/conditions.py`
- **Algorithm:** `q = clip(0.45·dyn + 0.25·H/6 + 0.30·(1 − dropout − black), 0, 1)`, where
  - `dyn = (p98 − p02)/(max − min)`
  - `H` = 64-bin Shannon entropy (bits)
  - `dropout` = fraction of rows with ≥ 92 % near-black pixels
  - `black` = fraction of pixels ≤ max(1, p1)
  - Flags: `LOW_DYNAMIC_RANGE`, `HORIZONTAL_DARK_BAND`, `HIGH_INVALID_PIXEL_FRACTION`, `CENTRAL_DARK_BAND_ESTIMATED`. Motion is always `UNKNOWN`.
- **Validation:** unit tests on synthetic arrays. No correlation with detection quality measured.
- **Limitation:** the frame-level score is injected as **positive object evidence** in both fusion scores (§3.8–3.9).
- **Safe claim:** "Measures raster conditions (dynamic range, dark bands, dropout rows) and records them with every Contact."
- **Unsafe claim:** "Detects heave/pitch/roll artefacts", "compensates motion".

### 7. Frozen YOLO11s: PIPELINE and CRAB_POT — VALIDATED (at dataset-representation level)
- **Source:** `ml/artifacts/final_v1/detector/{best.pt,metrics.json,manifest.json}`
- **Validation:** single held-out test evaluation (§4.6)
- **Limitation:**
  - Test metrics were computed on the Kaggle tile representation (SubPipe 512² tiles, PING 640², AI4Shipwrecks full image), **not through the runtime path** (768² tiles, different NMS and thresholds).
  - PIPELINE test data is later minutes of the same mission and pipeline.
  - Each class comes from a different sensor (§4.8).
- **Safe claim:** "On a group- and time-held-out test split, PIPELINE AP50 0.52 (P 0.68, R 0.55) and CRAB_POT AP50 0.43 (P 0.52, R 0.44)."
- **Unsafe claim:** "73 % precision", "production-grade", "generalizes to other sensors".

### 8. SHIPWRECK supervised detection — EXPERIMENTAL (failed)
- **Evidence:** held-out R = 0.00, AP50 = 0.0149. Validation mAP50-95 = 0.0032. S1 segmentation retry: validation box P = 0.003, R = 0.028.
- **Root cause is documented** in `ml/artifacts/shipwreck_diagnosis_v1/` (§4.9).
- **Safe claim:** "SHIPWRECK failed our held-out test. We diagnosed why (label fragmentation, tiny boxes, 0.17 % sampling exposure) and did not ship it as a measured capability."
- **Unsafe claim:** any SHIPWRECK detection claim.

### 9. SHIPWRECK recovery pass and display — DEMO_ONLY
- **Source:** `runtime.py:247–316` (conf 0.01, cluster ≥ 3 proposals with IoU ≥ 0.15, envelope box) and `perception/demo_policy.py`
  - display = `min(0.94, max(0.72, 0.85·raw + 0.15))`
  - spatial-consensus display = `0.55 + 0.30·(0.4·min(1,n/10) + 0.3·min(1,tiles/4) + 0.3·meanIoU)`
- **Runs by default** in every tiled inference that has no SHIPWRECK. This roughly **doubles detector passes** for those frames.
- **Unsafe claim:** any SHIPWRECK label shown without the DEMO_HEURISTIC disclosure. "The model detects wrecks."

### 10. Runtime inference path — IMPLEMENTED_BUT_UNVALIDATED
- **Source:** `runtime.py`: 768² tiles, 30 % overlap, conf 0.12 (tiled) vs 0.25 (full-frame default), NMS 0.45
- **Limitation:**
  - **Train/inference scale mismatch.** SubPipe was trained as 512² tiles upscaled ×1.25 to 640. Runtime uses 768² tiles downscaled ×0.83, so objects appear at 0.67× their training scale. A 500-row SubPipe strip gets 268 rows of zero padding at runtime.
  - AI4Shipwrecks was trained as full 1728-wide images downscaled to 640 (×0.37). At runtime it is tiled (×0.83), so objects appear about 2.2× larger than in training.
  - The operating confidence threshold depends on raster size.
- **Validation:** tiling unit tests only (`tests/test_runtime_tiling.py`). **No held-out end-to-end evaluation through this path.**

### 11. Contact association — IMPLEMENTED_BUT_UNVALIDATED (defect)
- **Source:** `packages/sagar/vnext/contacts.py`
- **Defect F5:** when both observations carry navigation, `_compatible` returns on world distance alone (`contacts.py:25`). Frame-level fixes are identical for all observations on a frame, so distance is 0 m, and **every same-class detection on that frame merges regardless of image position.** Observed: `survey_upload_c4c56e532038` merges crab pots at x = 113 and x = 457 (full-frame inference, no tiles) and labels the result `WINDOW_OVERLAP_ONLY`.
- **Secondary issues:**
  - Greedy matching compares only against the last member of each group.
  - The equirectangular distance omits cos(lat).
  - Two Contact fields disagree: `open_set_candidate` is always `False`; `is_open_set_candidate` is set.
- **Safe claim (after fix):** "Deterministic association of immutable observations into Contacts, with the association basis recorded."
- **Unsafe claim (today):** "One Contact = one object".

### 12. Temporal persistence — IMPLEMENTED_BUT_UNVALIDATED
- **Algorithm:** §3.5
- **Every `SEQUENTIAL_PING` Contact in the repository's retained runtime data (69 of 546 Contacts) comes from bundles with declared, synthetic ping bounds:** `sequence.zip` 25, "Epitome Judge Demo" 22, v3 18, v2 4.
- **Unsafe claim:** "Temporal persistence verified", or any use of the Epitome 3-observation Contact (F1). Also "independent re-observation" across adjacent SubPipe frames (F4).

### 13. Window-overlap persistence (Wilson) — EXPERIMENTAL
- **Source:** `packages/sagar/evidence/persistence.py`
- **Algorithm:** Wilson lower bound (90 %) on `n_obs / n_opportunities` over covering tiles
- **Used only by legacy Stage 3C** on the superseded `internal_v2` model. Not in runtime.

### 14. Acoustic-shadow validation — UNAVAILABLE (runtime) / EXPERIMENTAL (legacy)
- **Runtime:** `verify_candidate(pixels, bbox, None, condition)` → all fields null, `UNKNOWN_ORIENTATION` (`app.py:190, 556`).
- **Legacy:** `evidence/shadow.py range_matched_shadow` (§3.7) returned `NADIR_NOT_RECOVERABLE` for every Stage 3C row (`heldout_test_evidence_metrics.json`: `shadow.applicable = 0`).
- **Axis-convention hazard:** documented in `physics.py`. The legacy code treats rows as range; runtime `verify_candidate` treats columns as range.
- **Safe claim:** "Shadow evidence is designed and coded but disabled until range-side geometry is known. We never infer it."
- **Unsafe claim:** "Acoustic-shadow validation" as a working differentiator.

### 15. Pipeline acoustic hard-return verifier — IMPLEMENTED_BUT_UNVALIDATED
- **Algorithm:** §3.7. Measures bright pixels, not shadows.
- **The repository's own disclosure** (`docs/PIPELINE_ACOUSTIC_VERIFIER.md`): five legitimate SubPipe pipelines and one shadow-like false positive **all** returned `INSUFFICIENT_EVIDENCE`. No discrimination has been shown.
- **Naming hazard:** it feeds the fusion component called `acoustic_shadow`.

### 16. Open-set anomaly evidence — IMPLEMENTED_BUT_UNVALIDATED
- **Source:** `ml/experiments/build_open_set_v1.py`, `ml/artifacts/vnext/open_set_v1/`, `vnext/openset.py`, `app.py:559–567`, `runtime.py open_set_embedding`
- **Validation:** background-only calibration. `positive_anomaly_evaluation.status = NOT_EVALUATED`.
- **Measured issues:** F7, detailed in §3.6.
- **Safe claim:** "An advisory dissimilarity score against a SubPipe seabed reference memory built from frozen detector features. High means unlike that reference, not artificial."
- **Unsafe claim:** "Detects unknown objects", "open-set recognition", "flags artificial anomalies", any FPR or AUROC figure.

### 17. Natural Clutter v1 — EXPERIMENTAL (rejected)
- **Evidence:** `ml/artifacts/vnext/kaggle_20260902_final/experiment_decision.json`. Validation-only operational test on 25 AI4Shipwrecks images: FP 23 → 19, TP 2 → 0.
- **Safe claim:** "We tested a learned clutter gate, it removed true positives, and we rejected it."
- This honesty is an asset. Use it.

### 18. Evidence Score — IMPLEMENTED_BUT_UNVALIDATED (§3.8)
### 19. Contact Confidence raw fusion — IMPLEMENTED_BUT_UNVALIDATED (§3.9)
### 20. DEMO_BOUNDED_SIGMOID_V1 — DEMO_ONLY (§3.10)
- **Unsafe claim:** any "Confidence NN %" presented as belief that the object exists.

### 21. Calibration (isotonic + logistic fusion) — EXPERIMENTAL
- **Source:** `sagar/fusion/calibration.py`, `pipeline/stage3c.py IsotonicCalibrator`
- **Result:** Stage 3C found 0 positive validation matches (`validation_labels.positive_matched_pipeline = 0`), so calibration and fusion were never fitted. `ml/artifacts/stage3c_alignment_debug_v1/examples.json` shows predictions at y ≈ 380–420 against GT at y ≈ 1–116 on the same tiles. **The alignment failure was never resolved.**
- **Also unverified:** Stage 3C matches Ultralytics `boxes.xywh` (centre format) against annotation `bbox_xywh` (top-left format) using a top-left IoU (`stage3c.py _iou`). Treat any Stage 3C evidence metric as void.

### 22–24. Geolocation
- **22. Frame-level copy — IMPLEMENTED_BUT_UNVALIDATED.** Coordinates are copied verbatim. All shipped demo tracks are `SYNTHETIC_DEMO_METADATA` / `SYNTHETIC_DEMO_NAVIGATION` (Arabian Sea v2, Bay of Bengal v3/v4).
- **23. Object-level — UNAVAILABLE.** Bbox → lat/lon is not computed (§3.11).
- **24. SubPipe INS — PLANNED.** `EstimatedState.csv` carries local x/y/z (m), roll/pitch/yaw, depth, and DVL altitude per camera timestamp. It is never used. This is the only real navigation in the repository.

### 25. Metric dimensions — UNAVAILABLE
- Pixel bbox only. `range_scale_known: false` (`configs/datasets/subpipe.yaml`).
- The runtime field `pixel_dimensions` is the **image** size, not the object size.

### 26–27. Change detection
- **26 — PLANNED.** `compare_detections` requires callers to supply `matched_baseline_id` and coverage. No matcher exists.
- **27 — VALIDATED.** The refusal gates (`app.py:925–1000`) are deterministic. Because `coverage_polygon` is hard-coded `False` and the level is capped at `L1_FRAME_RELATIVE`, **every real comparison is refused by construction**, not by measurement.
- **Safe claim:** "Change semantics are defined and enforced. REMOVED is never inferred from absence. Comparisons without shared coverage are refused."
- **Unsafe claim:** "Survey-to-survey change detection" as a working capability.

### 28–29. Recovery priority
- **28 — IMPLEMENTED_BUT_UNVALIDATED.** `vnext/priority.py`: `π = mean(evidence_score, persistence_score, quality_score)`.
  - **Ceiling defect:** persistence is 0.15 for every non-sequential Contact, so `π ≤ (1 + 0.15 + 1)/3 = 0.717 < 0.75`. HIGH and `RECOVERY_CANDIDATE` are **unreachable** without declared sequential pings.
  - Retained runtime data shows LOW 492, MEDIUM 41, HIGH 13 of 546 Contacts.
  - `change_state` is read but unused.
- **29 — EXPERIMENTAL.** `mission/priority.py` with `configs/priority_weights.yaml` (six weighted components: confidence .30, persistence .20, anomaly .15, footprint .15, class .12, newness .08). It is used only in Stage 3C, where it returns `None` because `area_m2` is unknown.
- **Safe claim:** "Transparent rule-based triage over available evidence."
- **Unsafe claim:** "Recovery priority engine" with class, footprint, and newness terms (not in runtime), or any ecological risk claim.

### 30–33. Review and memory
- **30 — VALIDATED (functional).** Verdicts `CONFIRMED`, `REJECTED`, `RELABELLED`, `UNCERTAIN` are appended. Priority is re-derived.
- **31 — IMPLEMENTED_BUT_UNVALIDATED.** Queues are verdict counts over `runtime_surveys.json`. "Append-only" is an API convention; the JSON file is rewritten wholesale. No manifest export exists for runtime reviews.
- **32.** `feedback_training_eligible` (`tests/test_feedback_leakage.py`) guards only legacy SQLite detections. **A runtime review of a detector test-split image (for example the PING Rec15 frame in v4) is not flagged ineligible.**
- **33 — PLANNED.** `online_learning = false`.
- **Safe claim:** "Analyst verdicts are recorded append-only and routed into named curation queues for an operator-triggered future retraining round."
- **Unsafe claim:** "Self-learning", "improves with every review".

### 34–39
- **34. JSON/CSV — VALIDATED** (tests; provenance block).
- **35. PDF — UNAVAILABLE** (refused, never simulated).
- **36. Model Lab — VALIDATED** as a faithful display of `metrics.json`. The content caveat is F3.
- **37. Offline/local — IMPLEMENTED_BUT_UNVALIDATED.** Local MPS inference works. The only latency numbers are GPU-server numbers and legacy MPS tile numbers (§4.12).
- **38. Segmentation — EXPERIMENTAL / UNAVAILABLE.**
- **39. RF-DETR — UNAVAILABLE.**

---

# PHASE 3 — ML pipeline reconstruction

## 3.1 Which model is frozen?
- `ml/artifacts/final_v1/detector/best.pt`, SHA-256 `2aa3ac71051856bcfc8ec400804995f03568aa26d1a1fb24583e4eb1b7a10b15`, model id `sagardrishti_multidomain_v1_1_yolo11s`, snapshot `multidomain_sonar_v1_1_20260831`.
- **Architecture:** Ultralytics YOLO11s (anchor-free, decoupled head). Init: COCO `yolo11s.pt` per `kaggle_offline/` (the init record itself is **UNKNOWN**; `metrics.json` does not state it).
- **Training:** Kaggle, NVIDIA RTX PRO 6000 Blackwell (94.97 GiB), torch 2.10.0+cu128, Ultralytics 8.4.135, imgsz 640, ≤ 50 epochs, patience 10, seed 26057, 54.5 min.
- **Selection:** validation mAP50-95. YOLO11s 0.1061 beat YOLO11m 0.0977 and YOLO11l 0.0802.
- **Test policy:** "one metric evaluation after validation winner freeze".
- **Load-time integrity:** SHA must match (`FinalDetector.load`). The API refuses to start without the file.

## 3.2 Exact supervised classes
`0 PIPELINE`, `1 SHIPWRECK`, `2 CRAB_POT`. `unknown_is_supervised: false`. `configs/classes.yaml` names these `WRECK_OR_STRUCTURAL_DEBRIS` and `DERELICT_FISHING_GEAR`, but the frozen model and runtime use the names above.

## 3.3 Exact datasets
SubPipe full (Zenodo 10.5281/zenodo.12666132, GPL-3.0), AI4Shipwrecks (DOI 10.7302/dmf4-x492, CC-BY-4.0 asserted locally), and PING/GhostVision crab-pot data (HF `PINGEcosystem/sss-crab-pot-detection-ds`, conflicting local licence declarations, "PRIVATE TEAM ONLY"). Composition in §4.

## 3.4 How observations become Contacts
For each finding, sorted by `(frame_index, detection_id)`:

1. Find existing groups *g* where `compatible(g[-1], finding)`. Append to the first match, or start a new group.
2. `compatible(a, b)`:
   - `a.raw_class == b.raw_class` (required)
   - if both have lat/lon → **return** `111000·√((Δlat)² + (Δlon)²) ≤ 35 m` (no image-position check: defect F5)
   - elif both `sequential_observation_supported` → require `|frame_index_a − frame_index_b| ≤ 1`
   - elif different `source_frame_id` → incompatible
   - finally, normalized centre distance `‖c_a − c_b‖₂ ≤ 0.12`
3. Contact fields:
   - `max_raw_confidence`, `mean_raw_confidence`
   - `best_observation_id` (argmax raw)
   - `distinct_frame_observation_count` *n*
   - `window_overlap_duplicate_count = |obs| − n`
   - `persistence_evidence_type ∈ {SEQUENTIAL_PING, WINDOW_OVERLAP_ONLY, UNKNOWN, SINGLE_OBSERVATION}`
   - lat/lon of the first observation
   - `contact_id = sha256(joined detection ids)[:12]`

## 3.5 How temporal persistence is calculated (runtime)

```
genuine = all observations have sequential_observation_supported AND valid integer ping_start ≤ ping_end
n       = number of distinct frame_index values in the Contact
c       = length of the final run of pings where ping_start_i == ping_end_{i−1} + 1   (resets to 1 on a gap)

persistence_score p = 0.15                                  if n ≤ 1 or not genuine
                    = min(1, 0.35 + 0.13·n + 0.25·c/n)      otherwise
```

Values: n = 2 consecutive → **0.86**; n = 3 → **0.99**; n ≥ 4 → 1.0.

Fusion support: `s_pers = max(0, (p − 0.15)/0.85)`, giving 0 / 0.835 / 0.988.

**What it does not do:**
- It does not count opportunities where the object *should* have been seen and was not. 2-of-2 and 2-of-20 score identically.
- It does not use the Wilson bound specified in `ML_PLAN.md §7` and implemented in legacy `evidence/persistence.py`.
- It does not check that the declared ping bounds match the pixels (F4).

Every constant is **heuristic**.

## 3.6 How open-set evidence is calculated

**Memory construction** (`ml/experiments/build_open_set_v1.py`):
- Reference tiles: 3,558 annotation-free **train** 512² tiles from SubPipe Mini2 snapshot `snap_2fa4bca0a0bc4b7d`.
- For each tile: YOLO11s forward at imgsz 640, capture **layer 16** (P3/8 neck output, 128 channels), adaptive-average-pool to 4×4, and L2-normalize each of the 16 cell vectors: `u_{t,k} ∈ ℝ¹²⁸, ‖u‖ = 1`.
- 56,928 patch vectors → **deterministic `linspace` subsample to 2,048**. This is *not* a greedy k-centre coreset: `config.coreset.method = deterministic_linspace`.
- Calibration: 1,041 annotation-free **val** tiles × 16 = 16,656 patch scores, `s = min_j ‖u − m_j‖₂`. Then **τ = Q₀.₉₉₅ = 0.4616784453**. Background statistics: mean 0.108, median 0.099, max 0.617.

**Runtime scoring** (`app.py:559–567`, `runtime.py open_set_embedding`):

```
crop C  = bbox expanded by pad = max(8, 0.5·max(w,h)) px on every side (clipped to image)
F       = layer16( YOLO.predict(C, imgsz=640) )                       # crop is letterboxed/resized to 640
u_k     = pool4x4(F)_k / ‖pool4x4(F)_k‖                               k = 1..16
q       = (1/16) Σ_k u_k                                              # ‖q‖ ≤ 1, equality only if all cells agree
a       = min_j ‖q − m_j‖₂                                            # anomaly_score
open-set candidate  ⟺  a ≥ τ                                          # τ fixed; the per-survey q99.5 rule in ML_PLAN is not used
Contact anomaly     = max over supporting observations
fusion support      s_os = max(0, (min(a,1) − τ) / (1 − τ))
```

**Why the threshold does not transfer:**
- ‖q − m‖² = ‖q‖² + 1 − 2 q·m ≥ (1 − ‖q‖)². The runtime score therefore contains a **within-crop heterogeneity term** that the per-patch calibration distribution never had. Heterogeneous crops (objects plus background) have smaller ‖q‖ and score higher, independent of novelty.
- Runtime crops are bbox-scaled and resampled to 640. Calibration tiles were fixed 512² SubPipe windows.
- **All 86 calibration frames and all 290 memory frames are in the detector's own training split.** Verified by matching Mini2 source filenames to `multidomain_sonar_v1_1` metadata. The threshold is calibrated on imagery the feature extractor was fitted to.
- The reference is single-site, single-sensor (Klein 3500, Porto).

**Empirical red flags** (read-only analysis of 70 unique scored observations in `data/runtime/runtime_surveys.json`; uncontrolled sample, not an evaluation):
- 15/70 = **21 %** flagged, against a design rate of 0.5 % on background.
- PING crab-pot observations: **7/11 (64 %)** flagged. SubPipe: 2/6. AI4/other: 7 %.
- Spearman ρ(anomaly score, padded crop side) = **0.71**.

These fit a channel responding to sensor-domain shift and crop geometry. Open-set is **statistical** (τ is a quantile) but **not validated for its claimed purpose**.

## 3.7 How acoustic evidence is calculated

**Runtime physics** (`verify_candidate`): with `nadir_x=None`, returns `{all scores: None, physics_flags: [UNKNOWN_ORIENTATION]}`. Always the case in the runtime.

**Runtime PIPELINE verifier** (`verify_pipeline_acoustics`, PIPELINE observations only):

```
context  = bbox padded by max(3, 0.5·max(w,h)) px
bg       = median(context);  s = max(1, 1.4826·MAD(context))
bright   = frac(crop ≥ bg + s);   dark = frac(crop ≤ bg − s)
hard     = clip((bright − 0.08)/0.45, 0, 1)            → evidence_strength
elong    = max(w,h)/min(w,h)
status   = SUPPORTED                 if hard ≥ 0.55 and elong ≥ 3
         = WEAK_SUPPORT              if hard > 0.10
         = ACOUSTICALLY_INCONSISTENT if dark ≥ 0.70 and bright ≤ 0.08
         = INSUFFICIENT_EVIDENCE     otherwise
shadow_status = UNAVAILABLE (always)
```

**Legacy shadow** (`range_matched_shadow`, not in runtime; needs a row-based nadir):

```
band       = rows immediately +u_range of the box, length min(3·h, H/4)
background = same rows, flanking columns (range-matched)
contrast_z = (μ_bg − mean(band)) / σ_bg
continuity = frac(rows of band with mean < μ_bg − 1.5·σ_bg)
ordering   = mean(highlight strip) > μ_bg
score      = clip(0.5·tanh(max(0,contrast_z)/2) + 0.35·continuity + 0.15·ordering, 0, 1)
```

**How is a shadow tied to its object?** Only geometrically, by adjacency in the +range direction. It is never computed today. Nothing in the repository resolves which object a shadow belongs to when objects are adjacent.

## 3.8 Evidence Score (`score_contact`, `UNVALIDATED_EVIDENCE_FUSION`)

```
E = Σ_{k∈A} w_k·v_k / Σ_{k∈A} w_k            A = components with non-null value
w = {detector .30, persistence .25, physics .18, quality .15, anomaly .07, artificiality .05}
v_detector = max raw confidence
v_persistence = persistence_score   (the 0.15 baseline IS included)
v_physics = None (runtime), also forced None when pipeline verifier = INSUFFICIENT_EVIDENCE
v_quality = mean frame quality_score of supporting observations
v_anomaly = raw open-set distance (NOT thresholded; not clamped)
v_artificiality = None (Natural Clutter not loaded)
```

In practice A = {detector, persistence, quality, anomaly} and the denominator is 0.77. **Unavailable channels are excluded and the rest renormalized.** This part is true and correctly implemented.

Worked example (v4 PIPELINE, raw 0.695): E = (0.30·0.695 + 0.25·0.15 + 0.15·0.692 + 0.07·0.366)/0.77 = **0.488**, matching the stored value.

## 3.9 Contact Confidence raw fusion (`fuse_contact_confidence`, `CONTACT_EVIDENCE_FUSION_V1`)

Supports `s_k ∈ [0,1]`:

| Component | Weight w_k | Support s_k |
|---|---:|---|
| raw_detector | .65 | max raw confidence |
| temporal_persistence | .70 | (p − 0.15)/0.85 |
| acoustic_shadow | .60 | pipeline verifier `hard`, only if SUPPORTED/WEAK_SUPPORT |
| physics | .35 | physics_consistency (null at runtime) |
| sonar_condition | .20 | frame quality_score |
| open_set_anomaly | .30 | (a − τ)/(1 − τ), floored at 0 |
| artificiality | .15 | null |
| navigation_consistency | .15 | null ("fixes locate a frame; not object evidence") |

```
A⁺            = {k : s_k available and s_k > 0}
base          = 1 − Π_{k∈A⁺} (1 − w_k·s_k)                      (weighted noisy-OR)
g             = mean_{k<l ∈ A⁺} s_k·s_l      (0 if |A⁺| < 2)     (pairwise agreement)
raw_fused     = min(1, base + (1 − base)·0.18·g)
```

**Missing channels:** excluded, never zero-filled, true to the docs. By construction, adding any positive channel can only raise the score. The number of available channels therefore inflates confidence regardless of correctness.

**Worked examples (reproduced exactly from stored values):**
- v4 PIPELINE: raw 0.695, acoustic 0.12, condition 0.692 → base 0.5616, g 0.2158 → **raw_fused 0.579**.
- v4 SHIPWRECK: raw 0.044, condition 0.826 → base 0.1891 → **raw_fused 0.194**. **The image-quality channel supplies ~85 % of it.**
- v3 PIPELINE on `Exploratory_B_06.png` (AI4Shipwrecks `extras/terrain`, no object): raw 0.181, "acoustic_shadow" 0.60 (bright pixels), condition 0.63 → **raw_fused 0.516**.
- v3 CRAB_POT on SubPipe pipeline pings (cross-domain false alarm): raw 0.179, persistence support 0.835 (the two frames share 96 % of pixels) → **raw_fused 0.697**.

## 3.10 Normalized confidence, and why the UI shows 0.70–0.90

```
normalized = confidence = 0.70 + 0.20 · σ(28 · (raw_fused − 0.3139777305538386))
σ(x) = 1/(1 + e^(−x))
```

- It is **bounded to (0.70, 0.90) for every Contact by construction**. raw_fused = 0 gives 0.700; 0.15 gives 0.702; 0.314 gives 0.800; ≥ 0.47 gives ≈ 0.90.
- The centre 0.31398 is "the median raw-fused value from the Epitome v2 regression run". That is the synthetic, triplicated bundle (F1).
- The four examples above display 0.90, 0.707, **0.899**, and **0.90**.
- Where it appears: API `confidence` / `normalized_confidence`, the Contact CSV column **`confidence`** (first confidence column), and JSON reports.
- **This repository's committed workstation screens render `raw_confidence`, `display_confidence`, and `evidence_score`. They do not render the normalized Contact confidence.** If a UI build shows 0.70–0.90, it is reading `confidence` / `normalized_confidence`. Which deployed build does so is **UNKNOWN** from this repository.

## 3.11 How a bounding box becomes latitude/longitude

It does not. `finding_navigation_view(nav_record)` copies the frame's single row (`latitude`, `longitude`) to every observation on that frame. The bbox pixel position, side (port/starboard), slant range, altitude, heading, and layback are unused. The Contact takes the first observation's coordinates. `localization_uncertainty_m` is always `None` / `UNAVAILABLE`.

## 3.12 Learned vs statistical vs heuristic

| Quantity | Kind |
|---|---|
| YOLO11s weights, raw class scores, layer-16 features | **Learned** (supervised, frozen) |
| Open-set memory (subsample of learned features), τ = q99.5 | **Statistical** (fitted to background only) |
| Normalization centre 0.31398 | **Statistical**, but a statistic of a synthetic demo run, not of ground truth |
| All fusion weights, agreement 0.18, sigmoid steepness 28 and range 0.70–0.90 | **Heuristic** |
| Persistence formula; association gates (35 m, 0.12, gap 1); quality formula; pipeline-verifier thresholds | **Heuristic** |
| Tile 768 / overlap 0.30 / conf 0.12 / NMS 0.45; recovery constants; demo display maps; priority bands | **Heuristic** |
| Natural Clutter classifier | Learned (rejected, not loaded) |

## 3.13 Calibrated probabilities vs not

**No value in the runtime is a calibrated probability.**
- Raw YOLO scores are uncalibrated classifier outputs. No reliability diagram or ECE exists anywhere in the repository.
- `evidence_score`, `raw_fused_confidence`, `confidence`/`normalized_confidence`, `anomaly_score`, `quality_score`, `persistence_score`, and `priority_score` are all **not** probabilities.
- The only calibration code (isotonic + logistic, `fusion/calibration.py`) never produced a fitted model.

---

# PHASE 4 — Dataset and evaluation truth

## 4.1 Source corpora (`multidomain_sonar_v1_1_20260831/canonical/metadata.jsonl`, `qa/qa.json`)

| Source | Images | Instances | Geometry | Sensor / site | Labels |
|---|---:|---:|---|---|---|
| SubPipe (full) | 4,884 (HF 2,443 @ 5000×500; LF 2,441 @ 2500×500) | 4,941 PIPELINE | waterfall strips | Klein 3500, LAUV, Porto, one pipeline mission | COCO boxes; median box height ≈ 96 % of tile (pipeline runs along-track) |
| AI4Shipwrecks | 286 (width 1728; height 13–18,745) | 994 SHIPWRECK | full images | Thunder Bay, Lake Huron (freshwater), 28 wreck sites | **Boxes = 8-connected components of binary masks** |
| PING / GhostVision | 6,674 (640×640) from 2,139 augmentation parents | 9,311 CRAB_POT | Roboflow-exported, pre-augmented | consumer Humminbird, Delaware waters | boxes; single category "Crab-Pot" |

## 4.2 Split methodology and leakage protection

| Source | Unit | Train / Val / Test (images) | Groups | Strength |
|---|---|---|---|---|
| SubPipe | **source-time blocks of 300 s**: train bins 0–18, embargo 19–21, val 22–23, embargo 24–26, test 27–31 | 2,702 / 382 / 1,800 | 1 group per split | Strong against pixel leakage. **Same pipeline, same site, same sensor: temporal, not geographic, hold-out.** |
| AI4Shipwrecks | wreck site. Official test kept; train wrecks split into train/val | 140 / 26 / 120 | 13 / 3 / 13 wrecks | Strong, but tiny (val has 11 positive images) |
| PING | recovered recording or contact id before augmentation (targets 76/12/12) | 5,010 / 791 / 873 | 384 / 123 / 145 | ~80 % recording-grouped (reasonable). **~24 % grouped per contact/per image (`ping_contact_N`, `ping_ti####`, `ping_bc_post`, …): WEAK** |

**Build-time assertions (all PASS):** source-group leakage, augmentation-parent leakage, cross-split exact duplicates (SHA), cross-split near-duplicates (dHash + pixel check), box/mask validity, corrupt images, non-empty splits.

**Not asserted:**
- A frequency hold-out (planned in `EVALUATION_PROTOCOL §1`). HF and LF of the same pings share a split.
- Feedback leakage on the runtime path.

## 4.3 Training corpus (detection representation, `metrics.json preflight`)

| | Images | Positive | Background | PIPELINE | SHIPWRECK | CRAB_POT |
|---|---:|---:|---:|---:|---:|---:|
| Train | 44,940 | 10,902 | 34,038 | 6,901 | 576 | 7,254 |
| Val | 6,547 | 1,498 | 5,049 | 931 | 71 | 972 |
| Test | 28,743 | 5,804 | 22,939 | 5,084 | 347 | 1,085 |

- SubPipe contributes 512² tiles at 50 % overlap. Most background tiles are SubPipe.
- AI4Shipwrecks and PING contribute whole images.
- **The test set is ~97 % SubPipe tiles and 4.4× the size of validation.**

## 4.4 Preprocessing and tiling
- **Training:** raw grayscale tiles (SubPipe), zero-padded; other sources unchanged; Ultralytics letterbox to 640.
- **Runtime:** 768² / 30 % tiling (§2.2 #10). **Different from training.**

## 4.5 Augmentation and class imbalance
- **Augmentation: UNKNOWN.** No training args in the repository. Ultralytics defaults, if used, include mosaic, HSV jitter, and left-right flip, which `ML_PLAN.md §4` forbids for sonar.
- **Imbalance:**
  - SHIPWRECK instances are 3.9 % of training instances.
  - SHIPWRECK-positive images are **76 / 44,940 = 0.17 %** of draws (`class_exposure.json`). That is ~0.05 positive images per batch of 32.
  - No balanced sampling was recorded, despite `ML_PLAN.md §5` calling for "dataset-balanced" sampling.

## 4.6 Frozen-model metrics (held-out test, one evaluation)

| | Precision | Recall | AP50 / mAP50 | mAP50-95 | F1 (derived) |
|---|---:|---:|---:|---:|---:|
| **PIPELINE** | 0.680 | 0.549 | 0.524 | 0.180 | 0.608 |
| **CRAB_POT** | 0.524 | 0.441 | 0.428 | 0.158 | 0.479 |
| **SHIPWRECK** | 1.000* | **0.000** | 0.015 | 0.004 | 0 |
| Macro (Ultralytics "overall") | 0.734 | 0.330 | 0.322 | 0.114 | — |
| Macro excl. SHIPWRECK (derived) | 0.602 | 0.495 | 0.476 | 0.169 | — |

\* Precision 1.0 at recall 0 is degenerate: no true positives at the operating point.

**Validation (winner):** P 0.696, R 0.203, mAP50 0.212, mAP50-95 0.106. **Test recall is higher than validation recall.** That fits a composition difference between the splits (see 4.3), not generalization.

## 4.7 Evaluation components that do not exist
- **Open-set evaluation:** none with positives (`NOT_EVALUATED`). The leave-one-class-out protocol (`ML_PLAN §6`) was never run on final_v1.
- **Persistence evaluation:** none. Stage 3C window-overlap numbers are on the superseded model, and its GT matching failed.
- **Acoustic evidence evaluation:** none. Stage 3C shadow was applicable to 0 rows. The pipeline verifier showed no discrimination on 6 examples.
- **Contact-level evaluation:** none. No association precision/recall, no Contact-level P/R, no FP per km.
- **Runtime-path evaluation:** none on held-out frames.
- **Robustness:** corruption images generated, **every metric `null`** (`robustness_results.json`: `UNAVAILABLE_UNTIL_FROZEN_DETECTOR_EXECUTED`).
- **Ablation:** only rows A (frozen YOLO, SHIPWRECK val, TP 2 / FP 23 / FN 69) and E (Natural Clutter). Rows B, C, D, G are `null`.

## 4.8 The class-sensor confound (the most serious ML-design attack)
Each class comes from exactly one sensor/domain:
- PIPELINE = Klein 3500 waterfall tiles
- SHIPWRECK = AI4Shipwrecks full images
- CRAB_POT = 640² Humminbird images

**Per-class metrics are also per-domain metrics.** Nothing measures whether the detector recognizes objects or sensors. Observed symptoms:
- CRAB_POT detections on SubPipe pipeline frames: raw 0.179 in v3, 0.194 in v4.
- PIPELINE detections on AI4Shipwrecks natural terrain: raw 0.181.
- Open-set flags 64 % of PING observations.

## 4.9 SHIPWRECK failure is diagnosed, not mysterious (`ml/artifacts/shipwreck_diagnosis_v1/`)
- Labels are 8-connected mask components: **7.6 boxes per positive image** (p90 11, max 59). Median normalized box area is 0.00027.
- At imgsz 640, **47 % of train boxes are < 64 px² and 71.5 % are < 256 px²**.
- Exposure is 0.17 % of draws.
- A v1.2 candidate (area ≥ 256 px filter, 3×/5× oversampling) was prepared but never trained or frozen.

This makes a good scientific-rigour slide: *we found why, and we refused to paper over it.*

## 4.10 Effective sample size (not previously documented)
Consecutive SubPipe frames overlap by 480/500 rows (F4; verified on one LF/HF pair). If the 20-row step holds across the corpus, each ping appears in ~25 consecutive frames. The 1,800-frame SubPipe test set is then roughly 36 independent 500-ping windows per channel, and tile-level PIPELINE metrics are computed over highly correlated samples. **Confidence intervals must use time-block bootstrap, not per-tile resampling.**

## 4.11 Weaknesses an experienced ML judge can attack
1. The headline macro precision is inflated by a degenerate class (F3).
2. Class = sensor confound (4.8).
3. PIPELINE "held-out" is the same mission, pipeline, and sensor. Temporal only.
4. Test metrics come from the training representation, not the deployed runtime path.
5. Augmentation config is missing, so "sonar-valid augmentation" is unverifiable.
6. Single seed, no confidence intervals, no PR curves or failure galleries in the repository.
7. SubPipe redundancy (4.10).
8. Weak PING grouping for ~24 % of images.
9. Validation selection on a 10-minute SubPipe segment and 3 wreck sites.
10. No calibration of any displayed score.
11. The open-set threshold is calibrated on detector-training frames with a mismatched representation.
12. Demo imagery is mostly training-split (F6) or synthetic (F1).
13. Licensing: PING is "PRIVATE TEAM ONLY", SubPipe is GPL-3.0. Redistribution of the weights is unresolved.

## 4.12 Latency (what exists)
| Measurement | Device | Result | Source |
|---|---|---|---|
| final_v1, 200 images @ 640 | RTX PRO 6000 (server GPU) | mean 25.7 ms, median 22.6 ms, p95 83.7 ms, ~38.9 img/s | `final_v1/detector/metrics.json` |
| internal_v2 YOLO11s (same architecture), 100 tiles | Apple M5 Pro MPS | raw forward 4.97 ms/tile (batch 16); end-to-end 10.9 ms/tile; decode 0.75 ms; peak RSS ≈ 1.2 GB | `ml/artifacts/stage3c_v4/latency.json` |
| final_v1 runtime path per frame / per survey | any | **not measured** | — |
| Edge device, CPU-only, ONNX, INT8 | — | **not measured** | — |

Runtime cost note: a 5000×500 SubPipe frame needs 10 tile passes, **plus 10 more** for the SHIPWRECK recovery pass whenever no wreck is found, plus one forward pass per observation for open-set.

---

# PHASE 5 — PS 26057 fit

**The exact PS text is not in the repository.** The rows below combine `docs/RESEARCH.md §1`, the numbered "official requirements" in `ML_PLAN.md` / `EVALUATION_PROTOCOL.md` (3 speckle, 4 range-dependent gain, 6 heave/pitch/roll dropouts, 9 rock/natural false positives), and your checklist.

| PS requirement | Aqualens implementation | Status | Evidence | Gap | Judge attack | Defensible response |
|---|---|---|---|---|---|---|
| **Separate natural seabed from artificial objects (primary objective)** | Detector plus advisory open-set plus human review. Natural Clutter rejected. | **GAP** | `experiment_decision.json`; no FP-on-natural-seabed measurement | No validated natural-vs-artificial component | "Your primary objective has no measured component." | "Correct. Our learned gate failed recall preservation and was rejected. We measure natural-seabed false-alarm rate (Fig. E5) and keep the analyst in the loop. We do not claim automatic discrimination." |
| Marine debris / anomaly detection | Known classes plus open-set flag | PARTIAL | §3.6 | Open-set unvalidated | "What debris?" | Present only after E3. |
| Ghost nets / abandoned gear | CRAB_POT (derelict pots) only | PARTIAL (proxy) | PING corpus | No net class or net data | "Crab pots aren't ghost nets." | "Correct. Derelict pots are the only public labelled gear data. We never call it a net detector." |
| Shipwrecks | SHIPWRECK class failed; demo heuristic | **GAP** | R = 0 | — | "Recall zero." | Show the diagnosis (§4.9). Disable the heuristic. |
| Pipelines | PIPELINE | VALIDATED (single mission) | AP50 0.52 | Single site | "Same pipeline in test." | "Temporal hold-out with 15-min embargo. Cross-site generalization is untested." |
| Cylinders | none (open-set only) | **UNAVAILABLE** | — | No class, no data | "Mines/cylinders?" | "Not supervised. Would surface only as advisory dissimilarity." |
| Unknown anomalies | open-set advisory | IMPLEMENTED_BUT_UNVALIDATED | F7 | Threshold not transferable | "What makes UNKNOWN unknown?" | §7 Q12 |
| Speckle | no despeckle; condition engine measures | **GAP** | robustness nulls | Robustness unmeasured | "How do you handle speckle?" | Needs E6 robustness curve. |
| Varying resolution / range-dependent gain | tiling; resolution recorded; no TVG | PARTIAL | — | Scale mismatch (§2.2 #10) | "Different sonars, different resolution?" | Needs runtime-path eval (E2). |
| Acoustic shadows | not computed at runtime | **GAP** | `app.py:556` | Geometry unknown | "Where is shadow analysis?" | "Implemented, deliberately disabled without range-side geometry." Weak unless E7 runs. |
| Dropouts / heave-pitch-roll / motion | dark-row detection; motion UNKNOWN | PARTIAL | `conditions.py` | No attitude ingest; dropout overlap computed but unused | "Motion artefacts?" | "We measure dropout rows and flag overlap. We don't estimate motion from imagery." |
| False-positive suppression | persistence (declared only), human review | **GAP** | — | No FP/km measured | "How many false alarms per km?" | Needs E2/E4. |
| Confidence scoring | raw + unvalidated fusion + demo sigmoid | **GAP** (credibility) | §3.9–3.10 | No calibration | "Why trust 90 %?" | Show raw score + decomposition only (P0-2). |
| Dimensions | pixel bbox only | **UNAVAILABLE** | — | Range scale unknown | "Object length in metres?" | "Needs sample spacing and altitude. Not fabricated." |
| Geolocation | frame-level copy of supplied fix | PARTIAL | §3.11 | Not object-level; demo nav synthetic | "How does a box become lat/lon?" | §7 Q14 |
| Read sonar / navigation metadata | navigation.csv / mission.json | PARTIAL | `navigation.py` | No native sonar metadata; altitude dropped | "Read XTF?" | "No, raster plus nav CSV." |
| Edge / onboard efficiency | local MPS path | PARTIAL | §4.12 | No edge benchmark | "Runs on an AUV?" | "Local inference is shown. Edge is unmeasured." Needs E8. |
| JSON / CSV reports | yes | VALIDATED | tests | — | — | — |
| Operator UI + downloadable reports | Next.js workstation | VALIDATED (functional) | freeze doc | No PDF | — | — |
| Survey change (beyond PS core) | refusal gates only | PLANNED | §2.2 #26 | No matcher | — | Keep as design, not USP. |

---

# PHASE 6 — The five differentiators

## 6.1 Open-set anomaly awareness
- **What actually exists:** a frozen-feature nearest-neighbour score against SubPipe background, a fixed threshold, and an advisory flag carried to Contacts, fusion, UI, and CSV.
- **Scientific basis:** PatchCore (Roth et al., 2022) style memory-bank anomaly detection. Sound in principle for industrial inspection, where the reference domain equals the test domain.
- **Implementation:** §3.6. Runs and is versioned.
- **Validation:** none with positives. The threshold was calibrated on detector-training frames.
- **Novelty:** moderate. Reusing the detector's own features for open-set is reasonable. Strict separation from the class taxonomy is good design.
- **PS relevance:** high ("unknown anomalies", "debris").
- **Strongest evidence:** clean provenance; background-only calibration with no test leakage *into the threshold*.
- **Weakest assumption:** that distance from one Porto pipeline mission's seabed means "unusual object" on other sensors. The 64 % PING flag rate suggests it means "different sensor".
- **Likely judge question:** "What's your FPR on natural seabed from another sonar, and AUROC for objects vs background?"
- **Defensible answer today:** "Not yet measured. We only claim dissimilarity from a reference." Weak, but honest.
- **Best experiment (E3):**
  - Fix the representation: score per-patch minimum/maximum distances, identical to calibration, not the mean vector.
  - Calibrate τ on **detector-held-out** background.
  - Evaluate on held-out test crops: known objects (all three classes, all treated as "not background") vs annotation-free background, **per domain**.
  - Report AUROC, AUPRC, FPR@τ, and the per-domain background flag rate.
  - Optional: a pseudo-leave-one-domain-out experiment (memory built from SubPipe + PING background, tested on AI4 wrecks vs AI4 terrain).

## 6.2 Temporal persistence verification
- **What actually exists:** a declared-contract `SEQUENTIAL_PING` score plus "window overlap" bookkeeping. The Wilson-bound version is in legacy code only.
- **Scientific basis:** strong and sonar-specific. Real objects are stationary; speckle is not. Multi-look corroboration is standard.
- **Implementation:** §3.5. Heuristic constants, no miss counting.
- **Validation:** none. All observed instances come from synthetic or overlapping frames (F1, F4).
- **Novelty:** moderate. GhostVision also tracks temporally. The Contact framing is a good product abstraction.
- **PS relevance:** high (false-positive suppression, speckle, transients).
- **Strongest evidence:** the conceptual refusal to count window overlap as temporal. That was correctly fixed in a prior audit.
- **Weakest assumption:** that declared ping bounds are real and frames are independent.
- **Likely judge question:** "Show me that persistence reduces false alarms without losing targets."
- **Best experiment (E4):**
  - Reconstruct the true SubPipe waterfall (20-row step) with real ping indices.
  - Slide *disjoint* 500-ping windows through held-out test segments.
  - For GT pipelines and for detector false positives, measure survival across k consecutive independent windows.
  - Report FP/km and recall for "k-of-n" filtering (k = 1, 2, 3).
  - PING recordings with sequential frame numbers (`RecNN_…_000xx`) offer a second, point-target test.

## 6.3 Acoustic-shadow validation
- **What actually exists:** legacy range-matched shadow code and an axis-ambiguous `verify_candidate`. Both are disabled. The runtime "acoustic" channel is a bright-pixel fraction.
- **Scientific basis:** strongest of all five. Shadow length and geometry are first-principles SSS physics. NIOT evaluators know it well.
- **Implementation:** not on the live path.
- **Validation:** none. 0 applicable rows in Stage 3C.
- **Novelty:** high for a hackathon *if measured*. Close to zero as it stands.
- **PS relevance:** explicit ("acoustic shadows", natural vs artificial).
- **Weakest assumption:** that nadir and range direction can be recovered for arbitrary uploads. **They can for known sensor layouts:** SubPipe dual-channel waterfalls have nadir at the centre column.
- **Likely judge question:** "How do you know the shadow belongs to the object?"
- **Best experiment (E7):**
  - On SubPipe (known dual-channel layout) and AI4Shipwrecks (masks available), compute range-matched shadow scores for GT objects vs random matched background boxes.
  - Report separation (AUROC) and the fraction applicable. Do it on the correct axis.
  - **Do not** convert to height without altitude and range scale.

## 6.4 Survey-to-survey change detection
- **What actually exists:** a status taxonomy, a model-level REMOVED guard, and refusal gates. No matcher, no coverage polygon, no second survey.
- **Scientific basis:** sound semantics. Separating NOT_DETECTED from NOT_SURVEYED is the right idea.
- **Validation:** unit tests of the refusal logic only.
- **PS relevance:** low to moderate. It is not in the paraphrased PS core.
- **Demoability:** only as a "we refuse" screen.
- **Likely judge question:** "Show one change result."
- **Best experiment:** requires two overlapping real passes. Whether SubPipe contains revisits is **UNKNOWN**. Not feasible before Round 2 without data.

## 6.5 Recovery priority engine
- **What actually exists:** a 3-term mean with a ceiling defect (§2.2 #28). The documented 6-term config engine is legacy-only.
- **Scientific basis:** decision-support rule. Transparent, but not science.
- **Validation:** none possible without operator ground truth.
- **Novelty:** low.
- **PS relevance:** low (not in the PS core).
- **Likely judge question:** "Why is everything LOW?" or "Who chose these weights?"
- **Best experiment:** none worth running. Fix the ceiling or demote the feature.

## 6.6 Which three should dominate the Round-2 PPT

| Differentiator | PS relevance | Evidence today | Evidence achievable before R2 | Scientific risk if attacked | Demoability | Verdict |
|---|---|---|---|---|---|---|
| Open-set | High | None (red flags) | **Yes** (E3, 1–2 days) | High until E3 | High | **#1: lead with it only once E3 is done, and frame it as "dissimilarity"** |
| Temporal persistence | High | None (synthetic) | **Yes** (E4 on real SubPipe waterfall) | Medium | High | **#2** |
| Acoustic shadow | Highest (explicit) | None | **Possibly** (E7, 2–3 days, geometry work) | Medium | High with a real crop profile | **#3, conditional**: if E7 fails, replace it with "evidence-preserving Contact workflow" and never claim shadow |
| Change detection | Low–moderate | Gates only | No (no data) | Low (it refuses) | Low | One line under "honest failure" |
| Recovery priority | Low | Defective | Trivial fix | Low | Medium | Sub-bullet only |

**Selection rationale:**
- Open-set and persistence answer the PS's two hardest requirements: unknowns and false positives.
- Both can be turned into measured figures from data already on disk.
- Shadow is the most persuasive to a sonar scientist, but only if a real measured crop profile can be shown.
- Change and priority cannot produce evidence before Round 2 and are the least PS-central.

---

# PHASE 7 — Hostile judge audit

Each answer uses only what the repository supports today. **Bold** marks what must not be said.

**Q1. "Isn't this just YOLO on sonar?"**
The candidate generator is a fine-tuned YOLO11s, and we say so. What we add is a Contact layer over immutable detector observations, measured raster conditions, an advisory open-set channel, and an append-only review record with provenance on every export. Unavailable evidence stays unavailable. The honest weakness: none of the added channels is quantitatively validated yet (show E2–E4 if run). **Do not claim** the evidence layers "verify" detections.

**Q2. "Why should I trust this confidence score? Why is everything 70–90 %?"**
If the 0.70–0.90 value is on screen, the honest answer is that it is a display normalization, a bounded sigmoid fixed to our demo distribution. It is not calibrated and not a probability. The fix is to show the raw detector score and the per-channel decomposition, and to label the fused value "evidence index (uncalibrated)" (P0-2). **Never** read 0.9 as "90 % sure".

**Q3. "Shipwreck recall is 0. Why are you showing shipwreck detection?"**
We should not. The held-out test gave recall 0. We diagnosed it: mask-derived labels fragmented into 7.6 boxes per image, 47 % of boxes under 64 px² at 640, and 0.17 % training exposure. Shipwreck output in the runtime came from a disclosed demo heuristic, which should be switched off for Round 2 (P0-7).

**Q4. "Your overall precision is 0.73?"**
No. That is Ultralytics' macro average including SHIPWRECK's degenerate 1.0 precision at zero recall. Per class: PIPELINE P 0.68 / R 0.55 / AP50 0.52; CRAB_POT P 0.52 / R 0.44 / AP50 0.43.

**Q5. "How did you prevent train/test leakage?"**
- Splits were made at source level before tiling.
- SubPipe uses 300-second time blocks with 15-minute embargoes between train/val/test.
- AI4Shipwrecks is split by wreck site using the official test split.
- PING is split by recovered recording/contact before Roboflow augmentation.
- Automated checks cover group overlap, augmentation-parent overlap, and exact and near-duplicate images.
Admit: ~24 % of PING images have weak per-contact grouping.

**Q6. "Your pipeline test set is the same pipeline, isn't it?"**
Yes. It is a later 25-minute segment of the same mission, a temporal hold-out. Cross-site pipeline generalization is untested.

**Q7. "Each class comes from a different sonar. Isn't your detector a sensor classifier?"**
That confound exists, and our per-class metrics cannot rule it out. We observed CRAB_POT false alarms on Klein pipeline imagery. The honest framing: "per-domain detectors inside one network". The fix is a cross-domain test (E2 per-domain false-alarm rates).

**Q8. "How does temporal persistence actually work?"**
Only when the bundle declares a real recording sequence with ping bounds. Observations of the same class in adjacent frames within 35 m (or 0.12 normalized distance) are associated, and a heuristic score rises with distinct frames (0.86 for 2, 0.99 for 3). It does not yet count missed opportunities. The planned Wilson-bound version exists in legacy code.

**Q9. "Your consecutive SubPipe frames overlap. Isn't persistence trivially satisfied?"**
Yes. Adjacent SubPipe frames share 480 of 500 rows, so they are not independent looks. Valid persistence must use disjoint ping windows from the reconstructed waterfall (E4). Until then, **do not** show adjacent-frame persistence as evidence.

**Q10. "Were your three persistence observations three different sonar images?"** *(the fatal question)*
In the Epitome bundle, no: `sonar_0001–0003` are the same file. That bundle must not appear in Round 2 (P0-1).

**Q11. "How do you know an acoustic shadow belongs to the detected object?"**
We don't compute shadows at runtime, because range direction (nadir side) isn't known for arbitrary uploads. The designed method searches immediately beyond the object in the +range direction against a range-matched background. Attribution is by geometric adjacency, so adjacent objects remain ambiguous. **Do not** claim shadow validation.

**Q12. "What makes UNKNOWN actually unknown?"**
Nothing, semantically. The open-set score is nearest-neighbour distance from a SubPipe seabed feature memory. A high value means "unlike that reference", not "unknown object" or "artificial". It is also sensitive to sensor domain and crop geometry: we flag 64 % of PING observations. Present it only after E3, with per-domain FPR.

**Q13. "What's your open-set false-positive rate on NIOT's sonar?"**
Unknown. The reference memory is one Klein 3500 mission. A new sensor needs its own background reference and threshold. The architecture supports that, since the memory is a versioned artifact.

**Q14. "How does a bounding box become latitude/longitude?"**
Today it doesn't. Every observation inherits its frame's navigation fix. Object-level positioning needs ping time → navigation interpolation, heading, port/starboard side, slant-to-ground range (altitude plus sample spacing), and layback. None of that is implemented, and we don't fake it.

**Q15. "What happens without navigation?"**
Coordinates are null throughout, the map shows its unavailable state, change is refused, and the REACQUIRE action is disabled. This is implemented and tested.

**Q16. "Are these real coordinates?"**
No. Every demo track in the repository is labelled synthetic demo metadata. SubPipe's real INS (local x/y, attitude, altitude) exists on disk but is not integrated (P1-2).

**Q17. "How do you distinguish a rock from debris?"**
We don't, automatically. Our learned clutter gate removed true positives and we rejected it (FP 23→19, TP 2→0). Shadow evidence cannot separate them either, since rocks cast shadows. That decision stays with the analyst, and we make it faster and traceable.

**Q18. "What exactly is self-learning here?"**
Nothing is self-learning. `online_learning = false`. Verdicts are recorded append-only and tallied into curation queues for an operator-triggered retraining round. Admit two gaps: runtime reviews have no manifest exporter, and there is no evaluation-split leakage guard on the runtime path (P1-6).

**Q19. "Why is this better than GhostVision?"**
It is not better at detecting crab pots. GhostVision is a purpose-built single-class system reporting F1 ≈ 0.71–0.73 on complete recordings, and our CRAB_POT F1 is ≈ 0.48 on a different split. The protocols are not comparable. Our scope is different: multiple target types, an open-set channel, evidence provenance, and a review workflow. **Never** say "we beat GhostVision".

**Q20. "Can it run onboard an AUV? Latency?"**
It runs locally with no cloud dependency. The measured numbers are YOLO11s at ~5 ms raw forward and ~11 ms end-to-end per tile on Apple M5 Pro MPS (legacy model, same architecture), and 25.7 ms mean per image on a server GPU. No edge-device, CPU-only, or INT8 measurement exists, and no full-survey processing ratio. Run E8.

**Q21. "How do you handle speckle?"**
There is no despeckling at runtime; raw pixels are preserved. Image condition is measured. Robustness to speckle is unmeasured: the corruption set was generated but never scored (E6).

**Q22. "Heave/pitch/roll dropouts?"**
Near-black row bands are measured and flagged per frame, and overlap with each candidate is computed. Motion is reported UNKNOWN because we have no attitude input, and we don't infer motion from pixels.

**Q23. "Object dimensions in metres?"**
Not available. It needs range sample spacing and altitude, and SubPipe does not publish its range scale (`range_scale_known: false`). We report pixel extents only.

**Q24. "Ghost nets? You only have crab pots."**
Correct. The only public labelled derelict-gear SSS data is crab pots. We don't call it a net detector.

**Q25. "Cylinders, mines, UXO?"**
There is no supervised class. They could only appear as advisory open-set dissimilarity, which is unvalidated.

**Q26. "Change detection always refuses?"**
Yes, by design: our surveys lack shared coverage and object-level localization. The semantics (NEW / UNCHANGED / NOT_DETECTED / NOT_SURVEYED, never REMOVED from absence) are enforced, but the matcher is not built.

**Q27. "Why is every priority LOW?"**
The runtime rule averages evidence, persistence (0.15 without sequential evidence), and image quality, so it cannot exceed 0.717 for normal uploads. That is a defect to fix (P1-4). The weights are chosen, not learned.

**Q28. "Were your demo images in your training set?"**
In v4, six of seven were. Round 2 must use held-out-test frames only (P0-6).

**Q29. "What augmentations did you use?"**
The training configuration is not in our repository. We must recover it from the Kaggle notebook before claiming "sonar-valid augmentation".

**Q30. "Why 768-pixel runtime tiles when you trained on 512?"**
It was a runtime choice independent of the training representation. It changes object scale by ~0.67× for SubPipe, and we haven't measured its effect (E2).

**Q31. "Does the SHIPWRECK label in your demo come from the model?"**
From a disclosed recovery heuristic: a second pass at confidence 0.01 that keeps SHIPWRECK proposals where ≥ 3 agree. Raw confidence (≈ 0.04) is preserved and shown. For Round 2 it should be off.

**Q32. "Can you process raw XTF/JSF from our vehicles?"**
Not today. Input is rasters plus a navigation CSV. A native decoder (PINGMapper-style) is future work.

**Q33. "Why didn't calibration or fusion get fitted?"**
The legacy fitting run found zero validation matches, most likely a box-alignment defect, so no calibrator was produced. The runtime fusion weights are hand-set. We label the score unvalidated.

**Q34. "Why YOLO11s over m or l?"**
It had the best validation mAP50-95 (0.106 vs 0.098 vs 0.080). It is also the smallest and best suited to local inference.

**Q35. "Are your licences clear for deployment?"**
Not fully. PING data carries conflicting declarations and is private-team-only. SubPipe is GPL-3.0. Redistribution of derived weights is unresolved.

---

# PHASE 8 — Round-2 gap analysis

## 8.1 If Round 2 were tomorrow, the reasons we could lose (internal ranking)

Scores 1–5 (5 = worst impact / most PS-relevant / most visible / riskiest / easiest to fix).

| Risk | Impact | PS rel. | Visibility | Sci. risk | Fixability | Rank |
|---|---:|---:|---:|---:|---:|---:|
| Synthetic, triplicated demo presented as real survey evidence (F1) | 5 | 3 | 4 | 5 | 5 | 1 |
| 70–90 % display confidence exposed as meaningless (F2) | 5 | 4 | 5 | 5 | 5 | 2 |
| No measured evidence for any differentiator | 5 | 5 | 5 | 4 | 3 | 3 |
| SHIPWRECK R = 0 plus demo heuristic producing SHIPWRECK labels | 4 | 4 | 5 | 4 | 5 | 4 |
| Macro precision headline inflated (F3) | 4 | 3 | 4 | 4 | 5 | 5 |
| Demo images from training split; wrong provenance claim (F6) | 4 | 2 | 3 | 5 | 5 | 6 |
| Open-set channel responds to domain and crop size (F7) | 4 | 5 | 3 | 5 | 3 | 7 |
| Persistence on overlapping or synthetic frames (F4) | 4 | 4 | 3 | 5 | 3 | 8 |
| Association merges distinct objects when navigation is present (F5) | 3 | 3 | 4 | 3 | 5 | 9 |
| Natural-vs-artificial primary objective has no measured component | 5 | 5 | 3 | 3 | 2 | 10 |
| Contradictory docs (STATUS says no navigation ingest; CLAIMS says all NOT STARTED; RUNBOOK says real coordinates) | 3 | 1 | 3 | 3 | 5 | 11 |
| Class-sensor confound | 4 | 3 | 2 | 4 | 2 | 12 |
| Runtime path not evaluated; train/runtime scale mismatch | 3 | 3 | 2 | 3 | 3 | 13 |
| No edge latency | 3 | 4 | 3 | 2 | 4 | 14 |
| Priority ceiling (all LOW) | 2 | 1 | 3 | 2 | 5 | 15 |
| Change detection never produces a result | 2 | 2 | 3 | 1 | 1 | 16 |

## 8.2 P0 — MUST FIX (9)

**P0-1 · Retire the synthetic Epitome bundle and correct every document that calls it real.**
- Remove `Aqualens_Epitome_Demo_Survey.zip` and `Epitome_v2_Offshore_Demo.zip` from all judge paths: `scripts/internal_hack_check.sh` / `scripts/demo` defaults, RUNBOOK, README "Current Epitome demo", INTERNAL_HACK_FREEZE "Known-working demo".
- Strike "real recorded coordinates" and "one SEQUENTIAL_PING Contact has 3 observations" as evidence.
- If a synthetic bundle is kept for UI plumbing tests, label it `SYNTHETIC_RENDERED_TEST_FIXTURE` inside the bundle and on screen.

**P0-2 · Remove `DEMO_BOUNDED_SIGMOID_V1` from every judge-facing surface.**
- Show `raw_detector_confidence` plus the per-component decomposition (§3.9 table).
- If a single fused number is shown, show `raw_fused_confidence` labelled "evidence index (uncalibrated)", or a validation-calibrated value once E5 exists.
- Rename the CSV column `confidence` → `demo_display_confidence`, or drop it.
- Stop counting frame image quality (`sonar_condition`) as *support for object existence*: treat it as a reliability qualifier, or disclose explicitly.

**P0-3 · Fix Contact association under frame-level navigation (F5).**
- World distance may only *add* a constraint. It must not bypass the image-position gate unless coordinates are object-level.
- `WINDOW_OVERLAP_ONLY` must require `inference_mode == "TILED"` and overlapping tile provenance.
- Add a regression test using the exact `survey_upload_c4c56e532038` boxes.

**P0-4 · Stop presenting adjacent-frame or synthetic persistence (F4).**
- Persistence enters the PPT only from E4 (disjoint real ping windows).
- Otherwise present it as "designed; validated experiment pending".
- Add a bundle validator: reject declared ping bounds that contradict pixel overlap, or at least flag overlap.

**P0-5 · Replace the metrics headline with a per-class truth table.**
- Per class, with P, R, AP50, and F1. Report the macro average excluding SHIPWRECK as a *derived* number, and state it is derived.
- Show SHIPWRECK as FAILED alongside its diagnosis.
- State the test composition (~97 % SubPipe tiles), the temporal-only PIPELINE hold-out, and that the metrics use the training representation, not the runtime path.
- Same correction in Model Lab and README.

**P0-6 · Build the Round-2 demo bundle from detector held-out test frames only, and fix v4 provenance.**
- Correct `EPITOME_V4_SELECTION_REPORT.md` (Rec9 is train; Rec15 is test; six of seven frames are train).
- Every frame's *detector split* must be printed in the bundle provenance, looked up in `multidomain_sonar_v1_1_20260831/canonical/metadata.jsonl`, not in the source dataset's folder name.
- Do not select frames to hit a target confidence distribution.

**P0-7 · Default the SHIPWRECK recovery pass and SHIPWRECK display policy OFF for Round 2.**
- Environment flag, default off. Show SHIPWRECK as a failed class.
- If a wreck appears in the demo, show raw output and open-set / analyst review, not a SHIPWRECK label.

**P0-8 · Fix and minimally evaluate open-set before calling it the KING USP (E3).**
- Score the runtime query in the calibration representation (per-patch distances, max or top-k over patches).
- Calibrate τ on **detector-held-out** background per domain.
- Report per-domain background flag rate plus object-vs-background AUROC and AUPRC on held-out test crops.
- If AUROC is weak, present it as measured and demote the claim.

**P0-9 · One source of truth for claims.**
- Paste the verbatim PS 26057 text into `docs/`.
- Update `CLAIMS_AND_EVIDENCE.md` statuses (currently all `NOT STARTED`) and `STATUS.md` (says no navigation ingest; dated 2026-09-02).
- Make README consistent with this audit's truth table.
- Any repository shown to judges must not contradict itself.

## 8.3 P1 — HIGH-VALUE (8)

**P1-1 · Held-out runtime-path evaluation (E2).**
- Whole held-out frames per domain through `FinalDetector.infer`.
- P/R at IoU 0.5 and 0.3, FP per km (SubPipe track length from INS), FP per frame.
- Compare 512 vs 768 runtime tiles. Adopt 512 for SubPipe only if the held-out test shows the gain, and disclose it as a post-hoc runtime setting.

**P1-2 · Real SubPipe INS integration (L2 track-relative).**
- Interpolate `EstimatedState` (x, y, ψ, depth, alt) to SSS frame timestamps.
- Provide real per-frame track, real ping order, and real altitude.
- This single integration unlocks honest geolocation-in-metres (track-relative), real persistence, and the precondition for shadow geometry.
- Do not invent WGS84: SubPipe gives local metres.

**P1-3 · Acoustic shadow on known geometry (E7).**
- SubPipe dual-channel layout (nadir at centre column) and AI4Shipwrecks masks.
- Fix the axis convention, compute range-matched shadow, report object-vs-background separation.
- Wire it into runtime *only* for sensors with declared layout.

**P1-4 · Priority repair or demotion.**
- Remove the persistence 0.15 ceiling effect (exclude persistence when unavailable, as fusion already does).
- Either wire the documented config engine with pixel-area fallback clearly labelled, or present priority as simple triage.

**P1-5 · Calibration figure (E5).**
- Isotonic calibration of raw detector scores on validation, reliability diagram and ECE on test, per class.
- Optionally fit the existing 8-feature logistic fusion on validation (code in `fusion/calibration.py`).
- This is the only legitimate path to a displayed "confidence".

**P1-6 · Review-memory integrity on the runtime path.**
- Apply `feedback_training_eligible` using the detector split (by source-image SHA).
- Add a runtime JSON → manifest exporter.
- Unify `open_set_candidate` and `is_open_set_candidate`.
- Rename finding-level `production_qualified` (currently `true` for PIPELINE/CRAB_POT) to avoid implying production readiness.

**P1-7 · Edge/local latency (E8).**
- final_v1 through the runtime path on MPS and CPU-only: ms per frame, full-survey processing ratio (survey duration from SubPipe timestamps ÷ wall time), peak RSS, model size.
- Include the cost of the SHIPWRECK recovery pass (on vs off).

**P1-8 · Robustness sweep (E6).** Run the existing corruption generator (`scripts/run_vnext_robustness.py`) with the frozen detector on held-out frames: recall and FP vs severity.

## 8.4 P2 — DO NOT TOUCH BEFORE ROUND 2
- Retraining the detector, including SHIPWRECK v1.2, new classes, or YOLO26/RF-DETR. It invalidates the open-set memory (tied to layer 16 of this checkpoint), all thresholds, and all demo evidence.
- Natural Clutter revival or any automatic suppression gate.
- Segmentation, OBB, masks.
- Depth/bathymetry visualization and the external paper pipeline (§9).
- DeeperSense SSL, PhysDNet decomposition.
- Real change detection (needs overlapping real passes; data availability UNKNOWN).
- PDF export, GIS basemap polish, new screens, cloud deployment work.
- Online or "self-learning" features of any kind.

---

# PHASE 9 — Questions to answer before depth work or an external paper enters Aqualens

## 9.1 Definitions: these are not interchangeable

| Quantity | Definition | In SSS terms | In the repository today |
|---|---|---|---|
| **Water depth** | Sea surface → seabed at a location | = vehicle depth + altitude (for a towed or AUV sensor), at nadir only | SubPipe `Depth.csv` / `EstimatedState.depth` on disk, **not ingested** |
| **Sonar altitude** (H) | Transducer → seabed, vertically | From DVL / altimeter, or estimated from first bottom return (nadir gap width) | `navigation.csv altitude_m` parsed then **dropped**. SubPipe `Altitude.csv` (DVL, −1 = invalid) **not ingested**. Epitome altitudes synthetic. |
| **Slant range** (R_s) | Transducer → scatterer along the acoustic path | Proportional to two-way travel time, which is what the raster column index measures (× sample spacing) | Sample spacing **unknown** (`range_scale_known: false`) |
| **Ground range** (R_g) | Horizontal distance from nadir track to scatterer | R_g = √(R_s² − H²) under a flat-seabed assumption | **Not computed**. No slant-range correction. |
| **Bathymetry** | Seabed depth field over an area | Standard SSS **does not measure it**. Needs multibeam or interferometric SSS. | **Unavailable**. No source. |
| **Object depth** | Depth of an object below the surface | ≈ water depth at the object's location if it rests on the seabed. SSS cannot observe it directly off-nadir. | **Unavailable** |
| **Object height** (h) | Height of the object above the seabed | From shadow length L_s: h ≈ H·L_s / R_g,end (similar triangles, flat seabed, object on bottom, untruncated shadow, all ranges in ground coordinates) | Formula in `ML_PLAN §8`. `implied_height_m` is always `None`. |

## 9.2 Questions any depth or depth-distribution feature must answer

1. **Which quantity exactly?** One of the seven above. A "depth distribution" chart must name it. "Depth" alone is unacceptable.
2. **Measured or inferred?** Which sensor or field supplies it (DVL altitude, pressure depth, MBES)? Or is it derived from imagery? If derived, by what model, and validated against what?
3. **What datum and units?** Surface, chart datum, or seabed. Metres. Sign convention (SubPipe z is NED-down).
4. **Per what?** Per ping, per frame, per Contact, or per area? An SSS frame has one altitude per ping, not per pixel.
5. **Time alignment.** SubPipe nav rows are keyed to *camera* timestamps. How are they interpolated to SSS ping times, and what is the maximum gap?
6. **Validity handling.** SubPipe DVL reports −1 when invalid. What is shown then? It must be null, never interpolated silently across long gaps.
7. **Geometry assumptions.** Flat seabed? Known sample spacing? Known sound speed? What does the feature do when these are unknown? It must degrade to "unavailable".
8. **Uncertainty.** What error bar is propagated (altitude noise, range quantization, seabed slope)? Without it, no metric value may be shown (`CLAIMS §8`).
9. **Which PS requirement does it close?** Height or dimensions (yes, if validated). Bathymetry (not a PS requirement for SSS and not measurable). If none, it is decoration.
10. **Validation data.** Is there ground truth (known object heights, e.g. AI4Shipwrecks wreck dimensions from site records, SubPipe pipe diameter)? Without it, the feature is unvalidated by definition.
11. **Does it survive the hostile question** "SSS doesn't measure depth. Where does this number come from?"

**Currently defensible: NO.** No depth-related quantity is computed. The only real inputs (SubPipe INS depth/altitude) are not integrated. Every altitude in the demo bundles is synthetic.

## 9.3 Questions any external paper or model pipeline must answer

1. **Task identity:** detection, segmentation, anomaly detection, SSS-to-depth, or denoising? Which exact PS requirement does it close that we cannot close today?
2. **Input contract:** raw pings (XTF/JSF), slant-range rasters, ground-range mosaics, or RGB exports? What metadata does it require (altitude, sample spacing, frequency, heading)? Do we have those for our data and for NIOT's?
3. **Training data and domain:** which sensor, sites, depths, classes? Does it add yet another class-sensor confound?
4. **Licence and weights:** are weights released, under what licence, and compatible with our GPL-3.0 / CC-BY-SA constraints?
5. **Reported evaluation:** held-out protocol, group/site split, metrics. Are its numbers comparable to anything we report? (Same trap as GhostVision.)
6. **Reproducibility:** can we reproduce its headline number on its own data before integrating? If not, it cannot be cited.
7. **Coupling:** does it replace the detector? Then the open-set memory (layer-16 features of `2aa3ac71…`), τ, and all evidence must be rebuilt and re-validated. Or does it sit beside it as a new, independently nullable evidence channel?
8. **Compute:** latency and memory on our local MPS/CPU path. Is it edge-compatible?
9. **Failure semantics:** what does it output when its assumptions fail? It must be able to return "unavailable", not a number.
10. **Ablation:** on our held-out test, does adding it change Contact-level P/R or FP per km? If not measured, it adds claims, not evidence.
11. **Time to evidence:** can it be evaluated on held-out data before Round 2? If not, it is P2.

**External paper integration evaluated in this pass: NO.**

---

# PHASE 10 — Round-2 evidence plan (smallest high-impact set)

No numbers are predicted here. Each figure is specified so the result, whatever it is, is reportable. All experiments use the **frozen** detector and **held-out** splits. None changes the model.

**Core set (E1–E6); do these first:**

| ID | Figure / table | Question it answers | Experiment | Data | Metric | Expected output | Why a judge cares |
|---|---|---|---|---|---|---|---|
| **E1** | Per-class detector card plus SHIPWRECK diagnosis panel | "How good is the detector, honestly?" | Re-render existing frozen test metrics. Add PR curves and time-block bootstrap CIs by re-scoring the frozen model on test (a measurement, not a selection). Add a TP/FP/FN gallery per class. | final_v1 test split; `shipwreck_diagnosis_v1` | P, R, AP50, F1 per class with 95 % CI; box-size histogram; exposure | Per-class table (no macro headline); PR curves; 3×3 qualitative grid; "why SHIPWRECK failed" panel | Shows rigour and honest failure. Kills the "73 % precision" attack. |
| **E2** | Runtime-path held-out evaluation | "Does the deployed pipeline perform like the paper numbers?" | Run whole held-out frames through `FinalDetector.infer` (recovery off). Match at IoU 0.5/0.3. Repeat with 512 tiles for SubPipe. | Test-split SubPipe frames, AI4 test wrecks, PING test | P, R per domain; FP per frame; **FP per km** (SubPipe track length); cross-domain false-alarm matrix | Table: domain × {P, R, FP/km} for 768 vs 512 | Moves from "model metrics" to "system metrics". Exposes or clears the class-sensor confound. |
| **E3** | Open-set behaviour | "Does UNKNOWN mean anything?" | Fix query representation. Recalibrate τ on detector-held-out background. Score held-out object crops (all classes) vs background crops. | Test-split crops per domain | AUROC, AUPRC, FPR@τ per domain; score histograms | Two histograms per domain plus a table; honest per-domain flag rate | Converts the KING USP from claim to measurement, or tells you to demote it before a judge does. |
| **E4** | Real-waterfall persistence ablation | "Does persistence cut false alarms without losing targets?" | Reconstruct the SubPipe waterfall (20-row step); disjoint 500-ping windows; associate detections across k windows. | SubPipe test segment (plus PING sequential recordings if feasible) | Recall and FP/km for k-of-n (k = 1, 2, 3); survival curves TP vs FP | Line plot: FP/km vs recall for k = 1..3 | Directly answers false-positive filtering in the PS with the product's own mechanism. |
| **E5** | Confidence calibration and decomposition | "Why should I trust this score?" | Isotonic calibration of raw scores on validation, applied to test. Waterfall decomposition for 3 real held-out Contacts (TP, FP, weak TP). | Val (fit), test (report) | Reliability diagram, ECE before/after, per class | Reliability plot plus 3 decomposition bars | Replaces the demo sigmoid with a defensible number, or shows why none is shown. |
| **E6** | Robustness sweep | "Speckle, dropouts, resolution?" | Existing corruption generator × severities on held-out frames. | Test frames per domain | Recall and FP vs severity for speckle, row dropout, blur, contrast, resolution | 5 small line plots | Maps one-to-one onto PS requirements 3, 4, 6. The code already exists. |

**Conditional / supporting (E7–E9):**

| ID | Figure / table | Question | Experiment | Data | Metric | Output | Why |
|---|---|---|---|---|---|---|---|
| **E7** | Acoustic-shadow separation | "Is your shadow physics real?" | Range-matched shadow on the known SubPipe layout (nadir = centre column) and AI4 masks: objects vs matched background boxes. | SubPipe test, AI4 test | AUROC of shadow score; fraction applicable; example crop with measured profile | Histogram plus one annotated crop | The most persuasive slide for sonar scientists, if it separates. |
| **E8** | Local/edge latency | "Can it run onboard?" | final_v1 runtime path on MPS and CPU-only; recovery on vs off. | 1 SubPipe test segment | ms/frame p50/p95; **processing ratio** (survey duration ÷ wall time); peak RSS; model MB | Small table with the device named | Answers the edge requirement with numbers, and the device is named. |
| **E9** | Contact workflow on a real held-out segment | "What does an analyst actually get?" | One SubPipe test segment with real INS (after P1-2) through upload → Contacts → evidence → review → report. | SubPipe test chunk | Counts: observations → Contacts; review events; export rows | 4-panel screenshot strip with real counts | Demoability with zero synthetic content. |

**Not recommended before Round 2:** change-detection figures (no data), priority figures (no ground truth), depth plots (§9).

---

## Appendix A — Key file index

| Topic | Path |
|---|---|
| Frozen detector and metrics | `ml/artifacts/final_v1/detector/{best.pt,metrics.json,manifest.json}` |
| SHIPWRECK diagnosis | `ml/artifacts/shipwreck_diagnosis_v1/` |
| Open-set build / artifact | `ml/experiments/build_open_set_v1.py`, `ml/artifacts/vnext/open_set_v1/` |
| Natural Clutter decision | `ml/artifacts/vnext/kaggle_20260902_final/{experiment_decision.json,ablation_matrix.json}` |
| Robustness (unscored) | `ml/artifacts/vnext/kaggle_20260902_final/robustness/` |
| Corpus metadata / QA | `data/processed/multidomain_sonar_v1_1_20260831/{canonical/metadata.jsonl,qa/qa.json}` |
| Runtime inference | `packages/sagar/perception/runtime.py`, `packages/sagar/perception/demo_policy.py` |
| Contacts / persistence | `packages/sagar/vnext/contacts.py` |
| Fusion / confidence | `packages/sagar/vnext/evidence.py` |
| Physics / verifier | `packages/sagar/vnext/physics.py` |
| Priority | `packages/sagar/vnext/priority.py` (runtime), `packages/sagar/mission/priority.py` + `configs/priority_weights.yaml` (legacy) |
| API / orchestration | `packages/sagar/api/app.py` |
| Legacy evidence stack | `packages/sagar/pipeline/stage3c.py`, `packages/sagar/evidence/`, `packages/sagar/fusion/calibration.py`, `runs/run_stage3c_v4/` |
| Demo bundles | `data/runtime/demo/Aqualens_Epitome_v2_Offshore_Demo.zip` (synthetic), `artifacts/demo/*v3*`, `artifacts/demo/*v4*` |
| SubPipe real INS | `data/raw/subpipe/full_extracted/SubPipe/DATA/Chunk*/{EstimatedState,Altitude,Depth}.csv` |

## Appendix B — Reproducing this audit's non-trivial checks (read-only)

- **Epitome duplication:** `shasum -a 256` on `sonar_000{1,2,3}.png` inside `data/runtime/demo/Aqualens_Epitome_v2_Offshore_Demo.zip` gives the identical value `5e678df8…`.
- **Demo-frame splits:** look up each v4 filename in `multidomain_sonar_v1_1_20260831/canonical/metadata.jsonl` (`split` field).
- **SubPipe overlap:** load `1693573517.84.pbm` (A) and `1693573518.84.pbm` (B). `mean(|B[20:] − A[:480]|) = 0.0` (LF and HF).
- **Open-set calibration frames in detector-train:** map `snap_2fa4bca0a0bc4b7d/tiles.jsonl` annotation-free val/train source frames through `data/interim/subpipe/frames.jsonl` to filenames, then to `multidomain_sonar_v1_1` splits. Result: 86/86 and 290/290 are `train`.
- **Confidence examples:** `data/runtime/runtime_surveys.json`, surveys `survey_upload_c4c56e532038` (v4) and `survey_upload_d4509c0858c8` (v3), fields `confidence_components`, `raw_fused_confidence`, `confidence`.
- **Association merge:** same v4 survey, Contacts with `observation_count > 1`; compare `bbox_px` of `source_detection_ids` (inference mode `FULL_FRAME`).

*End of audit. No code, model, runtime, or configuration was modified.*
