# Aqualens — Round-2 Technical Novelty Assessment

**Follows:** `docs/ROUND2_TECHNICAL_AUDIT.md`, `docs/ROUND2_RESEARCH_AND_EXPERIMENT_PLAN.md`
**Date:** 2026-09-26
**Mode:** analysis only. No code, model, runtime, or configuration was changed. Nothing was committed or pushed.

**Rule applied throughout:** a combination of existing modules is not a novelty. Where prior art substantially implements an idea, this document says **NOT NOVEL**.

---

## 0. Verdict in one page

| | |
|---|---|
| **Primary contribution (proposed, pending experiments)** | **Survey-referenced, range-matched conformal anomaly testing for side-scan sonar.** Each candidate is scored with frozen detector features against seabed from **the same survey, the same sonar side and the same slant-range band**, with the candidate's own rows (and so its acoustic shadow) excluded. It returns a **distribution-free p-value**, so the operator sets the false-alarm rate per survey instead of inheriting a threshold from another sensor. |
| **Why this and not the others** | It attacks the project's central scientific flaw, the **class–sensor confound**. The deployed global-memory anomaly score flags **64 % of PING observations** because they come from a different sensor. The primary contribution is testable on all three datasets with **no new training**. It costs **zero extra network passes**, since the features come from the same detector forward pass. It yields a visual, falsifiable figure. |
| **What it is NOT** | Not a new statistical theory. Rank-based local detection is classical nonparametric CFAR, and rank p-values are conformal p-values. Not the first survey-referenced sonar anomaly detector (Kaeli 2016 did survey summaries). Not artificiality detection (rocks are local anomalies too). |
| **What would be new, to our knowledge** | The specific SSS construction (range-stratified, same-side, row-guarded reference over deep detector features, with split-conformal calibration and BH triage) **and its measured false-alarm validity across three different sonars** trained under a class–sensor confound. We found no prior SSS work that does this. The claim is limited accordingly. |
| **Supporting 1** | **Confound-aware evaluation protocol.** A sensor probe on detector features, a background-only hallucination matrix, and per-sensor background false-alarm rates. It measures our own confound instead of hiding it. |
| **Supporting 2** | **Availability-masked, validation-calibrated Contact fusion.** Missing evidence contributes zero log-odds, not negative evidence. It replaces the 0.70–0.90 display value. Its value is correctness, not novelty. |
| **Rejected as headline novelties** | PERSIST-Sonar (A), target–shadow consistency (C), reliability-aware fusion (D), cross-frequency corroboration (E3) |
| **YOLO11s** | **Kept** as the fast candidate generator. The research sits after detection. |
| **Implement now?** | **NO.** Awaiting approval. |

---

## 1. Literature map (what already exists)

Sources were checked in this session unless marked *canonical* (well-known works cited from memory, not re-fetched).

### 1.1 Side-scan sonar detection and recognition
- Supervised SSS detectors are saturated with YOLO/DETR variants: SS-YOLO (JMSE 2025), BES-YOLO, RCDI-YOLO (Frontiers 2025), MSF-DETR (2025), Transformer-YOLOv5 (Remote Sensing 2021), and the MDPI 2023 DETR-YOLO paper reviewed in the previous plan. **Another YOLO variant is not a contribution.**
- Review: *AUVs for Seabed Surveying: A Comprehensive Review of Side-Scan Sonar-Based Target Detection* (JMSE 14(2):145).

### 1.2 Derelict gear, ghost nets, litter
- **GhostVision** (Bodine et al., JMSE 2026, 14(10):951). YOLOv12, YOLO26 and RF-DETR on 3,110 images; F1 ≈ 0.71–0.73 after post-processing for all three architectures. **Tracking persistence already fused with confidence:** `S = α·conf_avg + (1 − α)·pred_cnt / max(pred_cnt)` (GhostVision README).
- **PINGMapper** (Bodine et al., Earth and Space Science 2022). Humminbird decoding, **water-column removal using sensor depth**, georectified mosaics. This is why PING crops carry no nadir.
- **GhostNetZero** (Microsoft AI for Good / WWF, tech report 2025). DeepLabV3 + ResNet50 segmentation of ghost nets, ~90 % detection rate, human-in-the-loop platform.
- **SeaClear / SeaClear2.0** (EU). Multibeam + imaging sonar + cameras, DNNs (TU Delft), 3D voxel litter map. The public page does not specify how litter is separated from rocks, and does not mention anomaly detection or multi-pass persistence.

### 1.3 Sonar open-set and anomaly detection
- Open-set / long-tail sonar classification: PLUD loss (Expert Systems with Applications 2024), Dynamic Margin Contrastive Learning (Scientific Reports 2025). These are classifier-level, on crops, not survey-level.
- **Coffelt & Christensen, "Anomaly Detection in Side-Scan Sonar"** (OCEANS 2021): convolutional autoencoder trained on normal seabed. **Global reference.**
- **Kapetanović et al., "Saliency and Anomaly…"** (IFAC 2020): contrast-based saliency on simulated SSS.
- **Kaeli, "Real-Time Anomaly Detection in Side-Scan Sonar Imagery for Adaptive AUV Missions"** (WHOI / OCEANS 2016). **Closest prior art for survey-referenced detection.**
  - Local saliency: filter-bank histograms compared with neighbours, scale-space extrema.
  - **Online rarity against a summary of the current mission.**
  - Per-ping running-mean normalization.
  - It reports **no false-positive rate**: "there is no false positive rate… because our algorithm is not trained to detect wreckage".
  - No deep features, no range-stratified reference, no calibrated p-values, no cross-sensor evaluation.
