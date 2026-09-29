# Aqualens web (apps/aqualens-astra)

The public Aqualens frontend: the landing page and the workspace (Survey Intake, role views, Review,
Contacts, Map, Report, System). React 19 + Vite, MapLibre GL for the Mission Map.

## Run locally

```sh
# backend, from the repo root
PYTHONPATH=packages .venv/bin/python scripts/serve_api.py      # http://127.0.0.1:8000

# frontend, from this directory
npm ci
cp .env.example .env.local
npm run dev                                                     # http://127.0.0.1:5320
```

`/workspace` is real mode: it starts at Survey Intake and never falls back to demo data.
`/workspace?demo=1` opens the deterministic demo Mission, always tagged Demo.

## Configuration

One build-time variable: `VITE_AQUALENS_API_BASE_URL` (or `VITE_API_BASE_URL`), the API base
including `/api/v1`. Production builds without it report the service as unavailable; they never
fall back to localhost. The API must allow this site's origin (`SAGARDRISHTI_ALLOWED_ORIGINS`).

## Map context sources

External, optional, credited in the map: OpenFreeMap vector tiles (OpenStreetMap data), AWS Terrain
Tiles (bathymetry and 3D seafloor; ocean depths from ETOPO1), Open-Meteo Marine (modelled sea level).
If they are unreachable the Mission track and Contacts still work and no values are shown.
Open-Meteo's free API is licensed for non-commercial use.

## Checks

```sh
npm run typecheck && npm run build
node qa/intake-e2e.mjs 1440x900 <inputs-dir> --full   # real uploads through the UI
node qa/map-e2e.mjs 1440x900                          # needs the Epitome v4 Mission uploaded
node qa/hero-video.mjs webm && node qa/landing-check.mjs 1440x900
```

QA scripts use Chrome via `CHROME_PATH` and Python with Pillow via `AQUALENS_PYTHON`.
