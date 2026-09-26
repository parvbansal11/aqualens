# Source audit — completed before frontend implementation

Source: /Users/parvbansal/Desktop/sagardrishti
Destination: /Users/parvbansal/Desktop/sagardrishti-astra
Source writable actions: NONE. Initial git status clean; HEAD 62b8567769482b13abbe50ef80b79ab35369bb6b.

## Product contract
Survey → Frame → Observation → Contact → Evidence → Review → Action/report. Contacts are deterministic associations over immutable observations. No browser-side association is run on live results. Null measurements remain absent, never zero. The existing visual hierarchy is not reused.

## Exact roles and permissions
From apps/workstation/src/components/final/runtime/strings.ts and shell/AppShell.tsx:
- field: Field Officer — results, review, map, report; upload/process.
- analyst: Sonar Analyst — results, full sonar workspace, review, report, map, change, review memory, Model Lab; upload/process.
- supervisor: Mission Supervisor — mission overview, results, review/priority, reports, map/coverage, change, review memory; upload/process.
- decision: Decision Viewer — decision overview, results, reports; upload/process. No review, map, or analyst workspace.
All now enter Workspace Home, as explicitly requested. Role selection is session-persisted; it is a workspace selection, not authentication. Existing permission boundaries remain route-guarded.

## Inspected routes and adapters
Source app routes: /, /app, /app/workspace, /app/review, /app/change, /app/comparison, /app/memory, /app/model-lab; public /how-it-works, /problem, /technology. FinalClaudeApp additionally switches landing, entry, upload, processing, results, map, workspace, review, mission, decision, change, memory, report, lab in state.
Inspected runtime/types.ts, api.ts, select.ts, zip-peek.ts, strings.ts, FinalClaudeApp.tsx; API app.py, jobs.py, navigation.py, contacts.py; scientific-copy tests and product/runtime contracts.
Representative observation: valid associated best_observation_id, else highest finite raw_confidence, else first associated record. Manual selection must persist independently per Contact.

## Actual live endpoints
GET /api/v1/runtime/health
GET /api/v1/runtime/surveys?limit=
POST /api/v1/surveys/upload — multipart file; accepts PNG/JPEG/PBM/ZIP; decoding and metadata validation happen before acceptance. Never retry writes automatically.
GET /api/v1/jobs/{job_id} and /events
GET /api/v1/runtime/surveys/{survey_id}
GET /api/v1/runtime/surveys/{survey_id}/contacts
GET /api/v1/runtime/surveys/{survey_id}/frames/{frame_id}/raster
POST /api/v1/runtime/surveys/{survey_id}/findings/{finding_id}/reviews
GET /api/v1/runtime/surveys/{survey_id}/report?format=json|csv&scope=contacts|observations
GET /api/v1/runtime/surveys/{survey_id}/change?baseline_survey_id=
GET /api/v1/runtime/memory/stats and /reviews
GET /api/v1/runtime/model-card
Legacy/prepared mission, detection, shadow, persistence, model, benchmark and comparison endpoints also exist. They are not substituted for runtime outputs.

## Runtime capabilities verified
Async QUEUED/PREPROCESSING/INFERENCE/POSTPROCESSING/COMPLETED/FAILED, observed per-phase states, actual counts, upload filename/bytes, optional registry and report readiness. No invented percentages.
Sonar condition is measured raster evidence. Pipeline acoustic verifier is advisory; dark regions do not establish shadow direction or artificiality. Persistence needs declared sequence and valid supplied ping bounds; repeated overlapping windows are WINDOW_OVERLAP_ONLY, not temporal persistence.
Contact fields include IDs/associations, best observation, classification, distinct frames, evidence fusion, anomaly/memory metadata, navigation, persistence, quality, priority, reviews and provenance. Detector scores, evidence scores, anomaly distance and priority are separate.
Review writes append an event to an observation and the associated Contact, then recompute transparent priority. CONFIRMED/REJECTED/RELABELLED/UNCERTAIN and canonical aliases are supported. No online learning. Export queues preserve lineage. Reports support JSON and Contact/Observation CSV. No PDF.

## Navigation/depth and scientific refusal
navigation.csv requires frame,timestamp_utc,latitude,longitude; optionally heading_deg,speed_mps,altitude_m,ping_start,ping_end. Frame API exposes lat/lon/heading/time, not depth. Altitude is not depth. Frontend normalized depth is an explicit nullable future field; present only if actually supplied. Fixture depth is illustrative.
Runtime Contact coordinates are copied from source-frame navigation, not pixel-to-world geolocation. Map labels this distinction. Tracks connect supplied ordered fixes only, with gaps preserved; no coverage polygons or bathymetry. Actual runtime change currently refuses removal: at most L1_FRAME_RELATIVE and no verified coverage polygon.

## Model facts verified
Frozen YOLO11s: PIPELINE, SHIPWRECK, CRAB_POT.
SHA-256 2aa3ac71051856bcfc8ec400804995f03568aa26d1a1fb24583e4eb1b7a10b15.
Open-set PATCHCORE_STYLE_OPEN_SET, open_set_v1, 2048 reference vectors, threshold 0.4616784453392029, q99.5_annotation_safe_background_val. Checked docs/OPEN_SET_V1.md and artifact config/threshold_calibration/hashes.json.
Natural Clutter: experimental ADVISORY_ONLY; REJECTED_FOR_AUTOMATIC_SUPPRESSION, no automatic veto. RF-DETR and mask refiner not configured. Review memory append-only, online_learning false.
SHIPWRECK held-out recall is zero at the frozen operating point; its recovery presentation may be DEMO_HEURISTIC, never production qualified. Display heuristic values must not become detector confidence.

## Fixture and asset findings
The latest stored five-frame Epitome record has six observations/three Contacts. Its own mission.notes says coordinates and ping ranges are synthetic, despite runbook wording that calls coordinates real. Some Epitome images are synthetic demonstration imagery. Neither is represented here as field evidence.
The new fixtures are independent presentation compositions using actual project sonar. Their Contact associations, example evidence values, review states, track and depth are explicitly illustrative. They do not inherit model scores from unrelated rasters. Raw detector fields are null. The frontend never treats an uploaded user file as a fixture.
Real sonar copied from claude-design-final/source/sonar and sonar/tiles. AI4Shipwrecks origin checked against data/raw/ai4shipwrecks; local metadata report records CC-BY-4.0. Exact sources/hashes recorded in public/sonar/ATTRIBUTION.json. No image synthesis.
