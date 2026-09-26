# PRODUCT SPEC — Frontend Contract

**This document is Cursor's contract.** Build against this and `docs/API_CONTRACT.md`. Do not
invent screens, fields, or metrics. Every value rendered comes from an API response; nothing is
hardcoded.

Stack: Next.js (App Router) · TypeScript · Tailwind · MapLibre GL (no API key) · canvas/WebGL
sonar viewport. `apps/workstation/`.

---

## 1. Visual principles

The product must read as **oceanographic mission-control software** — a sonar inspection
workstation, not a dashboard.

**Design around the work.** The sonar imagery is the product; chrome serves it. The Sonar
Workspace gives the raster the overwhelming majority of the viewport and everything else docks
around it.

| Do | Do not |
|---|---|
| Dark instrument ground; imagery is the brightest thing on screen | Purple/blue SaaS gradients |
| Dense, tabular, information-first layout | Giant marketing hero sections |
| Monospace/tabular numerics with **units on every value** | Rounded KPI-card grids |
| One restrained accent (amber, the sonar-display convention) | Glassmorphism, glow, blur decoration |
| Semantic colour distinct from accent: confirmed / rejected / unknown / warning | Emoji as UI iconography |
| Hairline borders, precise 4 px spacing grid | Drop shadows as decoration |
| Real empty states that explain the next action | Filler content, lorem, fake charts |
| Provenance badge wherever a derived number appears | "AI Powered" language anywhere |

**Provenance badges are the visual signature of this product.** Four states, visually distinct,
always present next to derived values: `MODEL` · `HEURISTIC` · `OPERATOR` · `DEMO`. A judge
should be able to see the system is honest before they think to ask.

**Demo watermark.** When `survey.is_demo === true`, a persistent non-dismissible bar renders
`survey.demo_banner` on every surface showing that survey, and it appears in exported reports.

---

## 2. Layout hierarchy

```
┌─ AppShell ───────────────────────────────────────────────────────────────┐
│ TopBar   mission ▸ survey selector · reference-level chip · demo banner  │
├────────┬─────────────────────────────────────────────────────────────────┤
│ Nav    │  Surface viewport                                               │
│ rail   │                                                                 │
│ (5)    │                                                                 │
└────────┴─────────────────────────────────────────────────────────────────┘
```

Five surfaces, in nav order:
1. **Mission Control** · 2. **Sonar Workspace** (hero) · 3. **Detection Review** ·
4. **Survey Comparison** · 5. **Evidence & Model Lab**

The **reference-level chip** (`L0`/`L1`/`L2`/`L3`) is always visible in the TopBar with
`level_reason` on hover. It is the fastest honest answer to "how do you know where this is?"

**Capability gating is global:** if `survey.capability_gates.X === false`, every control
depending on X renders disabled with a tooltip stating the reason. Never hide it silently, and
never let it fail on click.

---

## 3. Surface 1 — Mission Control

**Job:** choose what to work on; ingest; see survey state at a glance.

**Consumes:** `GET /missions`, `GET /missions/{id}`, `GET /surveys/{id}`,
`POST /surveys/{id}/ingest`, `GET /jobs/{id}/events` (SSE), `GET /memory/stats`.

**Layout:** mission list (left) → survey table (main) → selected-survey detail panel (right).

Survey table columns: name · dataset · sensor · frequency · frames · detections ·
**reference level** · reviewed count · latest run · demo flag.

Detail panel: capability gates as four pass/fail rows with reasons · coverage summary ·
`latest_run_id` · **Ingest** and **Open in Workspace** actions.

**Ingest flow:** POST → job id → SSE stream drives a **stage-by-stage** progress list
(ingest → tile → preprocess → perceive → evidence → fuse → geo → mission → persist), each with
elapsed ms. Not a spinner and not a fake percentage bar — the stage list *is* the progress
indicator, and it doubles as a live explanation of the pipeline during the demo.

**States**
- *Loading:* skeleton rows, correct row height, no layout shift.
- *Empty:* "No surveys ingested. Ingest a survey to begin." + primary Ingest action.
- *Job failed:* stage list shows the failing stage in error colour with `error.message` and a
  Retry action. Never a bare "something went wrong".

---

## 4. Surface 2 — Sonar Workspace (HERO)

**Job:** examine sonar imagery and its detections at full fidelity. This is the screen the demo
lives on and it gets the most engineering attention.

**Consumes:** `GET /surveys/{id}/frames`, `GET /frames/{id}/raster?layer=`,
`GET /surveys/{id}/detections`, `GET /detections/{id}`.

