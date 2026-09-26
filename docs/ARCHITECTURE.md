# ARCHITECTURE — Frozen for Internal Hackathon

**Status: ARCHITECTURE LOCKED (2026-08-30).** Changes require an explicit amendment to this
file before code is written against them. Codex and Cursor implement against this document and
`docs/API_CONTRACT.md`; they do not invent structure.

---

## 0. Architect's challenge to the proposed approach

This section exists because the brief asked me to challenge the design rather than ratify it.
Six things in the previous draft were wrong or overscoped. All six are now fixed.

| # | Problem found | Resolution |
|---|---|---|
| 1 | **The critical path was blocked on a gated dataset.** PINGEcosystem was designated primary, but it requires a human to accept HF terms. A build that cannot start until an external gate opens is a broken plan. | **SubPipe + AI4Shipwrecks (both openly downloadable) are the P0 critical path.** PINGEcosystem is additive — it drops in as a third class when the token exists and improves the king-USP evaluation, but nothing blocks on it. |
| 2 | **Open-set detection depended on a 52 GB download.** PatchCore over a DeeperSense memory bank is the right *finals* answer and the wrong *internal* answer. | Memory bank is built from **annotation-free background regions of our own training tiles**, using **our own fine-tuned detector's backbone**. Zero extra data, sonar-domain by construction, and it reuses a model we are training anyway. DeeperSense → finals. |
| 3 | **Temporal persistence was hostage to dataset metadata.** It assumed recoverable ping ordering, which several datasets do not provide — so USP 2 could have failed to demo at all. | **We control the tiling.** Tiling SubPipe's 5000×500 strips at 512×512 with 50 % overlap creates multi-window coverage deterministically. USP 2 therefore has two modes: `WINDOW_OVERLAP` (always available) and `SEQUENTIAL_PING` (where real recordings exist). It cannot fail to demo. |
| 4 | **Eleven top-level Python packages** for a hackathon executed by three agents is coordination overhead, not modularity. | One installable package `sagar` with enforced submodule boundaries. Same discipline, far less friction. |
| 5 | **A Parquet + registry-file data layer on a single laptop** was infrastructure for a problem we do not have. | SQLite is the system of record. Run directories hold `manifest.json`, `metrics.json` and artifacts. Parquet → finals, if ever. |
| 6 | **Persistent intelligence was entirely absent.** The previous design treated every survey as the first one. | New first-class layer (`sagar.memory`, §7). It is also the substrate that change detection runs on — see §8 for why these are one system, not two. |

**Contradiction resolved — "REMOVED".** The brief asks for NEW / REMOVED / UNCHANGED. Reporting
an object as REMOVED when the new survey never covered its location is a claim we cannot
support, and it is the single most demo-fatal error in this feature. The resolution is not to
overrule the requested vocabulary but to **protect** it: `REMOVED` is emitted only when the
baseline detection lies **inside** the new survey's coverage. Outside coverage returns
`NOT_SURVEYED`. The operator vocabulary is exactly the three words requested, and `REMOVED`
becomes a claim that survives questioning instead of one that collapses under it.

---

## 1. The spine: PICS (Ping-Indexed Coordinate System)

Retained from the research spec — it is the reason three of the five USPs are computable at all.

SSS imagery is a raster whose axes carry physical meaning: one is sequential pings
(along-track), one is acoustic return range (across-track). A detector that only knows `(x, y)`
cannot reason about shadows, associate observations across overlapping windows, or georeference.
Every module speaks one frame:

```
ping     = ping_index_start + along_sign · along_idx · ping_stride
range_m  = |across_idx − nadir_offset_px| · range_scale_m_per_px
side     = PORT | STARBOARD          (across_idx vs nadir_offset_px)
```

Two derived unit vectors are what the evidence modules consume:

- **`u_along`** — direction of increasing ping.
- **`u_range`** — direction of increasing range *away from nadir*.
  **Shadows fall in `+u_range`, so the search direction reverses between channels.** A module
  that assumes "shadow is to the right" is wrong on half of every dual-channel survey.

### 1.1 SpatialReferenceLevel — capability is declared, never assumed

