# Runtime API

The runtime surface is what the workstation actually talks to when an operator
uploads a survey. It sits alongside the frozen Stage 3B contract in
`docs/API_CONTRACT.md`, which continues to describe the immutable
`run_stage3c_v4` evidence artifacts and is unchanged.

Base: `${NEXT_PUBLIC_API_BASE_URL}/api/v1` · JSON · `snake_case` · ISO-8601 UTC.

## Failure classes

An operator has to be able to tell three different things apart, so the API
never conflates them.

| Situation | Shape | Meaning |
|---|---|---|
| The service is not reachable | no HTTP response | Nothing was sent. No state changed. |
| The upload was rejected | `4xx` with `error.code` | The file or its metadata was not acceptable. No job and no survey were created. |
| The run failed | `200` on upload, then `state: "FAILED"` on the job | The upload was accepted; processing failed. No partial survey record is written. |

Upload rejection codes: `VALIDATION_FAILED` (unsupported extension, empty file,
malformed `navigation.csv`/`mission.json`), `UNREADABLE_RASTER`,
`UNREADABLE_BUNDLE`, `EMPTY_BUNDLE`, `UNSAFE_ARCHIVE`. Job failure code:
`PROCESSING_FAILED`, with the phase it stopped at.

## Ingest is two-phase

`POST /api/v1/surveys/upload` does the fast, caller-attributable work inside the
request — write the file, extract the bundle, confirm every raster opens, parse
and validate navigation and mission metadata — and then returns. Detector
inference, evidence fusion and persistence run on a worker thread.

```jsonc
// 200, immediately
{ "upload_id": "upload_…", "job_id": "job_…", "survey_id": "survey_…",
  "state": "QUEUED", "source_frame_count": 2, "navigation_status": "AVAILABLE",
  "accepted": true }
```

This is why a large bundle no longer holds an HTTP request open for minutes, and
why the processing screen has real state to show while it works.

Nothing is retried automatically anywhere in this path. Re-uploading is a new
run with a new `survey_id`, and that stays the operator's decision.

## `GET /api/v1/jobs/{job_id}` — observable state

Every field is a real count, a real availability flag or a real phase
transition, published after the work it describes has happened. **There is no
percentage field.** The only ratio is `frames_completed` over
`source_frame_count`, and both are counted.

```jsonc
{
  "state": "INFERENCE", "phase": "inference",
  "upload": { "filename": "…", "bytes": 149814, "kind": "BUNDLE",
              "decoded": true, "bundle_entries": 4, "raster_count": 2 },
  "source_frame_count": 2, "frames_completed": 1,
  "metadata": { "navigation": "AVAILABLE", "mission": "AVAILABLE",
                "sequential_observation_contract": false },
  "detector": { "availability": "AVAILABLE", "loaded": true, "device": "mps",
                "model_sha256": "2aa3ac71…" },
  "open_set": { "availability": "AVAILABLE", "memory_version": "open_set_v1", "…": "…" },
  "contacts_fused": null, "report_ready": false,
  "steps": [ { "id": "inference", "label": "…", "state": "running",
               "detail": "1 of 2 source frames" }, "…" ],
  "error": null
}
```

Phases, in order: `upload_decoded`, `metadata_read`, `detector_ready`,
`inference`, `condition`, `open_set`, `contact_fusion`, `evidence`, `report`.
A step state is one of `queued`, `running`, `done`, `skipped`, `unavailable`,
`failed`. A component that is not configured in this deployment reports
`unavailable` with the reason; it is never animated as if it were running.

Jobs are in-memory progress telemetry, bounded to the most recent 200. The
durable record is the runtime survey.

## Reconnect and diagnostics

`GET /api/v1/runtime/surveys?limit=` returns a newest-first index of retained
runtime surveys (`survey_id`, name, counts, navigation status). This is the
recovery path: a client that lost its session finds the survey it was working on
instead of re-uploading the raster.

`GET /api/v1/runtime/health` is both the host health check and the operator
diagnostics source: liveness, the frozen detector's digest and verification
state, the compute device, every optional component's real availability, API
version, uptime and how many runtime surveys are retained. It reports no
filesystem paths and no secrets.

## Reports

`GET /api/v1/runtime/surveys/{id}/report?format=json` returns the complete
record plus a `provenance` block: generated-at, model ids and checkpoint digest,
dataset snapshot, fusion policy, evidence score type, model registry
availability, navigation status and positioned count, evidence availability
counts, review-state summary, and the limitations that apply to every figure in
it.

`format=csv` takes a `scope`: `observations` (default, one row per raw detector
observation) or `contacts` (one row per Contact, the operational object, with
its evidence score, score type, unavailable channels, priority band, open-set
state and review verdict).

JSON and CSV are the only formats this deployment produces. There is no PDF
generator, so no endpoint and no screen offers one.

## Resurvey comparison

`GET /api/v1/runtime/surveys/{id}/change?baseline_survey_id=` reports whether a
comparison between two passes is supportable, and when it is not, names every
capability gate that blocks it (`BASELINE_SURVEY`, `SPATIAL_REFERENCE_LEVEL`,
`COVERAGE_POLYGON`) with the reason. It also returns the definitions of `NEW`,
`UNCHANGED`, `NOT_DETECTED`, `NOT_SURVEYED` and `REMOVED`.

Frame-level navigation places a *frame*, not an object within it, so a runtime
survey with navigation is `L1_FRAME_RELATIVE` — below the `L2_TRACK_RELATIVE`
that metric matching between passes requires. The endpoint refuses rather than
producing states the evidence cannot support, and `REMOVED` is never inferred
from a detector absence.

## Review memory

`POST /api/v1/runtime/surveys/{sid}/findings/{fid}/reviews` appends one verdict.
Append-only: a new verdict adds an event, never edits or deletes an earlier one,
and never alters the raw detector class, confidence or box. It re-derives the
Contact's transparent recovery priority, because a human decision is one of that
rule's inputs.

`GET /api/v1/runtime/memory/stats` aggregates verdicts across every retained
runtime survey into named training-memory queues (`hard_negative`,
`confirmed_positive`, `relabelled`, `uncertain`) and reports `append_only: true`
and `online_learning: false`.

`GET /api/v1/runtime/memory/reviews?survey_id=&limit=` returns newest-first
events with the contact, the raw class and confidence at prediction time, the
model digest, and the queue each event belongs to.

Recording a verdict updates no model. The queues are exported as manifests for a
future supervised training or calibration round.
