# VNEXT pre-training adversarial audit

Final pre-training audit of Aqualens VNEXT for SIH PS 26057. Not a redesign; targeted
fixes only, applied where a concrete scientific/architectural/leakage/training-blocking
defect was found. No training run, no frozen-weight change, no held-out test access.

## PS fit

VNEXT algorithmically/architecturally addresses: known-class detection (frozen YOLO11s),
speckle/dropout/resolution/shadow robustness *measurement* (`SonarConditionEngine`,
generation-only perturbation harness), acoustic-shadow evidence without artificiality
inference, confidence/evidence filtering (`UNVALIDATED_EVIDENCE_FUSION`, always labelled
unvalidated), false-positive suppression (natural-clutter classifier interface, now with a
real evaluation path — see Audit 11), geolocation (explicitly null unless calibrated),
edge/local operation (local YOLO11s inference, SQLite review memory), human review
(append-only), and report generation (JSON/CSV). Open-set/unknown-candidate handling exists
as an interface (`OpenSetEvidence`) but is **not wired into the runtime pipeline** —
`open_set_candidate` is hardcoded `False` in every contact today. This is honest (no false
claim is made anywhere that unknown-candidate detection is live), but if any demo or slide
implies "open-set discovery is running," that is not true yet — disclose it explicitly.

No PS requirement is claimed-but-unimplemented that I could find; the one gap (open-set
inert) is already consistent with the freeze doc's "absent by default" framing.

## Contact/Event audit — CRITICAL FIX APPLIED

`packages/sagar/vnext/contacts.py`'s `fuse_contacts` grouped findings by `frame_index`,
which `packages/sagar/api/app.py:298` sets **per uploaded source image**, not per tile and
not per ping. Every tile-level detection from one raster's overlapping-tile pass
(`TILE_OVERLAP=0.30` in `perception/runtime.py`) therefore shared one `frame_index`, so
duplicate/adjacent detections from overlapping tiles of a *single static raster* were
indistinguishable from genuine cross-frame (temporal/sequential) persistence — exactly the
conflation the audit brief called out as unacceptable. `persistence_score` could jump from
0.15 (single observation) to ~0.86 for what was really one physical object caught by two
overlapping tiles.

This is not hypothetical: `evidence/persistence.py` (pre-existing, used by
`pipeline/internal_v2.py`) already encodes this exact distinction correctly — it labels
tile-window evidence `mode: "WINDOW_OVERLAP"` and never calls it temporal persistence.
`vnext/contacts.py` reintroduced the conflation for the new runtime path.

**Fix applied** (`packages/sagar/vnext/contacts.py`): persistence is now computed from the
count of *distinct* `frame_index` values in a group, not raw observation count. New fields:
`distinct_frame_observation_count`, `window_overlap_duplicate_count`,
`persistence_evidence_type` (`TRUE_SEQUENTIAL_PERSISTENCE` / `WINDOW_OVERLAP_ONLY` /
`SINGLE_OBSERVATION`). `observation_count` is unchanged (still the raw count) so nothing
existing regresses; the new fields are additive (frontend contract requires tolerance of
absent VNEXT fields). Regression test added:
`test_window_overlap_within_one_frame_is_not_temporal_persistence` in `tests/test_vnext.py`.

Other Audit-2 checks: class incompatibility is enforced (`raw_class` must match); excessive
association distance is bounded (35 m real-world or 0.12 normalized fallback); duplicate
`detection_id` records are correctly de-duplicated before grouping (existing test); contact
IDs are a stable hash of member detection IDs (deterministic). One large object fragmenting
into many contacts is still possible if NMS in `perception/runtime.py` leaves a boundary
fragment with low IoU to the main box — the new fields make this visible
(`window_overlap_duplicate_count > 0` on a `SINGLE_OBSERVATION`-class-adjacent contact) but
do not merge it; that is the correct conservative behaviour (never silently merge).

## Sonar condition audit — FIX APPLIED

