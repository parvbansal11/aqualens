# RESEARCH — Canonical Local Research Source

Local canonical copy of the project research context (published artifact:
HTML source at `docs/architecture-brief.html`).

**Verification status legend:** ✅ verified against a primary source during architecture lock
(2026-08-30) · ⚠️ conflicting sources, unresolved · ❔ from the project brief, not independently
verified.

---

## 1. The problem (SIH26057)

Ministry of Earth Sciences / NIOT. Category: Software. Theme: Disaster Management.
No dataset supplied by the organisers.

NIOT asks for an end-to-end automated CV pipeline that ingests side-scan sonar (SSS), separates
artificial targets from complex natural seabed, handles speckle / varying resolution / acoustic
shadows / heave-pitch-roll dropouts, detects or segments man-made objects (wrecks, pipes,
cylinders, entangled gear), scores confidence, suppresses rock and natural-feature false
positives, reads sonar/nav metadata, geolocates, emits JSON/CSV, exposes an operator UI with
downloadable reports, and is efficient enough for eventual edge/AUV deployment.

**The primary technical objective is separating natural seafloor topology from artificial
anomalies.** Everything else is downstream of that.

## 2. Domain facts that drive the design

SSS is acoustic backscatter, not photography. Intensity depends on seabed reflectivity,
incidence angle, propagation loss, terrain geometry, shadowing, frequency, altitude and
substrate. The raster has physical axes: one is sequential pings (along-track), one is acoustic
return range (across-track). Acoustic shadows, temporal persistence and navigation metadata are
therefore *exploitable signals*, not incidental artefacts.

Georeferencing is conceptually: ping/nav position + heading + range geometry + pixel location →
geographic location. PINGMapper is the reference implementation for raw SSS processing,
trackline smoothing, range calculation and georectification.

## 3. Prior work

**GhostVision** (Bodine et al., *JMSE* 2026) — closest operational reference. ✅
Low-cost SSS, derelict crab pots, YOLOv12 / YOLO26 / RF-DETR, temporal tracking, georeferencing
via PINGMapper, evaluated end-to-end on complete recordings. Roughly F1 0.71–0.73 after
filtering/optimisation; processing ~10–11× faster than acquisition duration.
**Trained on 3,110 manually annotated images** ✅ — the public dataset repository now holds
6,674. Not the same corpus. Baseline and reference, not a clone target, and not a comparable
benchmark.

**GhostNetZero** (Microsoft AI for Good + WWF Germany, 2025) ❔ — DeepLabV3 + ResNet50 semantic
segmentation of ghost nets, Baltic + Puget Sound. ~90 % operational centroid detection in some
configurations, but only 239 Baltic + 173 Puget Sound annotated segments and **no reserved test
set** — so the headline figure is not an independent-test benchmark and must never be cited as
one. Its methodologically sound and directly usable finding is **geographic domain shift**: a
Baltic-only model degraded substantially on Puget Sound; training across both improved
robustness. This is the single most important external result for our design, and it is why our
open-set thresholding is per-survey rather than global.

**AI4Shipwrecks** ✅ — demonstrates evaluation must split by independent wreck/site rather than
randomly shuffling overlapping sonar imagery.

**PhysDNet / physics-guided SSS** ❔ — shadow, reflectivity, terrain and propagation can be
treated as physically meaningful decomposable components. Deferred to finals.

## 4. Dataset facts verified during architecture lock

Full inventory, licences and usage decisions: `docs/DATA_STRATEGY.md`.

| Fact | Status |
|---|---|
| GhostVision models published as `model.safetensors` + `weights.onnx`, **no `.pt`**, CC-BY-SA-4.0 | ✅ |
| PINGEcosystem ghost-pot dataset is HF-gated (human must accept terms) | ✅ |
| SubPipe licence is **GPL-3.0**; Zenodo `10.5281/zenodo.10053564` | ✅ |
| SubPipe SSS: Klein 3500, LF 455 kHz @ 2500×500 (5,000 img), HF 900 kHz @ 5000×500 (5,030 img), 6,335 annotations, COCO + YOLO | ✅ |
| SubPipe includes INS/nav CSV (EstimatedState, Depth, Rpm, …) | ✅ |
| AI4Shipwrecks: 286 images, Thunder Bay NMS, Lake Huron; DOI `10.7302/dmf4-x492` | ✅ |
| AI4Shipwrecks site count: brief says 28 wrecks, dataset page says **24 sites** | ⚠️ **unresolved — resolve on download, do not quote a number until then** |
| DeeperSense: 434,164 patches, 384×384, **192 px overlap**, coast of Catalunya; Zenodo `10.5281/zenodo.10209444` | ✅ |
| Marine-PULSE: 323 POC + 134 URM + 88 SS + 82 EP; EdgeTech 4200FS/4200MP, Benthos SIS-1624, Klein-2000/3000; pre-split | ✅ |

The AI4Shipwrecks ⚠️ row is the template for how this project handles uncertainty: it is
recorded, it blocks a specific claim, and it is resolved by observation rather than by picking
the more convenient number.

## 5. The five differentiators (fixed — do not add a sixth)

1. **Open-set / unknown anomaly detection** (KING)
2. **Temporal persistence verification**
3. **Acoustic-shadow validation**
4. **Survey-to-survey change detection**
5. **Recovery priority engine**

Plus one architectural property that is deliberately *not* marketed as a USP:
**persistent intelligence** — the system does not treat every survey as its first.

## 6. Non-negotiable honesty constraints

Never invent dataset provenance, classes, sonar metadata, confidence, detections or benchmarks.
Never call a crab-pot detector a ghost-net detector. Never present demo GPS as sonar-derived.
Never call a heuristic a learned model. Never claim self-learning when only feedback storage
exists. Never hide failure cases. Never compare across incompatible evaluation protocols without
qualification. Every important claim carries a provenance/evidence path
(`docs/CLAIMS_AND_EVIDENCE.md`).
