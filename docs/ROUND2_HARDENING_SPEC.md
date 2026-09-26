# Aqualens — Round-2 Technical Hardening Specification

**Status:** authoritative for Round-2 engineering and research work. Nothing is implemented yet.
**Supersedes, where they conflict:** the sprint ordering in `ROUND2_RESEARCH_AND_EXPERIMENT_PLAN.md` and the candidate list in `ROUND2_TECHNICAL_NOVELTY.md`. Those documents remain the evidence base.
**Vocabulary:** `CONTEXT.md` (Upload, Survey, Look, Observation, Contact, Persistence, Local Anomaly, Comparable seabed, Raised-relief evidence, Missing evidence, Contact score, Analyst verdict, Failed class).
**Date:** 2026-09-26
**Erratum E-1 (PID-23, locked with A7):** where this specification or the ticket backlog implies otherwise, navigation provenance means:
- **MEASURED** is an Upload's declaration. It is stored and reported, but it does not establish VERIFIED Survey membership, a ping relationship, cross-Frame association, independent Looks or persistence until an explicit MEASURED verification procedure is specified and implemented.
- **DERIVED_FROM_SOURCE** is assigned only by Aqualens when B4 row-shift verification succeeds; an Upload that declares it is rejected. It is currently the only provenance that makes Frames eligible for cross-Frame relationships (A7, within one VERIFIED Survey).
- **DECLARED** Survey membership groups Frames only and is never evidence by itself. **SYNTHETIC_DEMO** is never scientific evidence. Undeclared provenance is **null** and is never relationship evidence.

Affected clauses, each marked "Erratum E-1": §5 A interim rule; §5 B rules 3(b) and 6.

Modules are named by their Python module or product surface, not by file path or line number. Line-level evidence for every defect is in the audit and the plan.

---

## 1. Scope

### 1.1 Problem statement
Aqualens will be examined in Round 2 by sonar scientists. The current system:
- presents unvalidated evidence as if validated;
- merges distinct objects into one Contact;
- treats unrelated rasters as one Survey;
- displays a 70–90 % "confidence" unrelated to correctness;
- runs a demo heuristic inside the inference path;
- has no measurement of its class–sensor confound.

A single hostile question on any of these can sink the submission. Its most promising research idea, survey-referenced local anomaly testing, has not been built or measured.

### 1.2 Solution
Harden correctness first (Contact, Survey), then build one shared held-out harness that runs the **actual runtime path**. Use it to:
1. measure the class–sensor confound;
2. test the one provisional novelty (survey-referenced, range-matched local anomaly significance);
3. validate persistence and raised-relief evidence only where physics allows;
4. replace hand-set fusion with a validation-fitted, availability-masked Contact score.

Every Round-2 claim must trace to a machine-readable artifact. Failed experiments are reported as failures.

### 1.3 User stories

1. As a sonar analyst, I want each Contact to represent one physical-object hypothesis, so that my verdict on it never applies to a different object.
2. As a sonar analyst, I want two crab pots in one frame to appear as two Contacts, so that I review each.
3. As a sonar analyst, I want overlapping inference windows of the same object merged into one Contact, so that tiling does not create duplicates.
4. As a sonar analyst, I want association across frames only within one Survey, so that unrelated recordings are never joined.
5. As a sonar analyst, I want upload order never to create association or persistence, so that renaming files cannot change results.
6. As a sonar analyst, I want byte-identical rasters in one Upload flagged, so that a duplicated file never counts as re-observation.
7. As a sonar analyst, I want to see which evidence channels are missing for a Contact, so that I know what was not assessed.
8. As a sonar analyst, I want missing evidence to neither raise nor lower a Contact score, so that unassessed Contacts are not silently demoted.
9. As a sonar analyst, I want the raw detector confidence shown separately from any fused score, so that I can judge the model directly.
10. As a sonar analyst, I want a Local Anomaly significance with its reference size, so that I know how strong the comparison was.
11. As a sonar analyst, I want Local Anomaly to be called a local anomaly, never an artificial object, so that I remain the one who decides "man-made".
12. As a sonar analyst, I want raised-relief evidence described as relief, never as artificiality, so that rocks are not presented as debris.
13. As a mission supervisor, I want to set the false-alarm level for Local Anomaly flags, so that analyst workload is predictable.
14. As a mission supervisor, I want a triage mode that bounds the expected fraction of seabed among flagged candidates, so that review time is controlled.
15. As a mission supervisor, I want the deployment claim to be "local offline workstation inference", so that no one assumes validated onboard operation.
16. As an NIOT evaluator, I want per-class results labelled as per-sensor results, so that I am not misled about generalization.
17. As an NIOT evaluator, I want a background-only sensor probe, so that I can see how strongly features encode the sensor.
18. As an NIOT evaluator, I want a sensor × predicted-class false-detection matrix, so that I can see cross-sensor hallucinations.
19. As an NIOT evaluator, I want per-sensor false-alarm rates for every anomaly score, so that I can check sensor dependence.
20. As an NIOT evaluator, I want SHIPWRECK shown as a Failed class with its diagnosis, so that the failure is visible and understood.
21. As an NIOT evaluator, I want ablations that contain only measured rows, with N/A where physically undefined, so that nothing is fabricated.
22. As an NIOT evaluator, I want false alarms per 1,000 pings rather than per km where distance is unknown, so that the metric is honest.
23. As an NIOT evaluator, I want persistence evaluated only on independent Looks, so that re-reading the same pings is not called re-observation.
24. As an NIOT evaluator, I want shadow features computed on the correct range axis against same-range seabed, so that range falloff is not mistaken for shadow.
25. As an NIOT evaluator, I want calibration metrics (ECE, Brier, NLL, reliability diagram) on held-out data, so that I can check whether any score means what it says.
26. As an NIOT evaluator, I want the actual runtime path evaluated on held-out data, so that I know how the deployed system performs, not only the training representation.
27. As an NIOT evaluator, I want every number traceable to an artifact with hashes and commands, so that I can audit it.
28. As an ML engineer, I want a held-out manifest that rejects training rows, so that leakage is structurally impossible.
29. As an ML engineer, I want the demo recovery heuristic provably off in evaluation, so that it never contaminates metrics.
30. As an ML engineer, I want frozen detector features captured in the same forward pass as detection, so that Local Anomaly costs no extra network passes.
31. As an ML engineer, I want pre-registered hypotheses and thresholds frozen before the test run, so that results cannot be tuned post hoc.
32. As an ML engineer, I want any post-hoc iteration recorded in the artifact manifest, so that it is declared rather than hidden.
33. As a research engineer, I want p-value validity tested on synthetic exchangeable data, so that the statistic is correct before real data.
34. As a research engineer, I want Local Anomaly compared against global-memory, isotropic, and raw-intensity CFAR baselines, so that the contribution of each design choice is measured.
35. As a research engineer, I want persistence compared against a threshold-matched baseline, so that it is not credited with what a higher threshold does.
36. As a presenter, I want a claims ledger that lists allowed wording per outcome, so that the PPT says only what the evidence supports.
37. As a presenter, I want publication-quality figures generated from metrics files alone, so that figures and numbers cannot diverge.
38. As a presenter, I want the demo bundle built from held-out frames with split provenance per frame, so that the demo cannot be attacked as training data.

---

## 2. Locked scientific definitions

