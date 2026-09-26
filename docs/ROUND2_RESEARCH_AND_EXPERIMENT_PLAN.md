# Aqualens — Round-2 Research and Experiment Plan

**Follows:** `docs/ROUND2_TECHNICAL_AUDIT.md`
**Date:** 2026-09-26
**Mode:** read-only. No code, model, runtime, or configuration was changed. Nothing was committed or pushed. This file is the only repository file written.

All verification checks ran as throwaway scripts in the session scratchpad, outside the repository. The association-bug reproduction script is reproduced verbatim in Appendix B so it can be rerun.

**Contents**
- Part A: Audit verification (confirmations, corrections, new findings)
- Part B: External paper (MDPI JMSE 11(4):690)
- Part C: Depth / bathymetry reality check
- Part D: Three core experiments (open-set, persistence, shadow), fully specified
- Part E: Contact association bug, reproduced
- Part F: Confidence story and calibration experiment
- Part G: 24–48 h experimental sprint (7 tasks)
- Appendices: shared evaluation conventions; reproduction script

---

# PART A — Audit verification

## A.1 Status of the audit's main findings

| Audit finding | Verdict | Evidence from this session |
|---|---|---|
| F1: Epitome bundle is synthetic; frames 1–3 byte-identical | **CONFIRMED** | Unchanged from the audit. SHA-256 check on the ZIP members. |
| F2: Contact `confidence` is a 70–90 % display sigmoid | **CONFIRMED** | `vnext/evidence.py`. Two tests *require* the band (`tests/test_vnext.py:143–164`, `tests/test_navigation_ingest.py:231–238`), so removing it is a deliberate test change, not a regression. |
| F3: macro precision inflated by degenerate SHIPWRECK | **CONFIRMED** | `metrics.json` |
| F4: consecutive SubPipe frames overlap 480/500 rows | **CONFIRMED and STRENGTHENED** | Checked on 36 random consecutive 1-s pairs (Chunk1 HF, Chunk4 HF, Chunk4 LF). Every pair satisfies `B[20:] == A[:480]` exactly (mean abs diff 0.0). **Rows are pings; 20 new pings per second; one frame = 500 pings = 25 s.** Frames 25 s apart are pixel-disjoint and contiguous. |
| F5: association merges same-frame objects under navigation | **CONFIRMED and BROADER** | Reproduced (Part E). The same bypass **also merges detections on different, non-sequential frames** whose fixes are within 35 m, overriding the "upload order is not a time axis" guard. |
| F6: v4 demo frames are mostly detector-training images | **CONFIRMED** | Unchanged |
| F7: open-set threshold does not transfer; responds to domain and crop size | **CONFIRMED** (mechanism); still **unevaluated** | Memory is per-cell unit vectors (norm 1.0, 2,048 × 128). Runtime uses the mean of 16 unit vectors. All 86 calibration frames are detector-train. Experiment D1 is designed to settle it. |
| F8: shadow never runs; change always refuses; priority capped | **CONFIRMED** | Unchanged. See A.2-1 for *why* shadow never became applicable. |
| Audit P1-2: "SubPipe INS unlocks honest geolocation and persistence" | **CORRECTED** | INS covers only 1,711 / 4,922 HF frames, and **zero** val or test frames (A.2-3). Useful for geometry calibration on train-split imagery, not for held-out evidence. |
| Audit 9.1: altitude/depth "on disk, not ingested" | **CONFIRMED, with coverage caveat** | See Part C. |

## A.2 New findings

**A.2-1 — The sonar axis question is resolved empirically.** In both SubPipe and AI4Shipwrecks, **rows are pings (along-track), columns are range, and nadir sits at the centre column.**
- SubPipe: the 20-row shift above; a central water-column band with a bright nadir line at column W/2 (visual check, LF and HF).
- AI4Shipwrecks: column-intensity minimum at x ≈ 848–856 of 1728 on three images; visual check of `Grecian_02` shows the wreck on the port side with its shadow on the far-range (left) side.

Consequences:
- The legacy `evidence/shadow.py range_matched_shadow` and `preprocess/pipeline.py estimate_nadir` treat **rows** as range. They are **physically wrong for both datasets**. This, not "nadir is unrecoverable", is why Stage 3C shadow was applicable to 0 rows.
- The SubPipe canonical sidecar field `along_track_axis: "COLS"` is wrong. It should be `ROWS`.
- Runtime `verify_candidate` uses the correct axis, but its background is the global image median, which is **not range-matched**.

**A.2-2 — PING images are geometrically augmented by the Roboflow export.**
- Three variants of one parent (`Rec19_wcp_ss_star_0002*`) show 90° rotation, shear, and flips. Their box coordinates move: `[124,142]`, `[444,510]`, `[444,100]`.
- The detector therefore trained on rotated sonar, which `ML_PLAN.md §4` forbids.
- **Range direction is unknowable for any PING image.**
- PING test holds **873 images from only 324 originals** (≈ 2.7 augmented copies each). CRAB_POT test metrics count rotated duplicates.

**A.2-3 — SubPipe navigation does not cover the held-out splits.** `EstimatedState.csv` ends at t = 1693575449 in Chunk4.
- SubPipe **val** (191 HF + 191 LF frames, from 1693575820) and **test** (975 HF + 825 LF, 1693577325–1693578565) have **no INS at all**.
- **False positives per km cannot be computed on held-out SubPipe.** Use FP per 1,000 pings.

**A.2-4 — Real altitude and vehicle depth exist for train-split chunks.**

| Chunk | Vehicle depth (median) | DVL altitude (median) | Water depth |
|---|---:|---:|---:|
| Chunk0, Chunk3 (vehicle at surface) | ≈ 0 m | 17.1 / 20.4 m | ≈ 17–20 m |
| Chunk1, Chunk2 | 15.6 / 16.4 m | ≈ 3.0 m | ≈ 19 m |

- A crude seabed-line picker on LF frames correlates with DVL altitude at r = 0.82 (n = 44, Chunk1–2). The HF picker failed.
- This is a **feasibility signal only**, not a result.

---

# PART B — External paper

## B.1 Facts (read from the published article via the in-app browser; MDPI blocks direct fetch)