Flag naming reviewed against "describe measurable conditions, don't diagnose causes."
`CENTRAL_DARK_BAND_ESTIMATED` was already correctly hedged. `HORIZONTAL_DROPOUT` was not: a
near-full-width near-black row band (`row_black >= .92`) can be sensor dropout, a legitimate
long acoustic shadow, or the nadir gap itself — the old name asserted a specific cause.
**Fixed**: renamed to `HORIZONTAL_DARK_BAND` with a comment stating the engine measures the
band, not its cause (`packages/sagar/vnext/conditions.py`); two test assertions updated.
`LOW_DYNAMIC_RANGE` and `HIGH_INVALID_PIXEL_FRACTION` were already measurement-only names —
no change needed. Black-pixel fraction vs. dropout vs. shadow: the engine correctly treats
all near-black pixels as one measured quantity and never claims which cause applies; the
overlap with a legitimate low-contrast seabed is inherent to any purely-pixel-statistic
measure and is appropriately disclosed via `quality_flags` rather than a hard classification.

## Acoustic physics audit — DISCLOSURE ADDED, no behaviour change

`verify_candidate` in `packages/sagar/vnext/physics.py` correctly returns
`UNKNOWN_ORIENTATION`/all-null whenever `nadir_x` is `None`, and the live runtime
(`app.py:303`) always passes `None` today ("Orientation is intentionally unknown unless
supplied by calibrated acquisition metadata") — so the axis logic below is currently dead
code in production, not a live bug.

However, it embeds an assumption that is **not** universal in this codebase: it treats the
image's horizontal axis (`nadir_x`, a column) as across-track/range. `pipeline/internal_v2.py`
(PICS block) uses the *opposite* convention — it derives `along_centre_px` from x and
`across_centre_px`/port-starboard from y (a row-based `nadir_offset_px`). If a future caller
ever wires a row-based nadir offset into `verify_candidate` without checking which axis its
raster actually uses, shadow-direction search would run along the wrong axis and silently
produce a plausible-looking but wrong `physics_consistency` score. **Fix applied**: added an
explicit warning comment in `physics.py` documenting this axis mismatch and instructing any
future integrator to verify the raster's layout before passing a real nadir value. No
behaviour changed (still returns null with no orientation), and `SHADOW_IS_NOT_ARTIFICIALITY`
is unconditionally present whenever physics *is* computed — the module correctly never infers
artificiality from a shadow alone.

## Open-set audit

`OpenSetEvidence.is_open_set_candidate` requires both a score and an explicit threshold —
never derived implicitly. `open_set_candidate` is hardcoded `False` in every runtime contact
(no adapter wired), so today no candidate can ever be mislabeled `UNKNOWN ARTIFICIAL
CANDIDATE` — the risk this audit is checking for cannot currently fire because the feature
is inert, not because it is calibrated. Disclose that open-set is interface-only. Minor gap:
`ModelRegistry.health()` does not report an `open_set`/anomaly-model entry alongside
`natural_clutter`/`rfdetr`/`mask_refiner` — cosmetic, post-SIH.

## Evidence fusion audit

Renormalization over available components is correct and tested
(`test_evidence_renormalization_and_raw_confidence_immutable`). No double counting found in
the current live path: `physics_consistency` is a single aggregated score (its own
highlight/shadow sub-scores are never separately re-added), and `anomaly`/`artificiality` are
always `None` today (no adapter wired), so there is no possibility of detector and open-set
evidence sharing one backbone in practice. Weights are a hardcoded dataclass default in
`packages/sagar/vnext/evidence.py`, explicitly commented as heuristic.

**Disclosure, not fixed**: `configs/vnext_evidence_fusion.yaml` exists with matching weight
values but is **not read by any code** (`grep` confirms zero references) — it is a
documentation-only file that could silently drift from the real weights in `evidence.py`.
Either wire it in as the single source of truth or delete it; left as-is because the values
currently agree and wiring config-loading in is not a "small, targeted" fix.

**Disclosure**: `quality_score` is one of the additively-weighted evidence components
(weight 0.15), i.e. it currently acts partly as evidence *for* an object's existence rather
than purely as a reliability modifier on the other components. This is a defensible design
choice (not obviously wrong), but it means a pristine low-confidence detection and a
noisy high-confidence detection can receive similar evidence scores. Not changed in this
pass — restructuring fusion semantics is a value judgement beyond a bug fix, and
`UNVALIDATED_EVIDENCE_FUSION` already discloses that no calibration claim is made.

## Change detection audit

`compare_detections` (`packages/sagar/mission/change.py`) enforces REMOVED only when
`coverage_by_baseline_id[id] is True`, and `SurveyChange`'s own Pydantic validator
(`core/models.py`) independently re-enforces `REMOVED` requires `inside_new_coverage=True` —
a second, model-level guard against a caller ever fabricating removal. No navigation ⇒ no
`matched_baseline_id` ⇒ never a false `UNCHANGED`/removal. `ChangeStatus` has no
`NOT_COMPARABLE` value; the PS's "not comparable" case maps to `ComparisonRefused` (a
whole-comparison refusal when spatial level < L2) rather than a per-item status — that is a
reasonable design, not a gap. **Disclosure**: "poor-quality coverage should not confidently
establish removal" is not enforced anywhere — `coverage_by_baseline_id` is a plain boolean
supplied by the (currently unwired) caller, with no raster-quality gate. The existing
`/api/v1/compare` endpoint is pre-existing legacy code that compares the single frozen
survey against itself and isn't exercised by the new runtime/contacts pipeline at all; wiring
real cross-survey comparison with quality-gated coverage is post-SIH.