| Level | Available | Persistence | Shadow | Geolocation |
|---|---|---|---|---|
| `L0_PIXEL_ONLY` | raster only, nadir not recoverable | window-overlap only | ✗ | ✗ |
| `L1_TILE_RELATIVE` | nadir + `u_range` estimated from the raster | window-overlap | ✓ px, no height | ✗ |
| `L2_TRACK_RELATIVE` | + ping index, range scale, sequential tiles | ✓ full | ✓ metric | ✓ nav-derived |
| `L3_SURVEYED` | + validated nav, heading, attitude | ✓ full | ✓ metric | ✓ with uncertainty |

A `NadirEstimator` recovers `nadir_offset_px` from the raster itself (the water column is a
low-return band; the first bottom return is a bright across-track ridge). Below confidence
threshold the tile drops to `L0` and shadow evidence returns
`applicable: false, reason: "NADIR_NOT_RECOVERABLE"`.

`level` is **computed** from which fields are populated. It cannot be set by hand.

---

## 2. System diagram

```
                          ┌─────────────────────── OPERATOR ───────────────────────┐
                          │  Next.js workstation — 5 surfaces (PRODUCT_SPEC.md)    │
                          └───────┬──────────────────────────────▲─────────────────┘
                                  │ REST + SSE                   │ review verdicts
                          ┌───────▼──────────────────────────────┴─────────────────┐
                          │  sagar.api — FastAPI (API_CONTRACT.md)                 │
                          └───────┬──────────────────────────────▲─────────────────┘
                                  │                              │
   ═══════ INFERENCE PATH ════════▼══════════════════   ═════════╪══ MEMORY PATH ══════
                                                                 │
   ingest ──► tile ──► preprocess ──► perception ──► evidence ──► fusion ──► geo ──► mission
     │         │           │          ┌────┴────┐    ┌───┴────┐              │        │
   readers   512²        nadir        │detector │    │persist.│           lat/lon  ┌──┴───┐
   SSS+nav   50% ovl     enhance      │openset  │    │shadow  │           coverage │change│
                         quality      └─────────┘    │context │                    │prior.│
                                                     └────────┘                    └──┬───┘
                                  │                                                   │
                          ┌───────▼───────────────────────────────────────────────────▼─────┐
                          │  PERSISTENCE — SQLite (system of record) + runs/ (immutable)    │
                          │  surveys · frames · detections · reviews · model_versions ·     │
                          │  benchmarks · survey_history                                    │
                          └─────────────────────────┬──────────────────────────────────────┘
                                                    │
                          ┌─────────────────────────▼──────────────────────────────────────┐
                          │  TRAINING PATH (offline, operator-triggered, never automatic)   │
                          │  dataset snapshot ──► split ──► train ──► eval ──► register     │
                          │        ▲ hard negatives + corrections from reviews              │
                          └────────────────────────────────────────────────────────────────┘
```

---

## 3. Module boundaries and ownership

One installable Python package, `sagar`, under `packages/sagar/`. Boundaries are enforced by
`tests/test_module_boundaries.py`, which walks the import graph and fails on violation.

| Module | Responsibility | May import | Owner agent |
|---|---|---|---|
| `sagar.core` | schemas, enums, provenance, config loading | — | Codex |
| `sagar.io` | SSS readers, nav parsing, **tiling** | core | Codex |
| `sagar.preprocess` | nadir estimation, enhancement, quality scoring | core | Codex |
| `sagar.perception` | detector wrapper, open-set scorer | core | Codex |
| `sagar.evidence` | persistence, shadow, context — **zero learned weights** | core | Codex |
| `sagar.fusion` | calibration + fitted logistic fusion | core | Codex |
| `sagar.geo` | PICS→geographic, coverage polygon, footprint | core | Codex |
| `sagar.mission` | change detection, recovery priority | core, geo | Codex |
| `sagar.memory` | reviews, queues, model registry, survey history | core | Codex |
| `sagar.evaluation` | splits, leakage assertions, metrics, ablations | core | Codex |
| `sagar.pipeline` | orchestration, run manifests | all above | Codex |
| `sagar.api` | FastAPI routers, serialisation | pipeline, core, memory | Codex |
| `apps/workstation` | Next.js frontend | HTTP only | **Cursor** |