| # | Locked decision | Operational definition used in this spec |
|---|---|---|
| Q1 | PERSIST-Sonar retired | The evidence pipeline has no novelty name. It is described by function only. |
| Q2 | Sole provisional novelty | **Survey-referenced, range-matched local anomaly testing:** same Survey × same Side × comparable Slant-range band × candidate row guard × frozen deep features × conformal-style significance. The claim survives only if cross-sensor false-alarm experiments (C, H1–H2) pass. |
| Q3 | Class ≡ sensor confound | Measured and disclosed via background-only sensor probe, sensor × predicted-class false-detection matrix, and per-sensor false-alarm rates (Workstream D). |
| Q4 | SHIPWRECK is a Failed class | Held-out recall 0 in final_v1. The recovery heuristic is **off** in every scientifically evaluated path. Local-anomaly recovery of misses may be claimed only if measured (C, H5). |
| Q5 | 0.70–0.90 normalized confidence is not evidence | Never used in any metric, figure or claim. Migration target: raw detector confidence + explicit evidence channels + validation-fitted Contact score. Production UI unchanged in this spec's P0. |
| Q6 | Measured ablations only | Ablation rows exist only with an artifact. Physically undefined cells are N/A with a reason, never "pending". |
| Q7 | No per-km without distance | SubPipe held-out uses FP per 1,000 pings and background false-alarm rate. SubPipe val/test have no INS. |
| Q8 | Persistence physically scoped | Persistence = re-observation in independent Looks: along-track continuity of extended targets across ping-disjoint windows; same-ping cross-frequency Looks; genuine multi-pass (none available). Overlapping windows are one Look. Never inferred from frame order. |
| Q9 | Shadow = raised relief | Never evidence of artificiality. Metric height requires altitude and sample-spacing provenance (not available for held-out data, so no metric height in Round 2). |
| Q10 | Fusion replacement | Validation-fitted lightweight model with availability masks. Missing ≠ negative. Image/sonar quality modulates reliability; it has no standalone positive effect. |
| Q11 | Deployment claim | "Local offline workstation inference" until measured on representative onboard hardware. |
| Q12 | Vocabulary | **Local Anomaly** = statistically unusual relative to comparable seabed. Never automatically "unknown object", "unknown artificial object" or "artificial anomaly". "Artificial" is only an Analyst verdict. |
| Q13 | Contact | One physical-object hypothesis. Spatially distinct objects are never merged because they share a Frame. |
| Q14 | Survey | One contiguous recording from one sonar in one pass. An Upload may contain several Surveys. Unrelated frames from different datasets or sensors are never one Survey. |

**Repository evidence check.** No locked decision was found to be scientifically invalid to implement. Two decisions carry physical limits, which are recorded here and not treated as reasons to reopen them:
- **Q8:** point targets (crab pots) have no independent Looks in any dataset on disk, so persistence can only be validated for extended targets (SubPipe pipelines) and cross-frequency Looks.
- **Q2:** PING images have an unknown range axis because the Roboflow export rotated and flipped them. There, "same Side × Slant-range band" cannot be formed; PING can only use an explicitly labelled range-unconditioned variant.

---

## 3. Current known defects

| ID | Defect | Where | Consequence |
|---|---|---|---|
| KD-1 | Frame-level navigation short-circuits Contact association (distance-only early return) | `sagar.vnext.contacts` | Distinct same-frame objects merge; unrelated frames within 35 m merge |
| KD-2 | Same-frame observations get `WINDOW_OVERLAP_ONLY` regardless of inference mode | `sagar.vnext.contacts` | Mislabelled evidence type |
| KD-3 | Without navigation, a normalized-centre gate of 0.12 (≈ 600 px on 5000-px frames) can merge distinct objects | `sagar.vnext.contacts` | Over-merging on wide frames |
| KD-4 | A review verdict propagates to every Contact containing the reviewed Observation | runtime review endpoint | A verdict can land on a different physical object |
| KD-5 | One Upload = one "survey" id; no Survey membership per Frame | runtime ingest (`sagar.api.app`) | Unrelated recordings are treated as one Survey |
| KD-6 | Byte-identical rasters in one Upload are not detected | runtime ingest | A duplicated file yields "persistence" (Epitome v2: three identical frames) |
| KD-7 | Declared sequence with synthetic ping bounds creates `SEQUENTIAL_PING` persistence | ingest + contacts | Synthetic navigation acts as scientific evidence |
| KD-8 | SHIPWRECK recovery pass (conf 0.01, cluster ≥ 3) runs by default in tiled inference | `sagar.perception.runtime` | Heuristic labels in outputs; ~2× passes |
| KD-9 | Contact `confidence` = 0.70 + 0.20·σ(28(raw_fused − 0.314)) | `sagar.vnext.evidence` | Every Contact 70–90 %; a raw 0.04 shows 70.7 %, a raw 0.18 false positive shows 89.9 % |
| KD-10 | Fusion weights hand-set; frame quality added as positive object evidence | `sagar.vnext.evidence` | Unvalidated; image quality inflates support |
| KD-11 | The "acoustic_shadow" component is a bright-pixel fraction for PIPELINE boxes | `sagar.vnext.physics` | Misnamed evidence |
| KD-12 | Legacy shadow and nadir code treat rows as range; SubPipe sidecar says along-track = columns | `sagar.evidence.shadow`, `sagar.preprocess`, SubPipe canonical sidecar | Wrong axis (verified: rows are pings, columns are range, nadir at centre column, for SubPipe and AI4) |
| KD-13 | Runtime open-set scores the mean of 16 unit cell vectors, while memory and threshold use per-cell vectors; calibration frames are all detector-train | runtime open-set path; `open_set_v1` | Threshold not transferable; 21 % flag rate on retained observations, 64 % on PING |
| KD-14 | Runtime tiling (768²/30 %) differs from the training representation (512² SubPipe tiles; full-image AI4); confidence floor 0.12 tiled vs 0.25 full-frame | `sagar.perception.runtime` | Held-out metrics do not describe the runtime path |
| KD-15 | No held-out evaluation of the runtime path exists | — | Deployed behaviour unmeasured |
| KD-16 | Headline macro precision 0.734 includes SHIPWRECK P = 1.0 at R = 0 | Model Lab, README | Inflated headline |
| KD-17 | Runtime reviews: no evaluation-split leakage guard, no manifest exporter | runtime memory | Test frames can enter training memory |
| KD-18 | v4 demo: 6 of 7 frames in detector train split; report mislabels one as held-out | demo artifacts | Demo attackable |
| KD-19 | PING images are Roboflow-augmented (90° rotation, shear, flips), 873 test images from 324 originals | corpus | Range axis unknown; duplicated test evidence |

---

## 4. Target architecture

### 4.1 Production path (after P0 correctness; UI unchanged)
```
Upload → Survey formation (per-Frame Survey membership, duplicate-raster flag, navigation provenance)
       → detection (frozen YOLO11s; recovery heuristic configurable, OFF for evaluation)
       → Observations (immutable)
       → Contact association (same-Frame tile-duplicates; cross-Frame only within a Survey via ping relationship)
       → evidence channels, each {value, availability, reliability, provenance}
       → [after gates] Contact score (validation-fitted, availability-masked)
       → review (verdict applies to exactly one Contact) → report
```

