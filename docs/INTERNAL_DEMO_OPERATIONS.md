# Internal demo operations

One command brings the real Aqualens backend into a verified demo state, and
one command tells you why it is not in one. Everything here runs offline on a
Mac: no Cloudflare, no Railway, no Vercel, no Supabase, no tunnel.

```sh
./scripts/demo up        # verify artifacts, start a warm backend, prove it is ready
./scripts/demo status    # fast read: process, port, health, detector, store
./scripts/demo doctor    # diagnose every prerequisite and say what to do
./scripts/demo restart   # restart only the backend this tool started
./scripts/demo logs      # recent backend log (-n N, --follow)
./scripts/demo down      # stop only what this tool started
./scripts/demo smoke     # existing read-only smoke checks (--full does a real upload)
./scripts/demo epitome   # real Epitome run in the terminal, with real counts
./scripts/demo watch     # poll health, report failures, never auto-restart
./scripts/demo env       # machine-readable API contract for a frontend
./scripts/demo snapshot  # diagnostic snapshot into .demo-logs/
```

`DEMO_PORT=8010 ./scripts/demo up` (or `--port 8010`) runs every command against
another port. `EPITOME_ZIP=<path>` overrides the canonical demo bundle.

## FIRST TIME

You need, on this machine:

1. `uv` installed, and the environment synced with the inference extra:
   ```sh
   uv sync --extra inference
   ```
2. The frozen detector at `ml/artifacts/final_v1/detector/best.pt`. It is
   gitignored, so it must be copied onto the host. Its SHA256 must be
   `2aa3ac71051856bcfc8ec400804995f03568aa26d1a1fb24583e4eb1b7a10b15`. Nothing
   here will run with a different file.
3. The `open_set_v1` artifact at `ml/artifacts/vnext/open_set_v1/`
   (`config.json` + `memory_bank.npz`).

Then:

```sh
./scripts/demo doctor
```

Fix every `FAIL` it prints — each one names the file, PID or command involved.
`WARN` lines are informational; you can demo with them.

You do **not** need to export `SAGARDRISHTI_MODEL_PATH`, `SAGARDRISHTI_OPEN_SET_DIR`
or `SAGARDRISHTI_RUNTIME_DIR`. `demo up` discovers the canonical paths from the
repository and sets them for the process it starts.

## DAILY START

```sh
./scripts/demo up
```

It refuses to continue unless, in this order: the Python environment works, the
frozen detector is present and SHA-verified, the `open_set_v1` artifact is
complete, the runtime metadata the API loads at construction time is present,
the runtime store is writeable, and port 8000 is either free or already held by
a correctly serving Aqualens backend.

It then starts a single-worker uvicorn, waits for
`/api/v1/runtime/health`, and only prints `READY FOR DEMO` once the live health
response proves all of:

```
status = ok
runtime_available = true
model_loaded = true
device present
model_sha256 = 2aa3ac71...a10b15
optional_models.open_set.availability = AVAILABLE
```

`model_loaded=true` at startup is the point of this tool. The detector is loaded
lazily by the survey worker, so a plain `uvicorn` start answers health with
`model_loaded=false` until somebody uploads a survey. `demo up` serves the app
through `scripts/demo_serve.py`, which calls the detector's own `load()` once
before uvicorn starts serving. No inference is run, nothing is faked and no
runtime state is written — it is the same initialization the survey worker
performs, moved earlier.

Add `--with-frontend` to also start the in-repo `apps/workstation` dev server on
:3000. It is optional; nothing else depends on it.

## CHECK STATUS

```sh
./scripts/demo status
```

Fast, read-only, no re-hashing of the checkpoint (it reports the digest the
backend itself serves). Shows: process and whether this tool owns it, PID,
uptime, port state, health status, `model_loaded`, device, checkpoint
verification, open-set availability, retained survey count, frozen evidence run
id, runtime store path, store size and free disk.

Job state is per-process and in memory; the API exposes one job at a time
(`/api/v1/jobs/{job_id}`), not an index, so `status` says so instead of
inventing a number.

If the backend was started by something other than this tool (for example from
the Astra project, which sets its own `SAGARDRISHTI_RUNTIME_DIR`), `status` says
so and warns that the retained-survey count belongs to that process's store,
not necessarily to `data/runtime`.

## RUN EPITOME

The terminal fallback if the frontend breaks in front of judges:

```sh
./scripts/demo epitome
```

It uploads the canonical bundle `~/Desktop/Aqualens_Epitome_Demo_Survey.zip`
(the one named in `docs/JUDGE_DEMO_RUNBOOK.md`), prints the job id, prints every
phase transition as the backend reports it, waits for completion and then prints
the real record counts read back from the report:

```
Survey ID       survey_upload_...
Frames          5
Observations    6
Contacts        3
Navigation      AVAILABLE (6 observations positioned)
Open-set        6 observations scored
Detector SHA    2aa3ac71...
Report          READY (JSON + CSV)
```

Every number comes from `/api/v1/runtime/surveys/{id}/report`. Nothing is
estimated or filled in. Pass a path (`./scripts/demo epitome <zip>`) to run a
different bundle; if the canonical one is missing, the command refuses and lists
what else it found rather than guessing.

## RECOVER FROM FAILURE

Run `./scripts/demo doctor` first. It is the command written for this.