| Field | Value |
|---|---|
| **TITLE** | *AUV-Based Side-Scan Sonar Real-Time Method for Underwater-Target Detection* |
| **AUTHORS** | Yulin Tang, Liming Wang (Naval University of Engineering, Wuhan); Shaohua Jin (Dalian Naval Academy); **Jianhu Zhao*** (corresponding), Chao Huang, Yongcan Yu (School of Geodesy and Geomatics, Wuhan University) |
| **YEAR** | 2023. *J. Mar. Sci. Eng.* 11(4), 690. DOI 10.3390/jmse11040690. Received 28 Feb, accepted 22 Mar, published 24 Mar 2023. |
| **PROBLEM** | Acoustic modems (≈ 13–14 kB/s) cannot return raw SSS data, so detection must run **onboard the AUV in real time** and transmit only target summaries. |
| **INPUT MODALITY** | **Raw side-scan sonar pings**: Shark-S455D, 450 / 900 kHz, 150 / 75 m single-sided range, on a Black Shark I-A AUV. Also GNSS/INS (fibre-optic INS, 1000 kHz DVL, USBL) and attitude. |
| **OUTPUT** | Detection boxes and segmentation masks for **shipwreck** and **mine**, plus target category, centre coordinates, "geometric dimensions" and a height, all transmitted acoustically. |
| **MODEL / METHOD** | (1) Real-time processing chain: decoding; echo quantization; **seabed-line detection (window-slope method)**; **slant-range correction L = √(R² − H²)**; statistical-gain radiometric correction; mean/median/frequency filtering; geocoding. (2) **DETR-YOLO**: YOLOv5 with DETR/transformer module, multi-scale fusion, SENet. (3) **BHP-UNet**: U-Net with blended hybrid dilated convolution and pyramid split attention. (4) Augmentation via **3D-printed physical models**, geometric shadow synthesis, and **StyleBankNet** style transfer. (5) Sliding detection on navigation strips (75 % window overlap, re-run every 10 new pings) with confidence-weighted box fusion. |
| **DATASET** | **Private.** Shipwreck: 612 original + 1,200 augmented images. Mine: **8 original** + 100 augmented. Train:test 4:1 with "ten-fold cross-validation". Sea trials: Zhoushan (Jul 2022, charted wreck, ~40 m depth, AUV altitude 20 m) and Sanya (Aug 2022, 3D-printed 2 m mine, ~30 m depth, altitude 15 m). |
| **LABELS** | Boxes and masks, 2 classes (shipwreck, mine) |
| **METRICS** | DETR-YOLO AP0.5 **76.5 %** (mine) / **84.5 %** (wreck); AP0.5:0.95 56.9 / 57.7; 427 / 431 FPS; 18.2 / 20.1 MB. BHP-UNet Dice 76.33 / 78.31, IoU 78.52 / 77.71. Baselines YOLOv5, Faster R-CNN, Transformer, U-Net, DeepLabv3+. Sea trials: wreck height "6.44 m … cannot be verified"; mine edges 1.75 m and 2.01 m against a 2 m truth. |
| **PRETRAINED WEIGHTS AVAILABLE** | **No** |
| **CODE AVAILABLE** | **No.** No repository is cited, and a web search found none. |
| **DATA** | "Access to the data will be considered upon request by the authors." |
| **LICENSE** | Article CC BY 4.0. No software or data licence exists. |
| **COMPUTE** | Training: 2× RTX 3090, i9-10900X, 1,200 epochs, batch 32, Adam lr 1e-4. Onboard computer: MIO-2263 (Celeron J1900 / Atom E3825, 8 GB). **No onboard latency is reported.** The FPS figures come from unspecified hardware, most likely the GPUs. |

## B.2 Scientific quality (what a reviewer would flag)

1. **Metric inconsistency.** Per the paper's own definitions (Eq. 13–14), Dice = 2·IoU/(1+IoU) ≥ IoU for any prediction set. Tables 3, 7 and 9 nevertheless report **IoU > Dice** for the mine target (78.52 > 76.33), for U-Net (70.61 > 67.95), and for U-Net shipwreck (71.47 > 69.26). This is only possible if the two numbers were computed differently (for example, IoU averaged with the background class). The segmentation numbers are not interpretable as reported.
2. **Leakage risk.** The mine class has 8 original images expanded to 100 augmented ones, with a 4:1 split. The paper does not say whether augmentation happened after the split. If it happened before, the test set contains siblings of training images. The same is true for the wrecks (612 → 1,200).
3. **Synthetic beats real** (Table 5). A model trained on 500 generated images outperforms one trained on 500 real images when tested on 100 real wreck images. The relationship of those 100 images to the generator's source images is not stated.
4. **Onboard real-time is asserted, not measured** on the onboard CPU.
5. **Height and dimension outputs are unvalidated.** The authors say so for the wreck; the mine has one example.
6. **No public artifacts.** Nothing is reproducible.

## B.3 Answers

| # | Question | Answer |
|---|---|---|
| 1 | Side-scan sonar relevant? | **Yes.** Genuine SSS on an AUV. |
| 2 | Can its method consume our inputs legitimately? | **Only its generic processing steps, and only on SubPipe and AI4Shipwrecks.** The chain needs raw pings with two-way travel time (R = ct/2), altitude, GNSS and attitude. We have rasters. What transfers to our rasters: seabed-line picking, pixel-unit slant-range correction (L_px = √(R_px² − H_px²), valid under uniform sampling and a flat seabed), column-wise gain normalization, and denoising. **PING cannot use any geometric step** (random rotations, no nadir). |
| 3 | What does it address? | Detection, segmentation, a real-time onboard processing chain, and geocoding, with unvalidated height and dimensions. **Not** bathymetry, depth estimation, or anomaly / open-set detection. Its "H" is sonar altitude estimated from the seabed line, not water depth. |
| 4 | Could it improve Aqualens scientifically? | **Marginally, and not through this paper specifically.** The useful parts (bottom tracking, slant-range correction, statistical gain, weighted box fusion over overlapping strips) are **standard SSS processing** also in PINGMapper and textbooks. Its models cannot be obtained. |
| 5 | Would integration need new data? | **Yes, for anything beyond geometry.** Real-time geocoding and metric height need raw pings, sample spacing, altitude and attitude, which the held-out data lacks. The models need private data and weights. |
| 6 | Reproducible implementation? | **No.** |
| 7 | Defensible Round-2 result in our timeline? | **Not from the paper.** A first-principles seabed-line + slant-range geometry step *is* worth implementing inside the shadow experiment (D3), and should be credited as standard practice (the paper can be cited as one example). |

**PAPER_INTEGRATION = LOW_VALUE.** Relevant domain, but no code, weights or data; evaluation defects; and its useful ideas are textbook SSS geometry we can implement directly. Cite it only as prior art for onboard real-time SSS pipelines. Do not cite its AP or Dice numbers as a benchmark, and do not borrow its "height" output.

---

# PART C — Depth / bathymetry reality check

## C.1 Field inventory

| Quantity | Available? | Source | Measured / Derived / Synthetic | Units | Uncertainty | Show in PPT? | Why |
|---|---|---|---|---|---|---|---|
| **Water depth** | Train-split SubPipe only | `EstimatedState.depth + alt` (Chunks 0–4, nav-covered frames) | Derived (sum of two measurements) | m | Sensor specs UNKNOWN; camera-keyed at 30 Hz, SSS at 1 Hz; valid only at nadir under flat seabed | **Only as a dataset telemetry plot** | No held-out frame has it; it is not an output of the system |
| **Sonar altitude** | Train-split SubPipe only | `Altitude.csv` (4 DVL beams + filtered, −1 = invalid), `EstimatedState.alt` | Measured | m | DVL accuracy UNKNOWN; 2.8 % invalid rows in Chunk0 | Telemetry only | Runtime drops `navigation.csv altitude_m`. **All Epitome altitudes are synthetic.** |
| **Vehicle depth** | Train-split SubPipe only | `Depth.csv` (pressure), `EstimatedState.depth` | Measured | m | UNKNOWN | Telemetry only | Same coverage limit |
| **Slant range** | Pixel form everywhere; metric form nowhere | Column index relative to nadir column (SubPipe, AI4) | Pixel: measured geometry. Metric: needs sample spacing (UNKNOWN; `range_scale_known: false`) | px (m only if derived) | Nadir column ±2 px; spacing UNKNOWN | **Pixel form only**, labelled "slant-range samples" | No sample-spacing metadata in either dataset |
| **Pixel range** | SubPipe, AI4 | Column − centre column | Measured (image geometry) | px | ±1–2 px | Yes | Exact image geometry |
| **Ground range** | Not computed | Would be √(r² − H²) with H = water-column half-width in px | Derived (flat-seabed assumption) | px (m with spacing) | Seabed-line pick error; slope | Only as a method illustration | Not implemented; assumption-dependent |
| **Range resolution / sample spacing** | Not in metadata | Could be estimated as DVL altitude ÷ seabed-line px (SubPipe Chunk1–2) | Derived | m/px | Unvalidated (crude r = 0.82, n = 44) | **No** (not yet) | Feasibility only |
| **Along-track sampling** | SubPipe | 20 new rows per 1-s frame (verified) | Measured | pings/s | Exact | Yes | Defines independent windows |
| **Bathymetry** | **None** | AI4 README mentions a "3D bathymetric system" on the vehicle, but no bathymetry is in the dataset | — | — | — | **No** | Standard SSS does not measure it |
| **Target depth** | None | — | — | — | — | **No** | SSS cannot observe object depth off nadir |
| **Target height** | None today | Shadow geometry h ≈ H·L_s / R_g,end, if implemented | Derived | ratio h/H (AI4); m (SubPipe Chunk1–2 only) | Flat seabed, object on bottom, untruncated shadow, H known | **Only if D3 passes**, as "unvalidated range-geometry estimate" | No ground-truth heights |
| **Heading** | SubPipe train split; runtime CSV | `EstimatedState.psi` (rad); `navigation.csv heading_deg` | Measured (SubPipe); **synthetic** in all demo bundles | rad / deg | UNKNOWN | Telemetry only | Held-out has none; demo values fabricated |
| **Attitude (roll / pitch)** | SubPipe train split | `EstimatedState.phi, theta`; `AngularVelocity.csv` | Measured | rad | UNKNOWN | No | Not ingested; not linked to evaluation |
| **Position** | SubPipe train split (local) | `EstimatedState x, y` (local metres, no WGS84 origin in repo) | Measured | m (local) | UNKNOWN | No | All runtime lat/lon in the repository are synthetic |