### 4.2 Research harness (separate from production; consumes the production path)
```
held-out manifest ─┬→ runtime-path inference cache (+ layer-16 cells from the same pass)
                   ├→ D  sensor-confound diagnostics
                   ├→ C  local anomaly significance (+ baselines)
                   ├→ E  persistence on independent Looks (SubPipe)
                   ├→ F  raised-relief (shadow) features (SubPipe, AI4)
                   ├→ G  fusion fit (val) + calibration evaluation (test)
                   └→ H  end-to-end runtime evaluation through the Upload API
                          → I  artifact bundles + claims ledger → J  demo evidence hygiene → PPT
```

### 4.3 Test seams (proposed; confirm before implementation)
1. **Contact association function** (existing pure function over Observations). All association semantics are tested here.
2. **Upload API**, via the existing FastAPI test client with the detector faked. Survey formation, review isolation, runtime evaluation plumbing and regression of existing behaviour are tested here.
3. **Research harness entry points**, one per experiment, reading a manifest and writing an artifact bundle. Statistical correctness is tested on synthetic fixtures at this boundary.

No other new seam is required. The layer-16 feature tap stays inside the harness for Round 2.

### 4.4 Deployment gates
No research output reaches production until its workstream's acceptance criteria and held-out success criterion pass. Specifically:
- **Local Anomaly:** C H1–H2 pass.
- **Contact score:** G deployment gate passes.
- **Raised relief:** F success criterion passes.
- **Persistence (beyond correct labelling):** E success criterion passes.

---

## 5. Workstreams (in dependency order)

**Dependency order:** **A + B → H0 → D → C → (E ∥ F) → G → H → I → J → PPT**

**Deviations from the requested order, with reasons:**
1. **B runs with A.** Cross-Frame association rules must be bounded by Survey membership. Without B, A can only use a stricter interim rule.
2. **H0 (harness foundation) comes before D.** D, C, E, F and G all consume held-out runtime-path detections and features. H remains the final end-to-end evaluation through the Upload API after A/B are fixed.
3. **J (demo evidence hygiene) is added before the PPT.** The claim contract depends on a held-out demo.

---

### Workstream A — Contact association correctness (P0)

**Existing behaviour.** Observations are grouped greedily against the last member of each group:
- Class must match.
- If both carry coordinates, association returns on world distance ≤ 35 m alone.
- Otherwise, declared-sequential frames need a frame-index gap ≤ 1; different non-sequential frames are rejected; then normalized centre distance ≤ 0.12.

Reproduced defects (plan Part E): same-frame FULL_FRAME crab pots 340 px apart → 1 Contact `WINDOW_OVERLAP_ONLY`; different frames with fixes 20 m apart → 1 Contact. A verdict on one Observation sets the disposition of the whole merged Contact.

**Legitimate behaviour to protect:**
- Overlapping-tile duplicates of one object merge.
- Class incompatibility prevents merging.
- Repeated Observation ids are de-duplicated.
- Contact ids are deterministic from member ids.
- Declared-sequential Frames with genuine contiguous ping bounds associate.

**Required behaviour:**
1. **Same Frame:** two Observations associate only as **tile-overlap duplicates**: both from tiled inference, different tiles, and box IoU ≥ 0.30 or one box centre inside the other. Otherwise they are separate Contacts.
2. **Different Frames:** associate only if both belong to the **same Survey** (Workstream B) and have a **verified ping relationship**:
   - (a) **overlapping pings:** boxes overlap after mapping both into Survey ping/range coordinates. This is the same Look, not persistence.
   - (b) **ping-contiguous disjoint windows:** Slant-range position match |x̄₁ − x̄₂| ≤ max(0.25·w, 20 px). These are independent Looks.
3. **Frame-level navigation** never participates in association. Object-level coordinates may only add a constraint (AND), never bypass one.
4. **Frame or upload order** never creates association.
5. **Each Contact records** its `association_basis` ∈ {SINGLE, TILE_OVERLAP_DUPLICATE, SAME_LOOK_OVERLAPPING_WINDOWS, INDEPENDENT_LOOKS_ALONG_TRACK} and its **Look count**. The persistence type derives from Looks, not Frames.
6. **A verdict** applies to the Contact containing the reviewed Observation only. Because of invariant I-A1, that Contact is one object hypothesis.

**Interim rule until B lands:** different Frames associate only if both are flagged sequential with valid, contiguous or overlapping ping bounds of non-synthetic provenance. Otherwise they never associate. *(Superseded by the final rule, A7; see Erratum E-1.)*

**Invariants:**
- **I-A1:** no Contact holds two Observations from one Frame unless they are tile-overlap duplicates.
- **I-A2:** no Contact spans two Surveys.
- **I-A3:** Observations are never modified by association.
- **I-A4:** a Contact id is a pure function of its member Observation ids.
- **I-A5:** permuting upload order yields identical Contacts.
- **I-A6:** frame-level fixes never change association outcomes.

**Acceptance criteria:**
- **A-AC1:** the plan's reproduction CASE 1 (same frame, two FULL_FRAME boxes, identical frame fix) yields 2 Contacts, each SINGLE.
- **A-AC2:** CASE 2 (same boxes, no navigation) yields 2 Contacts.
- **A-AC3:** CASE 3 (different frames, fixes 20 m apart, unrelated positions) yields 2 Contacts.
- **A-AC4:** two tiled Observations of one object on adjacent tiles (IoU ≥ 0.30) yield 1 Contact with basis TILE_OVERLAP_DUPLICATE.
- **A-AC5:** two Frames of one Survey with verified overlapping pings and overlapping mapped boxes yield 1 Contact, SAME_LOOK_OVERLAPPING_WINDOWS, Look count 1.
- **A-AC6:** two ping-contiguous, disjoint windows with a Slant-range position match yield 1 Contact, INDEPENDENT_LOOKS_ALONG_TRACK, Look count 2.
- **A-AC7:** reversing upload order produces identical Contact ids and memberships.
- **A-AC8:** re-running association on the retained v4 Observations produces no Contact containing two same-Frame FULL_FRAME boxes.
- **A-AC9:** a verdict posted on one of two same-Frame Observations changes exactly one Contact's disposition.
- **A-AC10:** all pre-existing tests that encode legitimate behaviour still pass. The test encoding KD-1 ("navigation association" merging non-sequential frames) is rewritten, with the rationale recorded in the test.

**Required tests:** unit tests at the association-function seam for A-AC1–7; API tests (fake detector) for A-AC8-style multi-object frames and A-AC9 review isolation. Prior art: the existing Contact-association unit tests and the API resilience tests using the test client.

**Required experiments:** H-AC4 (merge and split rates on held-out data) re-measures this in Workstream H.

**Migration risks:**
- Retained runtime surveys keep old Contacts (hydration only fills records without Contacts), so demos must be re-uploaded.
- Contact counts rise in existing demos.
- Frontend fixtures that assume merged Contacts may need updating.
- New Contact fields must be additive.

**Dependencies:** B (for the final rule); none for the interim rule.

**Scientific assumptions:** tile-overlap duplicates are the only legitimate same-Frame duplicates; IoU 0.30 is conservative for elongated boxes (pipeline boxes span most of the tile height).

**Claims enabled:** "A Contact is one physical-object hypothesis. Association is deterministic, bounded by the Survey, and never uses upload order or frame-level navigation."

**Claims forbidden:** "tracking", "multi-view fusion", "multi-pass confirmation" on single-pass data.

---

### Workstream B — Survey semantics, minimal (P0)

**Existing behaviour.** Every Upload becomes one "survey" identifier. Frames are ordered by filename. An optional mission file can declare sequential observations. Navigation rows attach per Frame by filename, and navigation provenance (synthetic vs measured) is not machine-enforced. Mixed sensors and datasets in one Upload are accepted as one survey (v4: 7 frames from 3 datasets). Duplicate rasters are not detected.

