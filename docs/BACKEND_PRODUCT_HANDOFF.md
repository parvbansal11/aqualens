# Aqualens backend workspace handoff

The Mission → upload → Survey → Contact → analyst → report flow is implemented in the existing FastAPI application. Research availability is separate from service health. No new scientific validation is claimed.

## Run locally

From the repository root, using the existing environment and frozen model:

```sh
PYTHONPATH=packages .venv/bin/python scripts/serve_api.py
```

Base URL: `http://127.0.0.1:8000/api/v1`. OpenAPI: `http://127.0.0.1:8000/openapi.json`; interactive docs: `/docs`.
Use one backend process/worker. Model inference is serialized and the loaded detector is reused. This is a local workstation service, bound to loopback by the launcher; actor names are declarations, not authenticated identities. No enterprise authentication or onboard deployment is claimed.

`SAGARDRISHTI_RUNTIME_DIR` selects writable runtime storage (default `data/runtime`). It must be outside frozen artifact/protocol directories. Existing artifact and model configuration remains compatible. SQLite tables extend `reviews.sqlite3`; ingestion still uses the existing retained upload/runtime store. Jobs survive restart; interrupted jobs explicitly fail without rerunning inference.

## Deterministic demo

```sh
PYTHONPATH=packages .venv/bin/python -m sagar.api.demo
# Stop the backend before reset. The old demo directory is archived, not destroyed.
PYTHONPATH=packages .venv/bin/python -m sagar.api.demo --reset
```

Stable IDs: `demo_mission_arabian_sea_07`, `demo_survey_01`, `demo_contact_a`, `demo_contact_b`, `demo_contact_c`.
`GET /demo/missions` or `GET /missions?demo=true` discovers them. Repeated seeding preserves analyst edits. Reset restores fixture content and archives previous audit history. A process lock refuses reset while a backend holds the demo store.

Optional `AQUALENS_DEMO_MODE=1` enables the non-destructive `POST /demo/seed` endpoint. It never enables detector recovery. Demo storage is `data/runtime/demo/product.sqlite3`, separate from real records. Real Missions reject synthetic-navigation uploads; demo Missions reject real upload processing. Demo reports retain `demo=true`, DEMO labeling and SYNTHETIC_DEMO geometry. Every fixture score is explicitly synthetic, never an inference result. Contact B has no machine prediction and no anomaly p-value. Contacts A (machine CRAB_POT) and B (no machine class, local anomaly NOT_VALIDATED) start UNREVIEWED so a presenter performs the analyst review, classification and priority live; Contact C (PIPELINE) carries one scripted DEMO_FIXTURE verdict so review history is populated from the start.

## Contracts and flow

Machine-readable handoff: `schemas/aqualens-product.schema.json` (Pydantic JSON Schema for Mission, Upload, Survey, Contact, Evidence, Machine, Analyst, review inputs/events, Capability, Map, Report), `schemas/aqualens-openapi.json`, and `schemas/aqualens-demo-examples.json` (deterministic DEMO responses). All three are generated from the implementation by `PYTHONPATH=packages .venv/bin/python scripts/export_product_contracts.py`; `tests/test_product_invariants.py` fails if they drift. List endpoints (`/missions/{id}/contacts|surveys|uploads|jobs`) are typed loosely in OpenAPI; use the product schema and demo examples for their item shapes. No frontend files were changed.