- **PatchCore** (Roth et al., CVPR 2022, *canonical*) and **AnomalyDINO** (DINOv2 patch kNN, 2024): **global** memory of normal patches.
- **MuSc** (Li et al., ICLR 2024): zero-shot anomaly detection by **mutual scoring among unlabeled test images**. General precedent for "the test data are the reference".
- **Public SIH 2026 repositories** (`jayasuriyasr/SIH_2026`, `jeevanandamD/SIH_2026`) describe YOLOv8n, **PatchCore with ResNet-18 and a global seabed memory**, a "45-degree offset" shadow heuristic, and a weighted evidence sum. **Global-memory PatchCore is what competing teams already present.**

### 1.4 Target–shadow reasoning
- Classical MCM: highlight/shadow segmentation and classification (Reed et al.; Myers & Fawcett, *IEE Proc. Radar Sonar Navig.* 2004, "Automated approach to classification of mine-like objects in sidescan sonar using highlight and shadow information"). Model-based highlight classification.
- Recent: shadow-aided decoupling heads with a physics-informed geometric loss (2025); illumination + shadow low-rank models (Ocean Engineering 2025); context-adaptive shadow/highlight fusion (arXiv 2506.01445, 2025).
- **Shadow-length height** h = H·L_s / (G + L_s) is textbook. The public SIH repo `Vedjamkar/Marinedetect` already implements it with synthetic validation.

### 1.5 Multi-look / temporal / persistence
- **Multi-aspect SSS classification with Dempster–Shafer fusion** (Fawcett, Myers et al., *"Multiaspect Classification of Sidescan Sonar Images: Four Different Approaches to Fusing Single-Aspect Information"*). Multi-instance and DS frameworks for multiple views.
- Track-before-detect exists for passive sonar and radar, not for SSS imagery targets.
- GhostVision tracking persistence (above).

### 1.6 Local background, CFAR, conformal
- **Acosta & Villar, "Accumulated CA–CFAR Process in 2-D for Online Object Detection From Sidescan Sonar Data"** (IEEE JOE 40(3), 2015): intensity CA-CFAR for SSS highlights and reverberation.
- **Nonparametric CFAR:** rank-sum and rank-quantization detectors (IET RSN 2020; EURASIP 2023/2026). The **rank of the cell under test among reference cells**, with guard cells. This is mathematically a **conformal p-value**.
- **Conformal anomaly detection** (Laxhammar & Falkman, *canonical*; `nonconform`, arXiv 2605.13642). Conformal p-values with **BH-FDR** for outlier testing (Bates et al., Ann. Statist. 2023, *canonical*).
- CFAR ≈ conformal equivalence is noted in applied work (Sensors 2026, optical-fibre alarm filtering).
- **Deep CFAR:** CFARnet (Signal Processing 2024), DF-CFAR (2025), BPNN-CFAR for sonar (IET SP 2023). These learn CFAR-constrained detectors; they are not local conformal tests on deep features.
- Hyperspectral **dual-window local RX** and deep dual-window variants: local-background anomaly scoring in another modality.

### 1.7 Domain shift and representation
- Syn2Real domain generalization for mine-like objects (arXiv 2410.12953), domain-adaptive shipwreck detection (Scientific Reports 2024; Ocean Engineering 2025), style transfer (MFSANet).
- **BenthicDINO** (Hamoda, Rajani, Gracias, arXiv 2608.23215, Aug 2026): physics-informed DINOv3 self-distillation with range-dependent attenuation and speckle simulation, and an **HSIC penalty to decouple features from viewing geometry**. It handles range dependence at **training** time. Evaluated on S3Seg segmentation.
- **Mine-JEPA** (CVPRW / MaCVi 2026): in-domain SSL on 1,170 SSS images beats fine-tuned DINOv3 for mine classification. Also: **applying in-domain SSL to foundation models degraded performance by 10–13 pp.**
- Dual-frequency SSS fusion: Xian et al. (IET RSN 2026), D²FNet (≈ 9,000 paired images).

### 1.8 Calibration and fusion
- Detection calibration: Küppers et al. (CVPRW 2020, D-ECE); "On Calibration of Object Detectors" (ECCV 2024).
- Conformal object detection: two-step conformal boxes (ECCV 2024), sequential risk control (arXiv 2505.24038), probabilistic CP detection (arXiv 2605.07549).
- Dempster–Shafer: established in multi-view MCM (1.5).

---

## 2. The central problem: class ≡ sensor

**What the confound breaks** (from the audit and plan):
1. Per-class metrics are per-sensor metrics. PIPELINE = Klein 3500 tiles, SHIPWRECK = EdgeTech 2205 waterfalls, CRAB_POT = Humminbird Roboflow crops.
2. The detector can use sensor texture as a class cue. Cross-domain hallucinations were observed (CRAB_POT on Klein pipeline frames; PIPELINE on AI4 terrain).
3. Any **global** anomaly reference measures distance to the reference sensor. `open_set_v1` (SubPipe-only memory) flags 64 % of PING observations.

**What cannot be fixed with current data:** no dataset contains two target classes from the same sensor, and no dataset contains the same target class from two sensors. **No method can prove sensor-independent class recognition on these data.** A defensible contribution must therefore either:
- (i) avoid relying on class labels across sensors, or
- (ii) measure the confound explicitly.

The selected primary does (i); supporting contribution 1 does (ii).

---

## 3. Candidate evaluations

Scores are 1 (weak) to 5 (strong).

### A. PERSIST-Sonar (physics-informed persistent open-set contact reasoning)

