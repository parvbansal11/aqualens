# INTERNAL SCOPE — P0 / P1 / P2

**P0** must work for the internal hackathon. **P1** is high-value polish, built only after every
P0 is green. **P2** is finals / post-selection and must not be started now.

**Scope rule:** nothing moves from P1/P2 into P0 without something moving out. The failure mode
this document exists to prevent is a half-finished P1 blocking a P0 demo.

---

## P0 — must work

### Data & pipeline
- `scripts/acquire_subpipe.py`, `scripts/acquire_ai4shipwrecks.py` → `data/raw/`
- Canonical frame conversion + nav normalisation (`docs/DATA_STRATEGY.md` §2)
- Tiling 512×512 at 50 % along-track overlap, frame-level split assignment **before** tiling
- Dataset snapshot with frozen sample list + hashes
- Five leakage assertions, enforced, written to the run manifest
- `NadirEstimator` → geometry descriptor → `SpatialReferenceLevel`
- CLAHE + speckle suppression (ENHANCED layer; RAW never mutated)
- Quality scoring with exclusion counting

### ML
- SPIKE S1 (safetensors loadability, 90 min timebox)
- Baseline evaluation: `gv-yolo12` ONNX on our test split, device recorded
- **One real fine-tuning run**: YOLO-s, 2–3 classes, ~80 epochs, MPS, best-on-val
- Model card + model registry entry with lineage
- Isotonic calibration + 8-feature fusion LR, fitted on val
- Open-set: detector-backbone memory bank + per-survey q99.5 threshold + proposals
- Metrics: P/R/F1/mAP@50/mAP@50:95 per class + per dataset; open-set AUROC/AUPRC/seabed-FPR;
  latency, model size, FP-per-km
- Ablations A0–A6
- Failure-case artifacts (FP / FN / open-set FP)

### Five USPs
- **1 Open-set** — proposals, `class_confidence: null` enforced, LOCO evaluation executed
- **2 Persistence** — `WINDOW_OVERLAP` mode with real `n_obs`/`n_opportunities` + Wilson
- **3 Shadow** — `contrast_z`, `continuity`, `ordering_ok` against a **range-matched** background
- **4 Change** — NEW / UNCHANGED / REMOVED / NOT_SURVEYED with a real coverage polygon
- **5 Priority** — weighted score reproducible from its stored breakdown

### Persistent intelligence
- Append-only `review_events`; four verdicts
- Derived queues: hard negatives, corrections, hard positives
- `training_eligible` with the val/test-split guard + `tests/test_feedback_leakage.py`
- Model registry with lineage; `confidence_at_prediction` frozen on every detection
- Survey history queryable (the substrate change detection runs on)

### Backend
- FastAPI implementing **every endpoint** in `docs/API_CONTRACT.md`
- SQLite (WAL) schema + numbered migrations
- SSE job progress with real per-stage timings
- JSON / CSV / GeoJSON report export from the same `Detection` records
- Contract-invariant validators (the six rules in `API_CONTRACT.md` §2)

### Frontend
- All five surfaces (`docs/PRODUCT_SPEC.md`)
- Sonar viewport: pan, zoom, four layer tabs, accurate overlays at all zoom levels, selection
- Inspector: contribution waterfall, all three evidence blocks, **shadow crop**, geo provenance,
  priority breakdown, review controls
- Keyboard review loop
- Comparison surface with coverage overlay and `confirmed_only`
- Model Lab reading `benchmarks.json` only
- Demo watermark; provenance badges everywhere; `applicable:false` chips

### Tests (all P0)
`test_module_boundaries` · `test_contract_invariants` · `test_splits` (5 assertions) ·
`test_feedback_leakage` · `test_no_hardcoded_metrics` · `test_geo_provenance` ·
`test_unknown_contract` · `test_priority_reproducible`

### Demo
`scripts/dev.sh` and `scripts/demo.sh` run cold-checkout → full path on real data.

---

## P1 — high-value polish (only after all P0 green)

- PINGEcosystem ingest + third class (**highest-value P1** — takes LOCO from 2 folds to 3 and
  adds the class closest to the problem statement)
- Segmentation head on AI4Shipwrecks masks + IoU/Dice
- `implied_height_m` from shadow geometry where altitude and range scale are known
- `SEQUENTIAL_PING` persistence mode using SubPipe nav ordering
- Calibration reliability diagram + ECE in the Model Lab
- Anomaly heatmap overlay layer in the viewport
- Mission map polish: uncertainty ellipses, track rendering, priority-sized markers
- Box adjustment on relabel
- Strict vs inclusive metric protocols for `Maybe-Crab-Pot`
- Cross-frequency (LF↔HF) generalisation experiment
- `MOVED` change status
- Report PDF

---

## P2 — finals / post-selection. Do not start.

- Full DeeperSense SSL pretraining (52 GB) and a domain-general encoder
- Marine-PULSE ingest, `ENGINEERING_STRUCTURE` class, multi-instrument robustness
- PhysDNet-style physics decomposition
- RF-DETR / YOLO26 architecture comparison; multi-seed statistical runs
- Deep ensembles, MC-dropout, conformal prediction
- Core ML / INT8 export, on-device benchmarking, streaming inference during acquisition
- Cross-line corroboration; pixel-level co-registered change detection
- Raw sonar format decoding (XTF, JSF, Humminbird), ground-range correction with bathymetry
- Attitude-driven geometric *correction* (v1 detects and scores attitude artefacts, does not fix)
- Automated retraining triggers; a real active-learning acquisition function
- Auth, multi-user, audit trail, RBAC
- Rented NVIDIA compute for any of the above
- Sea-trial validation on Indian-waters data with NIOT

---

## Explicit non-goals for internal

Real-time onboard inference · cloud deployment · mobile · i18n · light theme ·
production authentication · any dataset beyond SubPipe / AI4Shipwrecks / PINGEcosystem ·
a sixth headline USP.
