# Judge demo runbook (internal hack mode)

> Operations (start, status, diagnose, restart, logs, stop, smoke, Epitome run,
> snapshot) are in `docs/INTERNAL_DEMO_OPERATIONS.md`. Start there:
> `./scripts/demo up` verifies the frozen artifacts, warms the detector so
> health reports `model_loaded=true` before the first upload, and refuses to
> print READY until the live health endpoint proves it. This page stays the
> guide to *presenting* the demo.

## ONE-COMMAND LOCAL START

```sh
bash scripts/start_internal_demo.sh
```

This validates the frozen detector checksum and the open_set_v1 artifact,
refuses to start if either is missing or if ports 8000/3000 are already
occupied (it never kills another process for you), then starts the backend on
`http://127.0.0.1:8000` and the frontend on `http://localhost:3000` with the
API base wired correctly. It prints both URLs and the PIDs to stop when done.
Logs land in `.demo-logs/`.

Manual equivalent, if you need it (two terminals, from the repository root):

```sh
uv run uvicorn sagar.api.app:create_app --factory --host 127.0.0.1 --port 8000
```

```sh
cd apps/workstation && pnpm dev
```

## ONE-COMMAND HEALTH CHECK

```sh
bash scripts/internal_hack_check.sh
```

Read-only: verifies the frozen detector SHA, the open_set_v1 artifact,
backend health (`runtime_available`, `model_loaded`, `open_set` availability),
the survey index/upload/report routes, and frontend reachability. Exits
nonzero on the first critical failure. Add `--with-upload` to also run a real
Epitome upload end-to-end and confirm the job reaches `COMPLETED` (reads
`EPITOME_ZIP`, default `~/Desktop/Aqualens_Epitome_Demo_Survey.zip`).

`scripts/demo_health_check.sh` remains available as a lighter pre-flight
check (frozen detector checksum, frontend deps, frozen design references,
backend import) if you want a faster non-network check before the services
are even started.

## EPITOME DEMO FILE

The judge-facing demo bundle is `Aqualens_Epitome_Demo_Survey.zip`
(5 sonar rasters + `navigation.csv` + `mission.json`, real recorded
coordinates). Upload it as-is through the Upload screen, or via
`scripts/internal_hack_check.sh --with-upload` to confirm the pipeline end to
end without opening a browser.

Confirm the backend is up before you present: `curl -s
http://127.0.0.1:8000/api/v1/runtime/health`. `status` should be `ok`,
`runtime_available` `true`, and `optional_models.open_set.availability`
`AVAILABLE`. The workstation says the same thing in the sidebar — the service
strip reads **Service connected**, and every screen keeps working when it does
not, so a cold backend is a visible state rather than a blank page.

Optional environment values: `NEXT_PUBLIC_API_BASE_URL` for a non-default
backend and `SAGARDRISHTI_RUNTIME_DIR` for an isolated runtime-data location.
Do not set `SAGARDRISHTI_MODEL_PATH` unless it points to the checksum-pinned
frozen detector.

## Primary judge flow

1. **Landing.** A reviewable sonar-intelligence workflow, not an autonomous
   confirmation system. Use the header links, then **Try a survey**.
2. **Role entry.** Select **Sonar Analyst**, then **Upload new survey**.
3. **Upload.** Use a supported PNG/JPEG/PBM raster or a prepared ZIP. The
   requirements list is bound to reality: the analysis service's own state is
   the first row, and navigation/mission rows report what the bundle actually
   contains, read client-side before anything is sent. For navigation, use a ZIP
   containing a matching `navigation.csv`; `mission.json` is optional.
4. **Process survey.** The upload is *accepted* in milliseconds and inference
   runs on the service. The processing screen shows only observable job state:
   the upload decoded, the number of source frames, metadata availability, the
   detector and its device, open-set availability, contacts fused, report
   records written, and a counted `n / m` frames ratio. Point out that there is
   no percentage anywhere — nothing on that screen is estimated.
5. **Results.** Contacts are the default list, because a Contact is the
   operational object. Switch to **Raw observations** to show that the detector
   output underneath is unchanged and separately inspectable.
6. **Workspace.** Open a Contact. The inspector shows raw detector confidence
   and the evidence score as two separate figures, and lists the raw
   observations the Contact was fused from. Open **View technical evidence** for
   the evidence ladder: what the detector saw, persistence, navigation, sonar
   condition, acoustic verification, open-set anomaly, evidence fusion, analyst
   review, recovery priority, and natural clutter. Every row is closed by
   default and states its headline value; open two or three. Null channels read
   *unavailable with the reason* — never zero.