| Operation | Route (relative to `/api/v1`) | Contract |
|---|---|---|
| Create/open/list Mission | `POST /missions`, `GET /missions/{id}`, `GET /missions` | Create `{name, operator?, notes?}`; generated ID, `demo=false`, explicit REAL provenance. List remains an array for compatibility, with offset/limit; `demo=true` selects demo only. |
| Upload | `POST /missions/{id}/uploads` | Multipart `file`; PNG/JPEG/PBM or ZIP. Returns HTTP 202, upload/job IDs and **survey_refs**. Processing starts automatically. |
| Inspect uploads | `GET /missions/{id}/uploads` | SHA256, status, source, job reference and navigation declaration. Same upload bytes in one Mission return `DUPLICATE_UPLOAD` (409). |
| Inspect Surveys | `GET /missions/{id}/surveys`, `GET /surveys/{survey_ref}` | B membership: SINGLETON, DECLARED or VERIFIED. Missing sensor/acquisition metadata stays null. |
| Process/poll | `POST /surveys/{survey_ref}/process`, `GET /jobs/{id}`, `GET /missions/{id}/jobs` | Process returns the already-started job, including after failure. Never duplicates Contacts. Jobs expose observed phases/counts, not invented percentages. |
| Contact memory | `GET /missions/{id}/contacts` | `{items,total,offset,limit,demo}`. Filters: survey_ref, machine_class, analyst_class, status, priority, reviewed, search (Contact ID substring). Sort: created/reviewed/priority; stable ID tie-break. |
| Contact evidence | `GET /contacts/{id}`, `/contacts/{id}/evidence` | Immutable machine fields, detections, Look memberships, six evidence channels, current analyst state and history. |
| Review | `POST /contacts/{id}/review` | `{actor,status,note?}`; CONFIRMED, REJECTED or UNRESOLVED. An analyst may revise any prior verdict; UNREVIEWED is initial-only. |
| Classify | `POST /contacts/{id}/classification` | `{actor,classification,note?}`; analyst taxonomy below. Never changes machine class. |
| Priority | `POST /contacts/{id}/priority` | `{actor,priority,note?}`; CRITICAL/HIGH/MEDIUM/LOW/UNSET. System priority remains null. |
| Notes/history | `POST /contacts/{id}/notes`, `GET /contacts/{id}/history` | `{actor,note}`; append-only events record before/after, actor, timestamp, provenance. SQLite prevents history update/delete. |
| Map | `GET /missions/{id}/map` | GeoJSON `features` are Contact locations only. `availability` refers to Contact localization. `platform_context` contains separately marked declared MEASURED platform fixes, never Contact positions. No inferred tracks. |
| Reports | `POST /missions/{id}/reports`, `GET /reports/{id}` | Immutable structured snapshot of Mission, uploads, Surveys, Contacts/history/evidence, map, jobs, model/build provenance and limitations. Refused while uploads are incomplete/failed. |
| Download | `GET /reports/{id}?format=json\|html&download=true` | Escaped HTML or JSON; no PDF dependency. |
| Feature gating | `GET /system/capabilities` | Typed implementation status plus evidence availability, mode and reason. Gate using these and each Contact's evidence state. |
| Provenance | `GET /system/provenance` | Actual model digest, source-file digests, Git HEAD/dirty state at startup, per-class metrics read from the existing artifact, limitations. `shipwreck_recovery`, `scientific_mode` and `shipwreck_recovery_invocations` are read from the live detector, not hardcoded. |
| Operations | `GET /health`, `GET /readiness` | Also available without `/api/v1`. Readiness probes SQLite/storage and detector dependencies/hash; reports unloaded model separately. It is not an inference benchmark or scientific-validation gate. |

A legacy upload response's `survey_id` denotes the retained **Upload runtime container**, not a strict Survey. Mission uploads add `survey_refs`, which frontend code must use for scientific Survey identity. Source-raster URLs remain on the existing runtime route. Frame IDs are scoped to their Survey/Upload.

Existing frozen and `/runtime/*` contracts remain for compatibility. Their historical heuristic/normalized fields are not the product evidence contract and must not power the redesigned workspace. Runtime responses carry `X-Aqualens-Contract: legacy-unvalidated-presentation`. Historical Missions listed with `legacy=true` are not silently imported into product Missions. Historical artifacts are unchanged.

## Scientific semantics

`machine.supervised_class`: PIPELINE, SHIPWRECK, CRAB_POT only. `raw_detector_score` is uncalibrated. No material probability or calibrated Contact score is exposed by the product API. SHIPWRECK's held-out recall-zero failure and degenerate precision are explicit. The metrics endpoint distinguishes training representation from the frozen H0 runtime evaluation; no overall precision headline is used.

`analyst.classification` is version-one human semantics: FISHING_GEAR, ROPE_LINE, NET_LIKE_DEBRIS, PLASTIC_DEBRIS, METALLIC_DEBRIS, CONTAINER_DRUM, TYRE_RUBBER, CABLE_PIPELINE_RELATED, STRUCTURAL_DEBRIS, NATURAL_FEATURE, OTHER, UNRESOLVED. No authoritative broad debris analyst taxonomy existed in the inspected code; this explicit taxonomy does not replace historical detector taxonomies.

Evidence channels: detector, local_anomaly, persistence, raised_relief, navigation, analyst. Each has status, source, method, values, provenance, reason, timestamp, artifact_ref, demo. Statuses: AVAILABLE, UNAVAILABLE, NOT_VALIDATED, NOT_APPLICABLE, FAILED. Non-AVAILABLE evidence cannot carry measured values. Missing evidence is neither positive nor negative evidence.

Local anomaly is NOT_VALIDATED with no p-value: unusual relative to comparable seabed, never automatic artificiality. Water-column validation is pending; PID-02/D1 are not bypassed. Raised relief and metric depth/height are unavailable. Descriptive frame intensity statistics are not physical geometry.