| Field | Assessment |
|---|---|
| **CORE IDEA** | Candidates → embeddings → sequential association → Contacts → persistence + shadow + local anomaly → reliability-aware fusion → calibrated Contact confidence |
| **FORMULATION** | For Contact C with looks {o_i}: P(C artificial) = f(persistence(n_obs, n_opp), shadow(o_i), anomaly(o_i), detector(o_i); availability masks) |
| **WHAT IS ACTUALLY NEW** | Nothing substantive. Each stage exists; the integration is a system pipeline. |
| **CLOSEST PRIOR ART** | GhostVision (tracking persistence fused with confidence); multi-aspect SSS classification with DS fusion (Fawcett, Myers et al.); highlight+shadow MCM classifiers; PatchCore / Kaeli for anomaly |
| **DIFFERENCE** | Naming and assembly only |
| **PS RELEVANCE** | High (false-positive control, unknowns, confidence) |
| **DATA REQUIRED** | Multi-look observations of the same objects. **Not available** for point targets. SubPipe gives single-pass linear targets only; PING has no ping order; AI4 has no pass metadata. |
| **COMPLEXITY / EDGE COST** | Medium / low |
| **EXPERIMENT / BASELINE / ABLATION** | Contact-level P/R with and without each channel; possible only partially (SubPipe) |
| **METRICS** | Contact precision/recall, FP per 1,000 pings |
| **FAILURE MODE** | Ablation cells mostly N/A; judges recognize the GhostVision/MCM lineage |
| **EXPECTED FIGURE** | Pipeline diagram (not evidence) |
| **PUBLICATION POTENTIAL** | Low (systems description) |
| **SIH DEMO IMPACT** | Medium–high visually, **high risk under questioning** |
| **Scores** | Novelty 1 · Defensibility 2 · PS fit 4 · Measurability 3 · Data 2 · Implementation 3 · Demo 4 |
| **VERDICT** | **NOT NOVEL. Do not headline.** Keep persistence as an evidence channel only where pixel-disjoint looks exist (SubPipe). |

### B. Local seabed-conditioned open-set anomaly detection (as posed)

| Field | Assessment |
|---|---|
| **CORE IDEA** | A_local(x) = d(φ(x), M_local), with M_local = background from the current survey |
| **FORMULATION** | A_local(x) = min_{m ∈ M_local} ‖φ(x) − m‖, flag if A_local > τ |
| **WHAT IS ACTUALLY NEW** | As posed, **nothing**. Survey-referenced rarity is Kaeli 2016; test-data-as-reference is MuSc; local-background contrast is CA-CFAR in SSS (Acosta & Villar 2015) and dual-window RX in hyperspectral. |
| **CLOSEST PRIOR ART** | Kaeli 2016; MuSc 2024; Acosta & Villar 2015 |
| **DIFFERENCE** | Deep detector features instead of filter-bank histograms. Alone, that is incremental. |
| **PS RELEVANCE** | Very high (unknown anomalies, natural-vs-artificial *partially*, sensor variability) |
| **DATA REQUIRED** | Unlabeled survey imagery (have); GT boxes for evaluation (have) |
| **COMPLEXITY / EDGE COST** | Low / negligible |
| **EXPERIMENT** | Local vs global memory, per-sensor FPR and TPR |
| **FAILURE MODE** | An uncalibrated τ reintroduces a per-sensor threshold problem; "local" is undefined in SSS geometry (range dependence) |
| **PUBLICATION POTENTIAL** | Low as posed |
| **Scores** | Novelty 2 · Defensibility 3 · PS fit 5 · Measurability 4 · Data 4 · Implementation 4 · Demo 4 |
| **VERDICT** | **NOT NOVEL as posed. The right direction.** Made specific and calibrated in **E1**. |

### C. Sonar target–shadow geometric consistency

| Field | Assessment |
|---|---|
| **CORE IDEA** | Highlight/shadow pairing, far-range shadow asymmetry, shadow length, height ratio |
| **FORMULATION** | Δ = z_far − z_near against a range-matched background; h/H = (g(r_f + L) − g(r_f)) / g(r_f + L), g(r) = √(r² − w²) (see the previous plan, D3) |
| **WHAT IS ACTUALLY NEW** | Nothing methodologically. Only our corrected geometry for these datasets and the measurement. |
| **CLOSEST PRIOR ART** | Myers & Fawcett 2004; Reed et al.; shadow-aided heads (2025); competitor SIH repo (shadow height) |
| **COMPUTABLE FROM OUR DATA** | AI4 and SubPipe: yes (rows = pings, columns = range, nadir at the centre column; verified). PING: **no** (random rotations and flips, no nadir). Metric height: SubPipe Chunk1–2 only (train split, DVL altitude); AI4 dimensionless only. |
| **PS RELEVANCE** | High (acoustic shadows, raised vs flat) |
| **FAILURE MODE** | Rocks cast shadows; buried or low-profile targets have none; the far band is truncated at swath edge |
| **EXPECTED FIGURE** | Measured far/near profile on a held-out wreck (the "acoustic geometry panel") |
| **PUBLICATION POTENTIAL** | None as novelty |
| **SIH DEMO IMPACT** | High (physically intuitive) |
| **Scores** | Novelty 1 · Defensibility 3 (conditional on D3) · PS fit 4 · Measurability 4 · Data 3 · Implementation 3 · Demo 5 |
| **VERDICT** | **NOT NOVEL.** Keep as a **measured physics evidence channel** (previous plan, D3) and as the rationale for E1's row guard. |

### D. Reliability-aware Contact evidence fusion