```
┌──────────────────────────────────────────────────┬──────────────────┐
│ layer tabs: RAW · ENHANCED · DETECTIONS · CHANGE │  Detection       │
│ ┌──────────────────────────────────────────────┐ │  Inspector       │
│ │                                              │ │  (docked right,  │
│ │            SONAR VIEWPORT                    │ │   §5)            │
│ │        pan · zoom · overlays                 │ │                  │
│ │                                              │ │                  │
│ └──────────────────────────────────────────────┘ │                  │
│  ping ruler ─ along-track ────────────────────── │                  │
├──────────────────────────────────────────────────┤                  │
│ frame filmstrip / timeline                       │                  │
└──────────────────────────────────────────────────┴──────────────────┘
                                    Mission map: collapsible overlay panel
```

**Viewport requirements**
- Smooth pan and zoom (wheel + drag), zoom to cursor, fit-to-frame, 1:1 pixel reset.
- Layer switching **must not** reset zoom/pan or lose selection.
- Detection overlays: bounding boxes and masks in **exact** frame-pixel coordinates. Overlays
  scale with zoom; stroke width does not.
- Colour encodes `kind`: KNOWN by class; **UNKNOWN visually distinct** (dashed stroke, distinct
  hue) and labelled `Unknown anomaly candidate` — never a class name.
- Review state encodes as a badge on the box: confirmed / rejected / relabelled / unreviewed.
- Hover highlights; click selects and populates the Inspector in **< 150 ms**.
- **Rulers read in sonar units** — "ping 12,408" along-track and, at L2+, metres across-track.
  Not "pixel 512". At L0/L1 the across ruler shows pixels and says so.
- **`u_range` direction indicator** always visible. It is the axis shadow reasoning depends on;
  showing it makes the reasoning legible during questioning.
- `ANOMALY` heatmap available as an overlay when the survey has open-set output.
- `CHANGE` layer colours detections by `change_status`.

**Performance:** a survey has thousands of detections. Fetch by frame with pagination; never
request all detections at once. Render overlays on canvas, not as thousands of DOM nodes.

**States**
- *Loading raster:* dark placeholder at correct aspect ratio + frame id; no spinner over imagery.
- *No detections on frame:* viewport renders imagery normally; a quiet inline note
  "No detections on this frame" — **not** an empty-state takeover.
- *Layer unavailable:* tab disabled with reason (e.g. ANOMALY when open-set did not run).
- *Selected:* box emphasised, filmstrip marks the frame, Inspector populated.

**MUST work for the demo:** pan · zoom · all four layer tabs · click-to-select ·
Inspector population · overlay accuracy at every zoom level.

---

## 5. Surface 3 — Detection Review (+ the docked Inspector)

**Job:** understand *why* the system believes a detection, and record a human verdict. This is
where the KING USP and persistent intelligence become visible.

**Consumes:** `GET /surveys/{id}/detections` (filtered), `GET /detections/{id}`,
`GET /detections/{id}/evidence/shadow`, `.../persistence`,
`POST /detections/{id}/reviews`, `GET /memory/queues/*`.

**Layout:** filter bar → detection list (virtualised) → Inspector.

Filters: kind (KNOWN / UNKNOWN) · class · min confidence · change status · review state ·
sort by priority or confidence. Queue shortcuts: **Hard negatives · Corrections · Hard
positives · Unreviewed**.

### Inspector sections, in order

1. **Header** — thumbnail crop, `kind` badge, class or `Unknown anomaly candidate requiring
   review`, `final_confidence` with `MODEL`/`HEURISTIC` badges.
2. **Confidence breakdown** — `fusion.contributions` as a **horizontal log-odds waterfall**,
   one bar per feature, positive right / negative left, intercept shown. This is the visual
   answer to "where does 0.87 come from?"
3. **Evidence** — one block per channel:
   - *Persistence:* mode chip (`WINDOW_OVERLAP`/`SEQUENTIAL_PING`), `n_obs / n_opportunities`,
     Wilson score, scatter, and the per-window observation thumbnails.
   - *Shadow:* **the actual shadow-band crop image** with the measured intensity profile plotted
     beneath it, contrast z, continuity, ordering. `implied_height_m` only when non-null, always
     with its `height_assumptions` list attached.
   - *Context:* range-matched background z, clutter density.
   - **Any channel with `applicable: false` renders an explicit "Not computable — `<reason>`"
     chip. Never a zero, never a blank, never a hidden row.**
4. **Geometry & location** — bbox/mask, dimensions (px always; metres only when non-null, else
   the `reason`), lat/lon with `spatial_reference_level`, uncertainty, and the **geo provenance
   badge**. `DEMO_METADATA` renders in warning colour.
5. **Model provenance** — `model_id`, version, weights sha256 (truncated, copyable),
   `confidence_at_prediction`, device.
6. **Recovery priority** — score, rank, and the component contribution breakdown with weights.
   Carries the disclaimer string from the API verbatim.
7. **Operator review** — verdict buttons **Confirm · Reject · Relabel · Uncertain**; relabel
   opens a class picker and optional box adjustment; free-text notes; full prior review history
   listed beneath with reviewer and timestamp.

