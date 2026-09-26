# DATA STRATEGY

Verification status: ✅ verified against a primary source during architecture lock (2026-08-30)
· ⚠️ conflicting sources · ❔ from the brief, unverified. Never quote a ❔ or ⚠️ figure in a
claim — see `docs/CLAIMS_AND_EVIDENCE.md`.

---

## 1. Dataset inventory

### A. SubPipe — **INTERNAL NOW · P0 · primary**

| | |
|---|---|
| Source | REMARO / OceanScan-MST, LAUV pipeline inspection near Porto, Portugal ✅ |
| URL | `https://github.com/remaro-network/SubPipe-dataset` · Zenodo `10.5281/zenodo.10053564` ✅ |
| Licence | **GPL-3.0** ✅ — see §4, this constrains redistribution |
| Sensor | Klein 3500 SSS ✅ |
| Domain | LF 455 kHz @ 2500×500 (5,000 img) · HF 900 kHz @ 5000×500 (5,030 img) ✅ |
| Annotations | COCO **and** YOLO; 3,163 LF + 3,172 HF = **6,335** ✅ |
| Classes | pipeline (single class), partially sand-buried in places ✅ |
| Navigation | **Yes — INS CSV**: EstimatedState, Depth, Acceleration, AngularVelocity, Rpm, … ✅ |

**Why it is the backbone of the internal build.** It is the only P0 dataset with *real
navigation*, so it is the only route to a genuine `L2_TRACK_RELATIVE` geolocation
demonstration rather than a demo-metadata one. It has *two real frequencies*, so cross-frequency
robustness is measurable rather than asserted. And its 5000×500 waterfall strips are long
enough that our own 512×512 / 50 %-overlap tiling manufactures ~18 windows per strip — which is
what makes USP 2 demonstrable without depending on anyone's ping metadata.

**Weaknesses.** One class, one site, one sensor, one mission environment. It cannot on its own
support a multi-class detector or a domain-shift claim. Partially buried pipeline is a genuinely
hard positive — good for the demo, but expect lower recall there and report it rather than
tuning it away.

### B. AI4Shipwrecks — **INTERNAL NOW · P0 · primary**

| | |
|---|---|
| Source | UM Field Robotics, Thunder Bay National Marine Sanctuary, Lake Huron ✅ |
| URL | `https://umfieldrobotics.github.io/ai4shipwrecks/` · DOI `10.7302/dmf4-x492` (Deep Blue) ✅ |
| Licence | **⚠️ not confirmed** — dataset page returned 403 during lock. **Confirm on download before any redistribution or publication.** |
| Sensor | ❔ brief says Iver3 AUV + EdgeTech — not independently verified |
| Size | 286 high-resolution PNG images ✅ · ~1.14 GB ❔ |
| Sites | **⚠️ brief says 28 wrecks; dataset page says 24 sites. Unresolved.** |
| Annotations | expert pixel-wise segmentation masks ✅ |
| Classes | wreck (includes associated debris field) ✅ |

**Why.** It supplies the second unified class, the only pixel-level masks, and a genuine
**site-aware split** — the dataset exists partly to make the point that shuffling overlapping
sonar tiles inflates results. Use its official split as given.

**Weaknesses.** Small (286 images, ~161 with wrecks ❔). Freshwater Great Lakes, not marine —
a real domain difference from SubPipe's Atlantic coastal site, which is useful for robustness
reporting and must be disclosed rather than glossed. No navigation metadata expected → capped
at `L1` unless proven otherwise.

**⚠️ Both open questions above must be resolved by observation at download time and written
back into `configs/datasets/ai4shipwrecks.yaml`. Until then no site count and no licence claim
appears in any deliverable.**

### C. PINGEcosystem Ghost Pot SSS — **INTERNAL NOW *if unblocked* · P0-conditional**

| | |
|---|---|
| URL | `https://huggingface.co/datasets/PINGEcosystem/sss-crab-pot-detection-ds` ✅ |
| Licence | CC-BY-SA-4.0 ✅ |
| Access | **GATED** ✅ — a human must accept terms and share contact details. Not automatable. |
| Size | 6,674 images, ~559 MB ❔ · bbox annotations ✅ |
| Classes | `Crab-Pot`, `Maybe-Crab-Pot` ✅ |
| Models | `PINGEcosystem/gv-yolo12`, `gv-yolo26`, `gv-rf-detr` — `model.safetensors` + `weights.onnx`, **no `.pt`**, CC-BY-SA-4.0 ✅ |

