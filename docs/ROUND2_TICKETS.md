# Aqualens — Round-2 Execution Backlog

**Source of truth:** `docs/ROUND2_HARDENING_SPEC.md` (the 14 locked decisions are not reinterpreted here).
**Vocabulary:** `CONTEXT.md`.
**Status:** DRAFT v2, spec-drift audited 2026-09-26 (audit log at the end). Nothing implemented. Not published to an issue tracker (none is configured).

---

## How to read this backlog

- **Order:** A + B → H0 → D → C → (E ∥ F) → G → H → I → J → PPT. G, H, I and J are not pulled forward.
- **Freeze checkpoints:** FZ-H0, FZ-D, FZ-C, FZ-EF, FZ-G, FZ-H. Every freeze requires:
  1. all Python and frontend tests pass;
  2. the git diff since the previous freeze has been reviewed;
  3. the workstream's artifacts are generated;
  4. claim wording is decided (pass or fail wording from the spec's claim contract);
  5. no production deploy unless the relevant gate passed.
- **Priority:**
  - **P0:** required for Round-2 scientific credibility. This includes every workstream that spec §12 (Definition of Done) requires to reach a recorded pass/fail outcome: A, B, H0, D, C, E, F, G, H, I, J.
  - **P1:** work beyond the spec's required outputs.
  - **P2:** optional.
- **Pre-implementation decisions (PID-xx):** where the spec does not fix a parameter, method or definition that can change a scientific result or an acceptance outcome, the ticket names a PID instead of inventing one.
  - A ticket that lists a PID **cannot start** until that PID is resolved and recorded in a decision log.
  - Any value quoted from the research plan or novelty document is a *candidate only*; those documents are not locked protocol.
  - Resolved PIDs that affect C, E, F or G are frozen in that workstream's pre-registration before its test run.
- **Test-first:** every implementation ticket lists the tests to write before the change.
- **Artifact format before Workstream I:** experiments from H0 onward write artifacts using the field lists already fixed in spec §6 (manifest, metrics, preregistration, hashes). Workstream I adds schema validation, reproducibility checks and the claims ledger, then re-validates every earlier artifact.
- **Parallel:** "YES" means the ticket can run alongside another ticket whose dependencies are also met. It never means it may skip its own dependencies or PIDs.

### Module vocabulary used in tickets

| Name used in tickets | What it is |
|---|---|
| association module | `sagar.vnext.contacts` (Contact association and persistence labelling) |
| runtime API | `sagar.api.app` (Upload ingest, job worker, review endpoint, reports) |
| navigation parser | `sagar.perception.navigation` (navigation.csv / mission.json) |
| detector runtime | `sagar.perception.runtime` (frozen YOLO11s, tiling, NMS, SHIPWRECK recovery pass) |
| evidence module | `sagar.vnext.evidence` (current fusion and display normalization) |
| physics module | `sagar.vnext.physics` (pipeline verifier, oriented physics) |
| association tests | the Contact-association unit tests (`tests/test_vnext`) |
| API tests | test-client tests with a faked detector (`tests/test_navigation_ingest`, `tests/test_runtime_api_resilience`) |
| tiling tests | `tests/test_runtime_tiling`, `tests/test_final_runtime` |
| **round2 harness** | **new** research package in the ML experiments area. Sub-modules: manifest, infer, features, geometry, windows, probe, localanomaly, persistence, relief, fusion, runtime_eval, artifacts, ledger, demo. Location fixed in H0-1. |
| artifact store | `artifacts/round2/<workstream>/<experiment>/iter-<n>/` |
| corpus metadata | frozen `multidomain_sonar_v1_1_20260831` canonical metadata and QA |

---

## Pre-implementation decisions (PID)

Each must be resolved, with its value and rationale recorded, before any ticket that lists it starts. "Candidate" = a value proposed in a non-locked document; it is not adopted by this backlog.

| PID | Decision required | Tickets gated | Candidate (non-authoritative source) |
|---|---|---|---|
| **PID-01** | Method for constructing AI4 merged object regions from expert masks (morphology, minimum area) | H0-1, C12, C15, F7 | 15-px closing, area ≥ 1,024 px (research plan D1; novelty doc §6.6) |
| **PID-02** | Seabed-line pick algorithm (spec F item 1 fixes "seabed-line pick", not the algorithm); confidence threshold for UNAVAILABLE; tolerance for the synthetic geometry test | H0-6 | window-slope method (MDPI paper, research plan); ±2 px (research plan Part C) |
| **PID-03** | Which PING image represents each augmentation parent in the one-per-parent subset | H0-7 | lexicographically first filename (research plan D1) |
| **PID-04** | Evaluation subsets per experiment where the spec is silent: SubPipe (all test frames vs pixel-disjoint 25-s-spaced frames) and PING (one-per-parent vs all variants), for D, C, F and G. The spec fixes E (S_φ) and H (one per parent). | D1, C11, C12, F8, G1 | 25-s spacing; one per parent (research plan) |
| **PID-05** | Lowered detection floor for declared calibration and threshold sweeps (spec allows a declared lower floor; no value) | H0-8, E4, E5, G1 | 0.05 (research plan) |
| **PID-06** | Detection-to-GT matching algorithm (e.g. score-ordered one-to-one), and the IoU defining a TP label for fusion and calibration | H0-8, D4, G1, H4, H5 | score-ordered one-to-one; TP at IoU 0.5 (research plan App. A) |
| **PID-07** | Background-window sampling for D and C-H1: number per sensor and size distribution. The spec fixes only random placement, cross-sensor size matching and the exclusion rules. | D1, C11 | ≥ 2,000 per sensor, sizes from the object-window distribution (novelty doc §6.6) |
| **PID-08** | Rule assigning a detection to a background window (for detections per 1,000 windows and per-window false alarms) | D4, D5 | — |
| **PID-09** | Sensor-probe details: how crop embeddings are pooled; regularization / hyperparameter selection (train split only) | D2, D3 | — |
| **PID-10** | Baseline B2 threshold quantile ("τ from val per sensor"); baseline B3 memory construction (size, subsampling) | C7 | q95 (novelty doc); linspace to 2,048 (open_set_v1 build) |
| **PID-11** | Intensity statistic for the raw-intensity rank-CFAR baseline B4 | C8 | — |
| **PID-12** | Operating-point rule when exact "equal realized FPR" (C12) or "equal recall" (E5, C15) is unattainable with discrete scores | C12, C15, E5 | — |
| **PID-13** | H5 definitions: proposal-to-GT hit rule; "detector-missed wreck"; the pass criterion for "recovers AI4 wrecks at q = 0.1"; how the local-anomaly channel is combined with the detector for "precision at matched recall" | C15, C19 | hit = ≥ 25 % window overlap with a GT mask (novelty doc §6.6) |
| **PID-14** | Lacunarity definition for the false-alarm-rate-vs-seabed-complexity diagnostic | C11 | — |
| **PID-15** | Acceptance threshold for the val residual of the HF↔LF Slant-range mapping | E3 | median residual ≤ 10 px LF (research plan T2) |
| **PID-16** | Raised-relief feature definitions: contrast aggregation over the F/N bands; darkness thresholds for shadow length and continuity; pairing rule; f_any band sizes; numeric tolerance for "\|Δ\| ≈ 0" in F-AC1 | F3, F5, F6 | thresholds 1.0σ / 1.5σ, pairing min(f1, f2)·1[Δ > 0.5] (research plan D3) |
| **PID-17** | Same-range background sampling for F (number per positive, placement) | F7, F8 | 2 per positive (research plan D3) |
| **PID-18** | Fusion details: L2 strength selection (val only); which scores receive Platt/isotonic post-calibration (fused output only, or also raw detector confidence as a comparator); deployment-gate granularity (per sensor vs pooled) | G3, G5, G6, G9 | — |
| **PID-19** | SubPipe held-out bundle construction given the 512 MiB upload cap: raise the cap for evaluation, or split contiguous segments across Uploads (which ends Survey contiguity at each boundary) | H1 | — |
| **PID-20** | How false positives and pings are counted for "FP per 1,000 pings" in H, where overlapping 1-s frames share pings | H6 | — |
| **PID-21** | Pre-declared selection rules for qualitative panels and demo frames (never by confidence distribution, never best-case) | C19, F10, J2 | — |
| **PID-22** | Field name for per-Frame Survey membership. Spec §6 names it `survey_id`, but Observations already carry the legacy `survey_id` (the Upload id), which spec B requires be kept. | B1, B6, A7 | — |
| **PID-23** | How MEASURED and DERIVED_FROM_SOURCE navigation provenance is declared in an Upload, and whether an uploader's declaration alone is trusted | B3, A7 (API fixtures) | — |
| **PID-24** | Which box's width is *w* in the Slant-range position match max(0.25·w, 20 px) | A3, A7, E4 | — |

---

## Workstream A — Contact association correctness

#### A1 · Regression characterization tests: same-frame merge, navigation merge, upload order
**P0 · A · 1 h · Parallel: YES (with B1)**
- **Purpose:** Pin the reproduced defects (spec KD-1–KD-3) and the order-invariance requirement as executable tests before any fix, recording what the current code actually does.
- **Why now:** Every later workstream depends on Contacts meaning one object hypothesis.
- **Depends on:** none.
- **Inspect:** association module; association tests; plan Appendix B reproduction script and its recorded output (plan Part E).
- **Likely to change:** association tests only.
- **Tests first:**
  - (1) CASE 1 (spec A-AC1): two FULL_FRAME boxes on one Frame with an identical frame fix → spec requires 2 Contacts. **Current result by prior execution:** 1 Contact.
  - (2) CASE 2 (spec A-AC2): same boxes, no navigation → spec requires 2. **Current result by prior execution:** 2.
  - (3) CASE 3 (spec A-AC3): two Frames, fixes 20 m apart, unrelated positions, no declared sequence → spec requires 2. **Current result by prior execution:** 1.
  - (4) Order invariance (spec A-AC7): reversed upload order → identical Contact ids and memberships. **Current result: not yet executed; record it.**
  - (5) Tile-duplicate guard (spec A-AC4, count only): two TILED Observations of one object on adjacent tiles, IoU ≥ 0.30 → 1 Contact. **Current result: not yet executed; record it.**
- **Task:** write the tests and run them against the unchanged code. Any test that fails today is marked as an expected failure citing its spec criterion and defect id. Record every test's current result in the ticket log.
- **Acceptance:** all five tests exist and assert the **spec-required** outcome. Each test's current result is recorded from actual execution. Currently failing tests fail on an assertion about Contact count or identity, not on an error. The rest of the suite is unchanged.
- **Artifacts:** a current-result log (in the ticket record).
- **Regression risk:** none (tests only).
- **Stop:** tests written, run, and current results recorded.

#### A2 · Same-Frame association: only tile-overlap duplicates may merge
**P0 · A · 1.5 h · Parallel: NO**
- **Purpose:** Enforce invariant I-A1.
- **Why now:** This is the demo-visible defect (distinct crab pots merged).
- **Depends on:** A1.
- **Inspect:** association module; the Observation fields `inference_mode`, `tile_id`, `bbox_px`.
- **Likely to change:** association module; association tests (the window-overlap test fixture gains `TILED` mode and distinct `tile_id`s).
- **Tests first:**
  - A1 test (1) must pass.
  - New: two TILED Observations on the **same** tile never merge (spec: "different tiles").
  - New: Observations without an established tiled `inference_mode` are not duplicates (spec: duplicates require both from tiled inference).
- **Task:** for two Observations on one Frame, merge only when both are from tiled inference, on different tiles, and box IoU ≥ 0.30 or one box centre lies inside the other. Otherwise they are separate Contacts. No other same-Frame gate applies.
- **Acceptance:** spec A-AC1, A-AC2, A-AC4; the existing window-overlap test passes with its updated fixture (rationale in a comment).
- **Artifacts:** none.
- **Regression risk:** Contact counts rise on multi-object frames; frontend fixtures that assume merged Contacts.
- **Stop:** all association tests green; no change to cross-Frame behaviour yet.

#### A3 · Cross-Frame interim rule: verified ping relationships of non-synthetic provenance only
**P0 · A · 2 h · Parallel: NO**
- **Purpose:** Implement the spec's **interim rule** exactly and remove the navigation distance bypass (KD-1) and any upload-order dependence.
- **Why now:** CASE 3 and the v3 "place frames 2 m apart" behaviour must stop before any evaluation.
- **Depends on:** A2.
- **Requires decision:** PID-24 (*w*).
- **Inspect:** association module; navigation parser (existing mission-level synthetic labels); the declared-ping-order test; the navigation-association test.
- **Likely to change:** association module; association tests; API tests (expectation change only).
- **Tests first:**
  - A1 test (3) must pass.
  - Declared-sequential Frames whose ping bounds have a gap never associate.
  - Frames with identical frame fixes but no declared sequence never associate.
  - Declared-sequential Frames whose ping provenance is SYNTHETIC_DEMO or not established (absent) never associate. The spec's interim rule requires non-synthetic provenance, and absent provenance does not establish it. This is the same conservative convention as B3.
  - With established non-synthetic provenance, overlapping ping ranges associate only if the boxes overlap after mapping into shared ping/range coordinates.
  - With established non-synthetic provenance, contiguous disjoint ping ranges associate only if the Slant-range positions match within max(0.25·w, 20 px).
  - The declared-ping-order test is rewritten so that its Frames carry established non-synthetic ping provenance at the association seam, and it passes through ping contiguity, not geo.
  - Rewrite the navigation-association test to assert non-association of non-sequential Frames, with the rationale (it encoded KD-1).
- **Task:**
  - The association function takes each Frame's ping-bound provenance as an input: a spec B item 6 value, or absent. B3 later populates it at ingest; until then it is absent for every Upload, so the API path yields no cross-Frame association. This matches the spec interim rule ("otherwise they never associate").
  - Different Frames associate only if both are flagged sequential with valid ping bounds of non-synthetic provenance whose ranges overlap or are contiguous. Within those:
    - (a) overlapping pings → mapped-box overlap (spec A req 2a);
    - (b) contiguous disjoint pings → Slant-range position match (spec A req 2b).
  - Frame-level coordinates never participate. Frame index and upload order never create association.
- **Acceptance:** spec A-AC3, A-AC7; I-A5 and I-A6 hold in tests.
- **Artifacts:** none.
- **Regression risk:** the multi-frame API test (identical images, contiguous pings, no provenance) changes expectation to non-association until B3 lands; A7 revisits it under PID-23 (documented). Demos relying on geo merges lose them (intended).
- **Stop:** association tests and API tests green.

#### A4 · Association basis and Look count
**P0 · A · 1.5 h · Parallel: NO**
- **Purpose:** Make every Contact state *why* its Observations were grouped, and count independent Looks rather than Frames.
- **Why now:** Persistence (E) and reports need Look semantics; overlapping windows must not count as re-observation.
- **Depends on:** A3.
- **Inspect:** association module (persistence type and score computation).
- **Likely to change:** association module; association tests.
- **Tests first:**
  - Tile duplicate → basis TILE_OVERLAP_DUPLICATE, 1 Look.
  - Overlapping ping ranges with overlapping mapped boxes → SAME_LOOK_OVERLAPPING_WINDOWS, 1 Look.
  - Contiguous disjoint ping ranges with a Slant-range position match → INDEPENDENT_LOOKS_ALONG_TRACK, 2 Looks.
  - Single Observation → SINGLE.
  - The persistence type derives from Look count.
- **Task:** add additive Contact fields `association_basis` and `look_count`; derive the persistence evidence type (and the observation count it uses) from Looks, not Frames (spec A req 5; Q8).
- **Acceptance:** spec A-AC5, A-AC6 at the association seam; existing fields retained.
- **Artifacts:** none.
- **Regression risk:** persistence values fall for bundles whose "sequence" was overlapping or duplicated frames (intended); frontend reads of the persistence type.
- **Stop:** association tests green; field names match spec §6.

#### A5 · Review isolation: one verdict changes one Contact
**P0 · A · 1 h · Parallel: YES (with A4)**
- **Purpose:** Prevent a verdict landing on a different physical object (KD-4).
- **Why now:** Review memory must not be contaminated before any demo or evaluation.
- **Depends on:** A2, A3.
- **Inspect:** runtime API review endpoint; API tests.
- **Likely to change:** API tests (a new test); the review endpoint only if the test fails after A2/A3.
- **Tests first:** API test. The fake detector returns two FULL_FRAME boxes on one Frame, and the Upload includes navigation. Post a verdict on one Observation and expect exactly one Contact's disposition and review history to change (spec A req 6, A-AC9).
- **Task:** confirm or fix that the review update touches only the Contact containing that Observation.
- **Acceptance:** spec A-AC9.
- **Artifacts:** none.
- **Regression risk:** the append-only review behaviour test must remain green.
- **Stop:** API tests green.

#### A6 · Retained v4 Contact audit (read-only)
**P0 · A · 1 h · Parallel: YES (with A5)**
- **Purpose:** Show the fix on the real retained v4 Observations, without mutating runtime state.
- **Why now:** Confirms A-AC8 on the survey that exposed the defect.
- **Depends on:** A4.
- **Inspect:** retained runtime state (read-only), v4 demo survey records.
- **Likely to change:** round2 harness (a small audit entry point); no production code.
- **Tests first:** unit test that the audit reads state read-only (file hash unchanged after the run).
- **Task:** re-run association on retained v4 Observations; report Contacts before and after, same-Frame FULL_FRAME merges, and the basis of each Contact.
- **Acceptance:** spec A-AC8 (zero Contacts containing two same-Frame FULL_FRAME boxes); every changed Contact is listed.
- **Artifacts:** `artifacts/round2/A/v4_contact_audit/iter-1/` (report + manifest).
- **Regression risk:** none (read-only).
- **Stop:** report generated; runtime state hash unchanged.

#### A7 · Survey-bounded cross-Frame association (final rule)
**P0 · A · 1.5 h · Parallel: NO**
- **Purpose:** Replace the interim rule with the spec's final rule (spec A req 2; I-A2).
- **Why now:** Requires Survey membership from B; must land before the H0 freeze.
- **Depends on:** A4, B3, B4, B5.
- **Requires decision:** PID-22 (field name), PID-24 (*w*).
- **Inspect:** association module; Survey membership contract (B1); navigation provenance (B3).
- **Likely to change:** association module; association tests; API tests.
- **Tests first:**
  - Frames in different Surveys never associate, even with contiguous declared pings.
  - A ping relationship backed only by SYNTHETIC_DEMO or missing (null) provenance never associates Frames and never produces INDEPENDENT_LOOKS.
  - VERIFIED row-shift Frames (B4) associate as SAME_LOOK_OVERLAPPING_WINDOWS **only when their mapped boxes overlap** (spec A-AC5).
- **Task:** cross-Frame association requires the same Survey **and** a verified ping relationship: pixel-verified (B4), or ping bounds of MEASURED provenance (spec B rule 3b). Then the (a)/(b) criteria from spec A req 2 apply.
- **Acceptance:** spec I-A2, I-B3, I-B5 hold; A-AC1–A-AC10 all green.
- **Artifacts:** none.
- **Regression risk:** API fixtures must declare provenance per PID-23 or change expectation (documented).
- **Stop:** full suites green.

---

## Workstream B — Survey semantics (minimal, additive)

#### B1 · Survey membership data contract
**P0 · B · 1.5 h · Parallel: YES (with A1–A3)**
- **Purpose:** Introduce per-Frame Survey membership without migrating the Upload identifier.
- **Why now:** Everything that crosses Frames (A7, E, C references) is bounded by Survey.
- **Depends on:** none.
- **Requires decision:** PID-22.
- **Inspect:** runtime API ingest and upload record; report provenance block; stored upload-record hydration; navigation parser (mission metadata).
- **Likely to change:** runtime API (upload record shape: additive); navigation parser (declared membership); API tests.
- **Tests first:**
  - The upload record contains a Surveys list and per-Frame Survey membership, with a default of SINGLETON per Frame.
  - Explicit membership declared in mission metadata → DECLARED (spec B rule 3a).
  - Existing response fields are unchanged.
  - A stored record without these fields reads back as SINGLETON Surveys.
- **Task:** define and populate:
  - Survey membership (name per PID-22);
  - `membership_provenance` ∈ {DECLARED, VERIFIED, SINGLETON};
  - a geometry signature (width, height, channel layout);
  - `navigation_provenance` (spec values, nullable when not declared).
  The Upload keeps its existing identifier. The format of the DECLARED declaration is an implementation detail: DECLARED never enables persistence (I-B3).
- **Acceptance:** spec B-AC5 (partial); I-B1 holds; rule 3a covered.
- **Artifacts:** none.
- **Regression risk:** frontend types (additive only).
- **Stop:** API tests green.

#### B2 · Duplicate-raster detection by SHA-256
**P0 · B · 1 h · Parallel: YES (with B3, B5)**
- **Purpose:** A duplicated file must never yield re-observation (KD-6).
- **Why now:** The internal-round bundle used one image three times.
- **Depends on:** B1.
- **Inspect:** runtime API decode step.
- **Likely to change:** runtime API; API tests.
- **Tests first:** API test with a ZIP of three byte-identical PNGs → frames flagged DUPLICATE_RASTER, one Look, and no Contact with more than one Look.
- **Task:** hash every decoded raster; flag byte-identical duplicates; duplicates share one Look (spec B rule 5; I-B4).
- **Acceptance:** spec B-AC2, I-B4.
- **Artifacts:** none.
- **Regression risk:** existing multi-frame tests that upload identical fixture images now see duplicate flags; update with rationale.
- **Stop:** API tests green.

#### B3 · Navigation provenance enforcement
**P0 · B · 1.5 h · Parallel: YES (with B2, B5)**
- **Purpose:** Synthetic navigation can be displayed but never used as evidence (I-B5).
- **Why now:** All demo navigation in the repository is synthetic.
- **Depends on:** B1.
- **Requires decision:** PID-23.
- **Inspect:** navigation parser (mission fields, including existing demo and synthetic labels); runtime API.
- **Likely to change:** navigation parser; runtime API; API tests.
- **Tests first:**
  - Mission metadata carrying the existing synthetic labels (as in the v2 and v4 bundles) → provenance SYNTHETIC_DEMO.
  - With SYNTHETIC_DEMO, no ping relationship, Survey membership or persistence is established.
  - Navigation without declared provenance → `navigation_provenance` is **null**, and it never establishes ping relationships, VERIFIED membership or persistence.
- **Task:** record navigation provenance using **only** the spec values {MEASURED, DERIVED_FROM_SOURCE, SYNTHETIC_DEMO}, or null when undeclared (the product contract's null convention). Only MEASURED, or DERIVED_FROM_SOURCE with pixel verification, may support ping relationships.
- **Acceptance:** spec I-B3, I-B5; B-AC6 carries the provenance field.
- **Artifacts:** none.
- **Regression risk:** the multi-frame persistence API test (a sequence without provenance) changes expectation; documented.
- **Stop:** API tests green.

#### B4 · VERIFIED Survey formation from row-shift identity
**P0 · B · 2 h · Parallel: YES (with B2, B3)**
- **Purpose:** Establish shared pings from pixels, never from file order (spec B rule 3b).
- **Why now:** SubPipe held-out evaluation (E, H) needs genuine Surveys.
- **Depends on:** B1.
- **Inspect:** runtime API ingest; the plan's verified 20-row shift finding.
- **Likely to change:** runtime API (Survey formation step); API tests; unit tests on arrays.
- **Tests first:**
  - Synthetic arrays where Frame 2 equals Frame 1 shifted by k rows → one VERIFIED Survey, derived row offset k, provenance DERIVED_FROM_SOURCE.
  - Unrelated arrays → SINGLETON.
  - Input order shuffled → same result.
- **Task:** for Frames of identical geometry, detect exact row-shift identity independent of upload order. Row hashing may be used to find candidates, but every match must be confirmed by full pixel comparison, so the result stays exact. Group verified Frames into VERIFIED Surveys with derived ping offsets.
- **Acceptance:**
  - spec B-AC3 in full: the synthetic fixture (CI test) **and** three real consecutive SubPipe frames forming one VERIFIED Survey, recorded as a verification log from a run on the local SubPipe data;
  - ingest time for the real check recorded (a measurement, not a pass/fail gate).
- **Artifacts:** real-frame verification log.
- **Regression risk:** ingest latency on large Uploads (measured and recorded).
- **Stop:** tests green; real-frame log recorded.

#### B5 · Mixed-geometry Upload splitting
**P0 · B · 0.5 h · Parallel: YES (with B2, B3, B4)**
- **Purpose:** Frames of different raster geometry never share a Survey (I-B2).
- **Why now:** The v4 bundle mixes three sensors in one Upload.
- **Depends on:** B1.
- **Inspect:** runtime API ingest.
- **Likely to change:** runtime API; API tests.
- **Tests first:**
  - Declared membership spanning a 5000×500 and a 640×640 raster still yields at least 2 Surveys.
  - The v4-style 7-frame bundle → 7 SINGLETON Surveys.
- **Task:** geometry signature (width, height, channel layout) partitions Surveys.
- **Acceptance:** spec B-AC1, B-AC4.
- **Artifacts:** none.
- **Regression risk:** none beyond B1.
- **Stop:** API tests green.

#### B6 · Additive Survey fields in API responses and reports
**P0 · B · 1 h · Parallel: NO**
- **Purpose:** Make Survey membership and provenance visible in JSON, CSV and API outputs.
- **Why now:** H uses reports; judges read them.
- **Depends on:** B2, B3, B4, B5.
- **Requires decision:** PID-22.
- **Inspect:** runtime API report builders (JSON provenance block, Contact and Observation CSV).
- **Likely to change:** runtime API; API tests.
- **Tests first:** the JSON report includes the Surveys list and navigation provenance; the CSV includes Survey membership; every pre-existing report test passes.
- **Task:** additive fields only.
- **Acceptance:** spec B-AC5, B-AC6.
- **Artifacts:** none.
- **Regression risk:** downstream CSV consumers see new columns (additive).
- **Stop:** full Python and frontend suites green.

> **Gate to H0:** A1–A7 and B1–B6 complete.

---

## Workstream H0 — Held-out evaluation harness foundation

#### H0-1 · Held-out manifest builder
**P0 · H0 · 3 h · Parallel: YES (with H0-3)**
- **Purpose:** One leakage-proof list of every evaluation image and its groups.
- **Why now:** All experiments consume it.
- **Depends on:** A7, B6 (mandated order).
- **Requires decision:** PID-01 (AI4 merged object regions).
- **Inspect:** corpus metadata and QA; spec §6 and §7.
- **Likely to change:** round2 harness (manifest); new harness tests.
- **Tests first:** split counts equal corpus QA; required fields per spec §6 present; deterministic output.
- **Task:** build per-image rows: sensor, dataset, split, Survey id, bootstrap group, augmentation parent, GT boxes, AI4 merged object regions (method per PID-01), source SHA-256.
  - **Survey id:** SubPipe = maximal chains of consecutive frames linked by pixel-verified row-shift identity (spec B rule 3b, the same test as B4), per channel; AI4 = one waterfall; PING = one image.
  - **Bootstrap group** (spec §7.3): SubPipe 60-s time blocks; PING recording/contact group; AI4 wreck site.
  - Fix the harness package location.
- **Acceptance:** spec H0-AC1 (counts).
- **Artifacts:** `artifacts/round2/H0/manifest/iter-1/`.
- **Regression risk:** none (new code).
- **Stop:** counts match; tests green.

#### H0-2 · Leakage rejection tests
**P0 · H0 · 1 h · Parallel: YES (with H0-3)**
- **Purpose:** Make leakage structurally impossible (I-H0-1).
- **Why now:** Guards every downstream experiment.
- **Depends on:** H0-1.
- **Inspect:** manifest builder; existing feedback-leakage test.
- **Likely to change:** harness tests; manifest guards.
- **Tests first:**
  - Injecting a train row into an evaluation set raises an error.
  - A PING augmentation sibling in two splits raises an error.
  - Requesting fit-on-test raises an error (spec §7.1).
  - GT columns are inaccessible to reference builders (I-H0-4).
- **Task:** add guards and tests.
- **Acceptance:** all four adversarial tests pass.
- **Artifacts:** none.
- **Regression risk:** none.
- **Stop:** tests green.

#### H0-3 · Evaluation switch: SHIPWRECK recovery pass OFF
**P0 · H0 · 1.5 h · Parallel: YES (with H0-1)**
- **Purpose:** The demo heuristic never runs in scientific paths (Q4, KD-8).
- **Why now:** Every detection used for evidence depends on it.
- **Depends on:** A7, B6 (mandated order).
- **Inspect:** detector runtime (recovery pass trigger); tiling tests.
- **Likely to change:** detector runtime (an explicit configuration switch; **production default unchanged**); tiling tests.
- **Tests first:** with a fake model that would produce a recovery cluster, switch off gives no recovery Observation and a recovery-invocation counter of 0; switch default gives the current behaviour.
- **Task:** add an explicit runtime configuration switch for the recovery pass.
- **Acceptance:** spec H0-AC3.
- **Artifacts:** none.
- **Regression risk:** the demo path is unchanged by default; any configuration typo must fail loudly.
- **Stop:** tiling and API tests green.

#### H0-4 · Production-path inference equivalence fixture
**P0 · H0 · 1.5 h · Parallel: NO**
- **Purpose:** Prove the harness runs the actual runtime detection path.
- **Why now:** Otherwise "runtime evaluation" is detector evaluation again (KD-15).
- **Depends on:** H0-3.
- **Inspect:** detector runtime (tiled and full-frame paths); tiling tests' marker-frame fixtures.
- **Likely to change:** round2 harness (infer); harness tests.
- **Tests first:** for a tiled fixture and a full-frame fixture, harness detections equal production-path detections (classes, boxes, scores) with recovery off and identical floors.
- **Task:** harness inference calls the production path. A declared optional floor override (spec H0 item 3) is used only for calibration sweeps and recorded in the manifest.
- **Acceptance:** spec H0-AC4.
- **Artifacts:** none.
- **Regression risk:** none.
- **Stop:** equivalence tests green.

#### H0-5 · Layer-16 feature tap and cache (same forward pass)
**P0 · H0 · 2.5 h · Parallel: YES (with H0-6, H0-7)**
- **Purpose:** Deep cell embeddings for D and C without extra network passes.
- **Why now:** C's statistic and D's probe depend on it.
- **Depends on:** H0-4.
- **Inspect:** detector runtime; the existing open-set embedding method (for hook mechanics only).
- **Likely to change:** round2 harness (features); harness tests.
- **Tests first:**
  - Forward-pass counter equal with and without the tap.
  - Cells are 20×20 per 768 tile or 640 frame, L2-normalized (spec C item 1).
  - Cached cells equal an independent extraction within numerical tolerance.
- **Task:**
  - Hook layer 16 inside the harness's inference pass; average-pool to cells; normalize.
  - Cache for **every val and test image in the manifest** (spec H0 item 4), without lossy precision conversion.
  - Train-split background embeddings required by D2 and C7 are extracted by those tickets through the same tap.
- **Acceptance:** tests green; cache coverage = 100 % of manifest val/test images; cache manifest records detector SHA.
- **Artifacts:** `artifacts/round2/H0/cells/iter-1/`.
- **Regression risk:** disk use (measured); no coverage reduction is permitted to save space without a recorded decision.
- **Stop:** cache complete for all manifest val and test images.

#### H0-6 · Geometry records
**P0 · H0 · 2 h · Parallel: YES (with H0-5, H0-7)**
- **Purpose:** Range axis, nadir and water column per image, needed by C, E and F.
- **Why now:** The Side and range conditioning in C, and all of F, depend on it.
- **Depends on:** H0-1.
- **Requires decision:** PID-02.
- **Inspect:** the plan's verified geometry (rows are pings, columns are range, nadir at the centre column for SubPipe and AI4).
- **Likely to change:** round2 harness (geometry); harness tests.
- **Tests first:**
  - A synthetic waterfall with a known nadir and water column is recovered within the PID-02 tolerance.
  - Any PING record → RANGE_AXIS_UNKNOWN.
  - A pick below the PID-02 confidence threshold → UNAVAILABLE, never a guess.
- **Task:** per image, range axis; nadir column (±5 % of centre, fallback centre, per spec F item 1) with confidence; water-column half-width with confidence (method per PID-02).
- **Acceptance:** spec H0-AC5; a report of nadir estimates relative to the ±5 % window for SubPipe and AI4.
- **Artifacts:** `artifacts/round2/H0/geometry/iter-1/`.
- **Regression risk:** none.
- **Stop:** records exist for every image.

#### H0-7 · PING augmentation-parent deduplication
**P0 · H0 · 0.5 h · Parallel: YES (with H0-5, H0-6)**
- **Purpose:** Provide the one-image-per-parent PING subset (spec H0 item 5; KD-19).
- **Why now:** Needed by H bundles, and by other experiments per PID-04.
- **Depends on:** H0-1.
- **Requires decision:** PID-03.
- **Inspect:** corpus metadata augmentation parent ids.
- **Likely to change:** round2 harness (manifest subset); tests.
- **Tests first:** the one-per-parent test subset has exactly 324 images; the selection is deterministic under the PID-03 rule.
- **Task:** build the subset per PID-03.
- **Acceptance:** spec H0-AC6.
- **Artifacts:** subset list in the manifest artifact.
- **Regression risk:** none.
- **Stop:** tests green.

#### H0-8 · First runtime-path detector baseline
**P0 · H0 · 2 h · Parallel: NO**
- **Purpose:** First measurement of deployed-path detection per sensor (KD-14, KD-15).
- **Why now:** Supplies detections to D, C, E, F and G.
- **Depends on:** H0-2, H0-4, H0-7.
- **Requires decision:** PID-05 (declared sweep floor), PID-06 (matching).
- **Inspect:** harness inference.
- **Likely to change:** round2 harness (infer, evaluation); tests.
- **Tests first:** the PID-06 matching function on constructed boxes.
- **Task:**
  - Run val and test through the harness at runtime floors.
  - Also cache detections at the declared sweep floor (PID-05).
  - Compute per-sensor precision and recall at IoU 0.5 and 0.3 with cluster-bootstrap CIs (spec §7.3).
  - Label them as runtime-path metrics next to the training-representation metrics.
- **Acceptance:** per-sensor table with CIs; detector SHA recorded; recovery counter 0.
- **Artifacts:** `artifacts/round2/H0/runtime_path_baseline/iter-1/` (detection caches, metrics, figures).
- **Regression risk:** none.
- **Stop:** artifact written.

> ### FZ-H0: freeze
> A and B complete; H0-1–H0-8 artifacts exist; all suites green; diff reviewed. Claim wording decided for "runtime-path detection per sensor". No deploy.

---

## Workstream D — Sensor-confound diagnostics

#### D1 · Background-window sampler
**P0 · D · 2 h · Parallel: NO**
- **Purpose:** Shared, unbiased background windows for D, C and F, plus train background crops for the probe.
- **Why now:** Every false-alarm measurement uses them.
- **Depends on:** FZ-H0.
- **Requires decision:** PID-04 (subsets), PID-07 (count, size distribution).
- **Inspect:** manifest; geometry records.
- **Likely to change:** round2 harness (windows); tests.
- **Tests first:**
  - No window intersects any GT box dilated by 32 px.
  - No window intersects the water column.
  - Windows are randomly placed.
  - Crop and window sizes are size-matched across sensors (spec D req 1).
  - A fixed seed gives identical windows.
- **Task:**
  - Per sensor, test background windows drawn from the PID-04 subsets with the PID-07 count and size distribution.
  - Train background crops for the probe (train split only), also size-matched across sensors.
- **Acceptance:** tests green; counts reported per sensor.
- **Artifacts:** `artifacts/round2/D/windows/iter-1/`.
- **Regression risk:** none.
- **Stop:** windows file complete.

#### D2 · Deep-feature sensor probe
**P0 · D · 1.5 h · Parallel: YES (with D3, D4, D5)**
- **Purpose:** Measure how strongly features encode the sensor.
- **Why now:** Q3 disclosure.
- **Depends on:** D1, H0-5.
- **Requires decision:** PID-09.
- **Inspect:** feature cache.
- **Likely to change:** round2 harness (probe); tests.
- **Tests first:**
  - Fitting rejects non-train rows.
  - Implementation sanity: synthetic separable data is separated, and shuffled labels score near chance. This checks the code only, not a scientific threshold.
- **Task:** multinomial logistic regression on pooled layer-16 embeddings of train background (pooling and regularization per PID-09) → balanced accuracy on test background, with a 95 % bootstrap CI and the chance level.
- **Acceptance:** spec D-AC1 (deep part).
- **Artifacts:** probe metrics under `artifacts/round2/D/probe/iter-1/`.
- **Regression risk:** none.
- **Stop:** metrics written.

#### D3 · Intensity-histogram control probe
**P0 · D · 0.5 h · Parallel: YES (with D2, D4, D5)**
- **Purpose:** Show how much sensor identity is trivial intensity texture.
- **Why now:** Context for D2.
- **Depends on:** D1.
- **Requires decision:** PID-09 (same probe protocol).
- **Inspect:** raw background crops.
- **Likely to change:** round2 harness (probe); tests.
- **Tests first:** same as D2.
- **Task:** 64-bin intensity histograms → same probe protocol.
- **Acceptance:** spec D-AC1 (control part).
- **Artifacts:** same probe artifact.
- **Regression risk:** none.
- **Stop:** metrics written.

#### D4 · Sensor × predicted-class false-detection matrix
**P0 · D · 1.5 h · Parallel: YES (with D2, D3, D5)**
- **Purpose:** Quantify cross-sensor class hallucination.
- **Why now:** Q3 disclosure.
- **Depends on:** D1, H0-8.
- **Requires decision:** PID-08 (window assignment), PID-06 (matching on positives).
- **Inspect:** runtime-path detection cache.
- **Likely to change:** round2 harness (confound); tests.
- **Tests first:** planted-detection fixtures are counted in the correct cell under the PID-08 rule; rates are computed per 1,000 background windows, and per 1,000 pings for SubPipe.
- **Task:** 3 × 3 matrix at runtime operating floors, plus the cross-class confusion on positives, with CIs.
- **Acceptance:** spec D-AC2.
- **Artifacts:** matrix under `artifacts/round2/D/matrix/iter-1/`.
- **Regression risk:** none.
- **Stop:** metrics written.

#### D5 · Per-sensor false-alarm table (detector and deployed open-set)
**P0 · D · 1.5 h · Parallel: YES (with D2, D3, D4)**
- **Purpose:** Baseline background false-alarm rates before C.
- **Why now:** C's H1 compares against the deployed global memory.
- **Depends on:** D1, H0-8.
- **Requires decision:** PID-08.
- **Inspect:** runtime-path detections; the deployed open-set scoring (as deployed).
- **Likely to change:** round2 harness (confound); tests.
- **Tests first:** false-alarm-rate computation on constructed windows; CI method (spec §7.3).
- **Task:** per sensor, the fraction of background windows with (a) a detection at runtime floors (PID-08 rule) and (b) a deployed open-set flag, with cluster-bootstrap CIs.
- **Acceptance:** spec D-AC3 (initial columns; C11 adds the local-anomaly columns).
- **Artifacts:** false-alarm table under `artifacts/round2/D/far/iter-1/`.
- **Regression risk:** none.
- **Stop:** metrics written.

#### D6 · Confound figures
**P0 · D · 1 h · Parallel: NO**
- **Purpose:** PPT-ready disclosure.
- **Why now:** Closes D.
- **Depends on:** D2, D3, D4, D5.
- **Inspect:** D metrics.
- **Likely to change:** round2 harness (figures).
- **Tests first:** figures regenerate byte-identically from stored metrics.
- **Task:** probe confusion matrices, false-detection heat map, per-sensor false-alarm bars (PNG 300 dpi + SVG); an auto-generated confound statement in the metrics.
- **Acceptance:** spec D-AC4, D-AC5.
- **Artifacts:** `artifacts/round2/D/figures/iter-1/`.
- **Regression risk:** none.
- **Stop:** figures and statement written.

> ### FZ-D: freeze
> D artifacts complete; confound wording chosen from results; suites green; diff reviewed. No deploy.

---

## Workstream C — Local anomaly significance

#### C1 · Synthetic statistical correctness tests (test-first)
**P0 · C · 2 h · Parallel: NO**
- **Purpose:** Specify the statistic's required properties before building it.
- **Why now:** C's claim is statistical; tests must exist first.
- **Depends on:** FZ-D.
- **Inspect:** spec §5 C, §7.
- **Likely to change:** harness tests (localanomaly).
- **Tests first (these are the ticket):**
  - (a) C-AC1: on exchangeable synthetic fields, 1,000 simulations, p-values are uniform (KS p > 0.01) and realized false-alarm rate ≤ α within Monte-Carlo error.
  - (b) C-AC2: a planted anomaly gives power above a matched global-memory baseline.
  - (c) C-AC3: a planted dark band in the candidate's rows never enters the reference.
  - (d) C-AC4: changing GT boxes changes no p-value.
- **Task:** write the tests against the spec interface; they stay red until C6. Synthetic-field generation is a test-fixture choice.
- **Acceptance:** tests fail only for "not implemented".
- **Artifacts:** none.
- **Regression risk:** none.
- **Stop:** tests written and reviewed.

#### C2 · Reference builder
**P0 · C · 2.5 h · Parallel: YES (with C4)**
- **Purpose:** Comparable seabed: same Survey, same Side, similar Slant range, row guard, water column excluded.
- **Why now:** The core of the novelty.
- **Depends on:** C1, H0-6.
- **Inspect:** geometry records; manifest Survey ids.
- **Likely to change:** round2 harness (localanomaly reference); tests.
- **Tests first:**
  - Unit tests for each constraint: Survey, Side, Δr, g_p, G_p (as defined in spec C item 3), water column, detector-box exclusion.
  - C1(c) passes.
  - GT is unreachable.
- **Task:** implement per spec parameters.
- **Acceptance:** spec C-AC3, C-AC4 (reference part).
- **Artifacts:** none.
- **Regression risk:** none.
- **Stop:** tests green.

#### C3 · Availability states
**P0 · C · 1 h · Parallel: YES (with C4, C5)**
- **Purpose:** Missing ≠ zero for local anomaly.
- **Why now:** Every p-value record carries it.
- **Depends on:** C2.
- **Inspect:** spec §5 C item 8.
- **Likely to change:** round2 harness; tests.
- **Tests first:**
  - N < ⌈1/α⌉ − 1 → INSUFFICIENT_REFERENCE with N recorded.
  - Unknown range axis without the unconditioned variant → GEOMETRY_UNAVAILABLE.
  - Never 0 when unavailable.
- **Task:** state logic.
- **Acceptance:** spec C-AC5.
- **Artifacts:** none.
- **Regression risk:** none.
- **Stop:** tests green.

#### C4 · Deep-feature statistic T(W)
**P0 · C · 1.5 h · Parallel: YES (with C2, C3)**
- **Purpose:** Window statistic = max over cells of mean distance to the k = 3 nearest memory cells (spec C item 5).
- **Why now:** Needed by C6.
- **Depends on:** C1, H0-5.
- **Inspect:** cell cache.
- **Likely to change:** round2 harness; tests.
- **Tests first:** closed-form checks on tiny vector sets; invariance to cell order.
- **Task:** implement T(W).
- **Acceptance:** tests green.
- **Artifacts:** none.
- **Regression risk:** none.
- **Stop:** tests green.

#### C5 · Memory / calibration block split
**P0 · C · 1 h · Parallel: YES (with C3, C4)**
- **Purpose:** Disjoint memory 𝓜 and calibration 𝓒 via alternating 2-cell along-track blocks (spec C item 4).
- **Why now:** Prevents self-matching in calibration.
- **Depends on:** C2.
- **Inspect:** reference builder output.
- **Likely to change:** round2 harness; tests.
- **Tests first:** 𝓜 ∩ 𝓒 = ∅; deterministic block pattern; non-overlapping calibration placements.
- **Task:** implement the split and the placement enumerator.
- **Acceptance:** tests green.
- **Artifacts:** none.
- **Regression risk:** none.
- **Stop:** tests green.

#### C6 · Conformal-style p-value
**P0 · C · 1 h · Parallel: NO**
- **Purpose:** p(W\*) = (1 + #{T_j ≥ T\*}) / (1 + N).
- **Why now:** Completes the method; C1 goes green.
- **Depends on:** C3, C4, C5.
- **Inspect:** spec §5 C items 6, 7, 9, 10.
- **Likely to change:** round2 harness; tests.
- **Tests first:** C1(a), (b), (d) must now pass; BH at q on constructed p-values.
- **Task:** p-value, per-candidate α mode, BH triage mode, trimmed variant (top 2 %).
- **Acceptance:** spec C-AC1, C-AC2, C-AC4.
- **Artifacts:** none.
- **Regression risk:** none.
- **Stop:** all C1 tests green.

#### C7 · Global-memory baselines (B1–B3)
**P0 · C · 2 h · Parallel: YES (with C8, C9)**
- **Purpose:** The comparators for H1 and H2.
- **Why now:** Needed before pre-registration.
- **Depends on:** C4, H0-5.
- **Requires decision:** PID-10.
- **Inspect:** the deployed open-set artifact and scoring (B1 as deployed); cell cache; train background.
- **Likely to change:** round2 harness (baselines); tests.
- **Tests first:** B1 reproduces the deployed scores on fixtures within numerical tolerance; B2/B3 thresholds come from val only.
- **Task:**
  - B1: as deployed.
  - B2: global SubPipe memory, per-cell max statistic, τ from val per sensor (quantile per PID-10).
  - B3: global multi-sensor train memory (construction per PID-10; hashed).
- **Acceptance:** spec C-AC8 (partial).
- **Artifacts:** B3 memory plus hashes under `artifacts/round2/C/baselines/iter-1/`.
- **Regression risk:** none.
- **Stop:** baseline scores computable on any window.

#### C8 · Raw-intensity rank-CFAR baseline (B4)
**P0 · C · 1.5 h · Parallel: YES (with C7, C9)**
- **Purpose:** Test whether deep features matter (H4).
- **Why now:** Before pre-registration.
- **Depends on:** C2, C5, C6.
- **Requires decision:** PID-11.
- **Inspect:** reference builder.
- **Likely to change:** round2 harness; tests.
- **Tests first:** on synthetic fields, rank-CFAR p-values are uniform under the null.
- **Task:** the PID-11 intensity statistic, with the identical reference design and split, and a rank p-value.
- **Acceptance:** tests green.
- **Artifacts:** none.
- **Regression risk:** none.
- **Stop:** tests green.

#### C9 · Range-unconditioned local baseline (B5)
**P0 · C · 1 h · Parallel: YES (with C7, C8)**
- **Purpose:** Test whether range conditioning matters (H3); also the PING variant.
- **Why now:** Before pre-registration.
- **Depends on:** C2, C5, C6.
- **Inspect:** reference builder.
- **Likely to change:** round2 harness; tests.
- **Tests first:** the reference is all same-image cells at Chebyshev distance ≥ 2 cells from W\*; records are labelled RANGE_UNCONDITIONED.
- **Task:** implement.
- **Acceptance:** tests green.
- **Artifacts:** none.
- **Regression risk:** none.
- **Stop:** tests green.

#### C10 · Pre-registration artifact and hash
**P0 · C · 1 h · Parallel: NO**
- **Purpose:** Freeze hypotheses, parameters and all resolved C-relevant PIDs before touching test.
- **Why now:** Required before C11.
- **Depends on:** C6, C7, C8, C9; PID-01, 04, 07, 10, 11, 12, 13, 14 resolved.
- **Inspect:** spec §5 C (H1–H5), §7.
- **Likely to change:** round2 harness (preregistration writer); tests.
- **Tests first:** a hash mismatch between the pre-registration and a run blocks the run; any rerun increments the iteration counter.
- **Task:** write the pre-registration: hypotheses, α, q, k, Δr, g_p, G_p, cell size, trimming, success/failure rules, Holm, and the resolved PID values.
- **Acceptance:** spec C-AC7.
- **Artifacts:** `artifacts/round2/C/preregistration/iter-1/`.
- **Regression risk:** none.
- **Stop:** hash recorded before any test run.

#### C11 · H1 validity experiment (held-out background)
**P0 · C · 2 h · Parallel: NO**
- **Purpose:** Does the realized false-alarm rate hold at α per sensor?
- **Why now:** The gate for the novelty claim.
- **Depends on:** C10, D1.
- **Requires decision:** PID-04, PID-07, PID-14.
- **Inspect:** background windows; pre-registration.
- **Likely to change:** round2 harness (experiment runner).
- **Tests first:** a runner smoke test on a synthetic mini-manifest.
- **Task:**
  - Realized false-alarm rate at α ∈ {0.01, 0.05, 0.10} for the C variants and B1–B5, per sensor, with cluster-bootstrap and Clopper–Pearson CIs.
  - Extend the D5 table.
  - Report false-alarm rate vs local lacunarity (PID-14).
- **Acceptance:** H1 verdict recorded per pre-registration.
- **Artifacts:** `artifacts/round2/C/H1/iter-1/`.
- **Regression risk:** none.
- **Stop:** verdict written. **If H1 fails:** C12–C19 still run (spec DoD requires recorded outcomes), and the novelty claim is withdrawn at FZ-C.

#### C12 · H2 power experiment
**P0 · C · 1.5 h · Parallel: YES (with C13, C14, C15)**
- **Purpose:** Detection rate at equal realized false alarms vs global memory.
- **Why now:** The second gate for the novelty claim.
- **Depends on:** C11.
- **Requires decision:** PID-01 (AI4 objects), PID-04, PID-12 (operating point).
- **Inspect:** object windows (manifest GT), H1 results.
- **Likely to change:** round2 harness.
- **Tests first:** the PID-12 operating-point rule on constructed score data.
- **Task:** TPR at equal realized false-alarm rate (5 %) per sensor, C vs B1/B2, paired cluster bootstrap (B = 2,000) (spec H2, §7.3).
- **Acceptance:** H2 verdict recorded.
- **Artifacts:** `artifacts/round2/C/H2/iter-1/`.
- **Regression risk:** none.
- **Stop:** verdict written.

#### C13 · H3 geometry ablation
**P0 · C · 1 h · Parallel: YES (with C12, C14, C15)**
- **Purpose:** Range-conditioned vs unconditioned (SubPipe, AI4).
- **Why now:** Part of the novelty claim.
- **Depends on:** C11.
- **Inspect:** H1/H2 outputs.
- **Likely to change:** round2 harness.
- **Tests first:** runner smoke test.
- **Task:** paired TPR difference at α = 0.05 (paired cluster bootstrap, spec §7.3).
- **Acceptance:** H3 verdict recorded.
- **Artifacts:** `artifacts/round2/C/H3/iter-1/`.
- **Regression risk:** none.
- **Stop:** verdict written.

#### C14 · H4 deep features vs raw intensity
**P0 · C · 1 h · Parallel: YES (with C12, C13, C15)**
- **Purpose:** If rank-CFAR matches the deep features, the representation adds nothing, and we say so.
- **Why now:** Part of the novelty claim.
- **Depends on:** C11.
- **Inspect:** H1/H2 outputs.
- **Likely to change:** round2 harness.
- **Tests first:** runner smoke test.
- **Task:** paired TPR difference at α = 0.05, C vs B4.
- **Acceptance:** H4 verdict recorded.
- **Artifacts:** `artifacts/round2/C/H4/iter-1/`.
- **Regression risk:** none.
- **Stop:** verdict written.

#### C15 · H5 detector-miss recovery and evidence-channel value
**P0 · C · 2 h · Parallel: YES (with C12, C13, C14)**
- **Purpose:** The only permitted route to a SHIPWRECK-recovery claim (Q4). C-AC6 requires an H5 verdict.
- **Why now:** Pre-registered hypothesis.
- **Depends on:** C11, H0-8.
- **Requires decision:** PID-13 (hit rule, missed-wreck definition, pass criterion, combination rule), PID-12, PID-01.
- **Inspect:** AI4 test waterfalls; detection cache.
- **Likely to change:** round2 harness.
- **Tests first:**
  - Proposal enumeration: all non-overlapping 3 × 3-cell windows (spec C item 12).
  - The PID-13 hit rule on constructed masks.
- **Task:**
  - (a) Proposal mode with BH at q = 0.1 over AI4 test waterfalls: recovery of detector-missed wrecks, per PID-13.
  - (b) Local anomaly as an evidence channel for detector candidates: precision at matched recall (SubPipe, PING), using the PID-13 combination rule and the PID-12 operating-point rule.
  - (c) The false-positive survival rate (spec I-C4).
- **Acceptance:** H5 verdict recorded against the PID-13 criterion.
- **Artifacts:** `artifacts/round2/C/H5/iter-1/`.
- **Regression risk:** none.
- **Stop:** verdict written.

#### C16 · Holm-adjusted verdicts
**P0 · C · 0.5 h · Parallel: NO**
- **Purpose:** One authoritative verdict set for H1–H5.
- **Why now:** Closes the analysis.
- **Depends on:** C12, C13, C14, C15.
- **Inspect:** hypothesis outputs.
- **Likely to change:** round2 harness.
- **Tests first:** Holm adjustment on known p-value sets.
- **Task:** combined verdict file with adjusted p-values, CIs and n.
- **Acceptance:** spec C-AC6.
- **Artifacts:** `artifacts/round2/C/verdicts/iter-1/`.
- **Regression risk:** none.
- **Stop:** verdict file written.

#### C17 · Figure: nominal vs realized false-alarm rate per sensor
**P0 · C · 1 h · Parallel: YES (with C18)**
- **Purpose:** The primary PPT figure, shown whether H1 passes or fails.
- **Why now:** After verdicts.
- **Depends on:** C16.
- **Inspect:** H1 metrics.
- **Likely to change:** round2 harness (figures).
- **Tests first:** the figure regenerates from stored metrics.
- **Task:** three sensors; B1 (as deployed) vs C; diagonal; CIs.
- **Acceptance:** PNG 300 dpi + SVG.
- **Artifacts:** `artifacts/round2/C/figures/iter-1/`.
- **Regression risk:** none.
- **Stop:** figure written.

#### C18 · Figure: reference ablation
**P0 · C · 1 h · Parallel: YES (with C17)**
- **Purpose:** Show which design element matters (B1–B5 vs C).
- **Why now:** After verdicts.
- **Depends on:** C16.
- **Inspect:** H1–H4 metrics.
- **Likely to change:** round2 harness (figures).
- **Tests first:** same as C17.
- **Task:** realized false-alarm rate and TPR per variant per sensor. Measured rows only; N/A with a reason where undefined (Q6).
- **Acceptance:** figure plus table.
- **Artifacts:** same figures directory.
- **Regression risk:** none.
- **Stop:** figure written.

#### C19 · Panel: YOLO-missed wreck, success or failure
**P1 · C · 1 h · Parallel: YES (with C17, C18)**
- **Purpose:** Qualitative illustration of H5, honest either way. Not quantitative evidence.
- **Why now:** After C15.
- **Depends on:** C15, C16.
- **Requires decision:** PID-21 (selection rule), PID-13.
- **Inspect:** H5 outputs.
- **Likely to change:** round2 harness (figures).
- **Tests first:** the panel is produced by the pre-declared PID-21 rule, recorded in the manifest.
- **Task:** held-out wreck waterfall with the continuous p-value map and the BH q = 0.1 flags used by H5; range band and guard drawn; false alarms labelled.
- **Acceptance:** selection rule recorded; flags match the H5 artifact.
- **Artifacts:** figures directory.
- **Regression risk:** cherry-picking; prevented by the declared rule.
- **Stop:** panel written.

> ### FZ-C: freeze
> Verdicts recorded; novelty claim wording chosen (pass wording only if H1 ∧ H2); figures exist; suites green; diff reviewed. No deploy.

---

## Workstream E — Persistence validation (SubPipe only)

#### E1 · Independent-Look verification
**P0 · E · 1 h · Parallel: YES (with F1–F4)**
- **Purpose:** Guarantee zero shared pings between Looks (I-E1).
- **Why now:** Nothing in E is valid without it.
- **Depends on:** FZ-C.
- **Inspect:** SubPipe test Frames; B4 row-shift logic (concept reused).
- **Likely to change:** round2 harness (persistence); tests.
- **Tests first:** synthetic pixel-disjoint arrays → verified disjoint; overlapping → rejected.
- **Task:** pixel-verify every pair used as independent Looks.
- **Acceptance:** spec E-AC1 (100 % pass log).
- **Artifacts:** verification log under `artifacts/round2/E/`.
- **Regression risk:** none.
- **Stop:** log complete.

#### E2 · SubPipe 25-second phase sequence builder
**P0 · E · 1 h · Parallel: NO**
- **Purpose:** Pixel-disjoint, contiguous pass sequences S_φ.
- **Why now:** Input to the rules.
- **Depends on:** E1.
- **Inspect:** manifest SubPipe Survey segments (VERIFIED row-shift chains).
- **Likely to change:** round2 harness; tests.
- **Tests first:** every consecutive pair in S_φ is 25 ± 0.5 s apart, within one VERIFIED Survey segment, and verified disjoint.
- **Task:** build S_φ for φ = 0…24 per channel (spec E item 1).
- **Acceptance:** tests green.
- **Artifacts:** sequence file.
- **Regression risk:** none.
- **Stop:** file written.

#### E3 · Cross-frequency mapping validation
**P0 · E · 1 h · Parallel: YES (with E2)**
- **Purpose:** Enables rule X (same-ping HF/LF Looks); spec E item 2 requires the val residual to pass before use.
- **Why now:** Required before rule X.
- **Depends on:** E1.
- **Requires decision:** PID-15.
- **Inspect:** SubPipe val GT boxes (HF and LF).
- **Likely to change:** round2 harness; tests.
- **Tests first:** the fit rejects when the val residual fails the PID-15 criterion.
- **Task:** fit x_LF = a·x_HF + b on val only.
- **Acceptance:** residual check recorded.
- **Artifacts:** mapping parameters.
- **Regression risk:** none.
- **Stop:** pass, or rule X marked unusable (recorded outcome).

#### E4 · Persistence rules: causal C₁/C₂/C₃, non-causal N₂/N₃, cross-frequency X
**P0 · E · 1.5 h · Parallel: NO**
- **Purpose:** Apply the m-of-n rules (spec E item 3).
- **Why now:** Core of E.
- **Depends on:** E2, H0-8 (and E3 for X).
- **Requires decision:** PID-05 (sweep floor), PID-24 (*w*).
- **Inspect:** detection cache.
- **Likely to change:** round2 harness; tests.
- **Tests first:** rule outcomes on constructed detection chains; range-position match at max(0.25·w, 20 px), same class.
- **Task:** implement the rules; produce event chains.
- **Acceptance:** tests green.
- **Artifacts:** event records.
- **Regression risk:** none.
- **Stop:** records written.

#### E5 · Threshold-matched baseline
**P0 · E · 1 h · Parallel: NO**
- **Purpose:** Persistence must beat simply raising the threshold (spec E item 4).
- **Why now:** The decisive comparator.
- **Depends on:** E4.
- **Requires decision:** PID-12.
- **Inspect:** detection cache.
- **Likely to change:** round2 harness; tests.
- **Tests first:** the threshold search reaches the target recall on constructed data under the PID-12 rule.
- **Task:** for each rule, find the score threshold giving equal recall at m = 1.
- **Acceptance:** tests green.
- **Artifacts:** baseline records.
- **Regression risk:** none.
- **Stop:** records written.

#### E6 · Block-bootstrap evaluation
**P0 · E · 1 h · Parallel: NO**
- **Purpose:** Precision, recall, FP per 1,000 pings, retained/removed Contacts and latency, with CIs.
- **Why now:** Produces the verdict.
- **Depends on:** E5.
- **Inspect:** event and baseline records.
- **Likely to change:** round2 harness.
- **Tests first:** FP per 1,000 pings computed on S_φ only; **no per-km field exists**.
- **Task:** 60-s block bootstrap of paired differences; success/failure per spec.
- **Acceptance:** spec E-AC2, E-AC5.
- **Artifacts:** `artifacts/round2/E/eval/iter-1/`.
- **Regression risk:** none.
- **Stop:** verdict written.

#### E7 · Natural-clutter survival sample
**P0 · E · 1.5 h (includes manual labelling) · Parallel: YES (with E6)**
- **Purpose:** Which clutter kinds persistence removes (spec E item 6).
- **Why now:** Required spec output.
- **Depends on:** E4.
- **Inspect:** m = 1 false positives.
- **Likely to change:** round2 harness; labelling sheet.
- **Tests first:** the random sample of 100 is seeded and reproducible.
- **Task:** label 100 random m = 1 false positives into the spec categories (nadir/water column, seabed texture, pipeline-adjacent, isolated bright return, other); report survival per category under each rule.
- **Acceptance:** spec E-AC4.
- **Artifacts:** labelled sample plus a survival table.
- **Regression risk:** labeller bias (disclosed).
- **Stop:** table written.
- **OPTIONAL_METHOD_NOTE (not an acceptance criterion):** a second-rater spot check may be added to estimate labelling agreement.

#### E8 · Persistence operating-curve figure
**P0 · E · 1 h · Parallel: NO**
- **Purpose:** PPT figure (spec E-AC3).
- **Why now:** Closes E.
- **Depends on:** E6, E7.
- **Inspect:** E metrics.
- **Likely to change:** round2 harness (figures).
- **Tests first:** regenerates from metrics.
- **Task:** precision–recall operating curve with rule points and threshold-matched points; FP per 1,000 pings shown per rule.
- **Acceptance:** spec E-AC3.
- **Artifacts:** E figures.
- **Regression risk:** none.
- **Stop:** figure written.

---

## Workstream F — Raised relief (**hard stop: 7 h total across F1–F10**)

A time-box exhaustion is a recorded **failure** outcome per the spec. Shadow is then removed from the headline.

#### F1 · Correct range-axis geometry
**P0 · F · 1 h · Parallel: YES (with E1–E3)**
- **Purpose:** Columns are Slant range; the far side is away from nadir (KD-12; spec F item 1).
- **Why now:** Every F measurement depends on it.
- **Depends on:** FZ-C, H0-6.
- **Inspect:** geometry records; physics module (for the wrong-axis history only).
- **Likely to change:** round2 harness (relief); tests.
- **Tests first:** Side and far-edge selection on synthetic port and starboard boxes.
- **Task:** implement the geometry helpers.
- **Acceptance:** tests green.
- **Artifacts:** none.
- **Regression risk:** none (the production physics module is untouched).
- **Stop:** tests green.

#### F2 · Synthetic far-side shadow test
**P0 · F · 0.5 h · Parallel: YES (with F3, F9)**
- **Purpose:** The positive control for F5 (F-AC1, first part).
- **Why now:** Test-first.
- **Depends on:** F1.
- **Inspect:** —
- **Likely to change:** harness tests.
- **Tests first (the ticket):** a planted object with a far-side shadow gives Δ > 0 on the correct side for port and starboard.
- **Task:** write the test.
- **Acceptance:** red until F5.
- **Artifacts:** none.
- **Regression risk:** none.
- **Stop:** test written.

#### F3 · Range-falloff negative control test
**P0 · F · 0.5 h · Parallel: YES (with F2, F9)**
- **Purpose:** Range falloff must not look like shadow (F-AC1, second part).
- **Why now:** Test-first.
- **Depends on:** F1.
- **Requires decision:** PID-16 (tolerance for "\|Δ\| ≈ 0").
- **Inspect:** —
- **Likely to change:** harness tests.
- **Tests first (the ticket):** a range-falloff gradient with no object gives \|Δ\| within the PID-16 tolerance.
- **Task:** write the test.
- **Acceptance:** red until F4/F5.
- **Artifacts:** none.
- **Regression risk:** none.
- **Stop:** test written.

#### F4 · Range-matched background estimator
**P0 · F · 1 h · Parallel: NO**
- **Purpose:** Per-column robust background: median/MAD over rows outside the candidate (guard 10 px, extent K = max(3h, 100), masked rows excluded), or mirror-range (column 2x₀ − c) for SubPipe pipelines (spec F item 3).
- **Why now:** Needed by F5.
- **Depends on:** F1, F3.
- **Inspect:** geometry records.
- **Likely to change:** round2 harness; tests.
- **Tests first:** F3 passes for both estimators; masked rows are excluded.
- **Task:** implement both estimators.
- **Acceptance:** F3 green.
- **Artifacts:** none.
- **Regression risk:** none.
- **Stop:** tests green.

#### F5 · Raised-relief feature extractor
**P0 · F · 1 h · Parallel: NO**
- **Purpose:** The spec F item 4 features: highlight_z, far contrast, near contrast, Δ, shadow length, continuity, pairing, truncated flag, dimensionless h/H.
- **Why now:** Core of F.
- **Depends on:** F2, F4.
- **Requires decision:** PID-16 (operational definitions).
- **Inspect:** spec §5 F.
- **Likely to change:** round2 harness; tests.
- **Tests first:** F2 and F3 pass; the output schema has no populated metric-height field and never contains the word "artificial".
- **Task:** implement using the bands of spec F item 2 and the PID-16 definitions.
- **Acceptance:** spec F-AC1, F-AC4.
- **Artifacts:** none.
- **Regression risk:** none.
- **Stop:** tests green.

#### F6 · Darkness-only control
**P0 · F · 0.5 h · Parallel: YES (with F9)**
- **Purpose:** f_any = max adjacent contrast over 4 directions, to show that Δ adds more than "dark next to bright".
- **Why now:** Required comparator.
- **Depends on:** F5.
- **Requires decision:** PID-16 (band sizes).
- **Inspect:** —
- **Likely to change:** round2 harness; tests.
- **Tests first:** f_any is computed for every item.
- **Task:** implement.
- **Acceptance:** spec F-AC2.
- **Artifacts:** none.
- **Regression risk:** none.
- **Stop:** tests green.

#### F9 · PING orientation guard
**P0 · F · 0.25 h · Parallel: YES (with F2, F3, F6)**
- **Purpose:** No oriented features where the range axis is unknown (I-F1).
- **Why now:** Before any experiment run.
- **Depends on:** F1.
- **Inspect:** geometry records.
- **Likely to change:** round2 harness; tests.
- **Tests first:** any PING item → NOT_EVALUABLE_ORIENTATION; only f_any is computed.
- **Task:** implement the guard.
- **Acceptance:** spec F-AC3.
- **Artifacts:** none.
- **Regression risk:** none.
- **Stop:** tests green.

#### F7 · AI4 held-out experiment
**P0 · F · 1 h · Parallel: YES (with F8)**
- **Purpose:** Wrecks vs same-range background and vs natural relief.
- **Why now:** Primary F evidence.
- **Depends on:** F5, F6, F9, D1, H0-8.
- **Requires decision:** PID-01 (wreck objects), PID-17 (background sampling).
- **Inspect:** AI4 test waterfalls; terrain val images; detector false positives on terrain.
- **Likely to change:** round2 harness.
- **Tests first:** runner smoke test.
- **Task:** AUROC of Δ, pairing and f_any; far-vs-near Wilcoxon for wrecks and for background; wreck-site bootstrap.
- **Acceptance:** metrics per the spec F success/failure rules.
- **Artifacts:** `artifacts/round2/F/AI4/iter-1/`.
- **Regression risk:** none.
- **Stop:** metrics written, or the 7-h box is exhausted (failure outcome).

#### F8 · SubPipe held-out experiment
**P0 · F · 0.75 h · Parallel: YES (with F7)**
- **Purpose:** Pipelines vs same-range background and SubPipe false positives (mirror background).
- **Why now:** Secondary F evidence.
- **Depends on:** F5, F6.
- **Requires decision:** PID-04 (SubPipe subset), PID-17.
- **Inspect:** SubPipe test Frames per PID-04.
- **Likely to change:** round2 harness.
- **Tests first:** runner smoke test.
- **Task:** AUROC of Δ; 60-s block bootstrap.
- **Acceptance:** metrics written.
- **Artifacts:** `artifacts/round2/F/SubPipe/iter-1/`.
- **Regression risk:** none.
- **Stop:** metrics written, or the time box is exhausted (failure outcome).

#### F10 · Raised-relief verdict and figure
**P0 · F · 0.5 h · Parallel: NO**
- **Purpose:** Pass/fail per spec, plus figures.
- **Why now:** Closes F.
- **Depends on:** F7, F8.
- **Requires decision:** PID-21 (example selection).
- **Inspect:** F metrics.
- **Likely to change:** round2 harness (figures).
- **Tests first:** the panel example is chosen by the pre-declared PID-21 rule.
- **Task:** verdict file; geometry panel; Δ distributions; ROC curves.
- **Acceptance:** verdict recorded. **On failure, raised relief is removed from the headline and F stops.**
- **Artifacts:** F figures and verdict.
- **Regression risk:** cherry-picking; prevented by the declared rule.
- **Stop:** verdict written.

> ### FZ-EF: freeze
> E and F verdicts recorded (an F time-box exhaustion is a failure outcome); claim wording chosen per outcome; suites green; diff reviewed. Per spec G ("C, E and F results decide which channels exist"), record which channels G may use. No deploy.

---

## Workstream G — Contact score (fusion and calibration)

**Production is not changed until G9 passes.**

#### G1 · Fusion dataset builder
**P0 · G · 1.5 h · Parallel: NO**
- **Purpose:** Per-Observation channel table for val and test.
- **Why now:** Input to every G ticket.
- **Depends on:** FZ-EF, H0-8.
- **Requires decision:** PID-06 (TP label), PID-05 (detection floor), PID-04 (PING set).
- **Inspect:** detection cache; C, E and F outputs (channels recorded at FZ-EF).
- **Likely to change:** round2 harness (fusion); tests.
- **Tests first:**
  - Every channel has {value, availability, provenance}.
  - Labels follow the PID-06 rule.
  - SHIPWRECK and AI4 are excluded (no detector true positives), with the reason recorded.
- **Task:** build per-sensor tables (SubPipe, PING).
- **Acceptance:** tests green.
- **Artifacts:** fusion datasets under `artifacts/round2/G/`.
- **Regression risk:** none.
- **Stop:** tables written.

#### G2 · Availability-mask invariant tests
**P0 · G · 1 h · Parallel: NO**
- **Purpose:** Missing ≠ negative (I-G1), and quality is not evidence (I-G2).
- **Why now:** Test-first for G3/G4.
- **Depends on:** G1.
- **Inspect:** spec §5 G.
- **Likely to change:** harness tests.
- **Tests first (the ticket):**
  - A prediction with a channel missing equals the model restricted to the available channels (G-AC1).
  - ∂score/∂q = 0 when all available evidence values are 0 (G-AC2).
  - A metrics schema containing normalized display values is rejected (G-AC6).
- **Task:** write the tests.
- **Acceptance:** red until G3/G4.
- **Artifacts:** none.
- **Regression risk:** none.
- **Stop:** tests written.

#### G3 · Validation-only logistic fusion
**P0 · G · 1.5 h · Parallel: NO**
- **Purpose:** Replace the hand-set weights.
- **Why now:** Core of G.
- **Depends on:** G2.
- **Requires decision:** PID-18 (L2 strength selection, val only).
- **Inspect:** fusion datasets.
- **Likely to change:** round2 harness; tests.
- **Tests first:** G2 (missing-channel part) passes; fitting rejects test rows.
- **Task:** L2-regularized logistic regression with availability-masked terms, ≤ 10 parameters per sensor, fit on val (spec G item 2).
- **Acceptance:** spec G-AC1, G-AC3.
- **Artifacts:** fitted coefficients plus a manifest.
- **Regression risk:** none.
- **Stop:** tests green.

#### G4 · Quality as a reliability interaction
**P0 · G · 1 h · Parallel: YES (with G5, G6)**
- **Purpose:** Image quality modulates evidence and has no main effect (Q10).
- **Why now:** Locked decision.
- **Depends on:** G3.
- **Inspect:** the existing condition-engine quality value (the runtime's `quality_score`) in the fusion dataset.
- **Likely to change:** round2 harness; tests.
- **Tests first:** G2 (quality part) passes.
- **Task:** add q × evidence interaction terms; no q main effect.
- **Acceptance:** spec G-AC2.
- **Artifacts:** updated coefficients.
- **Regression risk:** none.
- **Stop:** tests green.

#### G5 · Platt calibration
**P0 · G · 0.5 h · Parallel: YES (with G4, G6)**
- **Purpose:** Parametric post-calibration (spec G item 3).
- **Why now:** A G7 comparator.
- **Depends on:** G3.
- **Requires decision:** PID-18 (which scores are calibrated).
- **Inspect:** fusion outputs on val.
- **Likely to change:** round2 harness; tests.
- **Tests first:** fits on val only; monotone.
- **Task:** fit Platt scaling on val for the scores named in PID-18.
- **Acceptance:** tests green.
- **Artifacts:** calibrator parameters.
- **Regression risk:** none.
- **Stop:** tests green.

#### G6 · Isotonic calibration
**P0 · G · 0.5 h · Parallel: YES (with G4, G5)**
- **Purpose:** Non-parametric post-calibration (spec G item 3).
- **Why now:** A G7 comparator.
- **Depends on:** G3.
- **Requires decision:** PID-18 (which scores are calibrated).
- **Inspect:** fusion outputs on val.
- **Likely to change:** round2 harness; tests.
- **Tests first:** fits on val only; monotone non-decreasing.
- **Task:** fit isotonic calibration on val for the scores named in PID-18.
- **Acceptance:** tests green.
- **Artifacts:** calibrator knots.
- **Regression risk:** none.
- **Stop:** tests green.

#### G7 · Held-out calibration evaluation
**P0 · G · 1.5 h · Parallel: NO**
- **Purpose:** ECE, Brier, NLL, AUROC and reliability diagrams on test (spec G item 4).
- **Why now:** Evidence for the gate.
- **Depends on:** G4, G5, G6.
- **Inspect:** calibrators; test fusion dataset.
- **Likely to change:** round2 harness.
- **Tests first:** ECE (15 equal-mass bins) on a known constructed example.
- **Task:** evaluate raw detector confidence, the current raw fused score, the fitted fusion, and its Platt and isotonic calibrations, per sensor. The display value appears only as a labelled negative control, never as a system metric. Classes with n_TP < 30 are marked INSUFFICIENT.
- **Acceptance:** spec G-AC4.
- **Artifacts:** `artifacts/round2/G/eval/iter-1/`.
- **Regression risk:** none.
- **Stop:** metrics written.

#### G8 · Bootstrap confidence intervals
**P0 · G · 1 h · Parallel: NO**
- **Purpose:** Uncertainty for the gate.
- **Why now:** Required by the gate rule.
- **Depends on:** G7.
- **Inspect:** G7 outputs.
- **Likely to change:** round2 harness.
- **Tests first:** CI method on a synthetic known distribution.
- **Task:** cluster bootstrap (B = 2,000; spec §7.3) of paired ECE and AUROC differences.
- **Acceptance:** CIs recorded.
- **Artifacts:** updated G metrics.
- **Regression risk:** none.
- **Stop:** CIs written.

#### G9 · Deployment gate verdict
**P0 · G · 0.5 h · Parallel: NO**
- **Purpose:** Decide whether the Contact score may replace the display value later.
- **Why now:** Closes G.
- **Depends on:** G8.
- **Requires decision:** PID-18 (gate granularity).
- **Inspect:** G metrics.
- **Likely to change:** round2 harness (verdict writer).
- **Tests first:** the gate logic on constructed pass and fail inputs.
- **Task:** pass only if the test ECE improvement over raw has a CI excluding 0 **and** AUROC is non-inferior (Δ ≥ −0.01), evaluated at the PID-18 granularity.
- **Acceptance:** spec G-AC5.
- **Artifacts:** gate verdict file.
- **Regression risk:** none.
- **Stop:** verdict written. **No production change happens in this ticket.**

> ### FZ-G: freeze
> Gate verdict recorded; Contact-score claim wording chosen; suites green; diff reviewed. Production integration of the Contact score (and removal of the display tests) is a **separate post-gate ticket, outside this backlog**, and only if G9 passed.

---

## Workstream H — Final runtime evaluation (end to end)

#### H1 · Held-out Upload bundle generator
**P0 · H · 1.5 h · Parallel: NO**
- **Purpose:** Real held-out bundles for the API.
- **Why now:** Input to the end-to-end run.
- **Depends on:** FZ-G.
- **Requires decision:** PID-19 (SubPipe bundles vs the upload cap).
- **Inspect:** manifest; B4 row-shift behaviour.
- **Likely to change:** round2 harness (runtime_eval).
- **Tests first:**
  - Every bundle frame is `test`.
  - SubPipe bundles are contiguous test segments (per PID-19) with no navigation, or with pixel-verified DERIVED_FROM_SOURCE ping bounds.
  - AI4: one test waterfall per bundle.
  - PING: one image per parent.
- **Task:** build bundles plus a bundle manifest.
- **Acceptance:** tests green.
- **Artifacts:** bundles under `artifacts/round2/H/bundles/iter-1/`.
- **Regression risk:** none.
- **Stop:** bundles written.

#### H2 · Synthetic-navigation rejection validator
**P0 · H · 0.5 h · Parallel: NO**
- **Purpose:** No synthetic navigation enters evaluation (spec H-AC6).
- **Why now:** Before any run.
- **Depends on:** H1.
- **Inspect:** navigation provenance (B3).
- **Likely to change:** round2 harness; tests.
- **Tests first:** a v2/v4-style mission bundle is rejected; a clean bundle passes.
- **Task:** implement the validator.
- **Acceptance:** spec H-AC6.
- **Artifacts:** validation log.
- **Regression risk:** none.
- **Stop:** all H1 bundles validated.

#### H3 · API end-to-end held-out run
**P0 · H · 2 h (mostly compute) · Parallel: NO**
- **Purpose:** Run held-out data through the actual Upload API.
- **Why now:** The only true runtime evaluation.
- **Depends on:** H2, H0-3.
- **Inspect:** runtime API (upload, job polling, survey fetch).
- **Likely to change:** round2 harness (runtime_eval).
- **Tests first:** a runner smoke test against the test client with a fake detector.
- **Task:** upload every bundle with recovery off and runtime defaults otherwise; retain job logs and survey JSON.
- **Acceptance:** spec H-AC1, H-AC2.
- **Artifacts:** run outputs plus a configuration snapshot.
- **Regression risk:** runtime state pollution; use an isolated runtime directory.
- **Stop:** all bundles COMPLETED, or failures recorded.

#### H4 · Observation-level metrics
**P0 · H · 1 h · Parallel: YES (with H5, H6, H7, H8)**
- **Purpose:** Precision and recall per sensor, runtime path end to end.
- **Why now:** Closes KD-15.
- **Depends on:** H3.
- **Requires decision:** PID-06.
- **Inspect:** H3 outputs.
- **Likely to change:** round2 harness.
- **Tests first:** reuses the PID-06 matching tests.
- **Task:** P/R at IoU 0.5 and 0.3 with CIs, next to the training-representation metrics (both labelled).
- **Acceptance:** spec H-AC3.
- **Artifacts:** H metrics.
- **Regression risk:** none.
- **Stop:** metrics written.

#### H5 · Contact merge and split metrics
**P0 · H · 1 h · Parallel: YES (with H4, H6, H7, H8)**
- **Purpose:** Verify Contact correctness on held-out data.
- **Why now:** Regression check of A.
- **Depends on:** H3.
- **Requires decision:** PID-06 (Observation-to-GT assignment).
- **Inspect:** H3 Contacts; GT objects.
- **Likely to change:** round2 harness; tests.
- **Tests first:** merge and split counting on constructed Contacts.
- **Task:** merge rate (Contacts containing more than one GT object) and split rate (GT objects spread over several Contacts), per sensor.
- **Acceptance:** spec H-AC4 (same-Frame distinct-object merge rate = 0).
- **Artifacts:** H metrics.
- **Regression risk:** none.
- **Stop:** metrics written.

#### H6 · False alarms per 1,000 pings
**P0 · H · 0.5 h · Parallel: YES (with H4, H5, H7, H8)**
- **Purpose:** The operator metric where distance is unknown (Q7).
- **Why now:** Required SubPipe metric.
- **Depends on:** H3.
- **Requires decision:** PID-20 (counting with overlapping frames).
- **Inspect:** H3 SubPipe outputs.
- **Likely to change:** round2 harness.
- **Tests first:** counting follows the PID-20 rule; no per-km field exists.
- **Task:** compute with CIs.
- **Acceptance:** metric written.
- **Artifacts:** H metrics.
- **Regression risk:** none.
- **Stop:** metric written.

#### H7 · MPS latency
**P0 · H · 1 h · Parallel: YES (with H4, H5, H6, H8)**
- **Purpose:** Measured local workstation performance (Q11).
- **Why now:** Required by spec H item 3.
- **Depends on:** H3.
- **Inspect:** job timings.
- **Likely to change:** round2 harness.
- **Tests first:** the timing harness records device, OS and library versions.
- **Task:** latency per Frame and the full-survey processing ratio (survey duration ÷ end-to-end processing time, per EVALUATION_PROTOCOL), with recovery on vs off, on Apple MPS. Descriptive summary statistics (e.g. median and tail) are reported; no pass/fail threshold.
- **Acceptance:** spec H-AC5 (MPS row).
- **Artifacts:** latency table.
- **Regression risk:** none.
- **Stop:** table written.

#### H8 · CPU latency
**P0 · H · 1 h · Parallel: YES (with H4, H5, H6, H7)**
- **Purpose:** Named-device CPU measurement required by spec H item 3.
- **Why now:** Required spec output.
- **Depends on:** H3.
- **Inspect:** job timings.
- **Likely to change:** round2 harness.
- **Tests first:** same as H7.
- **Task:** same measurements with the device forced to CPU.
- **Acceptance:** spec H-AC5 (CPU row).
- **Artifacts:** latency table.
- **Regression risk:** none.
- **Stop:** table written.

#### H9 · Runtime artifact snapshot
**P0 · H · 0.5 h · Parallel: NO**
- **Purpose:** One immutable record of the end-to-end evaluation.
- **Why now:** Closes H.
- **Depends on:** H4, H5, H6, H7, H8.
- **Inspect:** H outputs.
- **Likely to change:** round2 harness (artifacts).
- **Tests first:** the snapshot contains the configuration, detector SHA, bundle hashes and every metrics file.
- **Task:** write the snapshot.
- **Acceptance:** spec H-AC1–H-AC6 are all traceable.
- **Artifacts:** `artifacts/round2/H/snapshot/iter-1/`.
- **Regression risk:** none.
- **Stop:** snapshot written.

> ### FZ-H: freeze
> End-to-end results recorded; runtime claim wording chosen; suites green; diff reviewed. No deploy.

---

## Workstream I — Evidence artifacts

#### I1 · Artifact directory and schema layout
**P0 · I · 1 h · Parallel: NO**
- **Purpose:** One structure for every artifact.
- **Why now:** Everything later validates against it.
- **Depends on:** FZ-H.
- **Inspect:** all artifacts written since H0.
- **Likely to change:** round2 harness (artifacts); tests.
- **Tests first:** the layout validator accepts every existing artifact directory and rejects malformed ones.
- **Task:** formalize the directory layout and iteration rules per spec §10.
- **Acceptance:** all existing artifacts pass, or are listed for repair.
- **Artifacts:** a validation report.
- **Regression risk:** earlier artifacts need small repairs (recorded, not silently changed).
- **Stop:** report shows zero failures.

#### I2 · metrics.json schema
**P0 · I · 0.5 h · Parallel: YES (with I3, I4, I5, I7)**
- **Purpose:** Machine-checkable metrics (spec §6 fields).
- **Why now:** The ledger and figures depend on it.
- **Depends on:** I1.
- **Inspect:** spec §6.
- **Likely to change:** round2 harness; tests.
- **Tests first:** the schema enforces the spec §6 fields and rejects normalized display values (G-AC6).
- **Task:** schema plus a validator run over all artifacts.
- **Acceptance:** spec I-AC1.
- **Artifacts:** the schema file.
- **Regression risk:** none.
- **Stop:** all metrics validate.

#### I3 · manifest.json schema
**P0 · I · 0.5 h · Parallel: YES (with I2, I4, I5, I7)**
- **Purpose:** Provenance for every run.
- **Why now:** Needed by the ledger.
- **Depends on:** I1.
- **Inspect:** spec §6.
- **Likely to change:** round2 harness; tests.
- **Tests first:** the schema requires the spec §6 artifact-manifest fields (git SHA plus dirty flag, detector SHA, corpus snapshot id, splits, seeds, device, runtime configuration, preregistration hash, iteration number, command, timestamps).
- **Task:** schema plus a validator.
- **Acceptance:** all manifests validate.
- **Artifacts:** the schema file.
- **Regression risk:** none.
- **Stop:** all manifests validate.

#### I4 · preregistration.json schema
**P0 · I · 0.5 h · Parallel: YES (with I2, I3, I5, I7)**
- **Purpose:** Validate the C, E, F and G pre-registrations (spec I).
- **Why now:** The ledger must show pre-registration integrity.
- **Depends on:** I1.
- **Inspect:** C10 and the other pre-registrations.
- **Likely to change:** round2 harness; tests.
- **Tests first:** hash verification; the iteration counter is consistent with the run history.
- **Task:** schema plus a validator.
- **Acceptance:** all pre-registrations validate.
- **Artifacts:** the schema file.
- **Regression risk:** none.
- **Stop:** all validate.

#### I5 · hashes.json
**P0 · I · 0.5 h · Parallel: YES (with I2, I3, I4, I7)**
- **Purpose:** Tamper-evidence for every artifact file.
- **Why now:** Needed by the ledger.
- **Depends on:** I1.
- **Inspect:** artifact store.
- **Likely to change:** round2 harness; tests.
- **Tests first:** modifying any file breaks verification.
- **Task:** generate and verify hashes.
- **Acceptance:** all artifacts are hashed and verified.
- **Artifacts:** hashes per directory.
- **Regression risk:** none.
- **Stop:** verification passes.

#### I6 · Figure reproducibility test
**P0 · I · 1 h · Parallel: NO**
- **Purpose:** Figures cannot diverge from numbers.
- **Why now:** The PPT uses figures.
- **Depends on:** I2.
- **Inspect:** all figure generators.
- **Likely to change:** round2 harness; tests.
- **Tests first:** regenerating every figure from stored metrics gives identical files.
- **Task:** a reproducibility runner.
- **Acceptance:** spec I-AC2.
- **Artifacts:** a reproducibility report.
- **Regression risk:** none.
- **Stop:** all figures reproduce.

#### I7 · Failure-case index
**P0 · I · 1 h · Parallel: YES (with I2, I3, I4, I5)**
- **Purpose:** Failure cases are visible and navigable (spec I-AC4).
- **Why now:** Required spec output.
- **Depends on:** I1.
- **Inspect:** failure-case directories.
- **Likely to change:** round2 harness.
- **Tests first:** the index lists every experiment's failure cases.
- **Task:** build the index.
- **Acceptance:** spec I-AC4.
- **Artifacts:** the index file.
- **Regression risk:** none.
- **Stop:** index written.

#### I8 · Claims ledger generator
**P0 · I · 1.5 h · Parallel: NO**
- **Purpose:** The only route from artifact to PPT.
- **Why now:** Required before J and the PPT.
- **Depends on:** I2, I3, I4, I5, I6.
- **Inspect:** spec §11 claim contract; all verdicts.
- **Likely to change:** round2 harness (ledger); a new Round-2 evidence ledger document.
- **Tests first:**
  - Each ledger row requires an artifact path, hash, command and outcome wording.
  - The spec §11 forbidden phrases are rejected.
- **Task:** generate the ledger from verdicts, choosing the pass or fail wording automatically.
- **Acceptance:** spec I-AC3.
- **Artifacts:** the evidence ledger.
- **Regression risk:** none.
- **Stop:** ledger complete; forbidden-phrase check passes.

---

## Workstream J — Demo evidence hygiene

#### J1 · Remove synthetic Epitome from judge-facing defaults
**P0 · J · 1 h · Parallel: YES (with J2)**
- **Purpose:** The synthetic bundle never appears as real evidence (spec J item 1).
- **Why now:** Before any demo preparation.
- **Depends on:** I8.
- **Inspect:** health-check and demo scripts (default bundle paths); runbook; README current-demo section; freeze document.
- **Likely to change:** those scripts' defaults and those documents.
- **Tests first:** the health-check script, with no bundle argument, does not default to a synthetic bundle (a script-level test or dry-run assertion).
- **Task:** remove synthetic-bundle defaults (explicit argument only until J4 produces the held-out bundle); remove text presenting synthetic bundles as real.
- **Acceptance:** spec J-AC2 (script and named-document part).
- **Artifacts:** none.
- **Regression risk:** the operator muscle-memory command changes; documented in the runbook.
- **Stop:** scripts and docs updated.

#### J2 · Held-out-only demo candidate selector
**P0 · J · 1 h · Parallel: YES (with J1)**
- **Purpose:** Select demo frames from `test` only, by a declared rule (spec J items 2, 4).
- **Why now:** Replaces the v4 training-split demo.
- **Depends on:** I8, H1.
- **Requires decision:** PID-21.
- **Inspect:** manifest; H results.
- **Likely to change:** round2 harness (demo).
- **Tests first:**
  - Every selected frame is `test`.
  - The selection follows the pre-declared PID-21 rule and never a target confidence distribution.
  - The selection is deterministic.
- **Task:** implement the selector.
- **Acceptance:** tests green.
- **Artifacts:** a selection manifest.
- **Regression risk:** none.
- **Stop:** selection written.

#### J3 · Per-frame split provenance
**P0 · J · 0.5 h · Parallel: NO**
- **Purpose:** Every demo frame carries its detector split and SHA-256 (spec J item 2).
- **Why now:** Fixes the v4 report error class (KD-18).
- **Depends on:** J2.
- **Inspect:** corpus metadata.
- **Likely to change:** round2 harness (demo).
- **Tests first:** the split is looked up in corpus metadata, never inferred from source folder names (a test uses a Rec9-style case).
- **Task:** write the provenance file into the bundle.
- **Acceptance:** tests green.
- **Artifacts:** provenance inside the bundle.
- **Regression risk:** none.
- **Stop:** provenance written.

#### J4 · Held-out demo bundle validator
**P0 · J · 0.5 h · Parallel: NO**
- **Purpose:** Reject any demo bundle that violates spec J-AC1.
- **Why now:** Gate before demo use.
- **Depends on:** J3, H2.
- **Inspect:** H2 validator.
- **Likely to change:** round2 harness (demo); tests.
- **Tests first:** it rejects any non-`test` frame, any SYNTHETIC_DEMO navigation, and any frame lacking split provenance.
- **Task:** build the validator and the final bundle.
- **Acceptance:** spec J-AC1.
- **Artifacts:** the validated demo bundle.
- **Regression risk:** none.
- **Stop:** the bundle validates.

#### J5 · Demo Contact invariant check
**P0 · J · 0.5 h · Parallel: NO**
- **Purpose:** The demo run satisfies the A invariants (spec J-AC3).
- **Why now:** The last check before the PPT.
- **Depends on:** J4, A7.
- **Inspect:** the demo upload output.
- **Likely to change:** round2 harness (demo).
- **Tests first:** the invariant checker on constructed Contacts (reuses the A tests' logic).
- **Task:** upload the bundle (isolated runtime directory) and check the A invariants (I-A1–I-A6).
- **Acceptance:** spec J-AC3.
- **Artifacts:** a check report.
- **Regression risk:** none.
- **Stop:** report shows zero violations.

#### J6 · Judge-facing docs audit
**P0 · J · 1 h · Parallel: NO**
- **Purpose:** No judge-facing document references synthetic bundles as real (J-AC2) or contains a spec §11 forbidden claim (DoD 5).
- **Why now:** Before the PPT.
- **Depends on:** J1, I8.
- **Inspect:** README, runbook, freeze document, and every other judge-facing document.
- **Likely to change:** those documents (text only; UI copy changes are out of scope and are listed for a later ticket instead).
- **Tests first:** the ledger's forbidden-phrase check run over these documents.
- **Task:** remove synthetic-as-real references and forbidden claims, including the macro-precision headline (spec §11).
- **Acceptance:** spec J-AC2; the forbidden-phrase check passes.
- **Artifacts:** an audit report.
- **Regression risk:** none.
- **Stop:** check passes.

---

## PPT

#### PPT-1 · Assemble Round-2 evidence slides from the ledger
**P0 · PPT · 3 h · Parallel: NO**
- **Purpose:** Slides that say only what the evidence supports.
- **Why now:** Final.
- **Depends on:** J5, J6.
- **Inspect:** evidence ledger; figures.
- **Likely to change:** presentation files (outside the code base).
- **Tests first:** every number on a slide maps to a ledger row (a manual checklist generated from the ledger).
- **Task:** build the slides using only ledger rows and their pass or fail wording.
- **Acceptance:** spec §11 contract satisfied; no forbidden claims.
- **Artifacts:** the slide deck plus a numbers checklist.
- **Regression risk:** none.
- **Stop:** checklist 100 % mapped.

---

## Summary tables

**Counts:** 97 tickets plus 6 freeze checkpoints; 24 pre-implementation decisions.
- **P0 (96):** all tickets except C19.
- **P1 (1):** C19.
- **P2 (0).**

**Critical path:**
A1 → A2 → A3 → A4 → A7 (with B1 → B4 → B6) → H0-3 → H0-4 → H0-8 → **FZ-H0** → D1 → D4/D5 → D6 → **FZ-D** → C1 → C2 → C5 → C6 → C8/C9 → C10 → C11 → C12–C15 → C16 → C17 → **FZ-C** → (E ∥ F) → **FZ-EF** → G1 → G2 → G3 → G4 → G7 → G8 → G9 → **FZ-G** → H1 → H2 → H3 → H4–H8 → H9 → **FZ-H** → I1 → I2 → I6 → I8 → J2 → J3 → J4 → J5 → J6 → PPT-1

PIDs lie on the critical path wherever a critical ticket lists them. Resolving all 24 early removes that blocking.

**Parallelizable work:**
- A-family ∥ B-family (A3 needs A2; A7 joins both).
- H0-1/H0-2/H0-6/H0-7 ∥ H0-3/H0-4/H0-5.
- D2 ∥ D3 ∥ D4 ∥ D5.
- C2/C3/C5 ∥ C4; C7 ∥ C8 ∥ C9; C12 ∥ C13 ∥ C14 ∥ C15; C17 ∥ C18 ∥ C19.
- E ∥ F throughout.
- G4 ∥ G5 ∥ G6.
- H4 ∥ H5 ∥ H6 ∥ H7 ∥ H8.
- I2 ∥ I3 ∥ I4 ∥ I5 ∥ I7.
- J1 ∥ J2.
- Resolving PIDs can run in parallel with A/B.

**Technically independent, but held back by the mandated order:** H0-1, H0-2, H0-3 and C1 could start before their freezes with a second engineer. Scheduling them early requires relaxing the dependency order.

---

## Appendix — Spec-drift audit log (2026-09-26)

**Authority used:** `ROUND2_HARDENING_SPEC.md` (with its locked decisions), `CONTEXT.md`, and existing repository product contracts (e.g. `VNEXT_FINAL_PRODUCT_CONTRACT.md` null convention; `EVALUATION_PROTOCOL.md` processing-ratio definition). The research plan and novelty document are **not** treated as locked protocol.

### A. Drifts found and corrected

| # | Ticket | Addition found in draft v1 | Classification | Action |
|---|---|---|---|---|
| 1 | A1 | Expected current pass for reversed upload order | SPEC_DRIFT_REMOVE | Record current result from execution |
| 2 | A1 | Expected current pass for the tile-duplicate guard | SPEC_DRIFT_REMOVE | Record current result from execution |
| 3 | A3 | Interim rule omitted spec condition "non-synthetic provenance" (reduction) | SPEC_DRIFT_REMOVE | Condition restored at the association seam; absent provenance does not establish it, so the API path yields no cross-Frame association until B3. No dependency edge changed |
| 4 | A3 | Range-position match applied to overlapping-ping pairs | SPEC_DRIFT_REMOVE | Overlapping pings use mapped-box overlap (spec A req 2a); range match only for contiguous (2b) |
| 5 | A4 | SAME_LOOK assigned without the mapped-box-overlap condition (reduction) | SPEC_DRIFT_REMOVE | Condition restored (A-AC5) |
| 6 | A6 | v3 records added to the audit | SPEC_DRIFT_REMOVE | v4 only (A-AC8) |
| 7 | A7 | UNDECLARED provenance value | SPEC_DRIFT_REMOVE | Missing provenance is null, non-verifying |
| 8 | A7 | SAME_LOOK for VERIFIED frames without box overlap (reduction) | SPEC_DRIFT_REMOVE | Condition restored |
| 9 | B1 | DECLARED membership rule (spec B 3a) not covered by any ticket (reduction) | SPEC_DRIFT_REMOVE | Added to B1 |
| 10 | B3 | New enum value UNDECLARED | SPEC_DRIFT_REMOVE | Spec values only, plus null |
| 11 | B4 | "< 1 s per 5000×500 pair" acceptance threshold | SPEC_DRIFT_REMOVE | Recorded as a measurement only |
| 12 | B4 | Real SubPipe three-frame check of B-AC3 omitted (reduction) | SPEC_DRIFT_REMOVE | Restored as a recorded verification log |
| 13 | H0-1 | AI4 merged regions: 15-px closing, area ≥ 1,024 px | SPEC_DRIFT_REMOVE | → PID-01 |
| 14 | H0-1 | SubPipe segments split at gaps > 2 s | SPEC_DRIFT_REMOVE | Segments = pixel-verified row-shift chains (spec B 3b) |
| 15 | H0-5 | Feature cache narrowed to 25-s-spaced SubPipe + "frames required by C" | SPEC_DRIFT_REMOVE | 100 % of manifest val/test images |
| 16 | H0-5 | fp16 cache (lossy; can reorder near-ties) | SPEC_DRIFT_REMOVE | No lossy conversion |
| 17 | H0-6 | Window-slope seabed-pick method | SPEC_DRIFT_REMOVE | → PID-02 |
| 18 | H0-6 | ±2 px synthetic tolerance | SPEC_DRIFT_REMOVE | → PID-02 |
| 19 | H0-7 | Lexicographically-first sibling rule | SPEC_DRIFT_REMOVE | → PID-03 |
| 20 | H0-7 | All-variants sensitivity analysis | SPEC_DRIFT_REMOVE | Removed (scope) |
| 21 | H0-8 | Sweep floor 0.05 | SPEC_DRIFT_REMOVE | → PID-05 |
| 22 | H0-8 | Greedy score-ordered matching | SPEC_DRIFT_REMOVE | → PID-06 |
| 23 | D1 | ≥ 2,000 windows per sensor | SPEC_DRIFT_REMOVE | → PID-07 |
| 24 | D1 | Two-sample test p > 0.05 as acceptance | SPEC_DRIFT_REMOVE | Removed |
| 25 | D1 | Window sizes matched to the object-window distribution | SPEC_DRIFT_REMOVE | Spec requirement kept (size-matched across sensors); rest → PID-07 |
| 26 | D1 | SubPipe 25-s frames / PING one-per-parent as D subsets | SPEC_DRIFT_REMOVE | → PID-04 |
| 27 | C7 | B3 memory "linspace-sampled" | SPEC_DRIFT_REMOVE | → PID-10 |
| 28 | C8 | B4 statistic "window mean intensity" | SPEC_DRIFT_REMOVE | → PID-11 |
| 29 | C12 | AUROC and AUPRC added to the H2 experiment | SPEC_DRIFT_REMOVE | Removed (scope; not in C-AC6) |
| 30 | C15 | Proposal hit = ≥ 25 % overlap with a GT mask | SPEC_DRIFT_REMOVE | → PID-13 |
| 31 | C15 | Evidence-channel use as "filter by p ≤ α" | SPEC_DRIFT_REMOVE | → PID-13 |
| 32 | C15 | "False flags per image" metric | SPEC_DRIFT_REMOVE | Removed; H5 metrics per PID-13 |
| 33 | C15 | Priority P1 although C-AC6 requires an H5 verdict | SPEC_DRIFT_REMOVE | → P0 |
| 34 | C19 | Example selection rule "median-recall wreck" | SPEC_DRIFT_REMOVE | → PID-21 |
| 35 | C19 | p-value map at α = 0.01 while H5 is defined at BH q = 0.1 | SPEC_DRIFT_REMOVE | Shows the BH q = 0.1 flags and the continuous p-map |
| 36 | FZ-C | Optional "decide whether E and F run" | SPEC_DRIFT_REMOVE | Removed (spec DoD 3 requires E and F outcomes) |
| 37 | E1–E8 | Priorities P1/P2 (allowing skip) | SPEC_DRIFT_REMOVE | → P0 (DoD 3; E items 2 and 6 require E3 and E7) |
| 38 | E2 | Segments split at gaps > 2 s | SPEC_DRIFT_REMOVE | VERIFIED Survey segments |
| 39 | E3 | Residual rejection at median > 10 px | SPEC_DRIFT_REMOVE | → PID-15 |
| 40 | E4 | Detection cache "(0.05 floor)" | SPEC_DRIFT_REMOVE | → PID-05 |
| 41 | E7 | Stratified sampling | SPEC_DRIFT_REMOVE | Simple random sample of 100 (spec E item 6) |
| 42 | E7 | 20 % second-rater spot check in acceptance | OPTIONAL_METHOD_NOTE | Removed from acceptance; retained as an optional note |
| 43 | F1–F10 | Priority P1 (allowing skip) | SPEC_DRIFT_REMOVE | → P0; time-box exhaustion = recorded failure |
| 44 | F8 | 25-s-spaced SubPipe subset | SPEC_DRIFT_REMOVE | → PID-04 |
| 45 | FZ-EF | "Recorded skip decisions" | SPEC_DRIFT_REMOVE | Removed |
| 46 | C15, C16, E8, H9, critical path | Skip language: C15 "if skipped, no recovery claim"; C16 "(and C15 if run)"; E8 "(E7 optional)"; H9 "(H8 if run)"; critical path "(E/F or recorded skip)" | SPEC_DRIFT_REMOVE | Removed. The existing edges C15→C16, E7→E8 and H8→H9 are now unconditional; no edge added or removed |
| 47 | G1 | TP labels "from IoU-0.5 matching" | SPEC_DRIFT_REMOVE | → PID-06 |
| 48 | G5/G6 | Calibrating raw detector confidence as an extra comparator | SPEC_DRIFT_REMOVE | → PID-18 |
| 49 | G9 | Gate evaluated "per sensor" | SPEC_DRIFT_REMOVE | → PID-18 (granularity) |
| 50 | H8 | Priority P1 although spec H item 3 requires CPU latency | SPEC_DRIFT_REMOVE | → P0 |
| 51 | I7 | Priority P1 although I-AC4 requires the index | SPEC_DRIFT_REMOVE | → P0 |
| 52 | J2 | Example rule "stratified by sensor and by outcome" | SPEC_DRIFT_REMOVE | → PID-21 |
| 53 | J4 | Rejects duplicate rasters (not in J-AC1) | SPEC_DRIFT_REMOVE | Removed (scope) |
| 54 | J5 | Duplicate-raster flag check (not in J-AC3) | SPEC_DRIFT_REMOVE | Removed (scope) |
| 55 | J6 | "Correct statuses" in claims and status documents | SPEC_DRIFT_REMOVE | Removed (scope); J-AC2 + DoD 5 only |
| 56 | Preamble | "Skipped P1/P2 tickets" rule | SPEC_DRIFT_REMOVE | Replaced by the DoD-based priority rule |
| 57 | B3, A7 | DERIVED_FROM_SOURCE ping bounds allowed to support ping relationships without pixel verification | SPEC_DRIFT_REMOVE | MEASURED, or DERIVED_FROM_SOURCE with pixel verification (spec B rule 3b; H item 1) |
| 58 | B1, B6 | Invented field name `survey_ref` (spec §6 says `survey_id`, which collides with the legacy Upload identifier kept by spec B item 1) | REQUIRES_PREIMPLEMENTATION_DECISION | → PID-22 |
| 59 | H0-6 | "Low-confidence pick → UNAVAILABLE" with no threshold | REQUIRES_PREIMPLEMENTATION_DECISION | → PID-02 |
| 60 | H6 | Counting rule "pings counted once per disjoint coverage" | REQUIRES_PREIMPLEMENTATION_DECISION | → PID-20 |
| 61 | I3 | Manifest schema listed only part of the spec §6 artifact-manifest fields (reduction) | SPEC_DRIFT_REMOVE | All spec §6 fields required |
| 62 | I7 | "with their selection rules" added to the failure-case index test | SPEC_DRIFT_REMOVE | Removed (scope; I-AC4 requires the index only) |
| 63 | J1 | "Label synthetic fixtures as test fixtures" | SPEC_DRIFT_REMOVE | Removed (scope; J item 1 requires removal from defaults and documents) |
| 64 | J5 | Checked only I-A1 and I-A2 while J-AC3 requires the A invariants (reduction) | SPEC_DRIFT_REMOVE | Checks I-A1–I-A6 |

**Dependency edges:** unchanged from draft v1. Row 46 makes three existing conditional edges unconditional; no edge was added or removed. Effort estimates are unchanged.

### B. Spec gaps surfaced as decisions (not invented values)

These are PID-08, 09, 12, 13 (pass criterion and definitions), 14, 16, 17, 18 (L2 selection), 19, 20, 22, 23 and 24. Each is a parameter or definition the spec requires implicitly but does not fix, and which can change a result or an acceptance outcome.

### C. Checked and kept

| Ticket | Item | Classification |
|---|---|---|
| A2 | IoU ≥ 0.30 or centre-inside; both tiled; different tiles; no other same-Frame gate | SUPPORTED_BY_SPEC (A req 1) |
| A2 | Untiled / unknown mode ⇒ not a duplicate | SUPPORTED_BY_SPEC (A req 1, derived) |
| A1 | CASE 1–3 current results | SUPPORTED_BY_EXISTING_AUTHORITATIVE_DOC (executed reproduction, research plan Part E) |
| A1 | Expected-failure markers | IMPLEMENTATION_DETAIL_WITHOUT_SCIENTIFIC_EFFECT |
| A4 | Basis enum values; Look-based persistence type | SUPPORTED_BY_SPEC (A req 5; Q8) |
| A5 | Review history also isolated | SUPPORTED_BY_SPEC (A req 6) |
| B1 | Geometry signature; SINGLETON default; stored-record default | SUPPORTED_BY_SPEC (B req 4; migration risk) |
| B1 | DECLARED declaration format | IMPLEMENTATION_DETAIL_WITHOUT_SCIENTIFIC_EFFECT (DECLARED never enables persistence) |
| B2 | SHA-256 duplicates share one Look | SUPPORTED_BY_SPEC (B req 5; I-B4) |
| B3 | Existing synthetic labels in v2/v4 mission metadata → SYNTHETIC_DEMO | SUPPORTED_BY_EXISTING_AUTHORITATIVE_DOC (bundle provenance docs) |
| B3 | Null for undeclared provenance | SUPPORTED_BY_EXISTING_AUTHORITATIVE_DOC (product contract null convention) |
| B4 | Row hashing with full pixel confirmation | IMPLEMENTATION_DETAIL_WITHOUT_SCIENTIFIC_EFFECT |
| H0-1 | SubPipe Survey id = pixel-verified row-shift chains | SUPPORTED_BY_SPEC (H0 item 1 "contiguous time segments"; B rule 3b; E item 1 "VERIFIED Survey segment") |
| H0-1 | Bootstrap groups (60-s, recording/contact, wreck site) | SUPPORTED_BY_SPEC (§7.3) |
| H0-1 | 60-s block alignment | IMPLEMENTATION_DETAIL_WITHOUT_SCIENTIFIC_EFFECT |
| H0-2 | Sibling-across-split and fit-on-test guards | SUPPORTED_BY_SPEC (§7.1; I-H0-1; no-leakage rule) |
| H0-3 | Production default unchanged; fail loudly on bad configuration | SUPPORTED_BY_SPEC / IMPLEMENTATION_DETAIL |
| H0-4 | Declared floor override for sweeps | SUPPORTED_BY_SPEC (H0 item 3) |
| H0-5 | 20×20 cells, L2-normalized; forward-pass counter | SUPPORTED_BY_SPEC (C item 1; H0 item 4) |
| H0-5 | Cache covers all manifest val/test images | SUPPORTED_BY_SPEC (H0 items 3–4: embeddings from the val/test runtime pass) |
| J6 | Macro-precision headline removed from judge-facing docs | SUPPORTED_BY_SPEC (§11 forbidden list; DoD 5) |
| F7 | D1 dependency retained | Unchanged from draft v1 (dependency order preserved) |
| H0-6 | Nadir ±5 % of centre, fallback centre | SUPPORTED_BY_SPEC (F item 1) |
| D2 | Synthetic code-sanity probe tests | IMPLEMENTATION_DETAIL_WITHOUT_SCIENTIFIC_EFFECT |
| D1 | Fixed seed | IMPLEMENTATION_DETAIL_WITHOUT_SCIENTIFIC_EFFECT |
| C1–C16 | All numeric parameters (1,000 simulations, KS p > 0.01, k = 3, Δr, g_p, G_p, 2-cell blocks, top 2 %, α set, q = 0.1, 3 × 3 proposals, B = 2,000, Holm, Clopper–Pearson) | SUPPORTED_BY_SPEC |
| C11 | Lacunarity diagnostic reported | SUPPORTED_BY_SPEC (C assumptions); definition → PID-14 |
| E1–E6 | 25 ± 0.5 s; φ = 0…24; max(0.25·w, 20 px); m ∈ {1,2,3}; threshold-matched baseline; 60-s blocks; success/failure | SUPPORTED_BY_SPEC |
| E8 | FP per 1,000 pings displayed per rule | IMPLEMENTATION_DETAIL_WITHOUT_SCIENTIFIC_EFFECT |
| F4 | Guard 10 px; K = max(3h, 100); mirror background | SUPPORTED_BY_SPEC (F item 3) |
| F7/F8 | AUROC ≥ 0.75 / ≥ 0.70; CI low ≥ 0.65; f_any + 0.05; Wilcoxon p < 0.01 | SUPPORTED_BY_SPEC |
| G3–G9 | ≤ 10 parameters; 15 equal-mass bins; n_TP < 30; ECE CI excludes 0; AUROC Δ ≥ −0.01 | SUPPORTED_BY_SPEC |
| G4 | q = the runtime condition-engine quality value | SUPPORTED_BY_EXISTING_AUTHORITATIVE_DOC (runtime Contact field) |
| H7/H8 | Processing ratio definition | SUPPORTED_BY_EXISTING_AUTHORITATIVE_DOC (`EVALUATION_PROTOCOL.md`) |
| H7 | Descriptive latency summaries | IMPLEMENTATION_DETAIL_WITHOUT_SCIENTIFIC_EFFECT (no gate) |
| I1–I8 | Schemas and ledger per spec §6, §10, §11 | SUPPORTED_BY_SPEC |