**Review interaction contract**
- Verdict POSTs immediately; optimistic UI with rollback on failure.
- The detection is **never mutated client-side** — refetch and re-render from the response.
- Prior reviews are shown, never replaced. History is the feature.
- After a verdict, advance to the next unreviewed detection (keyboard: `C` confirm, `R` reject,
  `L` relabel, `→` next). Keyboard review is what makes the memory layer demo well.
- `training_eligible: false` renders its `reason` — most importantly "source frame is in the
  evaluation split", which visibly demonstrates the leakage guard.

**States:** loading skeleton · empty ("No detections match these filters" + clear-filters
action) · unreviewed vs reviewed styling · submitting · submit-failed with retry.

**MUST work:** open a detection · see the contribution waterfall · see the shadow crop · see
persistence counts · submit all four verdicts · see the review persist across reload.

---

## 6. Surface 4 — Survey Comparison

**Job:** show what changed between two surveys of the same mission.

**Consumes:** `POST /compare`, `GET /comparisons/{id}`, plus survey coverage polygons.

**Layout:** baseline/new survey pickers + `confirmed_only` toggle → summary counts →
split map/list.

- Summary: **NEW · UNCHANGED · REMOVED · NOT_SURVEYED** counts as four discrete tiles,
  each filtering the list.
- Map: both coverage polygons rendered, **with the non-overlapping region visibly distinct**.
  This is what makes `NOT_SURVEYED` self-explanatory rather than a technicality.
- List: paired baseline/new thumbnails, distance, status, whether the baseline was
  operator-confirmed.
- `confirmed_only` toggle: compare against **human-confirmed** history only. Label it
  "Compare against confirmed detections only" and surface the resulting count change — this is
  the visible payoff of persistent intelligence.

**Refusal state (required):** when either survey is below `L2`, render the
`COMPARISON_REFUSED` message and the offending survey's level. Do not disable the button
silently and do not attempt the call.

**MUST work:** run a comparison · all four status filters · coverage overlay ·
`confirmed_only` toggle.

---

## 7. Surface 5 — Evidence & Model Lab

**Job:** prove the numbers are real.

**Consumes:** `GET /benchmarks`, `GET /models`, `GET /memory/stats`.

- **Run header:** `run_id`, `git_sha`, `generated_at`, `device`, `split_id` — always visible.
- **Split assertions:** five PASS/FAIL rows. Displaying these is the point.
- **Detection metrics:** overall + per class / dataset / site / frequency tabs.
- **Open-set:** per-fold AUROC / AUPRC / seabed FPR + mean.
- **Ablation table:** A0–A6 with P/R/F1/mAP **and FP-per-km**.
- **Operational:** latency p50/p95, FPS, model size, peak RSS, full-survey processing ratio.
- **Baseline comparison:** renders the mandatory qualification text from
  `docs/EVALUATION_PROTOCOL.md` §4 adjacent to the table. Not a footnote.
- **Failure cases:** browsable FP / FN / open-set-FP galleries from run artifacts. **Showing
  these is a feature.**
- **Model registry:** versions, lineage (`parent_model_version_id`), snapshot, metrics ref,
  active flag.
- **Memory stats:** reviewed / confirmed / rejected / relabelled / training-eligible counts.

**States:** *no benchmark yet* → "No benchmark artifact published. Run an evaluation to
populate this surface." — **never placeholder numbers.** If `benchmarks.json` is absent the
surface is empty by design.

**Hard rule:** no numeric literal for any metric may exist in frontend source.
`tests/test_no_hardcoded_metrics.py` fails the build.

---

## 8. Cross-cutting states

| State | Requirement |
|---|---|
| Loading | Skeletons matching final layout. No layout shift. No spinner over sonar imagery. |
| Empty | Explains what is absent and the action that fixes it. Never a shrug. |
| Error | `error.message` verbatim from the API + retry where retry is meaningful. No stack traces. |
| Selected | Consistent emphasis treatment across viewport, list and map — selection is global. |
| Disabled | Always a tooltip with the reason, sourced from `capability_gates` or `level_reason`. |
| Demo | Persistent banner; `DEMO` badge on every affected value; carried into exports. |
| Offline/backend down | Clear "Backend unavailable at localhost:8000" with retry. Never partial fake data. |

## 9. Accessibility & interaction floor

Keyboard: full review loop (`C`/`R`/`L`/`→`), surface switching, focus-visible on every control.
Semantic HTML and ARIA labels on the viewport and all icon-only buttons. `prefers-reduced-motion`
respected. Contrast: WCAG AA on all text including overlay labels.

## 10. Performance targets

Workspace cold load < 3 s · detection select → Inspector < 150 ms · viewport pan/zoom 60 fps
with 500 visible overlays · detection list virtualised beyond 200 rows.

## 11. Explicitly out of scope for internal

Auth/login · multi-user presence · mobile layouts (desktop-first, ≥1440 px) · PDF export
(JSON/CSV/GeoJSON only) · in-browser annotation drawing beyond box adjustment on relabel ·
dark/light theme toggle (dark only) · i18n.