7. **Map.** With navigation, coordinates are supplied metadata and the track is
   the recorded per-frame fixes, nothing interpolated. Without it, the designed
   unavailable state; contacts with no position stay listed but are never
   placed. Do not imply location.
8. **Review.** Record a verdict with `C`/`R`/`L`/`U`, then follow **See where
   these decisions go** into **Review memory**: append-only history, four named
   training-memory queues, and the export manifests. State plainly that nothing
   is retrained by recording a verdict.
9. **Change.** Show the five change states and what each means, then the real
   capability gates. The comparison is refused, and the screen names exactly
   which gate blocks it. This is the honest answer, and it is the point.
10. **Mission / Decision.** Role views over the same record set.
11. **Report.** JSON with its provenance block, or CSV at contact or observation
    scope. Show the attribution panel: checkpoint digest, dataset snapshot,
    fusion policy, evidence score type, navigation status, review state.
12. **Model Lab.** The runtime component registry first — what is actually
    loaded on this host and the limit each component operates under, including
    RF-DETR unavailable and Natural Clutter v1 rejected as an automatic gate —
    then the frozen evaluation run.

## What not to claim

Do not claim calibrated probability, universal unknown-object recognition,
autonomous self-learning, learned ecological risk, GPS from sonar alone, or
production-grade SHIPWRECK recognition. Do not say Natural Clutter improves
detection: its FP reduction removed both baseline true positives. Do not offer a
PDF — this deployment has no PDF generator, and no screen claims one.

## Backup and recovery

- **`model_loaded=false` at startup.** This is a real backend fault, not a UI
  bug — do not try to demo around it. Check the backend log for the actual
  import/load error, re-run `bash scripts/internal_hack_check.sh` after
  fixing it, and confirm `model_sha256` matches
  `2aa3ac71051856bcfc8ec400804995f03568aa26d1a1fb24583e4eb1b7a10b15` before
  going back in front of judges.
- **Backend dies mid-demo.** The sidebar says *Service unreachable* and every
  screen states it; nothing crashes to a blank page. Restart it with the same
  `uv run uvicorn ...` command (or `scripts/start_internal_demo.sh` once you've
  stopped the frontend process it would otherwise refuse to touch); the
  workstation reconnects on its own and the open survey is still there.
- **Backend not running.** The sidebar says *Service unreachable* and every
  screen states it. Start the backend; the workstation reconnects on its own.
- **Session lost, tab reloaded, survey gone from view.** The sidebar's **Recent
  surveys** list reopens any survey the service still holds. A transient network
  failure never discards the open survey; only a `404` from the service does.
  To recover manually: `curl -s http://127.0.0.1:8000/api/v1/runtime/surveys`
  lists every retained survey by id.
- **Open-set score is below threshold.** This is the expected, common case —
  `is_open_set_candidate: false` just means the contact is not dissimilar
  enough from the background reference memory to flag. It is advisory
  evidence, not a pass/fail gate on the contact itself; say so plainly rather
  than treating it as a miss.
- **Upload rejected.** The screen says *This upload was not accepted*, names the
  reason, and states that no inference was run and no survey record was created.
- **Run failed.** The screen says *Processing did not complete*, names the phase
  it stopped at, and states that no partial survey record was written.
  "Process this file again" starts a new run with a new survey id and overwrites
  nothing.
- **Verdict not saved.** The queue row shows *Not saved* and the screen states
  that the decision was not recorded and is never resubmitted automatically —
  the log is append-only, so pressing the key again records it exactly once.
- **Navigation missing.** Continue with the raster-only path and the explicit
  location-unavailable state.
- **A SHIPWRECK output looks weak.** Show raw confidence and its
  `DEMO_ONLY`/non-production qualification. Do not reinterpret it.
- **Report download fails.** The screen surfaces the API error and states that
  nothing was exported; the in-app preview is the same serialization.

## Final 30-second close

Aqualens preserves the original detector evidence, adds transparent sonar,
association and open-set context where it is available, says plainly where it is
not, lets an analyst record an append-only decision that becomes training
memory, and exports the same traceable record with its provenance. Missing
evidence stays missing.