## C.2 Can Aqualens legitimately produce these?

| Visualization | Verdict | Reason |
|---|---|---|
| 1. Survey depth profile | **PARTIAL.** Only as "SubPipe public INS telemetry (train chunks)". Not a system output. | Real, but covers no held-out frame and no detection |
| 2. Detection depth distribution | **NO** | Held-out detections have no depth. Water depth at nadir ≠ object depth. |
| 3. Object depth | **NO** | Not observable from standard SSS |
| 4. Object height | **NOT YET.** Conditional on D3, as a dimensionless h/H on AI4 or metres on SubPipe Chunk1–2, labelled unvalidated. | Needs geometry plus shadow evidence that has not been validated |
| 5. Bathymetric map | **NO** | Physically impossible from these data |
| 6. Range-depth plot | **PARTIAL.** A calibration plot of seabed-line px vs DVL altitude (train chunks) is legitimate *if* the picker is validated. | It illustrates geometry. It is not depth sensing. |
| 7. 3D contact plot | **NO** | No object-level x, y, z exists |

**DEPTH_FEATURE = NOT DEFENSIBLE for Round 2.**

## C.3 Strongest alternative visualization with data we really have: "Acoustic geometry panel"

One held-out AI4Shipwrecks **test** wreck waterfall (not `Grecian_02`, which is train), annotated with **measured** quantities only:
- nadir column
- water-column half-width (first bottom return = altitude, in samples)
- range axis and port/starboard sides
- the wreck mask (expert label)
- a **measured far-range shadow profile**: mean intensity vs range across the object's rows, against the range-matched background band
- the near-side control profile

Pair it with a SubPipe strip showing the **20-ping-per-second waterfall reconstruction** and the pixel-disjoint 500-ping windows used by D2.

Every number comes from image geometry, and every assumption is written on the slide. It carries the physics story that the "depth" idea is reaching for, without inventing depth.

---

# PART D — Three core experiments

Shared conventions (splits, matching, bootstrap, file layout) are in **Appendix A** and apply to every experiment. All use the **frozen** detector (`2aa3ac71…`), **never** fit anything on test, and run the runtime detection path with the SHIPWRECK recovery pass **off** (harness-level; see A.3).

## D1 — Open-set: objectness or domain shift?

| Field | Specification |
|---|---|
| **RESEARCH QUESTION** | Does the open-set score separate objects from seabed *within* a sensor domain, or does it mainly separate sensor domains from the SubPipe reference? |
| **HYPOTHESIS** | H0: the score is dominated by domain. Background flag rate is much higher off-reference, and within-domain object-vs-background AUROC is near 0.5. H1: within-domain AUROC ≥ 0.75 in at least two domains, and background flag rates at a validation threshold stay ≤ 5 % in every domain. |
| **DATASET** | `multidomain_sonar_v1_1_20260831` canonical images: SubPipe, PING, AI4Shipwrecks |
| **EXACT SPLIT** | **Evaluation:** `split == "test"` only. **Threshold recalibration:** `split == "val"` only (AI4 val includes the 8 `extras_terrain` val images). **Optional multi-domain memory (M_multi):** background from `split == "train"` only. Reuse the existing `open_set_v1` memory as M_sub without rebuilding. |
| **UNIT OF ANALYSIS** | One crop: box padded by `max(8, 0.5·max(w,h))` px (the runtime rule), clipped to the image. |
| **POSITIVE SET** | Test objects per domain. **SubPipe:** GT pipeline boxes in frames spaced 25 s apart (pixel-disjoint). **PING:** GT crab-pot boxes, **one image per augmentation parent** (lexicographically first; the all-variants set is a sensitivity analysis). **AI4:** object boxes from test masks after 15-px morphological closing, connected components with area ≥ 1,024 px. |
| **NEGATIVE SET** | Per positive, two **size-matched** background crops from the **same domain's test images**. Random position (seed 26057), zero IoU with any GT box dilated by 32 px. For SubPipe/AI4, outside the water column (\|x − x₀\| > w_wc + 10 px). PING also samples its 227 test background images (one per parent). Separate **natural-relief** negative set: AI4 `extras_terrain` **val** images (size-matched random boxes), reported separately. |
| **PREPROCESSING** | Runtime-identical: grayscale → RGB replicate → BGR → Ultralytics letterbox at imgsz 640. No enhancement. |
| **ALGORITHM** | Hook YOLO11s layer 16 → adaptive-avg-pool 4×4 → L2-normalize each of the 16 cells. **R0 (as deployed):** q = mean of cells; score = min_j ‖q − m_j‖. **R1 (PatchCore standard):** per-cell NN distance, score = max over cells. Memories: **M_sub** = `open_set_v1` (2,048 SubPipe patches). **M_multi** = 2,048 per domain from train background, linspace-sampled exactly like `build_open_set_v1.py`. |
| **PARAMETERS** | τ_legacy = 0.4616784453. τ_val,d = q99.5 of domain *d* val background crop scores (same crop protocol). τ_val,pooled = q99.5 over all val background. Seeds 26057. |
| **METRICS** | Per domain and pooled: **AUROC, AUPRC** (report prevalence), **TPR @ FPR = 1 % and 5 %**, **FPR at each τ**, **flag rate** per domain × {object, background}. **Domain-shift index:** AUROC(background_d vs background_SubPipe). **Crop-size confound:** Spearman ρ(score, crop side) within negatives. |
| **BASELINE** | (a) **Domain-only baseline:** score = 1[domain ≠ SubPipe], giving a pooled AUROC. (b) **Crop-size-only baseline:** score = crop side. (c) Random, AUROC = 0.5. |
| **ABLATION** | R0 vs R1; M_sub vs M_multi; τ_legacy vs τ_val,d vs τ_val,pooled; PING one-per-parent vs all variants. **Optional O4:** sliding-window open-set proposals on AI4 test (512 px windows, stride 256), giving wreck recall at fixed false flags per image. This is the only test of "catching what the detector misses", since SHIPWRECK recall is 0. |
| **STATISTICAL SUMMARY** | Cluster bootstrap (B = 1,000) over source groups (Appendix A.4). 95 % percentile CIs. **Decision rule:** "**DOMAIN SHIFT DOMINATES**" if pooled AUROC(R0, M_sub) ≤ domain-only AUROC + 0.02 **and** mean within-domain AUROC < 0.65. "**OBJECTNESS SIGNAL PRESENT (domain-conditional)**" if within-domain AUROC ≥ 0.75 (CI low ≥ 0.65) in ≥ 2 domains. Otherwise "**INCONCLUSIVE**". |
| **FIGURES** | OS-1: score violins, 3 domains × {object, background}, R0/M_sub vs R1/M_multi. OS-2: within-domain ROC curves. OS-3: flag-rate bars per domain at τ_legacy and τ_val. OS-4: score vs crop side scatter. |
| **FAILURE CASES** | Top-20 highest-scoring backgrounds per domain; top-20 lowest-scoring objects per domain; all shown as crops with scores. |
| **SUCCESS CRITERION** | H1 met under R1 with either memory, **and** τ_val,d background FPR ≤ 5 % in every domain. |
| **FAILURE CRITERION** | Decision rule returns DOMAIN SHIFT DOMINATES, **or** within-domain AUROC < 0.65 in ≥ 2 domains. |
| **PPT CLAIM IF SUCCESSFUL** | "On held-out data, open-set dissimilarity separates objects from same-sensor seabed (AUROC per domain with CIs), at a background false-flag rate of X % per domain, using a per-sensor reference memory. It is advisory review evidence, not a class." |
| **PPT CLAIM IF UNSUCCESSFUL** | "Measured: our open-set channel mostly detects **sensor/domain change** (background flag rates …). We present it as an **out-of-distribution monitor**: *this survey does not look like our reference seabed, so treat detections with caution.* We do not claim unknown-object detection." Drop it from the top three. |

