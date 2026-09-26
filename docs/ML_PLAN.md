# ML PLAN — Internal Hackathon

Conservative and explicit by instruction. Every choice below has a stated fallback, and no step
depends on a gated dataset or on cloud compute.

Hardware: MacBook Pro M5 Pro, 24 GB unified memory, PyTorch MPS,
`PYTORCH_ENABLE_MPS_FALLBACK=1`.

---

## 1. The experimental design in one line

> **Baseline:** GhostVision `gv-yolo12`, released sonar-domain model, run off-the-shelf.
> **Ours:** a YOLO detector we fine-tune on our unified multi-class sonar corpus.
> **Compared on our own held-out, group-wise, leakage-asserted test split.**

This is a real experiment with a real control, and it satisfies "establish a sonar-specific
pretrained baseline", "fine-tune one lightweight detector" and "compare against baseline" in one
structure.

**An honesty constraint on that comparison, which must appear beside it every time:** the
baseline is a *single-class crab-pot* model and our test split contains pipelines and wrecks.
Reporting "we beat GhostVision" from that comparison would be dishonest. What the baseline
legitimately measures is **how far a strong off-the-shelf sonar model transfers to unseen
target types** — which is a genuinely interesting result and the honest framing. Where the
PINGEcosystem class is unblocked, a like-for-like `DERELICT_FISHING_GEAR`-only comparison
becomes available and *that* one is a fair head-to-head.

---

## 2. Primary baseline

`PINGEcosystem/gv-yolo12` ✅ — `model.safetensors` (37 MB) + `weights.onnx` (37 MB),
class `Crab-Pot`, input 640×640, CC-BY-SA-4.0.

Run via ONNX for the baseline evaluation only. **`RunManifest.device` must record
`onnxruntime:CPUExecutionProvider`** — ORT has no MPS provider on macOS, so the baseline's
latency is a CPU number and is labelled as such. It is never compared head-to-head against our
MPS latency without that qualification.

---

## 3. Initialisation — and the risk that decides it

**There is no `.pt` checkpoint in any GhostVision model repo** ✅ — only `safetensors` and
`onnx`. Ultralytics fine-tuning expects a `.pt`. Whether the safetensors state-dict keys map
cleanly onto an Ultralytics YOLOv12 architecture is **unverified and must not be assumed**.

```
SPIKE S1 (timeboxed 90 min, first ML task):
  attempt: YOLO('yolo12s.yaml') → load_state_dict(safetensors, strict=False)
  measure: % of keys matched, and whether a forward pass reproduces ONNX outputs
           on 10 fixed images within tolerance
  PASS → initialise from GhostVision weights (better sonar-domain init)
  FAIL → initialise from Ultralytics COCO-pretrained weights
  Either outcome is recorded in the model card. Do not spend more than 90 minutes.
```

**The plan of record is the FAIL branch** — COCO-pretrained init, which is guaranteed to work.
A PASS is upside, not a dependency. This is the difference between a plan and a hope.

---

## 4. Dataset, splits, preprocessing

**Datasets:** SubPipe (P0) + AI4Shipwrecks (P0), + PINGEcosystem if unblocked.
**Annotation formats:** SubPipe ships COCO and YOLO ✅; AI4Shipwrecks ships masks → converted to
both boxes (detector) and masks (segmentation, P1). Canonical form: YOLO txt + unified class
indices, per `docs/DATA_STRATEGY.md` §2.

**Splits:** group-wise, **assigned at frame level before tiling** (SubPipe → mission/chunk;
AI4Shipwrecks → official site split). Ratio ≈ 70/15/15 by group, not by image. Five leakage
assertions must pass or the run is invalid — `docs/DATA_STRATEGY.md` §3.

**Preprocessing** (`sagar.preprocess`, applied identically at train and inference — the same
code path, not a reimplementation):
1. grayscale load, RAW retained unmodified
2. nadir estimation → geometry descriptor → `SpatialReferenceLevel`
3. CLAHE + light speckle suppression → ENHANCED layer
4. quality scoring; unusable tiles excluded and counted in the manifest
5. tile 512×512, 50 % along-track overlap
6. letterbox to 640×640, grayscale replicated to 3 channels

**Augmentation — sonar-valid only. This is a correctness requirement, not a tuning knob.**

| Augmentation | | Note |
|---|---|---|
| Along-track flip | ✅ | survey direction is arbitrary |
| **Across-track flip** | ✅ **only with channel-label swap** | flipping across-track reverses `u_range`; a naive `fliplr` teaches physically impossible shadow geometry |
| Arbitrary rotation | ❌ | destroys along/across axis semantics |
| HSV / colour jitter | ❌ | meaningless on acoustic backscatter |
| Intensity / gamma jitter | ✅ | gain and substrate variation |
| **Multiplicative speckle** | ✅ | official requirement 3 |
| **Range-dependent gain jitter** | ✅ | TVG residual; official requirement 4 |
| **Ping dropout / row duplication** | ✅ | heave, pitch, roll artefacts; official requirement 6 |
| Along-track scale jitter | ✅ | vehicle speed variation |
| Mosaic / mixup | ❌ v1 | fabricates impossible seabed continuity and corrupts context evidence |

