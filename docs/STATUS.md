# STATUS

**Last updated:** 2026-09-02 · **Phase:** VNEXT product-contract freeze after verified Kaggle artifact ingestion.

Values: `WORKING` · `PARTIAL` · `NOT STARTED` · `BLOCKED` · `NEXT HANDOFF`.
Only factual state. A component is `WORKING` only when it runs and has been observed to run.

---

## Overall

| Area | State |
|---|---|
| Architecture & contracts | **WORKING** — 11 documents written and frozen |
| Repository scaffold | **WORKING** — installable `sagar` package, scripts and tests now exist |
| Data acquisition | **PARTIAL** — verified SubPipeMini2 acquired; AI4Shipwrecks source host blocks machine retrieval |
| Canonical conversion / preprocessing / tiling | **WORKING** — executed on verified Mini2 source data |
| Frame-level splits / leakage safeguards | **WORKING** — five assertions pass on `snap_2fa4bca0a0bc4b7d` |
| ML — detector (`final_v1`, YOLO11s) | **WORKING** — frozen, checksum-verified (`ml/artifacts/final_v1/detector/`); real local inference runs and is bound to the API. Held-out test: PIPELINE precision 0.68 / recall 0.55; CRAB_POT precision 0.52 / recall 0.44; **SHIPWRECK precision 1.00 / recall 0.00 (did not detect any held-out shipwreck)**. `internal_v2` is superseded. |
| ML — SHIPWRECK presentation | **PARTIAL, clearly marked** — `sagar.perception.demo_policy` may present a real class-1 or anomaly signal as SHIPWRECK for the demo UI, tagged `classification_source=DEMO_HEURISTIC`, `production_qualified=false`. This is not a measurement and is excluded from Model Lab figures. |
| Backend | **WORKING** — real arbitrary-upload path invokes condition assessment → frozen inference → Contact construction → physics/persistence capability gates → unvalidated evidence fusion → priority → append-only review → JSON/CSV export. |
| VNEXT Natural Clutter v1 | **REJECTED_FOR_AUTOMATIC_SUPPRESSION** — immutable Kaggle checkpoint/provenance retained; validation FP reduction (23→19) eliminated both baseline TPs and reduced recall 2.82%→0%; runtime is advisory-only/null. |
| RF-DETR | **NOT AVAILABLE** — no legitimate trained artifact is registered. |
| Frontend | **WORKING** — production frontend is a direct structural port of `preserved design export` (12/12 canonical screens), bound to the real FastAPI runtime; no synthetic sample data ships in the app shell |
| Geolocation | **NOT AVAILABLE** — this deployment accepts imagery only, with no navigation ingest; every finding's `lat`/`lon` is `null` and every screen renders the canonical "Location unavailable" / "No position" state. No coordinate is ever fabricated or approximated. |
| Tests | **WORKING** — 34 Python tests and 38 workstation tests pass; production build and typecheck pass |
| Demo | **WORKING** — upload → inference → review → export exercised end to end against the running API on a non-test raster; PDF export intentionally refused (`422`), not faked |

## Repository facts

- No commits. `git init` run; working tree untracked.
- Python Stage 2 package, scripts and tests exist under `packages/sagar/`, `scripts/`, and `tests/`.
- `configs/` holds `product.yaml`, `classes.yaml`, `priority_weights.yaml`,
  `datasets/_TEMPLATE.yaml`, `datasets/pingeco_ghostpot.yaml`.
  `configs/classes.yaml` was rewritten at lock (v2) to match `docs/DATA_STRATEGY.md` §2.
  `configs/datasets/{subpipe,ai4shipwrecks}.yaml` added. Observed SubPipe gates are written
  by `scripts/verify_gates.py`.
- `data/raw/subpipe/SubPipeMini2.zip` is MD5-verified real data. The archive and derived data
  are ignored by git.
- `models/` is empty. The frozen detector artifact is retained read-only at
  `ml/artifacts/internal_v2/sagardrishti_internal_v2_artifacts/` and is not modified by integration work.
- `docs/architecture-brief.html` is the source of the published research artifact.

## Documentation

| File | State |
|---|---|
| `docs/RESEARCH.md` | WORKING — canonical local research source |
| `docs/ARCHITECTURE.md` | WORKING — frozen |
| `docs/ML_PLAN.md` | WORKING — frozen |
| `docs/DATA_STRATEGY.md` | WORKING — frozen |
| `docs/API_CONTRACT.md` | WORKING — **frozen before frontend work** |
| `docs/EVALUATION_PROTOCOL.md` | WORKING — frozen |
| `docs/PRODUCT_SPEC.md` | WORKING — frozen |
| `docs/CLAIMS_AND_EVIDENCE.md` | WORKING — all claims currently `NOT STARTED` |
| `docs/INTERNAL_SCOPE.md` | WORKING |
| `docs/HANDOVER.md` | WORKING |
| `docs/STATUS.md` | this file |

