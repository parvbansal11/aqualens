# Aqualens deployment

Aqualens uses the rebranded Astra Vite frontend on Vercel and a Docker-based FastAPI backend on Render. The separate Next.js workstation remains available in `apps/workstation`. Existing fallback services remain separate resources.

## Render API

The root `render.yaml` defines the new `aqualens-api` service in Singapore, using the root `Dockerfile`, the `/api/v1/runtime/health` health check, and a 10 GB persistent disk mounted at `/app/data/runtime`. The service uses the frozen detector and open-set files bundled into the Docker image. Runtime uploads, survey records, and the reviews database live on the persistent disk.

The Blueprint sets these compatibility variables without secrets:

- `SAGARDRISHTI_ALLOWED_ORIGINS=https://aqualens-web.vercel.app`
- `SAGARDRISHTI_MODEL_PATH=/app/ml/artifacts/final_v1/detector/best.pt`
- `SAGARDRISHTI_OPEN_SET_DIR=/app/ml/artifacts/vnext/open_set_v1`
- `SAGARDRISHTI_RUNTIME_DIR=/app/data/runtime`
- `SAGARDRISHTI_MAX_UPLOAD_BYTES=536870912`

The existing variable names remain because the backend reads them. Do not copy any existing service secrets; no secrets are needed for this configuration.

## Vercel frontend

Create the `aqualens-web` project from the new GitHub repository and set its root directory to `apps/aqualens-astra`. Use `npm run build` with output directory `dist`. Set `VITE_API_BASE_URL` to `https://aqualens-api.onrender.com/api/v1` in the Production environment. Local development uses `http://127.0.0.1:8000/api/v1`; the API base comes from `src/lib/runtime/api.ts`.

The Render CORS value must match the production Vercel origin exactly. Update both settings together if the assigned Vercel hostname differs.

## Health and API checks

After deployment, verify `GET /api/v1/runtime/health` returns HTTP 200 and inspect `GET /api/v1/runtime/surveys` for the retained survey index. The health payload reports actual model and optional-component availability and does not expose filesystem paths or secrets.