## D2 — Temporal persistence on genuinely independent observations

| Field | Specification |
|---|---|
| **RESEARCH QUESTION** | Does requiring repeated sightings across *pixel-disjoint* sonar observations reduce false alarms more than simply raising the confidence threshold, at acceptable recall cost? |
| **HYPOTHESIS** | True extended targets (pipelines) recur at the same range in consecutive independent windows. Detector false alarms caused by speckle or transients do not. Stationary natural clutter and nadir artifacts **will** persist (expected failure mode). |
| **DATASET** | **SubPipe only.** The only source with verified real ping order. PING is excluded (Roboflow rotations, chunk-level crops, no ping order, no pass metadata). AI4 is excluded (no ping or pass metadata; SHIPWRECK recall is 0). **No synthetic or declared ping bounds are used.** |
| **EXACT SPLIT** | Evaluation: SubPipe **test** (975 HF + 825 LF frames, 1693577325–1693578565). Association tolerance tuning, if any, on SubPipe **val** only. HF/LF scale fit for the cross-frequency arm: **val** GT boxes only. |
| **UNIT OF ANALYSIS** | (i) **Detection** in one window (for precision/recall). (ii) **Event** = chain of matched detections across consecutive windows (for contacts retained/removed). |
| **INDEPENDENT WINDOWS** | Frames exactly 25 ± 0.5 s apart share **0** rows and are ping-contiguous (verified). Each frame *f* has predecessor f⁻ (t_f − 25) and successor f⁺ (t_f + 25), when they exist in the same channel and segment (segments split at gaps > 2 s). **Phase sequences:** S_φ = {frames with ⌊t − t_seg0⌉ mod 25 = φ}, φ = 0…24. Each S_φ is a pixel-disjoint, contiguous pass over the test survey. |
| **POSITIVE SET** | GT PIPELINE boxes in each test frame (COCO). SubPipe annotation completeness for pipelines is assumed; unannotated true pipelines would count as FP, so this is noted as a limitation. |
| **NEGATIVE SET** | Every detection not matched to GT: all CRAB_POT / SHIPWRECK detections on SubPipe (no such objects are labelled) plus unmatched PIPELINE detections. |
| **PREPROCESSING** | Runtime path, recovery off, detection floor 0.05 (lets the threshold baseline be swept). The operating threshold is reported at the runtime floor of 0.12. |
| **ALGORITHM** | **Range-position match** between detections *d* (window k) and *e* (window k±1), same channel and same raw class: \|x̄_d − x̄_e\| ≤ max(0.25·w_d, 20 px), where x̄ is box centre column and w is box width. Row position is ignored (different pings). **Rules:** **C_m (causal, operational):** keep d iff matches exist in windows f⁻, …, f⁻⁽ᵐ⁻¹⁾. **N_m (non-causal, reporting):** keep d iff a run of ≥ m consecutive windows including f each contains a match. **X (cross-frequency, physically independent look):** keep an HF detection iff an LF detection at the same timestamp matches after mapping x_LF = a·x_HF + b (a, b fitted on val GT; expect a ≈ 0.5). Keep the LF detection symmetrically. |
| **PARAMETERS** | m ∈ {1, 2, 3}; Δ = 25 s (500 pings); IoU for TP 0.5 (primary) and 0.3 (secondary, elongated boxes); operating score thresholds swept 0.05–0.95 for curves. |
| **METRICS** | Per rule: detection-level **precision, recall**, TP, FP; **FP per 1,000 pings** computed on each S_φ as FP / (\|S_φ\| × 0.5), then mean and range over φ; **FP per survey-minute**; events retained / removed and TP events retained / removed; **decision latency** (m − 1) × 25 s = (m − 1) × 500 pings for C_m; association compute overhead (ms per frame). **FP per km is NOT reported** (no INS on test; Part A.2-3). |
| **BASELINE** | m = 1 (no persistence). **Threshold-matched baseline:** raise the score threshold on m = 1 until recall equals the recall of C₂ (and of X), then compare precision. This is the decisive baseline: persistence must beat a higher threshold. |
| **ABLATION** | C₂ vs C₃ vs N₂ vs N₃ vs X vs (X ∧ C₂); HF vs LF; per class (PIPELINE vs non-pipeline hallucinations). |
| **NATURAL CLUTTER ANALYSIS** | Label 100 random FPs from m = 1 (stratified by class and channel; one reviewer plus 20 % second-reviewer spot check) as: nadir / water-column artefact; seabed texture / sand ripples; pipeline-adjacent (shadow or scour); isolated bright return; other. Report **survival rate per category** under C₂, C₃, X. Expect persistence to remove transients but keep stationary clutter; report whatever it shows. |
| **STATISTICAL SUMMARY** | Block bootstrap over 60-s time blocks (B = 1,000) for precision, recall and FP rate differences vs baseline. Report the paired difference (rule − baseline) with 95 % CI. |
| **FIGURES** | P-1: **precision–recall operating curves** for m = 1 (threshold sweep) with C₂, C₃, X, X∧C₂ marked as points, plus the threshold-matched baseline point. P-2: FP per 1,000 pings bars per rule with CI. P-3: waterfall strip showing a pipeline chain surviving across windows and a transient FP removed. P-4: clutter-category survival bars. |
| **FAILURE CASES** | TP pipelines removed (why: missed in the neighbouring window); FPs that survive (expected: nadir lines, persistent seabed features); crops for each. |
| **SUCCESS CRITERION** | At recall matched to the threshold baseline, C₂ or X precision exceeds baseline precision by ≥ 0.05 absolute with CI excluding 0; **or** FP per 1,000 pings falls ≥ 50 % with PIPELINE recall loss ≤ 5 percentage points (CI-supported). |
| **FAILURE CRITERION** | No rule beats the threshold-matched baseline (CI includes 0), **or** recall loss > 10 pp for every FP-reducing rule. |
| **PPT CLAIM IF SUCCESSFUL** | "On a held-out SubPipe segment (N pings), requiring a re-sighting in the next independent 500-ping window [or at the second frequency] cut false alarms per 1,000 pings from A to B at recall C → D, better than raising the threshold at equal recall. Scope: extended targets in a single pass. Point targets need multi-pass surveys." |
| **PPT CLAIM IF UNSUCCESSFUL** | "Measured: in a single pass, persistence did not beat a higher threshold. Consecutive-window persistence mostly removes transients that the threshold already removes, and stationary clutter persists. Multi-pass re-observation is the correct design." Keep the mechanism, drop the headline. |

