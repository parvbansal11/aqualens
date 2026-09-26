# Internal hack freeze snapshot

Authoritative snapshot of the verified-working state before the design system
frontend port. Recorded 2026-09-06 on branch `deployment`.

## Architecture

- Backend: single-process FastAPI service (`packages/sagar/api/app.py`,
  `packages/sagar/api/jobs.py`), served by uvicorn. Async survey upload -> job
  queue -> classified job lifecycle (`QUEUED` -> ... -> `COMPLETED`/`FAILED`),
  polled via `GET /api/v1/jobs/{job_id}`.
- Detector: frozen YOLO11s (`sagardrishti_multidomain_v1_1_yolo11s`), 3 known
  classes (`PIPELINE`, `SHIPWRECK`, `CRAB_POT`), tiled inference.
- Open-set evidence: PatchCore-style anomaly memory over frozen YOLO11s
  layer-16 embeddings (`open_set_v1`), advisory only, thresholded at
  q99.5 of validation-split background.
- Contact fusion: deterministic rule over sequential observations
  (`SEQUENTIAL_PING` / `SINGLE_OBSERVATION`), producing the Contact as the
  primary operational object; raw observations remain separately inspectable.
- Evidence fusion: `UNVALIDATED_EVIDENCE_FUSION` over whichever channels are
  actually available per contact (detector, persistence, quality, navigation,
  open-set); unavailable channels (artificiality, physics/acoustic verifier)
  are excluded from the weighted sum, never zero-filled.
- Review memory: append-only SQLite-backed verdict log, four training-memory
  queues (`confirmed_positive`, `hard_negative`, `relabelled`, `uncertain`).
  Online learning is disabled; verdicts never retrain a model at runtime.
- Frontend: Next.js 16 / React 19 single-page app under `/app`
  (`apps/workstation/src/components/final/AqualensApp.tsx`), 15 screens
  driven by client-side state plus a handful of directly linkable routes.
  Legacy `src/components/platform/*` components are dead code (referenced
  only by two older test files, not by any live route) — left in place, not
  deleted, per this pass's scope.

## Frozen artifacts

- Detector weights: `ml/artifacts/final_v1/detector/best.pt`
  SHA-256 `2aa3ac71051856bcfc8ec400804995f03568aa26d1a1fb24583e4eb1b7a10b15`
  (verified to match on 2026-09-06; also the `feature_extractor_sha256` the
  open-set memory bank was built against).
- Open-set memory: `ml/artifacts/vnext/open_set_v1/`
  (`config.json`, `memory_bank.npz`, `memory_version: "open_set_v1"`,
  threshold `0.4616784453392029`, source `q99.5_annotation_safe_background_val`).
- Frozen evidence run (legacy detections/frames used by the pre-runtime API
  surface, and required at backend startup): `runs/run_stage3c_v4/`
  (`frames.json`, `detections.json`, `benchmark.json`, `manifest.json`,
  `model_version.json`) plus `data/processed/snap_2fa4bca0a0bc4b7d/`
  (`split.json`, `tiles.jsonl`). All four are load-bearing at
  `Store.__init__` — the backend will not start without them, so they are
  intentionally kept in the Docker build context.

## Known-working demo (verified this pass)

Upload of `~/Desktop/Aqualens_Epitome_Demo_Survey.zip` (5 sonar rasters,
`navigation.csv`, `mission.json`) through the running backend:

- Upload accepted in <100 ms (async), job reached `COMPLETED` immediately.
- 5 source frames, 15 tiles, 6 detector findings, 3 fused Contacts.
- Navigation `AVAILABLE`, real recorded lat/lon on every frame.
- Open-set scored 6 of 6 observations; one Contact flagged
  `is_open_set_candidate: true`.
- Evidence Score present and separate from raw detector confidence on every
  Contact; `SEQUENTIAL_PING` persistence evidence on the 3-observation
  Contact.
- Report JSON (`GET .../report?format=json`) and both CSV scopes
  (`scope=contacts`, `scope=observations`) returned correct, non-fabricated
  rows.