## Blocked

| Item | Blocker | Owner | Impact |
|---|---|---|---|
| PINGEcosystem dataset | HF gated — a human must accept terms and share contact details, then set `HF_TOKEN` | **Parv** | Third class unavailable; open-set LOCO limited to 2 folds. **Does not block the build.** |
| AI4Shipwrecks download transport | Deep Blue Data host returns a Cloudflare challenge to non-browser clients in this environment | Codex / Parv if direct archive URL is needed | Licence and site count resolved; acquisition script records the exact host block and accepts an official direct archive URL |
| SubPipe redistribution | GPL-3.0 on a dataset; implications for derived artifacts unresolved | Parv (decision) | No impact on local training/demo |

## Open technical risks

| Risk | Status |
|---|---|
| GhostVision `safetensors` may not load into Ultralytics (no `.pt` published) | Unresolved — SPIKE S1, 90-min timebox, COCO-init fallback is the plan of record |
| Fine-tuned model may underperform the baseline | Fallback decided in advance — `docs/ML_PLAN.md` §11 |
| Open-set AUROC may be weak | Accepted — protocol execution is the P0 deliverable, not a score |

## Stage 2 evidence

- **WORKING:** SubPipeMini2 MD5 is `7e0d925f93a89bc0e8715e4f6f7caecb`, matching Zenodo.
  The archive contains 1,958 real SSS source frames, 1,319 COCO pipeline annotations, and
  HF/LF PBM waterfall imagery with nav CSVs.
- **WORKING:** DatasetSnapshot `snap_2fa4bca0a0bc4b7d` contains 404 annotated source frames,
  5,930 512x512 tiles at 50% overlap, 1,071 clipped pipeline boxes, and all five leakage
  assertions `PASS`. The real-snapshot split test passes. It allocates 290/86/28 annotated
  source frames and 772/239/60 boxes to train/val/test respectively.
- **WORKING:** visual and data QA passed: 1,958 canonical source frames and 5,930 tile files
  opened successfully; all source/tile boxes are valid; the contact sheet is saved beside the snapshot.
- **WORKING:** Kaggle-ready bundle generated at
  `data/processed/snap_2fa4bca0a0bc4b7d/kaggle`; it preserves 4,330 train, 1,280 validation,
  and 320 held-out test tiles.
- **PARTIAL:** Mini2 exposes only two natural recording sequences. The supervised snapshot uses
  observed timestamp-derived blocks, with 300-second overlap embargoes and 1,111 excluded boundary
  frames. The full SubPipe archive remains incomplete and is not represented by this snapshot.
- **WORKING:** AI4Shipwrecks metadata resolved from the authoritative Deep Blue Data DOI record:
  licence `CC-BY-4.0`; 28 distinct shipwrecks. The earlier 24-site statement was not corroborated.
- **BLOCKED:** the Deep Blue Data host responds to command-line requests with a Cloudflare challenge.
  An authorized browser-derived archive URL is required to complete its acquisition.

## NEXT HANDOFF

**→ Frontend port and runtime binding are complete.** `apps/workstation/src/components/final/`
is the sole production presentation layer (public site, role entry, and all twelve in-app
screens); the superseded `components/v2/` implementation and its unused public asset copies
were removed. The frozen `final_v1` detector (`ml/artifacts/final_v1/detector/best.pt`,
checksum-pinned) is the only model the API serves; `internal_v2` is retained read-only for the
non-runtime registry endpoints and is not what the workstation binds to.

Known, intentional gaps, not regressions:
- No navigation/GPS ingest exists, so no finding ever carries a real position and the map's
  geographic layers (coastline, track, coverage swath) render their canonical unavailable state
  rather than a fabricated one.
- SHIPWRECK detection is not production-qualified (0.00 recall on the held-out split); its
  demo-only presentation heuristic is confidence-boosted display text, not a claim of detection
  capability, and is excluded from every measured figure in Model Lab.
- The upload pipeline runs synchronously, so intermediate processing-stage states are not
  independently observable; the UI reports this honestly rather than animating stages it did not
  observe.
- PDF report generation does not exist and is refused, not simulated.

Before extending this beyond the current scope: resolve navigation ingest before claiming any
map or L2 change capability, and do not promote SHIPWRECK to a measured class without a held-out
retrain that clears recall above the demo-policy floor.
