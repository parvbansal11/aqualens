# Design before build

Complex system, simple surface. The Contact is the unit of navigation. Primary screens use editorial spacing, not nested card grids. Technical evidence appears in a drawer; absent capabilities do not take up operational space.

Eight surfaces only: Landing, four-role selector, role-specific Workspace Home, Upload, Processing, Results, Contact Workspace, Map. Review/Report/Change/Memory/Model Lab are deliberately deferred until visual review. Navigation may describe deferred surfaces without sending users into unfinished screens.

Landing: actual ocean film edge-to-edge, centered Aqualens identity, one supporting line, one primary launch link. GPU refraction samples the actual video, responds to pointer velocity, decays at rest; faint click wave. Native video/poster survives unsupported WebGL/reduced motion. One real sonar example explains Contact formation within 75vh. Five capabilities exactly. The closing section contains the product identity, workspace action and image credits.

Workspace: foam #f0f5f4, ink #14343e, teal #23776f, muted sand #d4b98a. Dark mode deep ocean #0c2029. No pure white/black base. Institutional sans (Manrope), landing editorial sans (DM Sans), IDs only in monospace. Reusable 4px spacing scale, two surface elevations, 8/16px radii, 160–240ms functional motion. Sonar is grayscale and dominant.

Map: Leaflet with Esri public Light/Dark Gray Canvas tiles with Esri/HERE/Garmin/OSM attribution. Restrained ocean tint, no private token. Float title, three-line Contact rail, custom classification cores/acoustic rings, custom zoom/fit/layers, minimal selected detail. Depth is sampled along the illustrative/supplied track, not bathymetry. Track, Contact and profile selection remain coherent. Map remains a secondary destination after Workspace Home.

Reference research (browser captures in qa/references):
- https://oceaneye-taxaformer.vercel.app/ and https://github.com/Rishabh1925/OceanEYE-TaxaFormer — inspected live landing, nav hover, map, smaller viewport and source ModernNav/CardNav/MapPage/globals/package. Next/React, Leaflet, GSAP, Three/OGL. Effective bounded floating nav, pale cyan, generous margins, short hover delays; simplify glass, metadata duplication and chart density. Source map uses a credential; ours will not reuse it.
- https://maitri-724j32w22-pranavs-projects-d1ec1802.vercel.app/ — live browser rendered. Full-size background video, simple foreground hierarchy, one CTA. Some video frames were near-black during capture. Adopt compositional restraint, not branding or content.
- https://www.bluemarinefoundation.com/the-sea-we-breathe/ — browser loading/loaded/scroll captures; environmental pacing, restrained peripheral metadata, pointer-led spatial experience. Keep analytical routes independent of expensive hero rendering.
- https://www.niot.res.in/ and https://incois.gov.in/ — rendered live. Institutional navy, clear service/document labeling, accessibility controls, mission-led navigation. Modernize density. https://www.moes.gov.in/ blocked direct browser access; public indexed documents and NIOT/INCOIS parent-ministry labeling inspected. Digital Ocean endpoint returned 502; do not claim full visual inspection.

QA: render all eight surfaces at 1920×1080,1512×982,1440×900,1180×820,860×900. Prioritize hero crop/refraction and map light/dark/selected/depth/no-depth. Validate keyboard, focus, route permissions, manual observation retention, responsive overflow, missing/null metric semantics, real file intake, backend-driven jobs using a detached test service, poster fallback and no console errors.

First rendered iteration: CARTO returned watermarked API-key-required tiles. Replaced with verified public Esri Canvas raster endpoints. Optimized video again after first renders. Removed the duplicate Contact summary from Workspace Home. Corrected image/overlay fit geometry and depth SVG width.