## D3 — Acoustic shadow: is there a physically oriented shadow signal?

**Step 0 — Is the current algorithm physically meaningful? No.**
- The runtime "acoustic_shadow" fusion component is a **bright-pixel fraction** for PIPELINE boxes. It is not a shadow.
- Legacy `range_matched_shadow` searches along **rows**, which is the along-track axis in both SubPipe and AI4 (A.2-1). It is geometrically wrong.
- Runtime `verify_candidate` uses the correct axis, but its "background" is the global image median (not range-matched), its shadow window equals the box width, and it never runs (`nadir_x = None`).

**A corrected feature extractor must be written.** D3 specifies it.

| Field | Specification |
|---|---|
| **RESEARCH QUESTION** | Do objects show a darkness band on the **far-range** side that is stronger than on the near side and stronger than at the same range in neighbouring pings? Does that separate objects from background and from natural relief? |
| **HYPOTHESIS** | Raised objects cast far-range shadows, so the far-minus-near darkness asymmetry Δ is > 0 for objects and ≈ 0 for flat seabed. Natural relief (rocks, reef) also casts shadows, so separation from relief is expected to be weaker. That is a **physical** limitation to report, not a bug. |
| **DATASET** | **AI4Shipwrecks** (primary: dual-channel, nadir at centre column, expert masks, visible shadows). **SubPipe** (secondary: pipelines parallel to track). **PING: not evaluable for oriented shadow** (range direction destroyed by augmentation; no nadir in crops). Evaluate PING only in the sign-agnostic control below, and never use it for a claim. |
| **EXACT SPLIT** | AI4 positives and background: **test** (13 wrecks, 74 positive images). AI4 natural relief: `extras_terrain` **val** (8 images; detector-val imagery, disclosed). SubPipe: **test** frames spaced 25 s apart. **No parameter is tuned on test.** Fixed parameters below; if any must change, tune on AI4 **train** / SubPipe **val** and re-freeze. |
| **UNIT OF ANALYSIS** | One object or control box on one side of nadir |
| **POSITIVE SET** | **Wreck:** AI4 test object boxes (15-px closing, area ≥ 1,024 px), fully outside the water column, not truncated at the image edge. **Pipeline:** SubPipe GT boxes in test frames. **Crab-pot:** PING GT boxes, **control only**. |
| **NEGATIVE SET** | (a) **Same-range background:** for each positive, 2 random boxes of identical size at the **same distance from nadir** (same columns on either side), in annotation-free rows ≥ 64 px from any mask. (b) **Natural relief:** random size-matched boxes on AI4 terrain val images at matched range, plus every frozen-detector detection on terrain images (their natural-clutter false positives). (c) **SubPipe background:** same-width boxes at matched range, ≥ 50 px from the pipeline box, same frames, plus SubPipe detector FPs. |
| **PREPROCESSING** | Grayscale native resolution, no enhancement. **Nadir column** x₀ = argmax of the column-mean nadir spike within ±5 % of W/2 (fallback W/2). **Water-column half-width** w_wc: window-slope seabed pick per 25-row block (first column moving outward from x₀ with the maximum smoothed derivative, within [0.02 W, 0.40 W]); median over blocks. |
| **ALGORITHM** | For box B = [x₁, x₂] × [y₁, y₂], side s = sign(centre − x₀) (range increases away from x₀). Far edge x_f = x₂ if s > 0 else x₁; near edge x_n the other. Range extent e = x₂ − x₁. **Far band F:** columns from x_f outward by L_max = min(3e, distance to edge); rows y₁…y₂. **Near band N:** from x_n toward nadir by min(L_max, distance to the water-column edge). **Range-matched background per column c:** μ_c, σ_c = median and 1.4826·MAD of I[r, c] for rows r ∈ [y₁ − K, y₁ − g) ∪ (y₂ + g, y₂ + K], with K = max(3(y₂ − y₁), 100), guard g = 10, excluding rows covered by any mask. **SubPipe pipelines span all rows, so use mirror-range background** (column 2x₀ − c, rows y₁…y₂). Report AI4 with both backgrounds. **Darkness** z_c = (μ_c − mean_{y₁…y₂} I[:, c]) / σ_c. |
| **FEATURES** | f1 **highlight_z** = median over object columns of (row-mean − μ_c)/σ_c. f2 **far_contrast** = mean z_c over the first k = max(5, e) far columns. f3 **near_contrast** = same on the near side. f4 **Δ = f2 − f3** (primary: orientation test). f5 **shadow_length** = consecutive far columns from x_f with z_c > 1.0 (gaps ≤ 3 px allowed). f6 **continuity** = fraction of rows y₁…y₂ whose mean over the first k far columns < μ − 1.0σ. f7 **pairing score** = min(f1, f2)·1[Δ > 0.5]. f8 **truncated** flag. f9 (secondary, only if f7 > 0 and not truncated) **height ratio** h/H = (g(r_f + L) − g(r_f)) / g(r_f + L), where g(r) = √(r² − w_wc²) and r is pixel slant range. Labelled a flat-seabed range-geometry estimate. |
| **SIGN-AGNOSTIC CONTROL (PING and all sets)** | f_any = max of darkness contrast over the 4 box-adjacent bands (left, right, up, down). This is **darkness, not a shadow test**. It exists to show how much "dark next to bright" alone separates, so that f4's added value is visible. |
| **PARAMETERS** | Thresholds 1.0σ / 0.5 as stated; k, K, g as stated; seed 26057; frozen before running test. |
| **METRICS** | Per dataset and per negative set: **AUROC** of f4 (primary), f7, f2, f5, f_any; **applicability** fraction (not in water column, not truncated); **paired Wilcoxon** of f2 vs f3 within positives and within each negative set; **Cliff's δ**. |
| **BASELINE** | f_any (darkness only); highlight only (f1). The shadow claim needs f4 or f7 to beat both. |
| **ABLATION** | Range-matched (flanking rows) vs mirror-range background (AI4); with and without water-column exclusion; k ∈ {5, e} reported, primary frozen as above. |
| **STATISTICAL SUMMARY** | Cluster bootstrap over wreck sites (AI4) / 60-s blocks (SubPipe), B = 1,000, 95 % CI. Wilcoxon p-values reported with n. |
| **FIGURES** | SH-1: the "acoustic geometry panel" (C.3) on one AI4 test wreck, with measured far and near profiles. SH-2: f4 distributions for wreck vs same-range background vs natural relief. SH-3: ROC for f4, f7, f_any, f1. SH-4: SubPipe pipeline far-vs-near profiles (median ± IQR). |
| **FAILURE CASES** | Wrecks with Δ ≤ 0 (buried, bow-on, truncated); background boxes with high Δ (terrain drop-offs); every relief negative with f7 > 0. Crops with profiles. |
| **SUCCESS CRITERION** | AI4: AUROC(f4 or f7) vs same-range background ≥ 0.75 (CI low ≥ 0.65) **and** it beats f_any by ≥ 0.05; far > near significant for wrecks (Wilcoxon p < 0.01) and not for background. SubPipe: AUROC ≥ 0.70 vs matched background. |
| **FAILURE CRITERION** | AUROC(f4) < 0.65 on AI4, **or** no far/near asymmetry, **or** f4 does not beat darkness-only f_any. **Then remove shadow validation from the Round-2 top three.** |
| **PPT CLAIM IF SUCCESSFUL** | "On held-out wreck sites, a far-range shadow asymmetry measured against same-range seabed separates wrecks from background (AUROC X, CI). It evidences *raised relief*: against natural rock or reef it separates only Y. Shadow is geometry evidence, not artificiality." |
| **PPT CLAIM IF UNSUCCESSFUL** | "Shadow evidence did not separate targets from same-range seabed in our held-out test. It stays a disabled, geometry-gated module." Remove it from the headline. |