| Field | Assessment |
|---|---|
| **CORE IDEA** | Channels with signal s_k, reliability r_k, availability m_k; missing ≠ negative |
| **OPTIONS WEIGHED** | **Dempster–Shafer with discounting:** needs mass assignments we cannot estimate or validate; rejected. **Bayesian accumulation:** needs per-channel likelihoods under both hypotheses; only estimable where channel labels exist; partially possible. **Conformal:** valid for per-channel p-values, and Fisher-combinable only for independent looks. **Availability-masked logistic regression fit on validation:** validatable with our data; **chosen**. |
| **FORMULATION** | logit P(TP \| x) = β₀ + Σ_k m_k (β_k·s_k + γ_k), with m_k ∈ {0, 1}. A missing channel contributes exactly 0; γ_k absorbs the base-rate shift when a channel is present. Fit on `val`, evaluate once on `test`; isotonic post-calibration if ECE improves. |
| **WHAT IS ACTUALLY NEW** | Nothing (missing-indicator logistic models and Platt/isotonic calibration are textbook) |
| **CLOSEST PRIOR ART** | Platt scaling; Küppers 2020; DS multi-view MCM fusion |
| **DATA REQUIRED** | Val/test detections with TP labels (have: SubPipe, PING; AI4 SHIPWRECK has no TPs) |
| **FAILURE MODE** | Too few TPs in val for some channels; channels available only on one sensor create sensor-specific weights (confound again). Report per sensor. |
| **Scores** | Novelty 1 · Defensibility 4 · PS fit 3 · Measurability 4 · Data 3 · Implementation 4 · Demo 2 |
| **VERDICT** | **NOT NOVEL. Necessary for correctness.** Supporting contribution 2. |

### E1 (own). Survey-referenced, range-matched conformal anomaly test (B made specific) — **SELECTED PRIMARY**

| Field | Assessment |
|---|---|
| **CORE IDEA** | Test each candidate against **acoustically comparable seabed from the same survey**: same sonar side, same slant-range band, rows away from the candidate (so its shadow and footprint are guarded out). Use frozen detector features, and convert the score to a **split-conformal p-value** so the false-alarm rate is chosen per survey. Optional BH over the survey controls analyst workload (FDR). |
| **FORMULATION** | See §6.3 |
| **WHAT IS ACTUALLY NEW (to our knowledge)** | (1) **SSS-geometry reference design:** side × slant-range band × along-track annulus with a row guard that removes the target footprint and its acoustic shadow, applied in a **deep feature space**. (2) **Split-conformal calibration within that reference**, giving per-survey, per-range false-alarm control without a sensor-specific global threshold. (3) **An empirical test of false-alarm validity across three sonars** (Klein 3500, EdgeTech 2205, Humminbird) under a class–sensor-confounded detector. (4) **Zero extra network passes:** cells come from the detector's own tiled forward pass. |
| **CLOSEST PRIOR ART** | Kaeli 2016 (survey-referenced saliency+rarity, handcrafted, no FPR); Acosta & Villar 2015 (intensity CA-CFAR in SSS); rank nonparametric CFAR (rank = conformal p); conformal anomaly detection + BH (Bates et al.); PatchCore / AnomalyDINO (deep features, global memory); MuSc (test data as reference); BenthicDINO (range invariance by training) |
| **DIFFERENCE** | Kaeli: no deep features, no calibrated false-alarm rate, no range stratification, no quantitative evaluation. CFAR: raw intensity, parametric or rank on a scalar, no learned representation. PatchCore / competitors: global memory, fixed threshold, sensor-dependent. BenthicDINO: needs SSL training and does not calibrate detection. **The combination is the contribution. No single component is new.** |
| **PS RELEVANCE** | Unknown anomalies ✔; false-positive control ✔ (operator-set α); varying sensors/resolution ✔; natural vs artificial: **partial**, since it detects *local acoustic anomalies*, including rocks; edge ✔ |
| **DATA REQUIRED** | Held-out test imagery of all three sensors plus GT boxes (have). No labels for calibration (the reference is unlabeled survey seabed). No training. |
| **IMPLEMENTATION COMPLEXITY** | Moderate: cell-embedding cache, reference builder, conformal scoring, baselines, evaluation (≈ 12–16 h) |
| **EDGE COST** | Negligible: kNN of ≤ ~20 candidate cells against ≤ ~500 reference cells × 128-d per candidate, plus a sort over ≤ ~300 calibration statistics. Sub-millisecond to low-millisecond on CPU. No extra detector passes (features hooked in the same forward). |
| **EXPERIMENT / BASELINE / ABLATION / METRICS** | §6 |
| **FAILURE MODE** | Exchangeability breaks at substrate boundaries and in rock fields (true local anomalies, "false" for artificiality). Reference contamination by unlabeled objects. Large wrecks filling the reference band reduce power. Tiny references (PING crops) give coarse p-values (minimum ≈ 1/(1 + n_cal)). Features trained on confounded data may be insensitive to some targets. |
| **EXPECTED FIGURE** | Realized false-alarm rate vs nominal α per sensor (global memory vs ours), plus a p-value map on a held-out AI4 wreck that the detector misses |
| **PUBLICATION POTENTIAL** | Moderate. Applied-methods paper or workshop (OCEANS, MaCVi, IEEE JOE letter) **if** validity holds across sensors and power beats intensity CFAR. Not a top-venue theory paper. |
| **SIH DEMO IMPACT** | High: "the operator sets 5 % false alarms and gets ≈ 5 % on three different sonars", plus a visual p-value overlay |
| **Scores** | Novelty 3 · Defensibility 4 · PS fit 5 · Measurability 5 · Data 4 · Implementation 4 · Demo 5 |

### E2 (own). Confound-aware evaluation protocol — **SELECTED SUPPORTING 1**

| Field | Assessment |
|---|---|
| **CORE IDEA** | Measure how much sensor identity drives our detector and anomaly scores, instead of asserting class performance |
| **FORMULATION** | (i) **Sensor probe:** logistic regression predicting sensor from layer-16 embeddings of *background-only* crops (train on train, test on test). Accuracy near 1 means the features encode sensor. (ii) **Background hallucination matrix H[s, c]:** detections of class c per 1,000 background cells of sensor s at the runtime floor. Off-diagonal mass is domain-driven class hallucination. (iii) **Per-sensor background false-alarm rate** of every anomaly score (global vs E1). |
| **WHAT IS NEW** | Low methodological novelty (shortcut-learning audits are known; Geirhos et al. 2020, *canonical*). We found **no SSS work that audits class–sensor confounding**. |
| **DATA / COST** | Existing test splits; minutes of compute |
| **FAILURE MODE** | None scientifically. It may show the detector is strongly confounded, which is the point. |
| **EXPECTED FIGURE** | 3×3 hallucination heat-map + sensor-probe accuracy |
| **Scores** | Novelty 2 · Defensibility 5 · PS fit 3 · Measurability 5 · Data 5 · Implementation 5 · Demo 3 |