**Two consequences worth stating explicitly:**

- `sagar.perception` **cannot import** `sagar.evidence` or `sagar.geo`. The detector cannot
  quietly consume evidence or position, so ablations compare like with like.
- `sagar.evidence` **holds no learned weights.** Evidence channels cannot overfit, and the
  "detector → +persistence → +shadow" ablation compares the *same* detector under different
  evidence rather than differently-trained models — the only version of that comparison that
  means anything.

**Ownership rule:** Cursor never edits `packages/`. Codex never edits `apps/workstation/`
except `apps/workstation/public/benchmarks.json`, which is generated. The two meet only at
`docs/API_CONTRACT.md`. See `docs/HANDOVER.md`.

---

## 4. Runtime data flow (inference)

```
1. INGEST     sagar.io reads SSS raster + nav (if any) → Survey, SonarFrame[]
2. TILE       512×512, 50 % along-track overlap → SonarTile[] with PICS descriptors
              ← this step manufactures the multi-window structure USP 2 needs
3. PREPROCESS NadirEstimator → geometry + SpatialReferenceLevel
              enhance (CLAHE + speckle suppression) → ENHANCED layer, RAW never mutated
              QualityScorer → usable / reason; unusable tiles are excluded and counted
4. PERCEIVE   detector.infer(tile) → Candidate[] (KNOWN)
              openset.score_map(tile) → anomaly map → Candidate[] (UNKNOWN) 
              open-set proposals overlapping a known candidate (IoU > 0.3) are absorbed,
              contributing anomaly_score rather than emitting a second box
5. EVIDENCE   persistence(candidates across overlapping tiles)  → PersistenceEvidence
              shadow(candidate, tile)                           → ShadowEvidence
              context(candidate, tile)                          → ContextEvidence
6. FUSE       calibrate detector confidence → fuse 8 features → final_confidence
              + per-feature log-odds contributions + evidence_completeness
7. GEO        PICS + nav → GeoFix (or provenance NONE / DEMO_METADATA)
              coverage polygon for the survey
8. MISSION    change vs prior survey → NEW | UNCHANGED | REMOVED | NOT_SURVEYED
              recovery priority → transparent weighted breakdown
9. PERSIST    write Detections to SQLite; write runs/<run_id>/manifest.json + metrics.json
```

Steps 1–8 are pure functions over typed records. Step 9 is the only writer.

---

## 5. Training flow (offline, explicit, never automatic)

```
configs/datasets/*.yaml
   │
   ▼
sagar.io.build_dataset_snapshot()      → data/snapshots/<snapshot_id>/
   │   frozen sample list + sha256 per file + group_key per sample
   ▼
sagar.evaluation.make_splits()         → group-wise train/val/test
   │   assert_no_group_overlap() + perceptual near-duplicate check
   │   ✗ FAILS THE BUILD if either assertion fails
   ▼
sagar.perception.train()               → Ultralytics YOLO, MPS
   │   + hard negatives and corrections from sagar.memory (if any exist)
   ▼
sagar.evaluation.evaluate()            → runs/<run_id>/metrics.json
   │
   ▼
sagar.memory.register_model()          → model_versions row
   │   id, parent, snapshot_id, split_id, metrics_ref, weights_sha256, device
   ▼
scripts/make_benchmarks.py             → apps/workstation/public/benchmarks.json
       refuses any run whose split assertions did not pass
```

Retraining is **operator-triggered**, never automatic. The system never silently changes the
model behind a detection that has already been reviewed.

---

## 6. Inference flow — model resolution

A detection records the model that produced it, permanently:
`model_version_id`, `weights_sha256`, `confidence_at_prediction`, `calibration_id`.

When a new model version is registered, **old detections are not rescored or overwritten.**
A re-run produces a *new* `run_id` and a *new* detection set. Comparing model versions is
therefore comparing two run sets, which is also how the ablation table is produced. This is
what makes "model version used" and "confidence at time of prediction" real fields rather than
aspirations.

