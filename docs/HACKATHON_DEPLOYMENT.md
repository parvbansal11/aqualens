# Hackathon deployment: persistent FastAPI instance

Use **Railway with a paid persistent service and a volume** for this hackathon. It is preferred because it avoids free-tier sleep behavior and exposes the single-service/container/volume configuration directly. Render is also supported below, but do not use a free instance for a live inference demo.

This is deliberately one FastAPI process, one Uvicorn worker, one in-process job registry, and one attached disk. It adds no Supabase, queue, database service, or model retraining.

## Image contents and startup policy

The `Dockerfile` copies only runtime inputs, not source datasets:

- `ml/artifacts/final_v1/detector/`, including the frozen YOLO checkpoint;
- `ml/artifacts/vnext/open_set_v1/`, including memory/config;
- `runs/run_stage3c_v4/`; and
- `data/processed/snap_2fa4bca0a0bc4b7d/{split.json,tiles.jsonl}`.

The last two are frozen-evidence indexes. The ~683 MB processed image dataset is excluded. Models and artifacts are not downloaded at startup or while serving. Dependencies install only while building the image; `YOLO_AUTOINSTALL=false` prevents runtime package installation.

The detector is **lazy-loaded**: startup verifies its checkpoint exists, then the first accepted inference loads YOLO. This preserves inference semantics and makes readiness quick. The image uses exactly one Uvicorn worker because PyTorch and the job registry are process-local. CPU thread pools are capped at one; choose enough RAM for PyTorch and expected surveys.

## Environment contract

| Consumer | Variable | Production value |
| --- | --- | --- |
| Vercel frontend | `NEXT_PUBLIC_API_BASE_URL` | `https://<backend-public-domain>` |
| backend | `SAGARDRISHTI_ALLOWED_ORIGINS` | `https://<vercel-production-domain>` (comma-separate exact origins) |
| backend | `SAGARDRISHTI_MODEL_PATH` | `/app/ml/artifacts/final_v1/detector/best.pt` |
| backend | `SAGARDRISHTI_OPEN_SET_DIR` | `/app/ml/artifacts/vnext/open_set_v1` |
| backend | `SAGARDRISHTI_RUNTIME_DIR` | `/data/runtime` |
| backend | `SAGARDRISHTI_MAX_UPLOAD_BYTES` | `536870912` (512 MiB) |

`PORT` is host-provided and respected by the image command. Do not point model artifacts at a volume unless separately populated before startup: volumes mount only at runtime, while frozen artifacts are baked into the image.

Startup aborts explicitly when the model is missing. It also aborts for a missing or invalid open-set artifact when `SAGARDRISHTI_OPEN_SET_DIR` is set. When it is unset, existing local behavior stays intact: an absent default artifact is `NOT_CONFIGURED`, never fabricated.

## Limits and durability

Upload validation (ZIP extraction, image decode, navigation/mission parsing) happens in the request. It is capped by `SAGARDRISHTI_MAX_UPLOAD_BYTES` (512 MiB default); size the persistent disk for both the ZIP and extracted rasters. Keep any proxy upload timeout at least 60 seconds and permit 512 MiB bodies. Inference occurs after the response in the existing worker thread, so inference need not fit browser/proxy request timeouts.

`GET /api/v1/runtime/health` is the readiness endpoint and reports detector/open-set availability without preloading YOLO.

Completed surveys, retained uploads, and reviews survive redeploy/restart **only when `/data` is a persistent platform volume**. An in-progress job can still be lost if the host process dies: job state is in memory and a survey is persisted only after completion. Never run more than one instance or worker against this runtime directory.

## Railway: copy/paste checklist (recommended)

1. Push the deployment branch. Confirm the frozen checkpoint is in the Docker build context. It is gitignored, so a normal Git deploy does not include it unless your approved artifact-delivery process supplies it before build.
2. Railway: **New Project** → **GitHub Repo** → select the repository. Railway detects the root `Dockerfile`.
3. Service → **Settings** → **Volumes** → **Add Volume**. Mount exactly at `/data`; choose capacity for retained ZIPs plus expanded rasters.
4. Service → **Variables**: paste:

```dotenv
SAGARDRISHTI_ALLOWED_ORIGINS=https://<vercel-production-domain>
SAGARDRISHTI_MODEL_PATH=/app/ml/artifacts/final_v1/detector/best.pt
SAGARDRISHTI_OPEN_SET_DIR=/app/ml/artifacts/vnext/open_set_v1
SAGARDRISHTI_RUNTIME_DIR=/data/runtime
SAGARDRISHTI_MAX_UPLOAD_BYTES=536870912
```

5. Do not set `PORT`; Railway injects it. Set health check path to `/api/v1/runtime/health`. Keep/increase the deploy health-check timeout if needed (Railway documents a 300-second default).
6. Service → **Networking** → **Generate Domain**. Run `BASE_URL=https://<backend-public-domain> ./scripts/production_smoke_check.sh` after deployment succeeds.
7. Vercel production environment: set `NEXT_PUBLIC_API_BASE_URL=https://<backend-public-domain>` and redeploy the frontend.
8. Verify one real browser upload and polling job. The volume persists runtime state across deploys/restarts; it does not make in-progress jobs recoverable.

Railway volume/health-check references: [volumes](https://docs.railway.com/volumes) and [health checks](https://docs.railway.com/deployments/healthchecks).

## Render: copy/paste checklist

1. Push the deployment branch with the frozen checkpoint available in the Docker build context as described above.
2. Render: **New** → **Web Service** → connect repository. Set runtime **Docker**, Dockerfile path `./Dockerfile`, and leave Docker Command blank so the image `CMD` runs.
3. Select a paid, always-on compute instance appropriate for CPU PyTorch. Do not use Render free for a live demo.
4. In **Advanced** / **Disks**, add a persistent disk mounted exactly at `/data`.
5. In **Environment**, paste the same five backend variables from Railway step 4. Do not override Render's `PORT`.
6. Set **Health Check Path** to `/api/v1/runtime/health`; deploy; then run `BASE_URL=https://<service>.onrender.com ./scripts/production_smoke_check.sh`.
7. Set Vercel `NEXT_PUBLIC_API_BASE_URL=https://<service>.onrender.com`, redeploy Vercel, and confirm `SAGARDRISHTI_ALLOWED_ORIGINS` has the Vercel production origin.

Render references: [web services](https://render.com/docs/web-services), [persistent disks](https://render.com/docs/disks), and [health checks](https://render.com/docs/health-checks). Persistent disks are single-instance storage and disable zero-downtime deploys.

## Smoke check

```sh
chmod +x scripts/production_smoke_check.sh
BASE_URL=https://<backend-public-domain> ./scripts/production_smoke_check.sh
```

It checks health, detector availability, `open_set_v1` availability, upload-route reachability (a body-less POST must return 422), and the runtime-survey index. It does not upload a ZIP, create a survey, or invoke inference.