A Contact is one physical-object hypothesis. Only the pre-existing verified PIPELINE along-track rule may produce multiple Looks from disjoint contiguous windows. Point targets require a repeated physical observation that this dataset contract does not supply. Verified overlapping source pings remain one Look. Duplicate rasters are flagged by B; product processing runs only one representative of a byte-identical group. Upload order, declared navigation and synthetic coordinates create no persistence. Available continuity evidence is not a validated performance claim.

MEASURED navigation remains an uploader declaration. B's DERIVED_FROM_SOURCE ping relationships do not imply GPS. Real Contact map features stay unavailable without defensible localization; platform fixes are separate context. Capability `contact_localization` is UNAVAILABLE. Product Contacts carry no latitude/longitude field at all; their `evidence.navigation` is UNAVAILABLE. Synthetic map points exist only in the tagged demo fixture.

Legacy caveat: the pre-existing `/runtime/*` Contact records still copy a frame's declared platform fix into `latitude`/`longitude` (with `localization_uncertainty_status: UNAVAILABLE`). That committed legacy contract was not rewritten. It is tagged `legacy-unvalidated-presentation` and must not be used as Contact localization by the redesigned workspace.

## Verification harnesses

- `tests/test_product_real_smoke.py`: a retained real SubPipe frame (`../sagardrishti/data/interim/subpipe/frames/subpipe_hf_f08e01ebe9790048.png`, read-only) → frozen detector → Contact → Mission report. It asserts the model SHA, recovery invocations = 0, UNAVAILABLE Contact localization, and an unchanged input digest. It is skipped when the frame or weights are absent. Plumbing only; not an evaluation.
- `tests/test_product_invariants.py`: hostile checks. They cover duplicate-raster single inference, platform fix ≠ Contact position, demo-recovery output refused by real Missions, live recovery reporting, frozen/source storage refusal, no fake-green capabilities, synthetic/coordinate/order-driven association, the demo end-to-end tag walk, and contract drift.

Runtime storage (`SAGARDRISHTI_RUNTIME_DIR`) is refused for the project root, `artifacts/`, `ml/artifacts/`, `models/`, `runs/`, `data/{processed,raw,interim,registry}`, `docs/`, `packages/`, `tests/`, `.git/`, and the sibling `sagardrishti` research repository.

## Failure and operational boundaries

Errors use `{error:{code,message,detail}}`. Invalid enums/extra mutation fields are rejected, not coerced into scientific fields. Missing references return 404; duplicate uploads and report readiness return 409; invalid uploads return 422; operational byte limits return 413. Internal exceptions are logged locally with generic client messages.

ZIP traversal and duplicate basenames are rejected; compressed/expanded uploads are limited to 512 MiB by default (`SAGARDRISHTI_MAX_UPLOAD_BYTES`), 10,000 members maximum, and each raster to 64 megapixels. Failed/rejected input files may remain in runtime upload storage for local troubleshooting; retention/cleanup automation is deferred. No endpoint accepts a filesystem path. No reset/delete endpoint affects real records.

There is no automatic failed-job retry or resume. Repeated process calls expose the same failure; byte-identical uploads in the same Mission remain duplicate-rejected. For another attempt after correcting the environment, create a new Mission. This deliberately avoids silently replacing Contact identities or their review history.

## Post-freeze scoped corrections

Starting HEAD: `aa00d1dfb377611b2fdd7eb43309aef06448e584` on `main`. Pre-existing untracked PID-02 annotations, `tests/test_wc_annotation_extension.py` and `tools/` were left untouched.

The shared `_association_relation` previously used verified same-Survey contiguous frame ping bounds and the frozen range-match gate for every class. Two CRAB_POT boxes at survey pings 100–200 and 600–700 could merge and increment Look count. `contact_fusion@v1.1_point_target_guard` restricts this disjoint-window branch to PIPELINE; it adds no thresholds. Existing same-ping overlap and extended-target tests remain.

`FinalDetector` now defaults recovery OFF, and backend construction explicitly passes False. The presentation-score helper is also opt-in. Explicit legacy `shipwreck_recovery=True` remains possible at the library seam, with heuristic records tagged demo/SYNTHETIC_DEMO. The backend exposes no recovery switch.

H0 inference already explicitly disables recovery and serializes only raw class/box/score/tile fields. H0's layer-16 cache and detector measurements do not invoke Contact association. No frozen H0 measurement is invalidated by these two corrections; historical backend Contact groupings may differ on a future new run. Frozen artifacts, source protocol, weights and caches were not rewritten or regenerated. No new point-target multi-Look positive fixture was invented.