---

## 7. Feedback / memory flow (persistent intelligence)

**Design rule: reviews are append-only events, never mutations of detections.** A detection is
an immutable statement about what a model said at a moment. A review is a separate immutable
statement about what a human said. Nothing overwrites anything.

```
operator opens Detection Review
   │
   ▼
POST /api/v1/detections/{id}/reviews
   { verdict: CONFIRMED | REJECTED | RELABELLED | UNCERTAIN,
     corrected_class?, corrected_bbox?, notes?, operator }
   │
   ▼
review_events (append-only)
   detection_id · verdict · corrected_* · operator · created_at
   model_version_id_at_prediction · confidence_at_prediction
   │
   ├──► DERIVED VIEWS (computed, never stored as mutable state)
   │      hard_negative_queue  = REJECTED   ∧ confidence ≥ τ_high
   │                             ← the model was confidently wrong: highest training value
   │      correction_queue     = RELABELLED
   │      hard_positive_queue  = CONFIRMED  ∧ confidence ≤ τ_low
   │      ambiguous_queue      = UNCERTAIN
   │
   └──► training_eligibility(detection) = has ≥1 review
                                        ∧ source frame licence permits training
                                        ∧ frame is not in the current val/test split
```

That last conjunct is critical and easy to get wrong: **feeding a reviewed detection from the
test split back into training silently destroys the test set.** `sagar.memory` refuses to emit
training-eligible examples whose frame belongs to val or test in the active split, and
`tests/test_feedback_leakage.py` asserts it.

Lineage is closed: `review → training example → snapshot → run → model_version → detection`.
Every model can answer "which operator corrections went into you", and every detection can
answer "which model produced me".

**What this is, in the exact words permitted:** persistent feedback memory, an active-learning
queue, model versioning, and an operator-triggered retraining pathway. It is **not** continuous
or autonomous learning, and `docs/CLAIMS_AND_EVIDENCE.md` forbids describing it as such.

---

## 8. Survey-history and change-detection flow — one substrate, two products

Change detection is not a separate feature bolted onto the pipeline. It is a **query over the
same persistence layer** that stores operator memory. This is the design's main economy: one
store, two headline capabilities.

```
survey_history:  survey_id → run_id → detections[] → coverage_polygon
                                   ↑
                        reviews scope which detections are trusted

POST /api/v1/compare { baseline_survey_id, new_survey_id }
   │
   1. resolve both surveys' latest accepted run
   2. require both ≥ L2 (else refuse with a stated reason)
   3. optional filter: compare only operator-CONFIRMED baseline detections
   4. Hungarian match on distance + class compatibility + size similarity,
      gated at r_match = max(15 m, 3σ_nav, 0.5 × footprint)
   5. classify:
        NEW          new detection, unmatched, inside baseline coverage
        UNCHANGED    matched within tolerance
        REMOVED      baseline detection, unmatched, INSIDE new coverage polygon
        NOT_SURVEYED baseline detection NOT covered by the new survey
   6. persist SurveyChange rows (a comparison is itself a durable artifact)
```

Step 3 is where persistent intelligence pays off visibly in the demo: change detection can be
run against *human-confirmed* history rather than raw model output, which is a materially
stronger claim than comparing two piles of unreviewed boxes.

---

## 9. How each USP fits the system

| USP | Module | Inputs | Output field | Fails safely as |
|---|---|---|---|---|
| **1. Open-set (KING)** | `perception.openset` | tile + detector backbone features + memory bank | `Candidate(source=OPEN_WORLD, category=UNKNOWN_ANOMALY_CANDIDATE, class_confidence=None)` | no proposals; known detection unaffected |
| **2. Persistence** | `evidence.persistence` | candidates across overlapping tiles in PICS | `PersistenceEvidence{mode, n_obs, n_opportunities, support, wilson}` | `applicable:false, reason:SINGLE_WINDOW_COVERAGE` |
| **3. Shadow** | `evidence.shadow` | tile + `u_range` + candidate box | `ShadowEvidence{contrast_z, continuity, ordering_ok}` | `applicable:false, reason:NADIR_NOT_RECOVERABLE` |
| **4. Change** | `mission.change` | two surveys' detections + coverage polygons | `SurveyChange{status}` | refuses below L2 with stated reason |
| **5. Priority** | `mission.priority` | fused detection + config weights | `RecoveryPriority{score, components}` | neutral component value, never 0 |

