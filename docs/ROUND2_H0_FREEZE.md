# Round-2 H0 freeze record (FZ-H0)

Held-out evaluation harness foundation, frozen for Workstream D. Baseline commit before H0: `08476ad211a990810bec6200751beae019989515`. Frozen detector: `ml/artifacts/final_v1/detector/best.pt`, model id `sagardrishti_multidomain_v1_1_yolo11s`, SHA-256 `2aa3ac71051856bcfc8ec400804995f03568aa26d1a1fb24583e4eb1b7a10b15` (unchanged). Harness: `ml/round2/` (import `round2`; rebuild commands run as `PYTHONPATH=packages:ml python -m round2.<module>`).

## Tickets

| Ticket | Implementation | Tests | Artifact | Acceptance | Status |
|---|---|---|---|---|---|
| H0-1 manifest | `round2/manifest.py` | `test_round2_manifest.py` | `artifacts/round2/H0/manifest/iter-2/` (iter-1 kept; identical rows) | H0-AC1: split counts equal the frozen QA (7,852 / 1,199 / 2,793); train rejection tested | Complete; AI4 `gt_object_regions` UNAVAILABLE_PENDING_PID_01 |
| H0-2 leakage guards | `round2/guards.py` | `test_round2_guards.py` | none (ticket) | the four adversarial tests; spec §7.1 applied literally (fit → val, evaluate → test, memory bank/probe → train) | Complete |
| H0-3 recovery switch | `sagar/perception/runtime.py` (`shipwreck_recovery`, keyword-only, default unchanged) | `test_recovery_switch.py` | none | H0-AC3: switch off → no recovery Observation, counter 0 | Complete |
| H0-4 production-path equivalence | `round2/infer.py`; runtime `confidence_floor` (default None) | `test_round2_infer.py` | none | H0-AC4 on tiled and full-frame fixtures, including the real frozen weights | Complete |
| H0-5 layer-16 cells | `round2/features.py` | `test_round2_features.py` | `artifacts/round2/H0/cells/iter-1/` (binaries gitignored; per-file SHA-256 in `records.jsonl`) | 100 % of val/test (3,992 images, 22,204 grids); detector SHA recorded | Complete |
| H0-6 geometry | `round2/geometry.py` | `test_round2_geometry.py` | `artifacts/round2/H0/geometry/iter-1/` | H0-AC5: every image has a record; PING range axis UNKNOWN; nadir report | Complete under PID-02 (water column and nadir confidence UNAVAILABLE) |
| H0-7 PING one-per-parent | `round2/ping_subset.py` | `test_round2_ping_subset.py` | `artifacts/round2/H0/ping_one_per_parent/iter-1/` | H0-AC6: 324 test representatives | Complete |
| H0-8 runtime-path baseline | `round2/evaluation.py`, `round2/baseline.py` | `test_round2_evaluation.py`, `test_round2_baseline.py` | `artifacts/round2/H0/runtime_path_baseline/iter-2/` (iter-1 kept: its `metrics.md` merged the claims flags; all data files identical) | per-sensor table with CIs; detector SHA; recovery counter 0 | Complete; figures: none defined |

Locked for H0: PID-02, PID-03, PID-05, PID-06, the H0-8 AI4 and PING evaluation scope (see `ROUND2_TICKETS.md`, "Resolved"). **Open: PID-01** (AI4 merged object regions).

## Claim wording: runtime-path detection per sensor

Decided wording (spec H0 "Claims enabled" and §11 "SHIPWRECK"). Any number used in a presentation still needs a ledger row (spec §10–11, ticket I8).

> Held-out evaluation of the deployed detection path per sensor. The frozen YOLO11s detector was run through its production tiled and full-frame path (SHIPWRECK recovery heuristic off, production confidence floors) on the held-out test split, and scored per dataset, sensor and class with class-aware one-to-one matching at IoU 0.5 (primary) and 0.3 (secondary), with 95 % cluster-bootstrap intervals. Each supervised class comes from one sensor, so no pooled figure is reported. PIPELINE on SubPipe (Klein 3500, 1,800 test frames): precision 0.554 [0.493, 0.623], recall 0.831 [0.741, 0.912] at IoU 0.5. CRAB_POT on PING (Humminbird), one image per augmentation parent (324 images): precision 0.682 [0.612, 0.761], recall 0.460 [0.339, 0.657]; all 873 augmented variants are reported only as a sensitivity check and are not independent observations. SHIPWRECK on AI4 (EdgeTech 2205) is evaluated against mask-fragment boxes only, not wreck objects: the detector produced no SHIPWRECK detections (recall 0 of 347 fragments); object-level AI4 metrics are unavailable pending PID-01. SHIPWRECK is a failed class. These runtime-path figures are not directly comparable with the earlier training-representation metrics, which used a different tile representation and operating points.

Forbidden with these results: a pooled or macro headline; any SHIPWRECK detection or recovery claim; describing the 873 PING variants as independent; describing AI4 fragments as wrecks; comparing runtime-path and training-representation numbers without labelling both.