---

# PART E — Contact association bug

## E.1 Reproduction (YES)

Script: Appendix B. It imports repository code only and writes nothing. Output:

```
CASE 1  same frame, frame-level nav fix present: 1 contact(s)
   CRAB_POT 2 obs | WINDOW_OVERLAP_ONLY | window_overlap_duplicate_count = 1
CASE 2  identical boxes, NO navigation (control): 2 contact(s)
   CRAB_POT 1 obs | SINGLE_OBSERVATION | window_overlap_duplicate_count = 0
   CRAB_POT 1 obs | SINGLE_OBSERVATION | window_overlap_duplicate_count = 0
CASE 3  two different frames, fixes ~20 m apart, unrelated image positions: 1 contact(s)
   CRAB_POT 2 obs | UNKNOWN | window_overlap_duplicate_count = 0
```

CASE 1 uses the exact boxes from retained survey `survey_upload_c4c56e532038` (PING frame, `FULL_FRAME` inference, so no tiles exist).

## E.2 Analysis

| Item | Detail |
|---|---|
| **ROOT CAUSE** | `packages/sagar/vnext/contacts.py:25`, `if wa and wb: return _metres(wa, wb) <= policy.max_world_distance_m`. This **early return** treats a **frame-level** navigation fix (copied to every observation on that frame by `perception/navigation.py finding_navigation_view`) as if it were an **object** position. It bypasses (a) the same-frame image-position gate and (b) the guard that different, non-sequential frames never associate (`contacts.py` lines after 25). **Secondary:** `window_overlap_duplicate_count = len(group) − n_frames` and the `WINDOW_OVERLAP_ONLY` label are assigned whenever two observations share a frame, **regardless of `inference_mode`**. Without navigation, a normalized-centre gate of 0.12 on a 5000-px-wide frame (≈ 600 px) can still merge distinct objects. |
| **AFFECTED CODE** | `vnext/contacts.py` (`_compatible`, `_metres`, `fuse_contacts` labelling). Callers: `api/app.py` `_run_survey_job` (contact fusion) and `_hydrate_legacy_runtime_surveys`. Downstream: contact-level evidence, confidence, priority, review propagation (`runtime_review` updates every Contact containing the reviewed finding). |
| **AFFECTED TESTS** | `tests/test_vnext.py::test_navigation_association_and_stable_ids` **encodes the defect** (frames 0 and 1, non-sequential, merged by geo); rewrite it. `::test_window_overlap_within_one_frame_is_not_temporal_persistence`: fixture lacks `inference_mode`; set `TILED` plus distinct `tile_id`s. `::test_declared_ping_order_not_filename_or_frame_order_controls_persistence`: currently passes **only because** geo merges frames 0 and 9; it must pass via ping contiguity after the fix. `tests/test_navigation_ingest.py::test_multiframe_declared_sequence_persists_contacts_for_runtime_api` should still pass (contiguous pings, same box). Frontend fixtures `apps/workstation/src/test/fixtures/runtime-survey{,-navigated}.json` and `final-port.test.tsx` reference `WINDOW_OVERLAP_ONLY` / `SEQUENTIAL_PING`: re-check, no expected change. |
| **IMPACT ON DEMO** | v4: 11 observations → 7 Contacts, of which 3 are merges of **distinct crab pots** (2 + 2 + 3 observations) labelled `WINDOW_OVERLAP_ONLY`. v3 relied on it: frames were "placed ~2 m apart so the ≤ 35 m gate fuses" them (`EPITOME_V3_SELECTION_REPORT.md`). Any navigated bundle with fixes < 35 m apart merges same-class detections across unrelated frames. |
| **IMPACT ON PERSISTENCE** | Same-frame merges get persistence 0.15 (no score change) but inflated `observation_count` and a false window-overlap label. Cross-frame merges in declared-sequential bundles skip the frame-adjacency check, so **non-adjacent frames count as distinct frames, and n and the persistence score inflate** (0.86 → 0.99). |
| **IMPACT ON EVIDENCE FUSION** | Contact `max_raw_confidence` = max over *different objects*: a weak object inherits a strong neighbour's confidence. Anomaly = max over members, so one object's open-set flag marks the merged Contact. Quality = mean. Evidence score, confidence and priority are computed on the mixture. **A reviewer's verdict on one object sets the disposition of the merged Contact**, so review memory can attach a CONFIRMED label to a different physical object. |

## E.3 Minimal fix (implementation plan; do not implement in this session)

1. **`_compatible(a, b)`** in `vnext/contacts.py` becomes:
   ```text
   if class differs                          -> False
   if a.source_frame_id == b.source_frame_id -> return tile_duplicate(a, b)
        # tile_duplicate: both inference_mode == "TILED", different tile_id, and
        #   IoU(bbox_px) >= 0.30 OR centre distance <= 0.5 * min(box sides)
   if both sequential_observation_supported:
        require 0 <= later.ping_start - earlier.ping_end - 1 <= policy.max_ping_gap   (default 0)
        require range-position match: |x_centre_a - x_centre_b| <= max(0.25 * width, 20 px)
        if both carry OBJECT-level geo (geo_level == "OBJECT"): also require world distance <= 35 m
        return result
   return False            # different frames without a declared, verified sequence never associate
   ```
   Frame-level fixes (`geo_level = "FRAME"`, set by `finding_navigation_view`) **never** participate in association.
2. **Labelling.** Count `window_overlap_duplicate_count` only for pairs merged by `tile_duplicate`. Set `WINDOW_OVERLAP_ONLY` only when such pairs exist. Add `association_basis ∈ {SINGLE, TILE_OVERLAP_DUPLICATE, DECLARED_SEQUENTIAL_PING}` to each Contact.
3. **Replace the `frame_index` gap with ping contiguity** for sequential association (upload order stops mattering).
4. **`_metres`:** add cos(latitude) to the longitude term (secondary; only affects future object-level geo).
5. **Tests:** add three regressions mirroring CASE 1/2/3 (expect 2 / 2 / 2 Contacts), rewrite `test_navigation_association_and_stable_ids`, update the window-overlap fixture to `TILED`, keep the ping-order test green via contiguity.
6. **Data:** retained runtime surveys keep their old Contacts (hydration only touches records without Contacts). **Demo bundles must be re-uploaded** after the fix.
7. **Doc:** one paragraph in `docs/CONTACT_CONFIDENCE_FUSION.md` or `VNEXT_FINAL_PRODUCT_CONTRACT.md` stating that frame-level navigation locates frames, not objects, and never associates observations.

Estimated effort: 1.5–2 h including tests. Risk: low; the change only reduces merging.

---

# PART F — Confidence story

## F.1 The chain as implemented

```
RAW YOLO SCORE s_raw            per observation (Ultralytics class score, anchor-free head)
  │   floors: 0.12 tiled / 0.25 full-frame; recovery pass may inject SHIPWRECK at ≥0.01
  ▼
EVIDENCE COMPONENTS (per Contact)
  raw_detector      = max s_raw over members
  temporal_persist. = (p − 0.15)/0.85,  p from heuristic formula (declared sequences only)
  acoustic_shadow   = bright-pixel fraction (PIPELINE only; SUPPORTED/WEAK_SUPPORT)   ← not a shadow
  physics           = null (always)
  sonar_condition   = frame image-quality score                                      ← not object evidence
  open_set_anomaly  = (a − τ)/(1 − τ)⁺
  artificiality, navigation_consistency = null
  ▼
FUSED SCORE  raw_fused = base + (1 − base)·0.18·g,  base = 1 − Π(1 − w_k s_k)   (weighted noisy-OR)
  ▼
DISPLAY  confidence = normalized = 0.70 + 0.20·σ(28·(raw_fused − 0.31398))          ← 70–90 % always
(parallel) evidence_score = Σ w_k v_k / Σ w_k over available (weighted mean, UNVALIDATED_EVIDENCE_FUSION)
```