**Required behaviour (no large schema migration):**
1. **The Upload keeps its existing identifier and API fields** for backward compatibility. It is documented as the Upload.
2. **Each Frame gains a Survey membership** within the Upload record. The Upload record gains a list of Surveys, each with membership provenance ∈ {DECLARED, VERIFIED, SINGLETON}.
3. **Survey formation rules:**
   - (a) explicit membership declared in mission metadata → DECLARED;
   - (b) membership verified from acquisition evidence → VERIFIED. Evidence means pixel-verified overlapping pings (for waterfall exports, row-shift identity between consecutive Frames), or ping bounds of **measured** provenance that are contiguous and overlapping; *(Erratum E-1: the measured-ping-bounds route is suspended. MEASURED is declaration-only until a verification procedure exists.)*
   - (c) otherwise each Frame is a SINGLETON Survey.
4. **Frames with different raster geometry** (width, height, channel layout) never share a Survey.
5. **Byte-identical rasters** within an Upload are flagged DUPLICATE_RASTER and never form separate Looks.
6. **Navigation carries provenance** ∈ {MEASURED, DERIVED_FROM_SOURCE, SYNTHETIC_DEMO}. SYNTHETIC_DEMO navigation may be displayed but never establishes Survey membership, ping relationships, persistence or any evaluation quantity. *(Erratum E-1: DERIVED_FROM_SOURCE is assigned only by Aqualens after B4 verification and cannot be declared; MEASURED is declaration-only; undeclared provenance is null and is never relationship evidence.)*
7. **Persistence, association and Local Anomaly references** are bounded by Survey membership. Persistence requires VERIFIED membership.

**Invariants:**
- **I-B1:** every Frame belongs to exactly one Survey.
- **I-B2:** a Survey never mixes raster geometries.
- **I-B3:** DECLARED membership alone never enables persistence.
- **I-B4:** duplicate rasters never yield independent Looks.
- **I-B5:** synthetic navigation never influences association, persistence, or any metric.

**Acceptance criteria:**
- **B-AC1:** uploading the v4 bundle yields 7 SINGLETON Surveys.
- **B-AC2:** uploading the Epitome v2 bundle flags `sonar_0001–0003` as DUPLICATE_RASTER, and no Contact in it has more than one Look.
- **B-AC3:** three real consecutive SubPipe frames (1 s apart) form one VERIFIED Survey via the 20-row shift identity. A synthetic-array unit fixture reproduces the shift property.
- **B-AC4:** an Upload mixing a 5000×500 and a 640×640 raster yields ≥ 2 Surveys.
- **B-AC5:** existing API response fields are unchanged; new fields are additive; all existing API tests pass.
- **B-AC6:** JSON and CSV reports include Survey membership and navigation provenance.

**Required tests:** API tests with ZIP fixtures (mixed geometry, duplicates, synthetic navigation flag) using the test client; unit tests of the Survey-formation rule on synthetic arrays.

**Required experiments:** none (a correctness workstream).

**Migration risks:**
- The workstation labels an Upload as a "survey". Wording is unchanged in this spec; a UI copy change is a later ticket.
- Previously retained records lack membership and default to SINGLETON on read.

**Dependencies:** none.

**Scientific assumptions:** the row-shift identity is valid evidence of shared pings for waterfall exports like SubPipe. Other formats need declared or measured metadata.

**Claims enabled:** "Association, persistence and local references never cross physically unrelated recordings."

**Claims forbidden:** calling a curated multi-dataset bundle a Survey or a "mission".

---

### Workstream H0 — Held-out evaluation harness foundation (P0, prerequisite for C–H)

**Existing behaviour:** none. Detector metrics exist only for the Kaggle training representation.

**Required behaviour:**
1. **Held-out manifest** built only from the detector's own split field in the frozen corpus metadata. Per image it records: sensor, dataset, split, Survey id (SubPipe: contiguous time segments; AI4: one waterfall image; PING: one image), augmentation parent (PING), bootstrap group, GT boxes, and AI4 merged object regions.
2. **Geometry record per image:** range axis (known for SubPipe/AI4, UNKNOWN for PING), nadir column, water-column half-width with a confidence value, or UNAVAILABLE.
3. **Runtime-path inference** over val/test images using the production detection path with the SHIPWRECK recovery heuristic **disabled via an explicit runtime configuration switch** (not by bypassing code). The harness may lower the confidence floor for calibration sweeps only as a declared harness parameter.
4. **Frozen layer-16 cell embeddings** captured in the same forward pass and cached.
5. **One-image-per-augmentation-parent subset** for PING.

**Invariants:**
- **I-H0-1:** no `train` row appears in any evaluation set.
- **I-H0-2:** detector SHA is verified before every run and recorded.
- **I-H0-3:** the recovery heuristic never executes in the harness.
- **I-H0-4:** GT is used only to select and score evaluation windows, never inside any reference or fitted parameter.

**Acceptance criteria:**
- **H0-AC1:** manifest split counts equal the frozen corpus QA counts; a unit test asserts rejection of train rows.
- **H0-AC2:** detector SHA recorded in every artifact.
- **H0-AC3:** with a fake detector that would emit a recovery candidate, harness output contains none, and a counter proves the recovery path was not entered.
- **H0-AC4:** for fixture images, harness detections equal production-path detections (same boxes, scores, classes) when recovery is off and floors match.
- **H0-AC5:** every image has a geometry record; PING is RANGE_AXIS_UNKNOWN.
- **H0-AC6:** the PING one-per-parent subset has 324 test images.

**Required tests:** harness unit tests (manifest leakage, recovery switch, equivalence to production on fixtures).

**Required experiments:** runtime-path precision/recall per sensor at IoU 0.5 and 0.3. This is the first measurement of KD-14/KD-15 and a preliminary input to H.

**Migration risks:** the recovery switch touches the runtime module. Its production default stays unchanged in this workstream, so the demo is unaffected.

**Dependencies:** A/B are not required for detection caching. Contact-level outputs come after A/B.

**Scientific assumptions:** the frozen corpus split is the authoritative held-out definition.

**Claims enabled:** "Held-out evaluation of the deployed detection path per sensor."

**Claims forbidden:** comparing runtime-path numbers with training-representation numbers without labelling both.

---

### Workstream D — Sensor-confound diagnostics (P0 evidence)

**Existing behaviour:** none. Per-class metrics are presented as class metrics.

**Required behaviour:**
1. **Background-only sensor probe:**
   - multinomial logistic regression predicting sensor (Klein 3500 / EdgeTech 2205 / Humminbird) from pooled layer-16 embeddings;
   - uses annotation-free crops, size-matched across sensors;
   - fit on `train` background, evaluated on `test` background;
   - control probe on 64-bin intensity histograms, to show how much is trivially texture or brightness.
2. **Sensor × predicted-class false-detection matrix:** detector (runtime path, recovery off) on background regions of each sensor's test split, at the runtime operating floors. Report detections per class per 1,000 background windows (and per 1,000 pings for SubPipe). Add the cross-class confusion on positives (predicted class vs GT class).
3. **Per-sensor false-alarm rate** for the detector and for every anomaly score (as deployed; C variants) on randomly placed background windows.

**Invariants:** the probe never sees test data in fitting; background windows exclude GT boxes dilated by 32 px and the water column.