- A real review verdict (`CONFIRMED`) was posted, appeared immediately in
  `GET /api/v1/runtime/memory/reviews` and `.../memory/stats`, with
  `online_learning: false` and `append_only: true` preserved.
- Change comparison against a second Epitome survey correctly refused
  (`COMPARISON_REFUSED`) with named gates (`SPATIAL_REFERENCE_LEVEL`,
  `COVERAGE_POLYGON`) rather than a fabricated diff.
- A separate single-image survey with no `navigation.csv`
  (`survey_upload_8fb96c6619ac`) carries `navigation_status: UNAVAILABLE`
  and `latitude`/`longitude: null` throughout — no fake coordinates, no
  leakage from the navigated survey processed around it.
- Classified failure states confirmed: empty upload ->
  `VALIDATION_FAILED` "Upload is empty."; unreadable raster ->
  `UNREADABLE_RASTER` naming the file, no inference attempted. Neither
  produces a generic browser "Load failed".

## Test counts (this pass, 2026-09-06)

- `uv run pytest -q`: **111 passed**.
- `pnpm test` (apps/workstation, vitest): **160 passed** across 10 files,
  including `scientific-copy.test.tsx` (52 tests), `resilience.test.tsx`
  (16 tests, transient-failure and survey-pointer-survival behavior),
  `accessibility.test.tsx` (17 tests), `final-port.test.tsx` (31),
  `final-parity.test.tsx` (19).
- `pnpm build`: succeeds, 12 static routes.
- `pnpm lint`: clean.

## Known limitations (unchanged this pass, still true)

- SHIPWRECK class is demo-only / not production-qualified
  (`production_qualified: false`); heldout recall is 0 in the frozen
  evaluation run — the model detects it in the live demo path via the
  open-set/evidence stack, not via a mature supervised SHIPWRECK detector.
- RF-DETR, Natural Clutter, and the mask refiner are all `NOT_CONFIGURED` /
  advisory-only; Natural Clutter is explicitly
  `REJECTED_FOR_AUTOMATIC_SUPPRESSION` because its FP reduction previously
  removed true positives too.
- Spatial reference level is `L1_FRAME_RELATIVE` for the Epitome bundle (no
  coverage polygon), so the Change screen's comparison gates
  (`SPATIAL_REFERENCE_LEVEL`, `COVERAGE_POLYGON`) will always refuse a real
  comparison against this data — that refusal is correct behavior, not a bug.
- No PDF export exists or is offered anywhere in the product.
- `docs/CLAIMS_AND_EVIDENCE.md` and the scientific-copy test file
  (`apps/workstation/src/test/scientific-copy.test.tsx`) are the source of
  truth for what language is and is not permitted; both predate and survive
  this pass unchanged in substance.

## Unsupported claims (do not make these)

Calibrated probability of any score; universal unknown-object recognition;
autonomous/self-learning behavior (online learning is hard-disabled);
learned ecological risk; GPS derived from sonar alone; production-grade
SHIPWRECK recognition; Natural Clutter improving detection.

## Startup

```sh
bash scripts/start_internal_demo.sh      # one-command local start
bash scripts/internal_hack_check.sh      # one-command read-only health check
bash scripts/internal_hack_check.sh --with-upload   # + real Epitome E2E
```

See `docs/JUDGE_DEMO_RUNBOOK.md` for the full judge flow, backup paths, and
what not to claim.

## Screens available (all reachable this pass)

Landing, Permission, Role entry, Mission, Upload, Processing, Results,
Workspace, Map, Review, Memory, Change, Decision, Report, Model Lab — all 15
wired into `/app` as client-side states of `AqualensApp.tsx`, plus
directly linkable routes at `/app/workspace`, `/app/review`, `/app/memory`,
`/app/change`, `/app/comparison`, `/app/model-lab`, and the public marketing
routes `/`, `/problem`, `/technology`, `/how-it-works`.