### E3 (own). Cross-frequency independent-look corroboration

| Field | Assessment |
|---|---|
| **CORE IDEA** | SubPipe records the same pings at 455 and 900 kHz. Speckle decorrelates across frequency; real targets persist. Combine per-look conformal p-values with Fisher's method: X = −2 Σ log p_i ~ χ²_{2m} under an independent null. |
| **CLOSEST PRIOR ART** | Dual-frequency SSS fusion detectors (Xian et al., IET RSN 2026; D²FNet); multispectral backscatter |
| **NEW** | Late, statistically combined corroboration rather than image fusion. Modest. |
| **DATA** | SubPipe only; one target class (pipelines); cross-frequency independence of *clutter* is an assumption to test |
| **Scores** | Novelty 2 · Defensibility 4 · PS fit 3 · Measurability 3 · Data 2 · Implementation 4 · Demo 3 |
| **VERDICT** | Optional ablation inside the primary's Contact-level experiment. Not a headline. |

### E4 (own). Analyst-workload control via BH-FDR over conformal p-values

| Field | Assessment |
|---|---|
| **CORE IDEA** | Flag the set of candidates whose BH-adjusted p ≤ q. Under PRDS conformal p-values, the expected fraction of background among flagged candidates is ≤ q: "at most q of what we send you is expected to be seabed". |
| **CLOSEST PRIOR ART** | Bates et al. 2023 (conformal outlier testing with BH), *canonical* |
| **NEW** | Application to SSS survey triage only |
| **VERDICT** | **Folded into E1** as its decision layer. Not a separate claim. |

### E5 (own, minor). Water-column / nadir geometric gating
Reject candidates inside the measured water column or on the nadir line (SubPipe/AI4). Trivial and prior-art-level. **Engineering hygiene, not novelty.**

### Scoring matrix

| Candidate | Novelty | Defensibility | PS fit | Measurability | Data | Implementation | Demo | Decision |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| A PERSIST-Sonar | 1 | 2 | 4 | 3 | 2 | 3 | 4 | Reject as novelty |
| B Local anomaly (as posed) | 2 | 3 | 5 | 4 | 4 | 4 | 4 | Refine into E1 |
| C Target–shadow | 1 | 3 | 4 | 4 | 3 | 3 | 5 | Evidence channel |
| D Reliability fusion | 1 | 4 | 3 | 4 | 3 | 4 | 2 | Supporting 2 (correctness) |
| **E1 Range-matched conformal** | **3** | **4** | **5** | **5** | **4** | **4** | **5** | **PRIMARY** |
| E2 Confound audit | 2 | 5 | 3 | 5 | 5 | 5 | 3 | Supporting 1 |
| E3 Cross-frequency | 2 | 4 | 3 | 3 | 2 | 4 | 3 | Optional ablation |
| E4 BH triage | 2 | 4 | 4 | 4 | 4 | 5 | 4 | Inside E1 |

---

## 4. Model question: is YOLO11s still the right candidate generator?

**Yes. Keep it frozen.**

1. **The primary contribution is detector-agnostic.** It scores any candidate, and in proposal mode needs no detector at all. A better detector raises the ceiling but does not change the scientific claim.
2. **Evidence that the architecture is not the bottleneck:** GhostVision found YOLOv12, YOLO26 and RF-DETR all reach F1 ≈ 0.71–0.73 after post-processing on the same data.
3. **Swapping invalidates everything frozen:** the open-set memory (tied to layer 16 of `2aa3ac71…`), thresholds, held-out metrics, demo evidence.
4. **RF-DETR** (DINOv2 backbone, ICLR 2026, Apache-2.0): likely better small-object recall. It requires GPU retraining and does not touch the class–sensor confound, and our SHIPWRECK failure is a **label and sampling** problem (diagnosed), not an architecture problem.
5. **RT-DETR / DETR variants:** same argument.
6. **Segmentation:** masks exist only for AI4; the S1 attempt failed (val box P 0.003). No.
7. **Self-supervised encoder:** Mine-JEPA shows in-domain SSL can match DINOv3 on small SSS data, but requires pretraining. BenthicDINO addresses range invariance by training. **Worthwhile as a representation ablation for E1 using a frozen DINOv2-S/14** (no training; weights not in the repository and must be fetched). Not as a replacement.

**Architecture stance:** YOLO11s remains the fast candidate generator. The research contribution sits **after** detection, in how candidates are tested against their own survey's seabed.

---

## 5. Selection

| Role | Contribution | One line |
|---|---|---|
| **PRIMARY** | **Survey-referenced, range-matched conformal anomaly test (E1, with E4 as decision layer)** | Distribution-free, per-survey false-alarm control for SSS candidates by testing them against same-side, same-range, row-guarded seabed from the same survey in detector feature space |
| **SUPPORTING 1** | Confound-aware evaluation protocol (E2) | Measures how much sensor identity drives our detector and anomaly scores |
| **SUPPORTING 2** | Availability-masked, validation-calibrated Contact fusion (D) | Missing evidence is neutral, not negative; outputs a calibrated Contact score with decomposition, replacing the demo sigmoid |
| Evidence channels (not novelties) | Shadow asymmetry (C), pixel-disjoint persistence and cross-frequency (A/E3) | Enter fusion only where geometry or independent looks exist |

---

## 6. Paper-grade experiment for the primary contribution