The KING USP in one paragraph: a **PatchCore-style memory bank** of patch embeddings taken from
annotation-free background regions of the **training split only**, extracted with **our own
fine-tuned detector's backbone**. Anomaly score is nearest-neighbour distance to that bank.
Thresholding is **per-survey** (`τ = max(τ_min, q99.5(this survey's scores))`) rather than
global, because absolute embedding distances shift across sensors and basins — the domain shift
GhostNetZero measured. Per-survey quantiles also bound false-positive burden by construction:
at q99.5 at most 0.5 % of patches can ever be proposed. Full spec in `docs/ML_PLAN.md` §6.

---

## 10. Persistence strategy

**SQLite (WAL) is the system of record.** One file, `data/sagar.db`. No server, no migration
framework beyond a numbered SQL migration folder.

| Store | Contents | Mutability |
|---|---|---|
| `data/sagar.db` | surveys, frames, tiles, detections, evidence, reviews, model_versions, benchmarks, survey_changes | detections/evidence append-only; reviews append-only |
| `runs/<run_id>/` | `manifest.json`, `metrics.json`, `artifacts/` (anomaly maps, shadow crops, overlays) | **immutable** |
| `data/snapshots/<id>/` | frozen dataset sample list + hashes + split assignment | **immutable** |
| `models/<model_id>/` | weights + `model_card.yaml` | immutable per version |
| `data/raw/<dataset_id>/` | untouched downloads | read-only |

Immutability is the mechanism that makes provenance real. If a run directory could be edited,
`run_id` in a report would mean nothing.

---

## 11. Deployment topology

**One machine runs the entire demo.** MacBook Pro M5 Pro, 24 GB, no cloud, no containers, no
orchestration.

```
localhost:3000   Next.js workstation (pnpm dev / next start)
localhost:8000   FastAPI (uvicorn), single process
                 └── PyTorch/Ultralytics on MPS, model loaded once at startup
data/sagar.db    SQLite WAL
runs/, models/   local filesystem
```

Explicitly excluded: Kubernetes, microservices, message queues, production auth, cloud storage,
distributed anything. `scripts/dev.sh` starts both processes; `scripts/demo.sh` runs the full
path from a cold checkout.

**Device honesty.** ONNX Runtime has **no MPS execution provider** on macOS — it silently
executes on CPU. Any latency measured that way is real but would be misleading if reported as
GPU inference. The internal build serves **PyTorch on MPS**; `RunManifest.device` records the
provider that actually executed, and `docs/EVALUATION_PROTOCOL.md` requires it in every latency
report. ONNX/CoreML export is a finals-scope experiment behind the same `Detector` protocol.

**When rented NVIDIA compute would make sense (finals only):** full-corpus DeeperSense
self-supervised pretraining (~52 GB, days of MPS time), multi-seed statistical runs, larger
backbones, and hyperparameter sweeps. None of it is required for, or used by, the internal
demo — and the architecture never assumes it.

---

## 12. Reference index

| Document | Contract it freezes |
|---|---|
| `docs/API_CONTRACT.md` | canonical objects + endpoints — frozen before Cursor starts |
| `docs/ML_PLAN.md` | baseline, datasets, training, fallback |
| `docs/DATA_STRATEGY.md` | dataset inventory, licences, canonical representation |
| `docs/EVALUATION_PROTOCOL.md` | splits, leakage safeguards, metrics, ablations |
| `docs/PRODUCT_SPEC.md` | every screen, state and interaction — Cursor's contract |
| `docs/CLAIMS_AND_EVIDENCE.md` | allowed wording and forbidden overclaims |
| `docs/INTERNAL_SCOPE.md` | P0 / P1 / P2 |
| `docs/HANDOVER.md` | agent execution order and file ownership |
| `docs/STATUS.md` | factual state |