The four ✅ sonar-specific augmentations map one-to-one onto official requirements 3, 4 and 6.
State that mapping when presenting; it is a direct answer to three requirements.

---

## 5. The fine-tuning experiment (M1)

| | |
|---|---|
| Model | Ultralytics YOLO, **s** scale (n if throughput demands it) |
| Input | 640 |
| Classes | 2 (P0) or 3 (PINGEcosystem unblocked) |
| Epochs | **80**, early stop patience 15, best-on-val checkpoint |
| Batch | 16 (fall back to 8 on MPS memory pressure) |
| Sampling | dataset-balanced — SubPipe otherwise dominates ~35:1 by image count |
| Expected size | ~14k tiles from ~15k source frames; **one overnight run**, not a sweep |
| Seeds | 1 for the internal build. Multi-seed variance → finals. |

**MPS considerations, stated because they will bite:**
- `PYTORCH_ENABLE_MPS_FALLBACK=1` is required; some ops silently fall back to CPU.
- MPS has no deterministic mode — record the seed, do not claim bit-exact reproducibility.
- Watch unified-memory pressure: 24 GB is shared with the OS, the browser and the dev server.
  Close the frontend during training.
- AMP on MPS is less mature than on CUDA. Start fp32; only try AMP if epoch time forces it.
- Benchmark epoch time on **one** epoch before committing to 80.

**Output artifacts (all required):**
```
models/<model_id>/weights.pt · model_card.yaml · args.yaml
runs/<run_id>/manifest.json · metrics.json · artifacts/{curves,confusion,failure_cases}/
data/snapshots/<snapshot_id>/  (frozen sample list + split)
```

---

## 6. Open-set / unknown anomaly path (KING USP)

Deliberately lightweight, and it needs **no dataset beyond the ones we already train on**.

```
1. FEATURES   our fine-tuned detector's backbone, P3+P4 feature maps,
              adaptively pooled and concatenated → D ≈ 320-512 per patch
              (sonar-domain AND task-relevant, because we trained it)
2. BANK       patch embeddings from annotation-free background regions of
              TRAIN-SPLIT tiles only.  Greedy k-centre coreset → |M| ≈ 30-50k × D, fp16 (~40 MB)
3. SCORE      per-patch nearest-neighbour distance → bilinear upsample → Gaussian smooth
4. THRESHOLD  tau = max(tau_min_global, quantile(this survey's scores, 0.995))
              PER-SURVEY, not global — absolute distances shift across sensors and basins
              (the GhostNetZero domain-shift finding). Also bounds FP burden by construction:
              at q99.5 at most 0.5 % of patches can ever be proposed.
5. PROPOSE    threshold → connected components → area filter
              → Candidate(source=OPEN_WORLD, category=UNKNOWN_ANOMALY_CANDIDATE,
                          class_confidence=None)
6. SUPPRESS   proposals with IoU > 0.3 against a known detection are ABSORBED into it,
              contributing anomaly_score as a fusion feature. Unknown means unknown.
```

**Schema-enforced:** `category == UNKNOWN_ANOMALY_CANDIDATE` ⟹ `class_confidence is None`.
A validator rejects any record naming a class for an unknown. Operator-facing wording is fixed
at **"Unknown anomaly candidate requiring review"**.

**Evaluation — leave-one-class-out.** Train on all classes but one; treat the held-out class as
genuinely unknown; measure whether the open-set path flags it. With 2 classes this is 2 folds;
with PINGEcosystem, 3. Metrics: region-level AUROC, AUPRC, and FPR on annotation-free seabed.
AUPRC matters more than AUROC — positives are rare.

**Fallback if AUROC is poor:** report it. A measured AUROC of 0.6 with an honest description of
why is a defensible result; a fabricated 0.9 is not. The *protocol executing* is the P0
deliverable; a specific score is not.

---

## 7. Temporal persistence strategy (USP 2)

The target is stationary; the vehicle moves. In image space a target appears to drift between
overlapping windows, which is why naive trackers need motion models. **In PICS its
`(ping, range_m)` is constant.** Association is therefore clustering with a fixed gate, not
tracking — far more robust and far less code.

**Two modes, and the first one always works:**

| Mode | Source | Availability |
|---|---|---|
| `WINDOW_OVERLAP` | our own 50 %-overlap tiling of one frame | **always** — we control the tiling |
| `SEQUENTIAL_PING` | adjacent frames in a real recording | where nav/ping order exists (SubPipe) |

```
n_obs             detections in the cluster
n_opportunities   windows whose ping AND range extent actually cover that PICS location
support_ratio     n_obs / n_opportunities
persistence_score Wilson lower bound of support_ratio at 90 %
scatter           std of observed PICS positions (m at L2+, px otherwise)
applicable=false  when n_opportunities == 1  → reason SINGLE_WINDOW_COVERAGE
```