**Why it matters and why nothing blocks on it.** It adds derelict fishing gear — the class
closest to the problem statement's "entangled debris / fishing nets" — and it takes the unified
taxonomy from 2 classes to 3, which materially strengthens the king-USP leave-one-class-out
evaluation (3 folds instead of 2). But it is gated on a human action, so **it is additive, not
load-bearing**. The build starts and completes without it.

**⚠️ Corpus discrepancy — must accompany any comparison.** GhostVision's published model
experiments used **3,110** manually annotated images ✅; the repository holds **6,674**. These
are not the same corpus. We report our own numbers on our own split and never claim
comparability with their F1 (~0.71–0.73).

**Two separate licences.** The CC-BY-SA-4.0 *dataset* licence and the CC-BY-SA-4.0 *model*
licence are distinct grants. Both are ShareAlike — see §4.

### D. Marine-PULSE — **FINALS LATER · P2**

Source: SSS recognition of marine engineering structures ✅. 323 pipeline/cable + 134 residual
mound + 88 seabed surface + 82 engineering platform ✅. Sensors: EdgeTech 4200FS, EdgeTech
4200MP, Benthos SIS-1624, Klein-2000, Klein-3000 ✅ — genuinely multi-instrument. Pre-divided
train/test ✅.

**Image-level labels, not boxes.** Registered `annotation_type: IMAGE_LABEL`; a loader
requesting `BBOX` will not see it. **We do not synthesise boxes from image labels.** Its finals
value is sensor diversity and the `seabed_surface` class as clean negatives.

### E. DeeperSense SSS corpus — **FINALS LATER · P2**

434,164 patches, 384×384, **192 px overlap**, from waterfalls off the coast of Catalunya;
categories include rock, sand ripple, mud, posidonia, coral, artificial reefs ✅. Zenodo
`10.5281/zenodo.10209444` ✅. ~52 GB ❔.

Released for self-supervised SSS pretraining. Finals use: SSL encoder pretraining and a
domain-general normality bank. **Marked `eval_eligible: false` at registry level** so a query
cannot pull it into any test split. Excluded from the internal build purely on cost — see
`docs/ARCHITECTURE.md` §0 item 2.

### F. GhostNetZero data — **LITERATURE ONLY · never a dataset**

239 Baltic + 173 Puget Sound segments ❔; no confirmed public release. Registered
`access: LITERATURE_ONLY`. We cite its **domain-shift finding** (Baltic-trained models degrade
on Puget Sound), which is methodologically sound and directly shapes our per-survey
thresholding. We never cite its ~90 % centroid figure as a benchmark: small *n*, no reserved
test set.

---

## 2. Canonical internal representation

Every dataset is converted once, into one shape. Downstream code never sees dataset-specific
formats.

```
data/raw/<dataset_id>/                 untouched download, read-only, sha256 manifest
        │
        │  scripts/ingest_<dataset_id>.py     ← the ONLY dataset-specific code in the project
        ▼
data/interim/<dataset_id>/
    frames/<frame_id>.png              full-resolution source raster, unmodified pixels
    frames/<frame_id>.json             CanonicalFrame sidecar
    nav/<mission_id>.csv               normalised: t, lat, lon, heading_deg, altitude_m, speed_mps
        │
        │  scripts/build_tiles.py       512×512, 50 % along-track overlap
        ▼
data/processed/<snapshot_id>/
    tiles/<tile_id>.png
    labels/<tile_id>.txt               YOLO format, unified class indices
    tiles.jsonl                        CanonicalTile records
    split.json                         group-wise train/val/test assignment
    snapshot.json                      frozen: source hashes, tiling params, git sha
```

### `CanonicalFrame` sidecar