## F.2 Classification

| Value | Probability? | Kind | Calibration evidence |
|---|---|---|---|
| s_raw (YOLO) | **No.** An uncalibrated classifier score. | Learned | **None.** No reliability diagram or ECE anywhere. |
| Open-set distance a | No | Statistical (distance; τ is a quantile) | None for positives |
| Persistence p | No | Heuristic | None |
| Quality score | No | Heuristic | None |
| Pipeline "acoustic" support | No | Heuristic | Negative (no discrimination on 6 examples) |
| raw_fused | No | Heuristic (hand weights) | None |
| normalized / `confidence` | No | Heuristic display map fitted to a synthetic demo's median | None. It is a presentation device. |
| evidence_score | No | Heuristic | None |
| priority_score | No | Heuristic | None |

**No value in the system is a probability, and none has calibration evidence.**

## F.3 Calibration experiment (CAL)

| Field | Specification |
|---|---|
| **QUESTION** | Can a per-class score be turned into an honest estimate of *P(detection is correct \| score, class)*, and does fused evidence add discrimination beyond s_raw? |
| **DATA** | PIPELINE: SubPipe. CRAB_POT: PING (one image per augmentation parent for **evaluation**; all variants allowed for fitting, sensitivity reported). **SHIPWRECK: excluded** (no true positives; state it). |
| **SPLIT** | **Fit on `val` only.** **Evaluate once on `test`.** SubPipe test uses all frames with 60-s block bootstrap (and a 25-s-spaced disjoint subset as a sensitivity check). |
| **DETECTIONS** | Runtime path, recovery off, floor 0.05 (tiled path via harness constant; full-frame via explicit `conf=0.05`). |
| **LABELS** | Greedy score-ordered matching to same-class GT at **IoU ≥ 0.5**: TP = 1, else 0. PIPELINE secondary IoU 0.3. False negatives do not enter detection calibration; report recall separately. |
| **SCORES COMPARED** | (1) s_raw. (2) raw_fused (runtime functions applied to each observation as a single-observation Contact: detector, sonar condition, open-set R0, pipeline verifier). (3) The 0.70–0.90 display value (to show its miscalibration). (4) Isotonic(s_raw). (5) Platt(s_raw) = logistic on logit(s_raw). (6) Isotonic(raw_fused). (7) Platt(raw_fused). All calibrators per class, fitted on val. |
| **METRICS** | **ECE** (15 equal-mass bins; 15 equal-width as secondary), **Brier**, **NLL** (clip 1e-6; for calibrated outputs), **AUROC** (TP vs FP) to compare the *discrimination* of s_raw vs raw_fused (monotone calibrators leave AUROC unchanged up to ties). Reliability diagrams with bootstrap bands. Report n_TP and n_FP per class. |
| **STATISTICS** | Cluster bootstrap (Appendix A.4), B = 1,000. Paired differences (calibrated − raw) with 95 % CI. |
| **DECISION** | If Isotonic or Platt reduces test ECE with a CI excluding 0, show **"estimated precision at this score (class X, validated on held-out test)"** in place of any "confidence". If AUROC(raw_fused) − AUROC(s_raw) < 0.03 or its CI includes 0, **fused evidence adds no discrimination**; show it only as a decomposition, never as a number. **The 0.70–0.90 display is removed regardless of outcome.** |
| **FIGURES** | CAL-1: reliability diagrams per class (raw vs isotonic vs display value). CAL-2: ECE / Brier table. CAL-3: AUROC s_raw vs raw_fused with CI. |
| **LIMITS TO STATE** | Calibration is domain-specific (SubPipe / PING) and does not transfer to a new sensor. It is conditional on detection (ignores misses). PING test contains rotated duplicates unless deduplicated. |

---

# PART G — Experimental sprint (24–48 h, 7 tasks, in order)

Shared layout: scripts in `ml/experiments/round2/`, outputs in `artifacts/round2/<task>/`. Every output directory carries `manifest.json` (git SHA, detector SHA, dataset snapshot id, split, seed, device, command line, start/end time) and `hashes.json`. Nothing touches the frozen detector, `open_set_v1`, or runtime code except T6.