| Symptom | What it means | What to do |
| --- | --- | --- |
| `model_loaded=false` in health | The backend was not started by `demo up`, or warmup failed | `./scripts/demo logs` and look for the `DEMO_WARMUP` line, then `./scripts/demo restart` |
| `REFUSING: port 8000 is owned by a process that is not a Aqualens backend` | Something unrelated holds the port | Stop that PID yourself (it is printed), or `DEMO_PORT=8010 ./scripts/demo up` |
| `Port 8000 is already served by a Aqualens backend; reusing it` | A good backend is already up | Nothing. If it is not demo-ready, the command says which field failed |
| Frontend says "Load failed" | The frontend cannot reach the API | `./scripts/demo status`; if healthy, check the frontend's `VITE_API_BASE_URL` against `./scripts/demo env` |
| Stale PID file | A previous backend died | `./scripts/demo down` clears it; then `up` |
| Backend dies mid-demo | See the log | `./scripts/demo logs -n 200`, then `./scripts/demo restart` |
| Checkpoint SHA mismatch | This is not the frozen detector | Restore the frozen artifact. Do not demo another model |
| Not sure what happened | | `./scripts/demo snapshot` and read/attach the file it names |

`./scripts/demo watch` polls health every few seconds and prints (and beeps) on
failure. It never restarts anything: a restart during live inference would
discard a running job.

What this tooling will never do, so you can trust it mid-demo: kill a process it
did not start, accept a detector whose SHA is not the frozen one, print READY
before live health proves it, delete surveys, uploads, reviews or datasets,
install packages, change thresholds, or silently switch ports or models.

## STOP SERVICES

```sh
./scripts/demo down
```

Stops only the backend recorded in `.demo-logs/backend.pid`, after confirming
that PID is still a live backend (so a recycled PID is never signalled). It
clears stale PID/state files, and leaves `data/runtime` — surveys, uploads,
reviews — untouched. If the port is still held by a process this tool did not
start, it says so and leaves it running.

## FRONTEND WIRING

```sh
./scripts/demo env
```

prints the contract, machine-readably:

```
SAGARDRISHTI_API_ORIGIN=http://127.0.0.1:8000
SAGARDRISHTI_API_BASE=http://127.0.0.1:8000/api/v1
SAGARDRISHTI_HEALTH_URL=http://127.0.0.1:8000/api/v1/runtime/health
VITE_API_BASE_URL=http://127.0.0.1:8000/api/v1
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
```

Note the two frontend conventions differ: the Vite frontend appends paths like
`/runtime/surveys` directly, so its base **includes** `/api/v1`; the in-repo
Next.js workstation takes the origin and appends `/api/v1` itself.

**CORS.** No change is needed for a local demo. With
`SAGARDRISHTI_ALLOWED_ORIGINS` unset, the backend allows any
`http://localhost:<port>` and `http://127.0.0.1:<port>`, which already covers

```
http://127.0.0.1:5174
http://localhost:5174
```

Only if you set that variable (for a non-loopback deployment) must you list the
origins explicitly, comma-separated, including both of the above. `demo doctor`
fails the CORS check if the variable is set and omits them.

## SMOKE TESTS

```sh
./scripts/demo smoke          # read-only: composes scripts/internal_hack_check.sh
./scripts/demo smoke --full   # additionally uploads the real Epitome bundle
```

The default run mutates nothing: it verifies the frozen detector SHA, the
`open_set_v1` artifact, health (`runtime_available`, `model_loaded`,
`model_sha256`, open-set availability), the survey index, upload-route
reachability (a body-less `422` probe, no upload) and the report route. It skips
the :3000 frontend check when nothing is serving there, so a backend-only demo
can pass.

`--full` performs a real upload and waits for the job to reach `COMPLETED`. It
creates one new runtime survey and modifies nothing existing.

`scripts/production_smoke_check.sh` remains the read-only check to point at a
remote deployment (`BASE_URL=https://... bash scripts/production_smoke_check.sh`).
It is not needed for the local internal demo.

## SNAPSHOT

```sh
./scripts/demo snapshot
```

Writes `.demo-logs/snapshot-<timestamp>.txt`: git commit and branch, short git
status, model path and SHA (expected and actual), open-set artifact contents,
the full live health payload, port listeners with their command lines, the demo
PID/state files, runtime store size and free disk, the **names** of any
`SAGARDRISHTI_*` overrides set in your shell, and the last 60 backend log lines.
No environment values, tokens or secrets are recorded. Attach it when reporting
a failure after the fact.

## WHAT RUNS WHAT

- `scripts/demo` — the operations entrypoint described above.
- `scripts/demo_serve.py` — the ASGI factory `demo up` serves; wraps the
  unmodified `sagar.api.create_app` and warms the detector before serving.
- `scripts/internal_hack_check.sh` — the existing smoke checks, reused by
  `demo smoke` (now accepts `--no-frontend`).
- `scripts/start_internal_demo.sh` — the earlier backend+frontend starter. Still
  works; `demo up` supersedes it for backend reliability and adds warmup,
  reuse, verification and diagnosis.
- `.demo-logs/` — `backend.log`, `backend.pid`, `backend.state`, `health.json`,
  snapshots. Safe to delete when nothing is running; it holds no evidence.

## CLOUD

Nothing above needs the network. Cloud/tunnel deployment is documented
separately in `docs/DEPLOYMENT.md` and `docs/HACKATHON_DEPLOYMENT.md` and is
never required for the internal demo. If a tunnel URL expires mid-demo, fall
back to `http://127.0.0.1:8000` and `./scripts/demo epitome`.