```jsonc
{
  "frame_id": "subpipe_hf_000412",
  "dataset_id": "subpipe",
  "source_filename": "…", "sha256": "…",
  "width_px": 5000, "height_px": 500,
  "sensor": "Klein 3500", "frequency_khz": 900.0,
  "mission_id": "subpipe_chunk_02", "site_id": "porto_pipeline",
  "group_key": "subpipe_chunk_02",           // the leakage-control unit
  "geometry": {
    "along_track_axis": "COLS", "along_sign": 1,
    "across_origin": "NADIR_CENTRE", "channel": "DUAL",
    "range_geometry": "UNKNOWN",
    "nadir_offset_px": null, "range_scale_m_per_px": null,
    "ping_index_start": null, "ping_stride": null, "altitude_m": null,
    "level": "L0_PIXEL_ONLY", "level_reason": "nadir not yet estimated"
  },
  "annotation_type": "BBOX",
  "licence": "GPL-3.0",
  "capability_gates": { "nav_available": true, "ping_order_recoverable": true,
                        "nadir_recoverable": null, "range_scale_known": false }
}
```

`geometry.level` is recomputed by `sagar.preprocess` after nadir estimation. It is never set by
the ingest script and never asserted by hand.

### Unified class taxonomy (`configs/classes.yaml`)

| Index | Unified class | Source | Internal status |
|---|---|---|---|
| 0 | `PIPELINE` | SubPipe `pipeline` | P0 |
| 1 | `WRECK_OR_STRUCTURAL_DEBRIS` | AI4Shipwrecks `wreck` (incl. debris) | P0 |
| 2 | `DERELICT_FISHING_GEAR` | PINGEcosystem `Crab-Pot` (+ `Maybe-Crab-Pot`, `certainty: UNCERTAIN`) | P0-conditional |
| — | `ENGINEERING_STRUCTURE` | Marine-PULSE | P2 |

`UNKNOWN_ANOMALY_CANDIDATE` is **not** in this table and is never a supervised class.

`Maybe-Crab-Pot` is carried as a `label_certainty` attribute, never silently merged. Metrics are
reported under a **strict** protocol (certain labels only) and an **inclusive** protocol.
Quietly folding uncertain labels into the positive class inflates recall and reviewers look
for it.

---

## 3. Leakage control

Group-wise splitting only. `group_key` per dataset: SubPipe → mission/chunk id;
AI4Shipwrecks → wreck/site id (use the official split); PINGEcosystem → recording id, falling
back to filename/spatial block **flagged `strength: WEAK`** and disclosed in any result using it.

**Tiling makes leakage worse, not better** — tiles at 50 % overlap are near-duplicates by
construction. Therefore splits are assigned **at frame level, before tiling**, and every tile
inherits its parent frame's split. `sagar.evaluation` refuses a tile-level split.

Five assertions run inside the pipeline and are written to `RunManifest.split_assertions`:

```
A. group overlap train ∩ test        == ∅
B. group overlap train ∩ val         == ∅
C. perceptual-hash near-duplicates   == 0   across splits
D. eval_eligible == false rows in val/test  == 0
E. every test group has ≥1 positive
```

`scripts/make_benchmarks.py` refuses to publish metrics from a run where any assertion failed.

**Feedback leakage** is the sixth, and the one that is easy to miss: operator-reviewed
detections fed back into training must not come from frames in the active val/test split.
Enforced in `sagar.memory`, asserted by `tests/test_feedback_leakage.py`.

---

## 4. Licence obligations — read before shipping anything

| Asset | Licence | Obligation |
|---|---|---|
| SubPipe | **GPL-3.0** | Copyleft. Safe for local training and evaluation. **Do not redistribute the data, and treat any question of distributing artifacts derived from it as unresolved until a human decides.** Flagged, not silently assumed away. |
| PINGEcosystem dataset | CC-BY-SA-4.0 | Attribution + ShareAlike |
| GhostVision models | CC-BY-SA-4.0 | Attribution + ShareAlike — **a separate grant from the dataset licence** |
| AI4Shipwrecks | ⚠️ unconfirmed | Confirm at download; no redistribution until confirmed |

The internal demo runs locally and redistributes nothing, so none of this blocks the build. It
is recorded here so that a decision to publish weights or data is made deliberately.

---

## 5. Acquisition order

```
1. SubPipe          open  ·  scripts/acquire_subpipe.py        ← start here, unblocks everything
2. AI4Shipwrecks    open  ·  scripts/acquire_ai4shipwrecks.py  ← resolve ⚠️ site count + licence
3. PINGEcosystem    GATED ·  needs Parv to accept HF terms, then HF_TOKEN in .env
4. Marine-PULSE / DeeperSense                                   finals only
```