| # | Task | Purpose | Files / components | Command / script | Output artifact | Depends on | Est. | Stop condition |
|---|---|---|---|---|---|---|---|---|
| **T1** | **Held-out harness + runtime-path inference cache** (also yields runtime-path P/R per domain, E2 of the audit) | One shared, audited source for every experiment | New: `ml/experiments/round2/r2_manifest.py`, `r2_infer.py`, `r2_common.py` (matching, bootstrap). Reads `canonical/metadata.jsonl`; calls `FinalDetector._infer_tiled` / `_class_aware_nms` / `_predict_boxes` with `TILE_CONFIDENCE_FLOOR` patched to 0.05; **recovery never called** | `uv run python ml/experiments/round2/r2_manifest.py --out artifacts/round2/manifest` then `uv run python ml/experiments/round2/r2_infer.py --splits val,test --out artifacts/round2/infer` | `manifest/heldout.jsonl` (per image: domain, split, group, parent, timestamp, channel, GT boxes, AI4 merged objects); `infer/detections_{val,test}.jsonl`; `infer/runtime_path_metrics.json`; `infer/timing.json` | none | 4–6 h | Split counts equal `qa.json`; zero train rows in eval sets; detector SHA verified; every val/test image has a record |
| **T2** | **Persistence experiment (D2)** | The PS false-positive-filtering evidence most likely to produce a clean result | New `ml/experiments/round2/d2_persistence.py` (phase sequences, range-position matching, C_m / N_m / X rules, HF↔LF scale fit on val, threshold-matched baseline, block bootstrap, figures) | `uv run python ml/experiments/round2/d2_persistence.py --infer artifacts/round2/infer --out artifacts/round2/persistence` | `persistence/metrics.json`, `pr_operating_curve.png`, `fp_per_1000_pings.png`, `clutter_survival.csv` (after the 100-FP labelling pass), `failure_cases/` | T1 | 4–6 h | All rules and baselines evaluated with CIs, **or** HF↔LF scale fit fails its val residual check (> 10 px LF median), in which case drop rule X and report it |
| **T3** | **Open-set experiment (D1)** | Settle objectness vs domain shift before the PPT names a "KING USP" | New `ml/experiments/round2/d1_openset.py` (crop sampler with size/range matching, layer-16 hook for R0/R1, M_sub load, optional M_multi build from train background, τ_val recalibration, domain baseline, decision rule) | `uv run python ml/experiments/round2/d1_openset.py --manifest artifacts/round2/manifest --out artifacts/round2/openset [--build-multi-memory]` | `openset/scores.jsonl`, `metrics.json` (with **decision label**), `OS-1…OS-4.png`, `memory_multi.npz` + hashes (if built), `failure_cases/` | T1 | 5–7 h | Decision rule evaluated for R0/M_sub and R1/M_sub at least. M_multi and O4 are optional and dropped if over time. |
| **T4** | **Confidence calibration (CAL)** | Replace the 70–90 % display with either a validated precision estimate or no number | New `ml/experiments/round2/cal_confidence.py` (labels from T1 detections, raw_fused via runtime `fuse_contact_confidence` on single-observation Contacts, isotonic/Platt fit on val, test evaluation) | `uv run python ml/experiments/round2/cal_confidence.py --infer artifacts/round2/infer --out artifacts/round2/calibration` | `calibration/metrics.json` (ECE, Brier, NLL, AUROC with CIs per class), `reliability_{PIPELINE,CRAB_POT}.png`, `calibrators.json` (knots / coefficients, val-fitted) | T1 | 2–3 h | Metrics for all 7 score variants × 2 classes with CIs; the decision recorded |
| **T5** | **Shadow experiment (D3)**, time-boxed | Decide whether shadow stays in the top three | New `ml/experiments/round2/d3_shadow.py` (nadir / water-column pick, corrected column-axis far/near bands, range-matched and mirror backgrounds, f1–f9, f_any, negatives incl. terrain and detector FPs, Wilcoxon, bootstrap, geometry panel) | `uv run python ml/experiments/round2/d3_shadow.py --manifest artifacts/round2/manifest --infer artifacts/round2/infer --out artifacts/round2/shadow` | `shadow/metrics.json` (with success/failure verdict), `SH-1_geometry_panel.png`, `SH-2…SH-4.png`, `failure_cases/` | T1 (terrain FP boxes) | 5–7 h | Verdict reached on the frozen parameter set. **Hard stop at 7 h:** if not done, shadow leaves the top three. No test-set parameter iteration. |
| **T6** | **Demo-integrity patch** (P0-1/2/3/6/7 of the audit, informed by T4) | Make the live demo consistent with the evidence | `vnext/contacts.py` (Part E fix); `vnext/evidence.py` / `api/app.py` (remove `DEMO_BOUNDED_SIGMOID` from `confidence` and the CSV, expose `raw_fused_confidence` as "evidence index (uncalibrated)" or T4's validated precision); `perception/runtime.py` (env flag `SAGARDRISHTI_SHIPWRECK_RECOVERY`, default off); tests listed in E.2 plus the two tests asserting the 0.70–0.90 band; new held-out-only demo bundle builder `scripts/build_round2_heldout_demo.py` (test-split frames, split printed per frame, **no navigation** or clearly synthetic-labelled) | `uv run pytest -q` · `pnpm --dir apps/workstation test` · `uv run python scripts/build_round2_heldout_demo.py --out artifacts/demo/round2_heldout.zip` | Green test suites; `artifacts/demo/round2_heldout.zip` + provenance listing detector split per frame; one upload run recorded | T4 (display decision) | 4–5 h | All tests pass; the new bundle uploads end-to-end; no Contact merges distinct same-frame objects (checked on the bundle) |
| **T7** | **Evidence pack** | Turn results into PPT-ready, traceable claims | New `docs/ROUND2_EVIDENCE_LEDGER.md` (each PPT number → artifact path + hash + command); update `docs/CLAIMS_AND_EVIDENCE.md` statuses; export final figures to `artifacts/round2/figures/` | `uv run python ml/experiments/round2/r2_figures.py --in artifacts/round2 --out artifacts/round2/figures` | Ledger, figure set, one-page claims sheet (successful and unsuccessful wording per Part D) | T2–T6 | 2–3 h | Every number intended for the PPT has a ledger row. Anything without one is not in the PPT. |

**Total:** ≈ 26–37 h for one engineer (fits 48 h). With two people: T2 and T4 in parallel with T3 after T1, and T5 in parallel with T6, which fits ≈ 24 h.

**Critical path:** T1 → T3 → T6 → T7.

---

## Appendix A — Shared evaluation conventions

**A.1 Splits.** Only the `split` field of `data/processed/multidomain_sonar_v1_1_20260831/canonical/metadata.jsonl` (the detector's own split). **Never** the source dataset's folder name. `train` is only for memory banks. `val` is only for fitting thresholds and calibrators. `test` is evaluated once per experiment configuration.

**A.2 Matching.** Greedy by descending score within class. A TP needs IoU ≥ 0.5 with an unmatched GT of the same class (secondary 0.3 for PIPELINE). Boxes in native image pixels.

**A.3 Runtime path without the demo heuristic.** Harness calls:
- `FinalDetector._infer_tiled` + `_class_aware_nms` when `needs_tiling`, with `perception.runtime.TILE_CONFIDENCE_FLOOR` patched in-process.
- Otherwise `_predict_boxes(image, conf=floor)`.

`_recover_weak_shipwreck_cluster` is never called. No repository file changes.

**A.4 Bootstrap units.** SubPipe: 60-s time blocks within split. PING: `source_group_id` (recording / contact), keeping augmentation siblings together. AI4: wreck site (`source_group_id`); terrain: site. B = 1,000, seed 26057, percentile 95 % CI.

**A.5 Reporting rule.** Every metric carries n, CI, split, and the artifact hash. A metric without these is not reported.

## Appendix B — Association-bug reproduction script (run read-only)

Run from the repository root:

```bash
PYTHONPATH=packages .venv/bin/python repro_assoc.py
```

```python
"""Read-only reproduction of the Contact association defect. Imports repo code; writes nothing."""
from sagar.vnext.contacts import fuse_contacts

def obs(det, frame_idx, frame_id, box_px, w, h, geo, mode="FULL_FRAME", cls="CRAB_POT", conf=0.3):
    x1, y1, x2, y2 = box_px
    return {"detection_id": det, "frame_index": frame_idx, "source_frame_id": frame_id,
            "raw_class": cls, "raw_confidence": conf, "bbox_px": list(box_px),
            "bbox_normalized": [x1 / w, y1 / h, x2 / w, y2 / h], "inference_mode": mode,
            "geo": {"lat": geo[0], "lon": geo[1]} if geo else {"lat": None, "lon": None},
            "sequential_observation_supported": False, "model_sha256": "x"}

def show(title, contacts):
    print(f"\n{title}: {len(contacts)} contact(s)")
    for c in contacts:
        print("  ", c["resolved_class"], c["observation_count"], "obs |", c["persistence_evidence_type"],
              "| window_overlap_duplicate_count =", c["window_overlap_duplicate_count"])

A = ((113, 103, 199, 207), (457, 32, 532, 126))      # survey_upload_c4c56e532038, 640x640, FULL_FRAME
fix = (14.99584, 84.005324)
show("CASE 1  same frame, frame-level nav fix present",
     fuse_contacts([obs("d1", 0, "frame_0000", A[0], 640, 640, fix), obs("d2", 0, "frame_0000", A[1], 640, 640, fix)], "s"))
show("CASE 2  identical boxes, NO navigation (control)",
     fuse_contacts([obs("d1", 0, "frame_0000", A[0], 640, 640, None), obs("d2", 0, "frame_0000", A[1], 640, 640, None)], "s"))
show("CASE 3  two different frames, fixes ~20 m apart, unrelated image positions",
     fuse_contacts([obs("d1", 0, "frame_0000", (10, 10, 60, 60), 640, 640, (15.0, 84.0)),
                    obs("d2", 1, "frame_0001", (580, 580, 630, 630), 640, 640, (15.00018, 84.0))], "s"))
```

## Appendix C — Sources
- Tang, Wang, Jin, Zhao, Huang, Yu (2023). *AUV-Based Side-Scan Sonar Real-Time Method for Underwater-Target Detection.* JMSE 11(4):690. https://www.mdpi.com/2077-1312/11/4/690 (read via the in-app browser; tables extracted from the page DOM).
- Code search: no official repository found for DETR-YOLO / BHP-UNet (web search, 2026-09-26).
- `data/raw/ai4shipwrecks/extracted/README.txt` (Iver3 + EdgeTech 2205; train/test wreck lists; terrain sites).
- `data/raw/ping-ghostvision/README.md` (Humminbird; Delaware; GhostVision citation Bodine et al. 2026, JMSE 14(10):951).

*End of plan. No code, model, runtime, or configuration was modified.*
