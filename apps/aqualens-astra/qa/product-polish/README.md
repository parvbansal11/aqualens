# Product polish verification

The frontend deployment source is `parvbansal11/sagardrishti-web`, branch `main`.

The product identity, metadata, landing close, role selection and workspace chrome now use SagarDrishti branding. Illustrative evidence remains explicitly labeled. Runtime contracts, scientific selectors, fixture values, source imagery, model metadata and measured results are unchanged.

Validation:

- `npm run lint` and `npm run typecheck`: pass.
- `npm test`: all 16 existing unit tests pass.
- `npm run test:e2e`: all 10 existing workflow tests pass, including the intercepted API upload/job flow. Only exact copy expectations changed.
- `npm run build`: pass.
- `node scripts/product-polish-qa.mjs` against the production preview: 180 rendered surfaces, both themes at 1920×1080, 1512×982, 1440×900, 1180×820 and 860×900. No page overflow, broken images, console errors or forbidden visible branding. Includes opened menus, map layers, evidence drawers and scientific disclosures. All 18 accessibility audits pass.
- `node scripts/interaction-qa.mjs`: existing production interaction suite passes, including 12 accessibility audits, map selection, drawer focus, video motion preferences, poster fallback and source asset loading.

`report.json` and `interaction-report.json` contain the browser evidence. Screenshots are retained locally in this folder and excluded from Git. Visual inspection covered the landing and its footer, roles, workspace, Contacts, sonar inspection, map controls, evidence drawer, review and report across the requested viewport sizes.

Glass is limited to interface controls and chrome. Sonar rasters, charts, reports and dense evidence retain solid backgrounds. Controls use 180–220 ms transitions, visible keyboard focus and reduced-motion overrides. Unsupported blur and reduced-transparency preferences use opaque surface fallbacks.

Repository branding search: no prohibited branding remains in shipped application copy or metadata. Any remaining matches in QA are the negative branding assertion itself or the standard JavaScript `WebGLRenderingContext.prototype` API.

The API-backed test uses intercepted responses. No backend service, model, dataset or scientific evaluation was modified or executed during this product polish pass.
