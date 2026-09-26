# VNEXT review audit packet

## A. Architecture and runtime flow

`raster + optional navigation -> SonarConditionEngine -> frozen YOLO11s known-class candidates -> immutable RuntimeFindings -> deterministic Contact fusion -> algorithmic physics evidence -> unvalidated evidence score -> priority/review/report`.

Optional adapters (RF-DETR, natural clutter scorer, mask refiner) are registry-reported and absent by default.

## B. Separation of concerns

Learned: frozen YOLO11s only; future natural-clutter, RF-DETR, and segmentation require separately trained artifacts. Algorithmic: condition measurement, contact association, physics heuristics, change matching, priority. Statistical: future calibration only. Human: append-only review/relabel/uncertainty. Demo-only: isolated SHIPWRECK presentation heuristic.

## C–I. Implementation policies

Changed files are `packages/sagar/vnext/*`, `packages/sagar/api/app.py`, `packages/sagar/memory/repository.py`, `packages/sagar/mission/change.py`, `packages/sagar/core/models.py`, new VNEXT scripts/config/docs/tests. Contacts retain source IDs, confidence aggregates, persistence, quality/physics/open-set fields, geo nullability, provenance, review summary, disposition and action. `contact_fusion@v1` requires class compatibility, adjacent frames, then real-world proximity when both real coordinates exist or normalized geometry fallback. Duplicate detection IDs are de-duplicated. `evidence_fusion@v1` is explicitly `UNVALIDATED_EVIDENCE_FUSION`, excludes unavailable components, and renormalizes documented weights. Physics requires orientation; otherwise all physics measures are null/unknown. A shadow is not artificiality.

Dataset preparation consumes supplied frozen train/validation assignments and group IDs, rejects test rows, emits hashes and leakage QA; no crops or models were trained.

## J–L. Validation executed

`uv run pytest -q`: **74 passed**. Frontend: **50 tests passed**, TypeScript no-emit passed, Next production build passed. Real E2E used approved train-split `1693569719.849.pbm`, not held-out test: frozen SHA matched; MPS selected; upload completed with 3 findings, 2 contacts, null coordinates, JSON/CSV reports, and append-only review. Contact evidence score was separately labelled and physics was `UNKNOWN_ORIENTATION`.

## M. Known limitations / blockers

No trained optional models, no calibrated pixel-to-world uncertainty, no orientation from arbitrary uploads, and no full benchmark metrics. The Natural Clutter package now has mask-backed, provenance-recorded negatives; its small validation set limits generalization claims.

## N. Kaggle plan

QA; Natural Clutter A; Natural Clutter B only if justified; validation selection; frozen-YOLO FP suppression ablation; optional RF-DETR; comparison; artifact export. No held-out-test selection.

## O–Q. Claim boundaries

Allowed: frozen detector generated candidates; measured conditions and transparent unvalidated evidence components were produced; optional models are unavailable. Prohibited: calibrated probability, artificiality from anomaly/shadow, removal without coverage, active RF-DETR/clutter model, metric improvement, fabricated geolocation uncertainty, or automatic self-learning. No unresolved implementation blocker remains for audit; the training-data insufficiency remains explicit.