## Recovery priority audit

REACQUIRE is correctly impossible without navigation (`nav = navigation_status ==
"AVAILABLE"` gates it). Analyst-confirmed contacts are distinguished
(`review=="CONFIRMED" and score>=.75`). **Disclosure, not fixed**: `prioritize()` in
`packages/sagar/vnext/priority.py` reads `contact.get("change_state")` into a local `change`
variable but **never uses it** in the action/band logic — dead code. In practice this has no
live effect because `change_state` is never populated on runtime contacts by
`fuse_contacts`/`app.py` either, so NEW vs PERSISTING currently cannot and does not affect
priority. Wiring real change-state into contacts and into this branching is post-SIH (it
requires connecting the change-detection flow to the runtime contacts pipeline, which doesn't
happen anywhere today).

## Natural clutter dataset verdict — CRITICAL FIX APPLIED

**Confirmed and fixed a real, quantified positional leakage bug.** Before the fix,
`build_natural_clutter_dataset.py`'s `candidates()` generator picked negative crop origins in
raster order and negatives took the first 1–2 that cleared the mask-exclusion buffer; since
most AI4Shipwrecks masks aren't in the top-left corner, **96.9% of all 323 negatives (313)**
sat at exactly two pixel origins, `(0,0)` and `(256,0)` — i.e. row≈0 for almost every
negative — while all 87 positives were centered on their actual (scattered, deep-in-image)
mask location. Verified directly against the manifest before touching code. Row position
alone was a near-perfect, content-independent discriminator.

**Fix applied**: added deterministic per-image seeded shuffling (`sampled()` helper,
`--seed`, default `20260827`) over the full set of valid grid candidates before selecting
negatives, for both `ANNOTATION_SAFE_BACKGROUND` and `VERIFIED_BACKGROUND_FRAME` provenance.
Re-ran the script: negatives now spread across **107 unique origins**, row=0 fraction dropped
from 96.9% to **14.4%**. Regenerated and replaced
`ml/experiments/vnext/kaggle_bundle/dataset/{natural_clutter_dataset_manifest.jsonl,
natural_clutter_qa.json, natural_clutter_split_manifest.json, negative_provenance.json}`.
New counts: 406 total crops (was 410) / 87 ARTIFICIAL (unchanged) / 319 NATURAL_OR_ARTEFACT
(was 323) — train 76/272 unchanged, val 11/47 (was 11/51; 5 near-duplicates now removed from
validation vs. 1 before, an expected consequence of randomized negative placement). 0 exact
duplicates, 0 group leakage, 0 held-out-test rows — all QA invariants still pass.

