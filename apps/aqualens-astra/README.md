# Aqualens

Side-scan sonar intelligence for detection, evidence review, mapping and operational decision support. Built around the Contact: Survey → Frame → Observation → Contact → Evidence → Review → Action/report.

The original `/Users/parvbansal/Desktop/aqualens` is the Aqualens backend source. This frontend consumes the Aqualens API through an environment-configured base URL. Runtime uploads, state, caches and temporary files stay under `.local-runtime/` during local runs.

## Run

Use Node.js 22.12+ or a compatible newer version.

```sh
cd apps/aqualens-astra
npm ci
npm run dev
```

Open http://127.0.0.1:5174. If the backend is not already running, start it in a second terminal from this folder:

```sh
npm run runtime:local
```

The launcher uses the Aqualens FastAPI service on port 8000 and writes uploads, reports, memory, caches, and temporary files only under `.local-runtime/`. It refuses to replace an occupied port. Development uses `.env.development.local` and the Vite `/api/v1` proxy; `.env.example` documents local and production API configuration. `VITE_API_BASE_URL= npm run dev` explicitly selects detached presentation mode.

For the production artifact:

```sh
npm run build
npm run preview
```

Open http://127.0.0.1:4173. `vercel.json` routes intake, station selection and workspace deep links to `index.html`, so direct navigation and refresh preserve the product flow.

## Product walkthrough

1. Launch Workspace from the centered ocean landing.
2. Upload a sonar survey and process it, or open a completed recent survey. Presentation surveys are a separate, explicitly labeled choice.
3. Choose **Field Officer**, **Sonar Analyst**, **Mission Supervisor**, or **Decision Viewer**, then enter Workspace Home. Stations change emphasis, not survey identity.
4. View Contacts, inspect sonar and source observations, disclose evidence, and locate supplied frame navigation on the map.
5. Review a Contact; runtime decisions append through its associated observation. Review Memory reads the saved events.
6. Open Report for the actual JSON, Contact CSV, and Observation CSV exports. Model Lab exposes the runtime registry; Change reads scientific readiness/refusal gates.

Manual observation selection and station/theme preferences persist in the session. Presentation review previews never write memory; manual processing replay never processes a selected file.

## Runtime boundary

`src/lib/runtime/wire.ts` preserves the inspected backend contract; `types.ts` defines the normalized view model. `api.ts` owns HTTP, `adapters.ts` maps backend records, and `selectors.ts` owns capability and representative-observation rules. Components consume normalized objects, not fixture-specific data shapes.

Local development connects to `http://127.0.0.1:8000/api/v1` through Vite. Health is `/runtime/health`; actual uploads use multipart `file` at `/surveys/upload`; jobs are read at `/jobs/{id}` and completed records at `/runtime/surveys/{id}`. Lazy detector loading does not disable a healthy upload service.

A real Epitome ZIP was processed and inspected in the browser: 7 frames, 8 observations, 3 Contacts. One UNCERTAIN review event and all three real exports were verified. Evidence is saved under `qa/runtime-integration/`. Automated E2E tests separately intercept their API contracts and never post to the real service.

Production builds need an explicit `VITE_API_BASE_URL` and a production reverse proxy or the backend's allowed CORS origin. `.env.development.local` and Vite's development proxy are not bundled into production.

Runtime jobs determine processing phases and completion. Upload POST requests are never automatically retried. Network uncertainty is reported without pretending that a write failed or succeeded.

## Scientific semantics

- Raw detector score, evidence strength, open-set anomaly distance, and priority are distinct fields. Evidence and open-set scores are not calibrated probabilities.
- A `DEMO_HEURISTIC` display classification does not become detector confidence or a production-qualified claim.
- Contact positions inherit frame navigation; they are not calibrated object geolocation. Ordered supplied fixes form tracks. Missing fixes preserve gaps, and unordered fixes are not connected.
- The inspected runtime does **not expose depth**. Altitude is not depth. Depth renders only when an explicit depth value exists; the navigated fixture uses clearly labeled illustrative depth. No bathymetry or coverage is synthesized.
- `WINDOW_OVERLAP_ONLY` never becomes temporal persistence. Natural Clutter is advisory only. Review memory is append-only; online learning is disabled.
- Representative selection uses a valid associated best ID, else the highest finite raw score, else the first associated observation. A valid manual choice takes precedence thereafter.

## Presentation fixtures and assets

`src/fixtures/epitomeNavigated.ts` and `epitomeNoNavigation.ts` are explicitly marked **DEMO PRESENTATION FIXTURE / NOT MODEL OUTPUT / NOT PRODUCTION SURVEY EVIDENCE**. Associations, boxes, map coordinates, depth, review state, and example evidence values are illustrative. Raw detector classes/scores and model hashes remain absent. The geographic demonstration is unrelated to the sonar acquisition site.

Five actual project sonar assets were copied without pixel changes. `public/sonar/ATTRIBUTION.json` records original paths, SHA-256 hashes, AI4Shipwrecks attribution, and the license identified in the source metadata. No sonar was generated.

The hero derives from `/Users/parvbansal/Downloads/oceaneye.mov`, which remains untouched. `public/media` contains H.264/yuv420p MP4 with faststart and no audio, VP9 WebM with no audio, and a JPEG poster. The browser chooses one video format. Reduced motion and failed media retain the poster. WebGL refracts the actual film; it pauses offscreen and in hidden tabs.

The Leaflet map uses the public Esri Light/Dark Gray Canvas raster endpoints with attribution. No private key is embedded. These external tiles need network access; the navigation overlays remain available if tiles fail. CARTO was rejected during visual QA because the tested endpoint returned API-key watermarks.

## Validation

```sh
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
```

Browser tests use installed Google Chrome. The bounded final visual script uses the local frontend and the recorded live survey ID:

```sh
node scripts/visual-qa.mjs
```

The responsive matrix is 1920×1080, 1512×982, 1440×900, 1180×820, and 860×900. Evidence and screenshots are in `qa/`. Automated accessibility checks supplement rendered inspection and keyboard testing; they are not a full assistive-technology certification.

See `docs/PRODUCT-AUDIT.md` for the source contract, `docs/DESIGN.md` for the reference research and design decisions, and `docs/FIRST-PASS-REPORT.md` for the initial handoff. Earlier design/audit documents retain their historical context.