**Acceptance criteria:**
- **D-AC1:** probe balanced accuracy with 95 % bootstrap CI and chance level, for both deep and histogram features.
- **D-AC2:** 3 × 3 false-detection matrix with counts, rates and CIs.
- **D-AC3:** per-sensor false-alarm table for detector and each anomaly score.
- **D-AC4:** figures: probe confusion matrix, false-detection heat map, per-sensor false-alarm bars.
- **D-AC5:** a machine-readable "confound statement" in `metrics.json`, auto-generated from the results with no manual wording.

**Required tests:** unit test that probe fitting rejects non-train rows; a synthetic check that the matrix counts detections on planted fixtures correctly.

**Required experiments:** D itself (≈ 1–2 h compute).

**Migration risks:** none (analysis only).

**Dependencies:** H0.

**Scientific assumptions:** dataset = sensor in this corpus (each source is one instrument). Background crops are representative of each sensor's seabed.

**Claims enabled:** "We measured our class–sensor confound: probe accuracy X; cross-sensor false detections Y."

**Claims forbidden:** "The detector recognizes objects independently of sensor."

---

### Workstream C — Local anomaly significance (the provisional novelty)

**Existing behaviour:** global SubPipe memory (`open_set_v1`) with KD-13 defects. There is no survey-referenced statistic.

**Required behaviour (harness only for Round 2; production only after gates):**