Negative validity (`expanded_intersects`, 96px dilation margin on a 256px crop) is a
defensible exclusion buffer and was not changed. Domain is 100% AI4Shipwrecks — no
cross-dataset natural-vs-artificial generalization claim is defensible; this model is only
usable as an AI4Shipwrecks-domain candidate suppressor / experimental artificiality evidence
source, not a universal natural-seabed classifier. Validation size (11 ARTIFICIAL) makes a
two-architecture F1 comparison statistically weak; `--convnext` is already off by default in
`run_kaggle.py`, so the default run trains only EfficientNet-B0 — recommend keeping that
default (documented in `README_RUN_ORDER.md`, now updated).

## Dataset cheating risks (post-fix)

| Risk | Status |
|---|---|
| Negative crop-origin leakage (row≈0) | **FIXED** — randomized, seeded |
| Positive-centered vs. negative-random crop generation | Inherent to the method (positives must be centered to be labelled correctly); no longer confounded with position since negatives are now spread |
| Negative validity (mask-exclusion margin) | OK, 96px margin on 256px crop is defensible |
| Domain generalization claim | Disclose-only: AI4Shipwrecks-only, no cross-dataset claim allowed |
| 11-example architecture selection | Disclose-only: default run avoids it (`--convnext` opt-in) |

## Training design verdict

`run_kaggle.py`: CrossEntropyLoss, AdamW lr=1e-4, 5 epochs, `weights=None` (trained from
scratch — no internet-dependent pretrained download, correct for offline safety, but a real
underfitting risk on ~348 train crops). No augmentation at all (safe — nothing destroys
sonar semantics, but also no regularization benefit). **Fixed**: added inverse-frequency
class weighting for the ~3.6:1 train imbalance (76 vs. 272), and a `--seed` argument with
`torch.manual_seed` for reproducibility (previously unseeded). Checkpointing, per-architecture
metrics, and confusion-matrix export were already correct and unchanged. Threshold selection
remains "validation F1 subject to recall review; no automatic acceptance threshold" — honest,
unchanged.

## FP-suppression evaluation verdict — MAJOR FIX APPLIED (most important fix in this audit)

Before this pass, `fp_suppression_ablation.json` was a **permanent stub**
(`{'status':'UNAVAILABLE', reason: 'provide validation-only YOLO proposal/GT match records'}`)
with no code anywhere to generate those records — the single most important deliverable this
audit brief calls for ("MORE IMPORTANT than crop classifier accuracy") did not exist.