## Unavailable by design (not defects)

- AI4 object-level detector metrics and `gt_object_regions`: UNAVAILABLE_PENDING_PID_01.
- Water-column half-width and nadir confidence (all images): UNAVAILABLE (PID-02). C's water-column removal, D2's water-column exclusion and F's near band therefore cannot run as specified until a validated procedure exists.
- PING range axis: UNKNOWN; no nadir (H0-6).
- Val is never evaluated (§7.1): val detections exist only as a fitting cache.

## Known limitations

- **Sweep-cache max_det saturation.** At the PID-05 floor 0.001, 208 of 22,204 detector passes returned `max_det` = 300 boxes, all AI4 (test 186 of 2,812; val 22 of 988); SubPipe and PING: 0. Only `runtime_path_baseline/iter-*/sweep/*.jsonl` is affected (the low-score tail of those passes is truncated). The runtime-floor baseline is unaffected: filtering the sweep at the production floors reproduces the runtime detections on all 3,992 images. The sweep cache's consumers exclude AI4 (E4/E5: SubPipe only; G1: AI4 and SHIPWRECK excluded), and D uses runtime operating floors. Classification: recorded limitation only. A rerun with a larger, pre-declared `max_det` would be a new artifact iteration, never a change to these.
- PING intervals are wide (145 bootstrap groups); AI4 has 13 test sites; rates with fewer than 30 events are flagged not for claims (§7.8).
- The frozen corpus (images, masks, QA) exists only in the SagarDrishti source tree; Aqualens holds a byte-identical copy of its metadata. H0 rebuilds read it there.
- Artifact manifests record `git_sha` 08476ad with `git_dirty: true` (H0 code was uncommitted when they were built) and pin harness source by SHA-256.

## Integrity checklist

No test GT in fitting, calibration, threshold selection or reference construction; no retraining; recovery off and never entered (0 invocations in every run); raw detector fields only (presentation tampering tested); no demo confidence; no synthetic navigation; no metric geometry; unavailable values are null with a status, never 0; PING siblings not independent in primary evaluation; AI4 fragments never called wrecks; all prior artifacts byte-identical.

## Artifact hashes (SHA-256)

| File | SHA-256 |
|---|---|
| manifest/iter-1/manifest.jsonl, manifest/iter-2/manifest.jsonl | `68e52c1072329bbdd31accaaa3fa1c662373643a4b20fee7ceabcd80d14ee815` |
| manifest/iter-2/artifact_manifest.json | `be1a616b98cbb30f3e974760346d735b948e34854aeef26ce9b2835b57d7ccc8` |
| manifest/iter-2/summary.json | `9daed6a186b2d5d305e92dec745819dd80fb6fdb1626c85921cf8f83be9bb010` |
| cells/iter-1/records.jsonl | `23a80945a16bbef9a8ed913681db9fd54484a2f4bed0f28a8ed8610acea73b13` |
| cells/iter-1/cache_manifest.json | `5cba921df7fd3b1736761fdc1dff05c3a84d4762af3847a61ec73c91b21fe326` |
| geometry/iter-1/geometry.jsonl | `cb404978d476a2303a2b6647f3f31ef18c1b17d4a239d3870bc115d90935d928` |
| geometry/iter-1/nadir_report.json | `b26f6324b7e9467e8116db1b02ccbc3f6b4d0df98beec90007867cdf953cadb0` |
| ping_one_per_parent/iter-1/ping_one_per_parent.jsonl | `ba87d07eb55f2f4974c6ac267dc6808a41c35db8f1b6b46eb636f3e4dac65dd6` |
| runtime_path_baseline/iter-2/metrics.json (= iter-1) | `55029b7d3d9f72193062c04781a07c471de223b50051b37244e4c850876eb835` |
| runtime_path_baseline/iter-2/metrics.md | `3a10388b60c3df057f6ee57cdd0d7a8baac3ac4af41e4856380a3853f80145fd` |
| runtime_path_baseline/iter-2/sweep/test.jsonl (= iter-1) | `e8250bf995ce0c9c1c86fc550b4b19f54b10fb0f629cfdbeb1fee89bbd6b9e52` |
| runtime_path_baseline/iter-2/sweep/val.jsonl (= iter-1) | `c6db57df36c2cbbf633aa9d33e11a8577bbdb7d79a1e422e23315618a92f1218` |
| runtime_path_baseline/iter-2/test_match_labels.jsonl (= iter-1) | `955aa57e3a56d8eac6a99f117eb7efe9469a9da78bc4c4c4dcd94b03a32a11cb` |
| runtime_path_baseline/iter-2/artifact_manifest.json | `e5580282a9d03b2fdb5e9b058cf4b07e1413ec126652fb105b0996b283bcf1d9` |

The 7,984 H0-5 cell and valid-fraction binaries (4.58 GB) are gitignored; each file's SHA-256 is in `cells/iter-1/records.jsonl`.