### 6.1 Research question
Can a survey-referenced, range-matched conformal test on frozen detector features flag seabed objects at an operator-chosen false-alarm rate that **holds across three different side-scan sonars**, where a globally referenced anomaly memory does not? And does it retain useful sensitivity to objects, including objects the supervised detector misses?

### 6.2 Hypotheses (pre-registered)
- **H1 (validity):** on randomly placed held-out background windows, realized FPR(α) ≤ α + 0.02 at α ∈ {0.01, 0.05, 0.10} **in each sensor** (upper 95 % CI bound). The global-memory baseline violates this in ≥ 1 sensor.
- **H2 (power at equal false alarms):** at equal realized FPR (5 %), TPR(E1) ≥ TPR(global memory) in ≥ 2 of 3 sensors (paired bootstrap).
- **H3 (geometry matters):** the range-stratified reference beats an isotropic local reference in TPR at α = 0.05 (SubPipe, AI4).
- **H4 (representation matters):** deep-feature E1 beats an **intensity rank-CFAR** with identical windows at α = 0.05. If not, the deep features add nothing and we say so.
- **H5 (system value):** as an evidence channel, E1 improves detection precision at matched recall (SubPipe, PING). In proposal mode it recovers AI4 wrecks that YOLO misses (SHIPWRECK recall 0) at controlled FDR.

### 6.3 Method and formulation

**Geometry.** SubPipe and AI4: rows = pings p, columns = slant-range samples; nadir column x₀ estimated per image; water-column half-width w_wc from a seabed-line pick. Side σ = sign(x − x₀). Range coordinate r = |x − x₀| (pixels). PING: range axis unknown (Roboflow rotations and flips), so it uses the **isotropic** variant only, reported separately.

**Cells.** Hook YOLO11s layer 16 in the **same** tiled forward pass used for detection (768² tiles, imgsz 640). Average-pool the 80×80 map to 20×20 cells (≈ 38 px native for 768 tiles; 32 px for 640 full frames) and L2-normalize: u(c) ∈ ℝ¹²⁸. Cells inside the water column are removed from all sets.

**Candidate window.** A candidate (detector box or proposal) covers cell set W* (h × w cells). Its statistic is

> T(W*) = max_{c ∈ W*} s(c),  with s(c) = (1/k) Σ_{j ∈ kNN_k(u(c), 𝓜)} ‖u(c) − u(j)‖₂, k = 3.

**Reference region.**

> 𝓡(W*) = { c : σ(c) = σ*, |r(c) − r̄*| ≤ Δr, g_p ≤ |p(c) − p̄*| ≤ G_p, c ∉ water column, c ∉ any *detector* box }

- Δr = max(2 cells, ½ × range extent of W*); g_p = ½ × row extent of W* + 2 cells; G_p = g_p + 40 cells.
- The **row guard** excludes the candidate's own footprint *and its shadow* (the shadow lies in the same pings).
- **Only runtime-available information** (detector boxes) is excluded. Ground truth is never used.
- **Isotropic variant (PING, and ablation):** all cells at Chebyshev distance ≥ 2 cells from W* in the same image.

**Split conformal.** Partition 𝓡 by alternating along-track blocks of 2 cells into a memory set 𝓜 and a calibration set 𝓒. Compute T for **every** placement of an h × w window fully inside 𝓒, scored against 𝓜: {T_j}, j = 1…N. Then