Before implementing it, I verified the one real risk that would have made this unsafe:
whether AI4Shipwrecks validation images used by the natural-clutter dataset might overlap the
frozen YOLO11s's own train/test split (AI4Shipwrecks is a confirmed **P0/primary** domain for
the frozen detector — `docs/DATA_STRATEGY.md:36`, `qa/contact_ai4shipwrecks.png` in the
frozen snapshot). I cross-referenced `image_sha256` and `source_group_id` between
`data/processed/ai4shipwrecks_s1/manifest.jsonl` (natural-clutter's source) and
`data/processed/multidomain_sonar_v1_1_20260831/canonical/metadata.jsonl` (the frozen
detector's own canonical snapshot): **166/166 image-level overlaps, 0 split mismatches, 16/16
source-group split agreements.** The natural-clutter "val" images are exactly a subset of the
frozen detector's own AI4Shipwrecks val split — never its train or test split. This made it
safe to proceed.

**Implemented**:
- `ml/experiments/vnext/build_fp_suppression_val_gt.py` (new): extracts GT SHIPWRECK bboxes
  for validation-split images only from the frozen snapshot, with a hard runtime assertion
  that each image's split agrees between both sources (fails loudly, not silently, if it
  ever doesn't). Produces `dataset/natural_clutter_val_gt.jsonl`: 25 validation images, 71 GT
  boxes, 14 images with zero wrecks (legitimate background val frames).
- `run_kaggle.py`: new `run_fp_suppression()` — frozen YOLO (via
  `sagar.perception.runtime.FinalDetector`, reusing the actual production tiling/NMS path
  rather than duplicating it) → SHIPWRECK-class candidates on validation images → greedy
  IoU≥0.30 GT matching → trained natural-clutter classifier accept/reject on each candidate
  crop → TP/FP/FN/precision/recall for YOLO baseline and YOLO+suppressor, plus FP
  reduction/recall delta/precision delta and a per-image breakdown. Gated behind
  `--yolo-weights` (SHA256-verified against the frozen hash before any inference) and a clean
  `sagar`/`ultralytics` import-and-load check performed **before** the evaluation loop (not
  mid-loop) — any missing dependency or hash mismatch produces an honest `UNAVAILABLE` +
  reason, never a fabricated number, matching the existing convention.
- Verified: script compiles; all four `UNAVAILABLE` gating paths (no GT file, no weights
  flag, bad weights path, SHA mismatch) return correctly; the real frozen weights load
  correctly through this new code path in this environment (fails only at the expected point
  — no trained classifier checkpoint exists yet, since no training has run); `_iou_xyxy` and
  `_match_candidates` unit-verified against synthetic boxes. Full end-to-end numbers cannot
  exist until the classifier is actually trained overnight — that is expected and correct.

## Kaggle executability

Dependencies: stdlib + `torch`, `torchvision`, `PIL` for the base pipeline (all
offline-available once the Kaggle image has them, which it does by default); the new
FP-suppression stage additionally needs `sagar.perception.runtime` (hence `ultralytics`) —
gated as UNAVAILABLE-with-reason if absent, never a hard crash. No pretrained weights are
fetched (`weights=None`), no huggingface_hub calls, no URL downloads anywhere. Dataset mount
path is CLI-configurable (`--source-root`); frozen YOLO path is now also CLI-configurable
(`--yolo-weights`) and SHA-verified. Output dir, per-file SHA256 manifest
(`artifact_hashes.json`), and final ZIP export were already implemented and remain correct.
`README_RUN_ORDER.md` updated with the new step 0 (GT extraction, run once, not on Kaggle)
and the `--yolo-weights` requirement for step 4.

## RF-DETR status

Confirmed inert and correctly non-blocking: `config.json` has `"rfdetr": {"enabled": false}`;
`run_kaggle.py` never imports or downloads anything RF-DETR-related; the `--rfdetr` flag is
accepted but unused. No change needed.

## Robustness status

`scripts/run_vnext_robustness.py` and `scripts/run_vnext_ablation.py` confirmed to only
generate perturbed images / report shapes — every actual metric field
(`detection_recall`, `precision`, `fp_count`, `event_contact_recall`, `evidence_score_drift`)
is honestly `None` with `metric_status: 'UNAVAILABLE_UNTIL_FROZEN_DETECTOR_EXECUTED'`. No
fabricated numbers. No fix needed — this is exactly what the task itself says should be true
at this stage ("Do not claim robustness improvement").

## Frozen artifact integrity

`ml/artifacts/final_v1/detector/best.pt` SHA256 = **verified matching**
`2aa3ac71051856bcfc8ec400804995f03568aa26d1a1fb24583e4eb1b7a10b15` (checked directly with
`shasum -a 256`, independently confirmed by the ML-audit fork). No frozen metrics file was
read for tuning; no test-split file was opened at any point in this session. The isolated
SHIPWRECK demo policy (`perception/demo_policy.py`) was read but not modified.

## Sonar scientist attack

*"Your dropout detector will fire on a genuine long shadow and you called it a sensor fault."*
Fixed — renamed to `HORIZONTAL_DARK_BAND`, cause left undiagnosed. *"Your shadow-direction
logic assumes a column-axis nadir; my swath's nadir runs along rows."* Disclosed with an
explicit comment; currently dead code in the live path (nadir always unknown), so no live
wrong answer today, but flagged so nobody wires it in blind. **FIX NOW** (both done).

## ML researcher attack

*"313 of your 323 negative crops came from two pixel coordinates. Your classifier didn't
learn 'natural vs. artificial,' it learned 'is this row zero.'"* **FIX NOW** — fixed and
verified (14.4% row-0 residual, 107 unique origins). *"You claim FP-suppression evaluation
but ship a permanent stub."* **FIX NOW** — implemented, gated, verified.

## NIOT engineer attack

*"Multiple detections from my overlapping-tile sonar mosaic will look like your system
tracked the same target across several passes — that's not persistence, that's redundant
coverage of one pass."* **FIX NOW** — fixed with `persistence_evidence_type`. *"Can I trust
REMOVED on a resurvey with a bad transducer?"* Not currently enforced (coverage is a bare
boolean); **DISCLOSE**, post-SIH (the endpoint that would need this isn't wired to the new
pipeline yet).

## SIH judge attack

*"Prove your evidence score isn't just repackaged YOLO confidence."* It isn't — it's a
renormalized blend of five largely-independent signals, always labelled
`UNVALIDATED_EVIDENCE_FUSION`. *"Prove your FP-suppression number isn't fabricated."* It's
either a real number from a verified-leakage-free validation set once trained, or an honest
`UNAVAILABLE` with a stated reason — never fabricated, and now actually reachable rather than
permanently stubbed.

## Fixes made

1. `packages/sagar/vnext/contacts.py` — window-overlap vs. true persistence structurally
   separated (`persistence_evidence_type`, `distinct_frame_observation_count`,
   `window_overlap_duplicate_count`); persistence/consecutive-count math now keyed on
   distinct frame indices.
2. `tests/test_vnext.py` — new regression test for (1); two flag-name assertions updated.
3. `packages/sagar/vnext/conditions.py` — `HORIZONTAL_DROPOUT` → `HORIZONTAL_DARK_BAND`
   (measurement, not cause).
4. `packages/sagar/vnext/physics.py` — added explicit axis-convention warning comment
   (no behaviour change).
5. `ml/experiments/vnext/build_natural_clutter_dataset.py` — fixed negative-crop positional
   leakage via deterministic seeded shuffling; added `--seed`.
6. Regenerated `ml/experiments/vnext/kaggle_bundle/dataset/{natural_clutter_dataset_manifest.jsonl,
   natural_clutter_qa.json, natural_clutter_split_manifest.json, negative_provenance.json}`.
7. `ml/experiments/vnext/build_fp_suppression_val_gt.py` (new) — validation-only GT extraction
   with a hard cross-source split-agreement assertion.
8. `ml/experiments/vnext/kaggle_bundle/dataset/natural_clutter_val_gt.jsonl` (new artifact).
9. `ml/experiments/vnext/kaggle_bundle/run_kaggle.py` — implemented the real FP-suppression
   evaluation stage; added class-weighted loss and `--seed`/reproducibility.
10. `ml/experiments/vnext/kaggle_bundle/README_RUN_ORDER.md`,
    `ml/experiments/vnext/kaggle_bundle/config.json` — documented the above.

## Disclosures required

- Open-set/anomaly scoring is interface-only; `open_set_candidate` is always `False` today.
- `configs/vnext_evidence_fusion.yaml` is unused (documentation only); `evidence.py`'s
  hardcoded weights are the actual source of truth and currently match it.
- `quality_score` is an additive evidence component, not purely a reliability modifier — a
  defensible but disclosable design choice.
- `priority.py`'s `change` (NEW/PERSISTING) variable is read but never used; harmless today
  only because `change_state` is never populated on runtime contacts either.
- `/api/v1/compare` is legacy, self-comparison-only, and not wired to the new runtime/contacts
  pipeline; `coverage_by_baseline_id` has no raster-quality gate.
- `verify_candidate`'s shadow-direction axis assumption is unverified against real acquisition
  geometry and inconsistent with `internal_v2.py`'s PICS convention; currently inert.
- Natural-clutter classifier is AI4Shipwrecks-domain-only; no cross-dataset claim is
  defensible. `--convnext` two-architecture selection is statistically weak on 11 validation
  examples — keep it opt-in.
- FP-suppression numbers do not exist yet (correctly `UNAVAILABLE` until the overnight run
  produces a trained classifier checkpoint); this audit made the pipeline *capable* of
  producing them, not the numbers themselves.

## Post-SIH work

- Wire an open-set/anomaly adapter into `ModelRegistry.health()` and the runtime pipeline.
- Wire `configs/vnext_evidence_fusion.yaml` as the actual weight source, or delete it.
- Consider making `quality_score` a multiplicative reliability modifier instead of an
  additive evidence component (requires a value judgement, not a bug fix).
- Wire real change-state onto runtime contacts and make `priority.py` actually use it.
- Wire quality-gated coverage into cross-survey comparison; connect `/api/v1/compare` to the
  runtime contacts pipeline.
- Resolve the `physics.py` nadir axis-convention question empirically before ever passing a
  real orientation value into `verify_candidate`.
- Add an `open_set` entry to `ModelRegistry.health()`.

## Test results

`uv run pytest -q`: **75 passed** (74 pre-existing + 1 new regression test), including all
VNEXT-specific tests. No frontend/API contract shape changed (only additive contact fields;
one internal flag string renamed, confirmed unreferenced by any frontend code via grep) —
frontend tests/typecheck/production build were not re-run as not necessary; nothing in
`apps/workstation/src` reads any of the changed/added fields.

## Overnight training GO/NO-GO

**GO**, with the fixes above already applied to the dataset and pipeline. Exact Kaggle run
instructions:

```
# One-time, NOT on Kaggle (already done in this session; re-run only if the AI4Shipwrecks
# source manifest changes):
python ml/experiments/vnext/build_natural_clutter_dataset.py \
  --output-dir ml/experiments/vnext/kaggle_bundle/dataset
python ml/experiments/vnext/build_fp_suppression_val_gt.py

# On Kaggle (mount this kaggle_bundle/, the AI4Shipwrecks source tree, and the frozen
# detector checkpoint best.pt as three dataset inputs):
python run_kaggle.py --dataset-dir dataset --source-root /kaggle/input/<ai4shipwrecks-mount> \
  --smoke-loader                      # preflight; stop on any QA failure
python run_kaggle.py --execute \
  --source-root /kaggle/input/<ai4shipwrecks-mount> \
  --yolo-weights /kaggle/input/<frozen-detector-mount>/best.pt
  # omit --convnext (default): 11-example val set makes two-architecture selection
  # statistically weak; add --rfdetr only if RF-DETR assets are ever bundled (they are not)
```

Expected runtime: EfficientNet-B0, 5 epochs, 348 train crops, batch size 16 — a few minutes
on any Kaggle GPU (T4/P100) or the user's RTX PRO 6000; the FP-suppression stage adds tiled
YOLO inference over 25 validation images plus 71+ classifier forward passes, seconds more.
Total: well under 15 minutes end-to-end, not an "overnight" workload at this dataset size —
overnight headroom exists only if `--convnext` is added or the dataset is later grown.

Check `artifacts/fp_suppression_ablation.json` first: `status` must be `COMPLETE` (not
`UNAVAILABLE`) for the FP-suppression numbers to exist; if `UNAVAILABLE`, the `reason` field
says exactly what's missing (weights path/hash, or `sagar`+`ultralytics` import).
