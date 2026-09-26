# Production survey basemap

## Cause and change

`src/components/SurveyMap.tsx` uses Leaflet 1.9 raster tiles:

`https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/{style}/MapServer/tile/{z}/{y}/{x}`

The styles remain `World_Light_Gray_Base` and `World_Dark_Gray_Base`. The old
`maxNativeZoom: 16` requested regional-only tiles offshore. On the existing
Bay of Bengal survey (`survey_upload_21f01173ef3c`), the light tile at
`16/30005/48059` returned HTTP 200, `image/jpeg`, with “Map data not yet
available” embedded in the image. This is a coverage failure, not a Vercel
network failure. A decoded placeholder fires `tileload`, not `tileerror`.

The provider documents global coverage through [level 13 for light](https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer?f=pjson)
and [level 10 for dark](https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer?f=pjson).
Native requests now respect those limits. Leaflet scales these tiles at closer
map zooms, retaining `maxZoom: 20` and the existing survey fit limits. Close-up
basemap detail is limited to that global source resolution.

## Configuration trace

- No basemap access token or Vite variable is required or read.
- `VITE_API_BASE_URL` configures only the survey API; the basemap bypasses it.
- Both tile URLs use HTTPS. Responses allow cross-origin images with
  `Access-Control-Allow-Origin: *`; requests from the production origin succeed.
- The deployed HTML response, `index.html`, and `vercel.json` have no CSP blocking
  the tile provider. No domain registration or credential restriction caused this failure.
- The existing `tileerror` warning and `tileload` recovery remain in place.
- Coordinates, navigation, Contact and track layers, ZIPs, API, map UI, and CSS
  are unchanged.

## Repeatable verification

```sh
VITE_API_BASE_URL=https://aqualens-api.onrender.com/api/v1 npm run build
npm run preview
PREVIEW_URL=http://127.0.0.1:4173 node scripts/basemap-qa.mjs
# After the deployment is live:
QA_OUTPUT=/tmp/astra-basemap-live node scripts/basemap-qa.mjs
```

The preview harness serves built assets at the production browser origin so
the existing API CORS policy is respected, without changing the API. Tiles
and survey data are live network reads. The harness checks response codes,
decoded images against the actual missing-data tile, geometry preservation
across themes, zoom, pan, fit, Contact selection, layers, survey switching,
network failure and recovery. It captures close-up and coastline screenshots.
Fullscreen checks use the browser Fullscreen API: the existing map UI has a
fit button, not a dedicated fullscreen button. Reports and screenshots go to
`/tmp/astra-basemap-qa` by default.

Verified on 2026-09-15: lint, typecheck, 16 unit tests, 10 existing browser tests,
and the production-build map harness passed. The final build run captured 66
successful HTTP 200 tile responses, no page errors, and passing light/dark,
coastline, interaction, fullscreen, switching, and fallback checks. Contact and
track geometry matched the pre-fix production map exactly at the same viewport
(SHA-256 `3f728751b0ef91c2387d7162b99ef8daa0594e96b15bd6a17d7a1b0bf9ccc7a2`).