> p(W*) = (1 + #{ j : T_j ≥ T(W*) }) / (1 + N).

If W* is exchangeable with the calibration placements (background from the same local distribution), P(p ≤ α) ≤ α. **This is the per-survey, per-range CFAR property, without parametric clutter models.**
- **Trimmed variant (ablation):** drop the top 2 % of T_j before ranking (OS-CFAR analogue against contamination).

**Decisions.**
- CFAR mode: flag if p ≤ α.
- **Triage mode (E4):** Benjamini–Hochberg at level q over all candidates in the survey.

**Selection caveat (stated in results).** Validity applies to *unselected* windows. For detector-selected candidates, the rate of p ≤ α among detector false positives is reported as **false-positive survival**, not as validity.

### 6.4 Training procedure
**None.** The detector is frozen (`2aa3ac71…`). There is no memory bank to build: the reference is the test survey itself. Hyperparameters (k, Δr, g_p, G_p, cell size, trimming) are **fixed before looking at test**. If tuning is needed, it happens on `val` only (SubPipe val, PING val, AI4 val + terrain val), and the frozen set is recorded in `manifest.json`.

### 6.5 Validation procedure (`val` only)
Sanity-check p-value uniformity on val background windows per sensor (QQ plot; Kolmogorov–Smirnov against U(0,1)). Choose the trimmed/untrimmed variant and k ∈ {1, 3, 5} by val validity, then freeze.

### 6.6 Test procedure (held-out `test`, once)
- **Background validity set:** per sensor, ≥ 2,000 randomly placed windows with shape sampled from that sensor's object-window size distribution. They lie in annotation-free regions, zero IoU with GT boxes dilated by 32 px. **GT is used only to choose evaluation windows, never inside the reference.** SubPipe frames are taken 25 s apart (pixel-disjoint); PING uses one image per augmentation parent.
- **Object power set:** all test GT objects (AI4 wrecks as merged mask components ≥ 1,024 px; SubPipe pipelines; PING crab pots).
- **Detector-candidate set:** YOLO detections (runtime path, recovery off, floor 0.05), labelled TP/FP at IoU 0.5.
- **Proposal set (AI4):** all non-overlapping windows of 3 × 3 cells over each test image. A hit is a window overlapping a GT wreck mask by ≥ 25 % of the window.

### 6.7 Baselines
| ID | Baseline | Why |
|---|---|---|
| B0 | YOLO raw confidence | Detector-only reference |
| B1 | `open_set_v1` **as deployed** (mean-of-cells query, fixed τ = 0.4617) | The current system; matches what competitors do |
| B2 | Global SubPipe memory, per-cell max score (PatchCore-correct), τ at val q95 per sensor | Fair global baseline |
| B3 | Global **multi-sensor** memory (train background of all three sensors) | "Just add more reference data" |
| B4 | **Intensity rank-CFAR** (rank-sum of window mean intensity) with the identical reference design | Tests whether deep features matter (H4) |
| B5 | E1 with **isotropic** reference | Tests whether range geometry matters (H3) |
| B6 (optional) | E1 on frozen DINOv2-S/14 features | Representation ablation |

### 6.8 Ablations

Ablation 1, method components (the core table):

| Row | Reference scope | Guard | Features | Calibration |
|---|---|---|---|---|
| R1 | global (train memory) | – | YOLO L16 | fixed τ |
| R2 | same image, isotropic | – | YOLO L16 | conformal |
| R3 | same survey, **range-stratified** | – | YOLO L16 | conformal |
| R4 | same survey, range-stratified | **row / shadow guard** | YOLO L16 | conformal |
| R5 | = R4 + trimming | guard | YOLO L16 | conformal (trimmed) |
| R6 | = R4 | guard | **raw intensity** | rank-CFAR |
| R7 (opt.) | = R4 | guard | DINOv2-S | conformal |

Ablation 2, Contact-level system (the user's requested structure, modified to be scientifically valid; N/A cells stay N/A):

| Configuration | SubPipe | AI4 | PING |
|---|---|---|---|
| Detector only | ✔ | ✔ (≈ no TPs) | ✔ |
| + persistence (pixel-disjoint 25-s windows; Fisher combination) | ✔ | N/A (no pass metadata) | N/A (no ping order) |
| + local conformal anomaly (E1) | ✔ | ✔ | ✔ (isotropic) |
| + acoustic shadow (only if D3 passes) | ✔ | ✔ | N/A (orientation lost) |
| Full: availability-masked logistic fusion, fit on val | ✔ | ✔ | ✔ |

*Modification rationale:* persistence and shadow are physically undefined on some datasets. Filling those cells would fabricate an ablation.

### 6.9 Metrics
- **Primary:** per-sensor **TPR at nominal α = 0.05**, reported **with the realized per-sensor FPR** (validity).
- **Secondary:**
  - realized FPR vs α ∈ {0.01, 0.05, 0.10} (calibration curve)
  - within-sensor AUROC and AUPRC (prevalence stated)
  - realized FDR under BH at q = 0.1
  - FP survival rate for detector false positives
  - Contact-level precision at matched recall and **FP per 1,000 pings** (SubPipe)
  - AI4 proposal-mode wreck recall at q = 0.1 and false flags per image
  - latency (ms per frame, CPU and MPS)
  - FPR vs local seabed complexity (lacunarity of the reference region), showing where exchangeability breaks
  - E2 outputs: sensor-probe accuracy and hallucination matrix

### 6.10 Statistical tests
- **Validity:** cluster-bootstrap 95 % CI of realized FPR per sensor (clusters: 60-s blocks for SubPipe, recording for PING, wreck site for AI4). H1 holds if the upper bound ≤ α + 0.02. Clopper–Pearson reported alongside for transparency.
- **Power comparisons:** paired cluster bootstrap (B = 2,000) of TPR difference at equal realized FPR, and of AUROC difference.
- **Uniformity (val):** KS test and QQ plots.
- **Multiplicity:** Holm correction across H1–H5.

### 6.11 Failure analysis
- Top-100 background windows with p ≤ α per sensor, labelled: rock outcrop / relief, sand-wave crest, substrate boundary, nadir or water-column artefact, reference contamination (unlabeled object), acquisition artefact (dropout band).
- Missed objects (p > α): buried pipeline sections, low-contrast pots, wrecks larger than the reference band.
- Report where exchangeability fails. That is the honest limitation slide.

### 6.12 Compute
- Offline experiment on M5 Pro (MPS), reusing the cached detector passes from the previous sprint's T1.
- Cell caches: SubPipe test at 25-s spacing ≈ 1.1k tiles × 20×20×128 fp16 ≈ 110 MB; AI4 test (tiled large waterfalls) and PING test (one image per parent) are of similar order.
- Scoring: < 5 ms per frame on CPU.
- Whole test evaluation, including bootstraps: ≈ 1–3 h wall time.
- **No GPU training.**

### 6.13 Implementation plan (not started; awaiting approval)

| Step | File (new, under `ml/experiments/round2/rsc/`) | Output | Est. |
|---|---|---|---|
| 1 | `cells.py`: layer-16 hook inside the harness's tiled / full-frame inference; nadir and water-column estimate; cache per image | `artifacts/round2/rsc/cells/*.npz` + manifest | 3–4 h |
| 2 | `reference.py`: side × range-band × row-guard reference (+ isotropic, global variants), memory/calibration split, trimming | unit-tested reference builder | 2–3 h |
| 3 | `score.py`: kNN window-max statistic, conformal p-values, BH | p-values for background / object / candidate / proposal sets | 2 h |
| 4 | `baselines.py`: B1–B5 (+ optional B6) | baseline scores | 2–3 h |
| 5 | `evaluate.py`: validity curves, TPR@α, AUROC / AUPRC, FDR, Contact-level ablation, bootstrap, Holm, figures | `metrics.json`, `figures/` | 3–4 h |
| 6 | `confound_probe.py` (supporting 1) | sensor-probe accuracy, hallucination matrix | 1–2 h |
| 7 | `fusion_fit.py` (supporting 2): availability-masked logistic on val, isotonic check, test once | calibrated Contact scores, reliability diagrams | 2 h |

- **Implementation total ≈ 15–20 h.** It depends on the previous sprint's T1 harness (manifest + inference cache, 4–6 h) if that is not built yet.
- **Experiment runtime and analysis ≈ 8–12 h.**
- **Runtime integration** (behind a flag, into `app.py` / Contact fusion) happens **only after** H1–H5 results exist.

### 6.14 How it replaces the previous sprint's D1
D1 (open-set: objectness vs domain) becomes rows R1–R3 plus E2 of this experiment. Persistence (D2) and shadow (D3) remain evidence-channel experiments feeding Ablation 2. Calibration (CAL) becomes supporting contribution 2.

---

## 7. Claims

**Safe novelty claim, only if H1 and H2 hold:**
> "To our knowledge, Aqualens is the first side-scan sonar pipeline that tests each candidate against acoustically comparable seabed from the same survey (same side, same slant-range band, footprint and shadow excluded) in detector feature space, and returns a distribution-free p-value. The operator sets the false-alarm rate, and we measured that it holds on three different sonars, where a globally referenced anomaly memory flags a different sensor's seabed wholesale. It builds on nonparametric CFAR, conformal anomaly detection and survey-referenced saliency (Kaeli 2016). Its novelty is the SSS-specific reference design and the cross-sensor validation."

**If H1 fails:**
> "Survey-referenced testing reduced but did not remove sensor dependence (realized FPR …). We report it as an advisory local-anomaly map."

Drop the novelty claim in that case.

**Claims we must not make:**
- "Detects artificial / unknown objects". It detects *local acoustic anomalies*, rocks included.
- "New anomaly-detection theory"; "first survey-referenced sonar anomaly detection" (Kaeli 2016).
- "Domain-invariant features"; "guaranteed false-alarm rate in all seabeds". The guarantee holds only under local exchangeability; boundaries and rock fields violate it.
- "PERSIST-Sonar is a novel method"; "novel shadow-based verification"; "novel evidence fusion".
- Any comparison "better than GhostVision".
- Any metric before the experiment exists.

**Killer PPT figure (data-driven; shown whether it succeeds or fails):**
- **Left:** realized false-alarm rate vs nominal α for Klein 3500 (SubPipe), EdgeTech 2205 (AI4Shipwrecks), Humminbird (PING). Global-memory anomaly (as deployed, and as competitors do it) vs ours, with 95 % CIs; the diagonal is ideal.
- **Right:** a held-out AI4 wreck waterfall where the supervised detector finds nothing (SHIPWRECK recall 0), overlaid with the conformal p-value map at α = 0.01. The same-side range band and row guard are drawn, and a local false alarm on a rock outcrop is labelled as such.

---

## Appendix — Sources consulted this session
- GhostVision: https://github.com/PINGEcosystem/GhostVision · https://www.mdpi.com/2077-1312/14/10/951
- PINGMapper: https://agupubs.onlinelibrary.wiley.com/doi/abs/10.1029/2022EA002469
- GhostNetZero: https://www.microsoft.com/en-us/research/wp-content/uploads/2025/09/GhostNetAI_TechReport.pdf
- SeaClear2: https://www.seaclear2.eu/automated-methods-for-underwater-litter-mapping/ · https://www.cml.fraunhofer.de/en/research-projects/SeaClear.html
- Kaeli 2016: https://www2.whoi.edu/staff/jkaeli/wp-content/uploads/sites/141/2019/11/Kaeli2016-AnomalyDetection.pdf (IEEE Xplore 7778653)
- Coffelt & Christensen 2021: https://orbit.dtu.dk/en/publications/anomaly-detection-in-side-scan-sonar/
- Kapetanović et al. 2020: https://www.sciencedirect.com/science/article/pii/S2405896320318735
- Acosta & Villar 2015: https://www.semanticscholar.org/paper/365e9521a7348a399e23dbe384e7d7fface048b5
- Fawcett, Myers et al., multi-aspect DS fusion: https://www.semanticscholar.org/paper/17818764849a342f1c5239dda1496075628bb9ac
- Myers & Fawcett 2004 (highlight / shadow): https://digital-library.theiet.org/doi/10.1049/ip-rsn%3A20040117
- Shadow / highlight 2025: https://arxiv.org/abs/2506.01445 · https://www.sciencedirect.com/science/article/abs/pii/S0029801825014179
- Nonparametric rank CFAR: https://ietresearch.onlinelibrary.wiley.com/doi/full/10.1049/iet-rsn.2019.0472 · https://link.springer.com/article/10.1186/s13634-023-01032-z
- CFARnet: https://arxiv.org/pdf/2208.02474 · DF-CFAR: https://link.springer.com/article/10.1007/s00521-025-11246-x
- Conformal anomaly detection: https://arxiv.org/abs/2605.13642 · https://doi.org/10.3390/s26165174
- MuSc: https://arxiv.org/abs/2401.16753 · AnomalyDINO: https://arxiv.org/html/2405.14529v2
- BenthicDINO: https://arxiv.org/abs/2608.23215 · Mine-JEPA: https://arxiv.org/abs/2604.00383
- Sonar open-set: https://www.nature.com/articles/s41598-025-04877-6 · https://www.sciencedirect.com/science/article/abs/pii/S0957417424003609
- Domain generalization: https://arxiv.org/pdf/2410.12953 · https://www.nature.com/articles/s41598-024-63501-1
- Dual-frequency SSS: https://ietresearch.onlinelibrary.wiley.com/doi/10.1049/rsn2.70122
- Detection calibration: https://arxiv.org/abs/2004.13546 · conformal detection: https://arxiv.org/abs/2403.07263 · https://arxiv.org/pdf/2505.24038
- RF-DETR: https://arxiv.org/pdf/2511.09554 · https://github.com/roboflow/rf-detr
- Competitor public repos (context only): https://github.com/jayasuriyasr/SIH_2026 · https://github.com/jeevanandamD/SIH_2026 · https://github.com/Vedjamkar/Marinedetect

*End. No code, model, runtime, or configuration was modified.*