1. **Feature extraction.** Frozen YOLO11s layer-16 map from the same tiled or full-frame forward pass. Average-pool to cells: 20 × 20 per 768 tile (≈ 38 px native), 20 × 20 per 640 frame (32 px native). L2-normalize each cell: u(c) ∈ ℝ¹²⁸. Remove water-column cells.
2. **Candidate window W\*:** the cells covered by a detector box or proposal (h × w cells).
3. **Same-Survey reference, side-conditioned, range-conditioned, guarded:**
   𝓡 = { c : Survey(c) = Survey\*, Side(c) = Side\*, |r(c) − r̄\*| ≤ Δr, g_p ≤ |p(c) − p̄\*| ≤ G_p, c ∉ water column, c ∉ any detector box }
   - Δr = max(2 cells, ½ × range extent of W\*);
   - g_p = ½ × row extent of W\* + 2 cells (the row guard removes the candidate footprint and its shadow, which lie in the candidate's pings);
   - G_p = g_p + 40 cells.
   - GT is never used.
   - **Range-unconditioned variant** (PING, and as an ablation): all same-image cells at Chebyshev distance ≥ 2 cells from W\*. Labelled RANGE_UNCONDITIONED.
4. **Memory / calibration split:** 𝓡 is split by alternating along-track blocks of 2 cells into memory 𝓜 and calibration 𝓒 (disjoint).
5. **Statistic:** T(W) = max_{c∈W} (1/k) Σ_{j∈kNN_k(u(c),𝓜)} ‖u(c) − u(j)‖₂, with k = 3.
6. **Significance:** compute T for every **non-overlapping** placement of an h × w window fully inside 𝓒, scored against 𝓜: {T_j}, j = 1…N. Then p(W\*) = (1 + #{T_j ≥ T(W\*)}) / (1 + N).
7. **Trimmed variant** (ablation): drop the top 2 % of T_j (contamination robustness).
8. **Availability:**
   - AVAILABLE;
   - INSUFFICIENT_REFERENCE when N < ⌈1/α⌉ − 1 (α unreachable), with N recorded;
   - GEOMETRY_UNAVAILABLE when Side or range cannot be established and the unconditioned variant was not requested;
   - never a zero score.
9. **Dependence handling:**
   - calibration placements are non-overlapping;
   - memory and calibration are block-disjoint;
   - candidates in one Survey share the calibration set, so their p-values are dependent but positively dependent (PRDS);
   - evaluation uncertainty uses cluster bootstrap over Survey-level groups.
10. **Multiple testing:**
    - **per-candidate mode:** flag if p ≤ α (α ∈ {0.01, 0.05, 0.10});
    - **triage mode:** Benjamini–Hochberg at q over all candidates of a Survey;
    - α and q are fixed before test and never chosen post hoc.
11. **Baselines (same windows):**
    - B1: `open_set_v1` as deployed;
    - B2: global SubPipe memory with the per-cell max statistic, τ from val per sensor;
    - B3: global multi-sensor train memory;
    - B4: raw-intensity rank-CFAR with the identical reference design;
    - B5: range-unconditioned local reference;
    - B6 (optional): frozen DINOv2-S features.
12. **Proposal mode:** all non-overlapping 3 × 3-cell windows over AI4 test waterfalls, BH at q = 0.1. Tests recovery of wrecks the detector misses (the only permitted SHIPWRECK-recovery claim).

**Pre-registered hypotheses** (frozen in the artifact before any test run):
- **H1 validity:** on randomly placed held-out background windows, the upper 95 % CI bound of realized FPR ≤ α + 0.02 at each α, **in each sensor**; B1 violates this in ≥ 1 sensor.
- **H2 power:** at equal realized FPR (5 %), TPR(C) ≥ TPR(B1 or B2) in ≥ 2 of 3 sensors (paired cluster bootstrap).
- **H3 geometry:** range-conditioned beats range-unconditioned in TPR at α = 0.05 (SubPipe, AI4).
- **H4 representation:** deep features beat intensity rank-CFAR (B4) at α = 0.05.
- **H5 system:** used as an evidence channel, improves detector precision at matched recall (SubPipe, PING); in proposal mode, recovers AI4 wrecks at q = 0.1.
- Holm correction across H1–H5.

**Invariants:**
- **I-C1:** GT never enters 𝓡.
- **I-C2:** test data never tunes k, Δr, g_p, G_p, cell size, trimming, α or q.
- **I-C3:** unavailable significance is never zero.
- **I-C4:** validity is claimed only for unselected windows. For detector-selected candidates, the p ≤ α rate among false positives is reported as "false-positive survival".

**Acceptance criteria:**
- **C-AC1:** on synthetic exchangeable fields (1,000 simulations), p-values are uniform (KS p > 0.01) and realized FPR ≤ α within Monte-Carlo error.
- **C-AC2:** a planted anomaly in synthetic fields gives power above a matched global-memory baseline.
- **C-AC3:** a planted dark band in the candidate's rows (simulated shadow) never enters 𝓡.
- **C-AC4:** changing GT boxes does not change any p-value (only which windows are evaluated).
- **C-AC5:** availability states are emitted as specified, with N recorded.
- **C-AC6:** the test run produces H1–H5 verdicts with CIs, n and Holm-adjusted p.
- **C-AC7:** the pre-registration hash in the artifact matches the file committed before the run; any post-hoc rerun increments a declared iteration counter.
- **C-AC8:** all baselines are computed on identical windows.

**Required tests:** synthetic statistical tests (C-AC1–3), reference-builder unit tests (Side, range band, guard, water-column exclusion), availability-state tests.

**Required experiments:** C on held-out SubPipe, AI4 and PING (range-unconditioned).

**Migration risks:** none in Round 2 (harness only). Production integration later must reuse the same cell tap to keep zero extra passes.

**Dependencies:** H0, D (for the baseline false-alarm table and shared background windows), A/B (Survey ids for references).

**Scientific assumptions:** local exchangeability of background cells within a Survey, Side and range band. It fails at substrate boundaries and in rock fields, which are reported via false-alarm rate vs local seabed complexity (lacunarity).

**Claims enabled (only if H1 and H2 pass):** "To our knowledge, the first side-scan sonar test that calibrates each candidate against same-Survey, same-Side, comparable-range seabed with the candidate's pings excluded, giving an operator-set false-alarm rate measured to hold on three sonars. It builds on nonparametric CFAR, conformal anomaly detection and survey-referenced saliency (Kaeli 2016)."

**Claims forbidden regardless of outcome:**
- "detects unknown / artificial objects";
- "guaranteed false-alarm rate on any seabed";
- "domain-invariant";
- "first survey-referenced sonar anomaly detection";
- "new statistical theory".

---

### Workstream E — Persistence validation (physically scoped)

**Existing behaviour:** a heuristic persistence score from declared sequences (synthetic in every retained case); adjacent SubPipe frames share 480/500 rows.

**Required behaviour:**
1. SubPipe **test** only. Independent Looks are Frames exactly 25 ± 0.5 s apart (zero shared pings, **pixel-verified per pair**) within one VERIFIED Survey segment. Phase sequences S_φ, φ = 0…24.
2. **Cross-frequency Looks:** HF and LF Frames with the same timestamp. LF↔HF Slant-range mapping x_LF = a·x_HF + b is fitted on **val** GT boxes only; the val residual must pass before use.
3. **Rules:**
   - C_m (causal): matches in the m − 1 preceding windows;
   - N_m (non-causal): a run of ≥ m windows;
   - X: cross-frequency corroboration;
   - X ∧ C₂.
   - m ∈ {1, 2, 3}; Slant-range position match |x̄₁ − x̄₂| ≤ max(0.25·w, 20 px), same class.
4. **Baselines:** m = 1; **threshold-matched baseline** (raise the score threshold until recall equals the rule's recall).
5. **Metrics:** detection precision and recall (IoU 0.5; 0.3 secondary), false positives, **FP per 1,000 pings** (on S_φ, mean and range over φ), Contacts retained and removed, decision latency (m − 1) × 500 pings, association compute cost.
6. **Natural clutter:** label 100 random m = 1 false positives into categories (nadir/water column, seabed texture, pipeline-adjacent, isolated bright return, other); report survival per category.
7. PING and AI4 are excluded, with the stated physical reasons.

**Invariants:**
- **I-E1:** no Look pair shares a ping (pixel test = 100 % pass).
- **I-E2:** no synthetic navigation or upload order is used.
- **I-E3:** no per-km metric.

**Acceptance criteria:**
- **E-AC1:** independence verification log with 100 % pass.
- **E-AC2:** all rules and baselines reported with block-bootstrap (60-s blocks) CIs of paired differences.
- **E-AC3:** a precision–recall operating-curve figure with rule points and the threshold-matched point.
- **E-AC4:** clutter-survival table.
- **E-AC5:** the scope statement ("extended targets, single pass; point targets require multi-pass") is embedded in `metrics.json`.
- **Success:** C₂ or X beats the threshold-matched baseline precision by ≥ 0.05 at equal recall (CI excludes 0), **or** FP per 1,000 pings falls ≥ 50 % with recall loss ≤ 5 pp.
- **Failure:** no rule beats the threshold-matched baseline. Then persistence is not a headline and is reported as measured.

**Required tests:** unit tests for the independence check (synthetic shifted arrays), the rule logic on constructed chains, and the HF↔LF mapping-fit rejection path.

**Dependencies:** H0, B (VERIFIED Survey segments).

**Scientific assumptions:** pipelines keep a near-constant Slant range while the AUV follows them; SubPipe pipeline annotations are complete (unlabelled pipelines would count as false positives, noted as a limitation).

**Claims enabled:** "In a single pass, re-sighting in the next independent 500-ping window [or at the second frequency] reduced false alarms per 1,000 pings from A to B at recall C → D, better than a higher threshold (extended targets)."

**Claims forbidden:** "temporal tracking"; persistence for point targets; any use of adjacent SubPipe frames as independent observations.

---

### Workstream F — Raised-relief (acoustic shadow) validation

**Existing behaviour:** the runtime never computes shadows; the legacy code uses the wrong axis (KD-11, KD-12).

**Required behaviour:**
1. **Geometry correction:** rows = pings, columns = Slant range; nadir column estimated per image (±5 % of centre, fallback centre); water-column half-width from a seabed-line pick. Side s = sign(x̄ − x₀). Far edge = away from nadir.
2. **Bands:** far band F from the far edge outward, L_max = min(3e, distance to edge); near band N toward nadir (bounded by the water column).
3. **Range-matched background per column:** robust median/MAD over rows outside the candidate (guard 10 px, extent K = max(3h, 100)), excluding masked rows. **Mirror-range background** (column 2x₀ − c, same rows) for SubPipe pipelines, which span all rows.
4. **Features:** highlight_z; far contrast; near contrast; **Δ = far − near** (primary); shadow length; continuity; pairing; truncated flag; dimensionless h/H secondary; **darkness-only control** f_any (max adjacent contrast over 4 directions).
5. **Sets:** AI4 test wrecks vs same-range background and vs natural relief (terrain **val** images plus detector false positives on terrain); SubPipe test pipelines vs same-range background and SubPipe false positives. PING is not evaluable for oriented shadow (control only).
6. **Height:** no metric height in Round 2 (sample spacing unknown; held-out data lacks altitude).

**Invariants:**
- **I-F1:** oriented features never computed where the range axis is unknown.
- **I-F2:** the word "artificial" never appears in shadow outputs.
- **I-F3:** no metric height without altitude and sample-spacing provenance.

**Acceptance criteria:**
- **F-AC1:** synthetic waterfall tests. A planted object with a far-side shadow gives Δ > 0 on the correct side for both port and starboard. A range-falloff gradient with no object gives |Δ| ≈ 0 (range-matched background works).
- **F-AC2:** the darkness-only control is computed for every item.
- **F-AC3:** PING items automatically marked NOT_EVALUABLE_ORIENTATION.
- **F-AC4:** the output schema has no metric-height field populated.
- **Success:** AI4 AUROC(Δ or pairing) vs same-range background ≥ 0.75 (CI low ≥ 0.65) and ≥ f_any + 0.05; far > near significant for wrecks (Wilcoxon p < 0.01) and not for background; SubPipe AUROC ≥ 0.70.
- **Failure:** otherwise. Shadow is then removed from the Round-2 headline.
- **Hard time box: 7 h.**

**Required tests:** synthetic geometry tests (F-AC1), orientation guard tests (F-AC3).

**Dependencies:** H0 (geometry records, detector false positives on terrain), B.

**Scientific assumptions:** flat seabed locally, and a shadow that falls in the same pings as the object. Rocks and reefs cast shadows, so separation from relief is expected to be weaker; this is reported, not hidden.

**Claims enabled:** "Far-range shadow asymmetry against same-range seabed separates wrecks from background (AUROC …); it indicates raised relief and separates wrecks from natural relief only [Y]."

**Claims forbidden:** "shadow ⇒ man-made"; "measures object height" (Round 2).

---

### Workstream G — Contact score: fusion and calibration replacement

**Existing behaviour:** hand-set noisy-OR plus the 0.70–0.90 display map (KD-9, KD-10); `evidence_score` is a weighted mean.

**Required behaviour:**
1. **Channels** as available per sensor:
   - detector: logit of raw detector confidence;
   - local anomaly: −log p (if C passes);
   - persistence: Look count / rule outcome (SubPipe);
   - raised relief: Δ (if F passes).
   Each channel is {value, availability m_k ∈ {0,1}, provenance}.
2. **Model:** logit P(TP) = β₀ + Σ_k m_k·(β_k·s_k + γ_k) + Σ_k m_k·δ_k·q·s_k.
   - q is image/sonar quality and has **no main effect**; it only scales evidence terms, i.e. it modulates reliability.
   - A missing channel contributes exactly 0.
   - L2-regularized; ≤ 10 parameters per sensor.
   - Fit on **val** only, per sensor (SubPipe, PING; AI4 has no detector true positives).
3. **Calibration:** Platt and isotonic post-calibration fitted on val.
4. **Evaluation on test:** ECE (15 equal-mass bins), Brier, NLL, AUROC, and reliability diagrams with bootstrap bands. Compared against raw detector confidence, the current raw fused score, and the display value (shown only as a negative control, never as a metric of the system).
5. **Deployment gate:** test ECE improvement over raw has a CI excluding 0 **and** AUROC is non-inferior (Δ ≥ −0.01). Until the gate passes, production is unchanged and no scientific artifact uses the normalized display.

**Invariants:**
- **I-G1:** missing channel ⇒ zero contribution.
- **I-G2:** ∂score/∂q = 0 when all available evidence values are 0.
- **I-G3:** fitting uses val only.
- **I-G4:** no artifact contains `normalized_confidence` as a metric input or output.

**Acceptance criteria:**
- **G-AC1:** a unit test shows predictions equal a model restricted to the available channels.
- **G-AC2:** a unit test for I-G2.
- **G-AC3:** the manifest asserts val-only fitting.
- **G-AC4:** test metrics with CIs and n_TP / n_FP per sensor; a class with n_TP < 30 is marked INSUFFICIENT.
- **G-AC5:** the gate decision is recorded in the artifact.
- **G-AC6:** a schema test rejects any metrics file containing normalized display values.

**Dependencies:** H0; C, E and F results decide which channels exist.

**Scientific assumptions:** detection-conditional calibration (it ignores misses; recall is reported separately); calibration is sensor-specific and does not transfer.

**Claims enabled:** "Estimated precision at this score for class X on sensor Y, validated on held-out test (ECE …)."

**Claims forbidden:** "probability that the object exists"; any calibration claim for SHIPWRECK or for sensors not evaluated.

---

### Workstream H — Final runtime evaluation (end to end)

**Required behaviour:**
1. After A/B, upload held-out bundles **through the Upload API**. Bundles:
   - SubPipe: contiguous test segments, no navigation, or ping bounds DERIVED_FROM_SOURCE and pixel-verified;
   - AI4: one test waterfall per bundle;
   - PING: one image per parent.
2. Recovery off via the runtime switch; runtime defaults otherwise (floors, tiling, NMS).
3. Evaluate:
   - Observations vs GT per sensor (P/R at IoU 0.5 and 0.3);
   - Contacts vs GT objects: **merge rate** (Contacts containing > 1 GT object) and **split rate** (GT objects spread over > 1 Contact);
   - FP per 1,000 pings (SubPipe);
   - latency per Frame and full-survey processing ratio on named devices (MPS, CPU), recovery on vs off.
4. Report side by side with training-representation metrics, both labelled.

**Acceptance criteria:**
- **H-AC1:** 100 % of bundles processed via the API (job logs retained).
- **H-AC2:** the runtime configuration snapshot is recorded.
- **H-AC3:** per-sensor metrics with CIs.
- **H-AC4:** merge rate = 0 for same-Frame distinct GT objects (regression check of A).
- **H-AC5:** latency table names the device, OS, and torch/Ultralytics versions.
- **H-AC6:** a bundle validator rejects any bundle with SYNTHETIC_DEMO navigation.

**Dependencies:** A, B, H0, and G (if the Contact score passes its gate).

**Claims enabled:** "Held-out, end-to-end runtime performance per sensor on local workstation hardware."

**Claims forbidden:** onboard/AUV performance; per-km rates.

---

### Workstream I — Round-2 evidence artifacts

**Required behaviour:** each experiment writes one artifact bundle containing:
- `manifest.json`;
- `metrics.json`;
- `preregistration.json` (experiments C, E, F, G);
- `figures/` with PNG at 300 dpi plus SVG, generated **only from `metrics.json` and cached records**;
- `failure_cases/` with an index;
- `hashes.json`.

A **claims ledger** document maps every PPT number to artifact path + hash + command + outcome wording.

**Acceptance criteria:**
- **I-AC1:** `metrics.json` validates against the schema in §6.
- **I-AC2:** regenerating figures from the stored metrics reproduces identical files.
- **I-AC3:** every PPT number has a ledger row; a PPT number without one is removed.
- **I-AC4:** the failure-case index exists for every experiment.

**Dependencies:** C–H.

---

### Workstream J — Demo evidence hygiene

**Required behaviour:**
1. Remove the synthetic Epitome bundles from every judge-facing default path and document: health-check defaults, runbook, README "current demo", freeze document.
2. Build the Round-2 demo bundle only from held-out test frames. Record the detector split per frame (looked up in corpus metadata, never inferred from source folder names), plus SHA-256.
3. Correct the v4 selection report's split claims.
4. No frame selection by target confidence distribution.

**Acceptance criteria:**
- **J-AC1:** a bundle validator confirms all frames are `test` and navigation is absent or non-synthetic-derived.
- **J-AC2:** no judge-facing document references synthetic bundles as real.
- **J-AC3:** the demo run's Contacts satisfy A-AC invariants.

**Dependencies:** A, B, H.

---

## 6. Data contracts

| Record | Required fields |
|---|---|
| **Held-out manifest row** | image_id, dataset, sensor, split, survey_id, augmentation_parent (nullable), bootstrap_group, gt_boxes[class, xyxy_px], gt_object_regions (AI4), source_sha256 |
| **Geometry record** | image_id, range_axis ∈ {COLUMNS, UNKNOWN}, nadir_col (nullable), nadir_confidence, water_column_halfwidth_px (nullable), provenance |
| **Observation (additions)** | inference_mode, tile_id, frame_id, survey_id, look_id, recovery_candidate (must be false in evaluation) |
| **Contact (additions)** | survey_id, association_basis, look_count, member observation ids, per-channel evidence {value, availability, provenance} |
| **Local anomaly record** | candidate_id, survey_id, side, range_band, variant ∈ {RANGE_CONDITIONED, RANGE_UNCONDITIONED, GLOBAL_*, INTENSITY_CFAR}, statistic T, N_calibration, p_value (nullable), availability, α, q |
| **Persistence event** | chain_id, survey_id, channel (HF/LF), window ids, ping ranges, independence_verified (bool), rule outcomes |
| **Shadow feature record** | candidate_id, side, far/near contrast, Δ, length_px, continuity, pairing, truncated, f_any, orientation_status |
| **Fusion input** | per channel: value, availability, provenance; quality q; label (val/test only) |
| **Artifact manifest** | git SHA + dirty flag, detector SHA, corpus snapshot id, splits used, seeds, device, runtime config, preregistration hash, iteration number, command, start/end timestamps |
| **metrics.json entry** | name, value, ci_low, ci_high, n, unit, split, sensor, bootstrap_unit, hypothesis_id (nullable), verdict (nullable) |

---

## 7. Statistical contracts

1. **Splits.** `train` is used only for memory banks and probes. `val` is used only for fitting (fusion, calibration, cross-frequency mapping, optional hyperparameter checks). `test` is evaluated once per pre-registered configuration.
2. **Pre-registration.** Hypotheses, thresholds, α, q, k, window parameters and success/failure criteria are written and hashed before the test run. Any rerun after seeing test increments a declared iteration counter, and the ledger shows it.
3. **Uncertainty.** Cluster bootstrap (B ≥ 1,000; 2,000 for paired comparisons) over:
   - SubPipe: 60-s time blocks;
   - PING: recording/contact groups (augmentation siblings kept together);
   - AI4: wreck sites.
   Report percentile 95 % CIs. Clopper–Pearson is reported alongside for rates.
4. **Multiplicity.** Holm correction across the pre-registered hypotheses of each experiment.
5. **Discrete p-values.** Report N. Significance below 1/(N + 1) is impossible, and such candidates are marked INSUFFICIENT_REFERENCE at that α.
6. **False-alarm control language.** "Calibrated false-alarm rate, measured to hold under local exchangeability". Never "guaranteed". Validity is claimed only for unselected windows.
7. **Metrics.** No accuracy headline. No per-km without distance. No normalized display value. Missing evidence is never replaced by 0.
8. **Minimum evidence.** Rates with n < 30 events are reported but not used for claims.

---

## 8. Test strategy

**What makes a good test here:** it exercises external behaviour at a seam (association results, API responses, artifact contents, statistical properties), not internal helpers.

| Seam | What is tested | Prior art |
|---|---|---|
| Contact association function | A-AC1–7 semantics, invariants I-A1–I-A6 | existing Contact-association unit tests |
| Upload API (fake detector) | A-AC8–9, B-AC1–6, H-AC6 bundle validation, report fields | existing API resilience and navigation-ingest tests using the test client and a monkeypatched detector |
| Runtime detection | recovery switch, harness/production equivalence (H0-AC3–4) | existing runtime tiling tests with marker frames |
| Research harness entry points | leakage (H0-AC1), synthetic statistics (C-AC1–3, F-AC1, E independence), fusion invariants (G-AC1–2), schema (I-AC1, G-AC6) | existing feedback-leakage test |

- **Tests that must change with justification:** the test encoding navigation-based merging of non-sequential frames; the two tests asserting the 0.70–0.90 band. These change **only when** the Contact score replaces the display (after the G gate), not in P0.
- **Frontend:** vitest fixtures that contain merged Contacts are re-checked for additive fields.

---

## 9. Experiment strategy

| Order | Experiment | Data | Primary output | Stop condition |
|---|---|---|---|---|
| 1 | H0 runtime-path P/R | val/test, all sensors | per-sensor P/R | manifest and equivalence checks pass |
| 2 | D confound | train (probe fit), test | probe accuracy, 3×3 matrix, false-alarm table | all figures produced |
| 3 | C local anomaly | test (val for checks) | H1–H5 verdicts | verdicts with CIs |
| 4a | E persistence | SubPipe test (val for mapping) | operating curve vs threshold-matched | success/failure recorded |
| 4b | F raised relief | AI4 test, terrain val, SubPipe test | AUROC Δ vs f_any | verdict, or the 7-h time box |
| 5 | G fusion + calibration | val fit, test eval | ECE/Brier/NLL/AUROC, gate decision | gate recorded |
| 6 | H end-to-end | held-out bundles via API | runtime metrics, merge/split, latency | H-AC1–6 |

---

## 10. Artifact contract
See Workstream I and §6. Artifacts live under a Round-2 artifacts directory, one sub-directory per experiment and iteration. They are immutable once written; a rerun gets a new iteration directory. The claims ledger is the only route from artifact to PPT.

## 11. PPT claim contract

| Claim | Requires | If it passes | If it fails |
|---|---|---|---|
| Contact correctness | A-AC1–10, H-AC4 | "One Contact = one object hypothesis; deterministic, Survey-bounded association" | Must not demo multi-object frames |
| Confound disclosure | D-AC1–5 | "We measured our class–sensor confound: …" | (always shown) |
| Local anomaly novelty | C H1 ∧ H2 | Safe novelty claim (Workstream C) | "Advisory local-anomaly map; sensor dependence reduced but not removed", no novelty claim |
| Detector-miss recovery | C H5 (proposal mode) | "Local anomaly flagged X of Y held-out wrecks the detector missed at q = 0.1" | No recovery claim |
| Persistence | E success | Scoped claim (Workstream E) | "Single-pass persistence did not beat a higher threshold; multi-pass needed" |
| Raised relief | F success | Scoped claim (Workstream F) | Shadow removed from headline |
| Contact score | G gate | "Estimated precision, validated on held-out test" | Raw confidence + decomposition only |
| Runtime performance | H-AC1–5 | "Held-out end-to-end on local workstation (device named)" | Report as measured |
| SHIPWRECK | always | "Failed class; diagnosis: fragmented labels, tiny boxes, 0.17 % exposure" | — |
| Deployment | always | "Local offline workstation inference" | — |

**Forbidden regardless of results:**
- PERSIST-Sonar or any pipeline name implying novelty;
- "unknown/artificial object detection";
- "shadow ⇒ man-made";
- calibrated probability without G;
- "guaranteed false-alarm rate";
- per-km false alarms;
- "onboard/AUV-ready";
- "better than GhostVision";
- "self-learning";
- macro precision 0.734 as a headline;
- any number without a ledger row;
- synthetic or training-split imagery as evidence.

## 12. Definition of Done
1. A and B acceptance criteria pass; the full Python and frontend suites are green.
2. H0 harness passes H0-AC1–6.
3. D, C, E, F and G each have a recorded outcome (pass or fail) against pre-registered criteria, with artifacts per Workstream I.
4. H end-to-end evaluation complete, with H-AC1–6.
5. The claims ledger covers every PPT number; forbidden claims are absent from the PPT, README and judge-facing docs.
6. J demo hygiene complete.
7. No production UI change beyond what a passed gate authorizes; the display normalization is not used in any artifact.
8. `CONTEXT.md` vocabulary is used consistently in new docs and artifact field names.

## 13. Explicit non-goals
- Retraining or replacing the detector (including SHIPWRECK v1.2, RF-DETR, YOLO26), segmentation, OBB.
- Metric object height, depth, bathymetry, 3-D Contact plots.
- Survey-to-survey change detection implementation.
- Onboard/edge deployment work beyond measuring latency.
- UI redesign or copy changes (separate tickets after gates).
- Large schema migration (the Upload id is retained; Survey membership is additive).
- External paper integration (MDPI JMSE 11(4):690: LOW_VALUE).
- Downloading new model weights (DINOv2 ablation optional and non-blocking).
- PDF reports, GIS basemaps, priority-engine redesign.

---

## Further notes
- **Issue tracker:** not configured in this repository (the agent-skills setup was not completed), so this spec is written as a repository document and not published as an issue. Publishing to GitHub Issues is an outward action and needs explicit approval.
- **ADR candidate** (not written): "The Upload keeps the legacy survey identifier; Surveys are additive per-Frame membership". It is hard to reverse once clients depend on it, surprising without context, and the result of a real trade-off against a full schema migration.
- **First implementation ticket:** A1 — write failing tests at the association seam for A-AC1–3 and A-AC7 (the plan's reproduction CASE 1–3 plus order permutation), then the minimal association change under the interim rule; rewrite the defect-encoding navigation test with its rationale.