Wilson rather than the raw ratio, because 1/1 and 8/8 are not the same evidence and a raw ratio
says they are.

---

## 8. Acoustic-shadow strategy (USP 3)

Minimal credible implementation, all in PICS, all along `u_range`.

```
0. require u_range (L1+). Else applicable=false, reason=NADIR_NOT_RECOVERABLE
1. RANGE-MATCHED BACKGROUND: across-track profile mu(range), sigma(range) over the tile
2. shadow band: immediately +u_range of the candidate, same along-track extent,
   length capped at 3 x candidate across-track extent
3. contrast_z   = (mu(range) - mean(band)) / sigma(range)
4. continuity   = fraction of along-track rows in the band below mu - 1.5*sigma
5. ordering_ok  = bright highlight present immediately -u_range of the dark region
6. shadow_score = bounded combination of 3, 4, 5
```

**Step 1 is the whole difficulty.** Intensity falls with range, so comparing a far-range object
against a global image mean makes every distant object look shadowed. Range-matching the
background is the difference between a working module and a plausible-looking broken one.

`applicable=false` when the candidate is in the water column/nadir band, or within the cap
distance of the far-range edge (truncated shadow), or geometry is unknown.

**P1 (only where `altitude_m` and `range_scale_m_per_px` are both known — SubPipe nav supplies
depth):** `implied_height_m = H·L/(R+L)`, emitted with its `height_assumptions` list
(flat seabed, object on bottom, altitude known, shadow untruncated). **Not a 3-D
reconstruction**, and labelled as a range-geometry estimate everywhere it appears.

**What we claim, precisely.** Shadow evidence separates *real raised objects* from speckle and
texture artefacts. It does **not** on its own separate man-made from natural — rocks cast
shadows too. It is one channel of eight in fusion, weighted by fitted data, not by assertion.

---

## 9. Fusion and calibration (M2)

No hand-tuned weights, no fusion neural network. An L2 logistic regression on 8 features, fitted
on **validation only**, evaluated on test:

```
calibrated_det_logit · persistence_wilson · log1p(n_opportunities) · shadow_score
shadow_applicable · context_z · clutter_density · anomaly_score
```

Detector confidence is first calibrated by isotonic regression on val, so `0.8` means 0.8.
Nine parameters total — auditable, unable to meaningfully overfit, and producing the
per-feature log-odds contributions the Detection Inspector renders as a waterfall.

Coefficients committed to `models/fusion/fusion_lr.json` with a model card.

---

## 10. Training order

```
0. SPIKE S1 — safetensors loadability (90 min, timeboxed)
1. Dataset snapshot + splits + 5 leakage assertions   ← nothing trains until this passes
2. M1 detector fine-tune (overnight)
3. Evidence modules (no training; unit-tested against synthetic fixtures)
4. Open-set memory bank (needs M1 backbone) → unblocks the KING USP
5. M2 calibration + fusion (needs M1 + evidence on val)
6. Ablations A0–A6 → metrics.json → benchmarks.json
7. P1: segmentation head on AI4Shipwrecks masks
```

Step 1 gates everything deliberately. **A detector trained on a leaking split is worse than no
detector, because its numbers look good.**

---

## 11. Fallback strategy if our fine-tuned model underperforms

Decided in advance so it is a plan, not a panic. Evaluated on the val split at step 2.

| Situation | Action |
|---|---|
| Ours < baseline on the shared class | **Ship it and report it.** An honest negative result with a stated cause (2 classes, ~14k tiles, single seed, one overnight run vs a purpose-built 3,110-image single-class model) is defensible. Fabricating a win is not. |
| Ours collapses on one class | Report per-class metrics — already required. Investigate class balance; do **not** drop the class to improve the headline. |
| mAP unusably low across the board | Fall back to **YOLO-n at 640 with a longer schedule**, or reduce to the single strongest class for the *detector demo* while the pipeline still runs all classes. Record the reduction in scope in `STATUS.md`. |
| Training does not converge in time | The demo runs on the **GhostVision baseline model** end-to-end. Every other subsystem — evidence, open-set, change, priority, memory — is model-agnostic and still works. **The product does not depend on our model being good.** |
| Open-set AUROC poor | Report the measured value. Protocol execution is the deliverable. |

The last row is the important structural property: **the architecture is designed so that a
disappointing training result degrades one number, not the demo.**

---

## 12. Postponed to finals

Full DeeperSense SSL pretraining · PhysDNet-style physics decomposition · multi-seed statistical
runs · larger backbones and hyperparameter sweeps · RF-DETR and YOLO26 comparison · instance
segmentation for entangled-net morphology · deep ensembles / conformal uncertainty · Core ML and
INT8 export with on-device benchmarking · cross-line corroboration · pixel-level co-registered
change detection · rented NVIDIA compute for any of the above.
