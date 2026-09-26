# VNEXT final product contract

Aqualens is a sonar intelligence pipeline for analysts and mission supervisors. Its workflow is **ingest → assess → detect → verify → fuse → localize → review → prioritize → report**. The primary operational object is a **Contact**, constructed from immutable detector observations; it is not a claim that an object is confirmed.

## Contracted objects and evidence

`MISSION` contains survey context. `SURVEY` contains source/provenance, coverage and capability gates. `OBSERVATION` preserves raw YOLO class, confidence, normalized bbox, source frame and model SHA. `CONTACT` contains identifiers, source observations, display/open-set classification state, association basis, persistence state, acquisition/physics/open-set/clutter evidence, localization status, evidence score, review history, change state, priority explanation and versions.

Null/unavailable remains null/unavailable. Coordinates, headings and timestamps are copied only from supplied navigation metadata. Motion quality is `UNKNOWN` without motion metadata; image heuristics do not measure vehicle motion. Localization uncertainty is exposed only when defensibly computed.

| Component | Classification | Runtime contract |
|---|---|---|
| Frozen YOLO11s candidate generator | LEARNED | Preserves raw confidence and SHA; known classes only: PIPELINE, SHIPWRECK, CRAB_POT. |
| Sonar Condition Engine | ALGORITHMIC_PHYSICS | Measured raster quality, contrast, dropout/nadir indicators and resolution; no cosmetic enhancement claim. |
| Acoustic Physics Verifier | ALGORITHMIC_PHYSICS | Highlight/shadow/nadir/dropout evidence only; shadow never proves artificiality, unknown orientation remains unknown. |
| Contact association/persistence | ALGORITHMIC_PHYSICS | World proximity, legitimate ping/range-side relationship, real adjacency, class, then normalized geometry; arbitrary upload order cannot establish sequence. |
| Open-set memory | STATISTICAL | Anomaly, threshold/source, feature source and memory version; high anomaly means unusual, not artificial. |
| Evidence fusion | STATISTICAL | Explicit versioned weights, missing-channel disclosure, `UNVALIDATED_EVIDENCE_FUSION`, never probability. |
| Natural Clutter v1 | LEARNED | `REJECTED_FOR_AUTOMATIC_SUPPRESSION`; experimental `ADVISORY_ONLY`, nullable, never a veto. |
| Review and memory | HUMAN | Append-only CONFIRMED/FALSE_POSITIVE (legacy REJECTED)/RELABELLED/UNSURE (legacy UNCERTAIN) events and provenance exports. |
| Change and recovery priority | ALGORITHMIC_PHYSICS | Coverage-aware NEW/UNCHANGED/NOT_DETECTED/NOT_SURVEYED; priority is transparent rules, not learned ecological risk. |
| SHIPWRECK recovery presentation | DEMO_ONLY | Isolated presentation policy; never changes raw confidence or production qualification. |
| RF-DETR | UNAVAILABLE | No legitimate trained artifact is registered. |

## Semantics and safeguards

UNKNOWN is open-set only. A combined analyst-facing label may say `UNKNOWN ARTIFICIAL CANDIDATE REQUIRING REVIEW` only when combined evidence supports it; it is not universal unknown-object recognition. Natural-clutter output cannot alter candidate generation, raw detector confidence, or a Contact disposition.

`REMOVED` needs a prior contact, genuine new-survey coverage, adequate localization/coverage evidence, and supported matching/review rules. An absent candidate under coverage is `NOT_DETECTED`; outside coverage is `NOT_SURVEYED`.

Review feedback is curated training memory exported as hard-negative, confirmed-positive and uncertain manifests. It is never online self-learning.

## System health and frontend requirements

Clients consume `MISSION`, `SURVEY`, `CONTACT`, `OBSERVATION`, `EVIDENCE`, `REVIEW`, `CHANGE`, `PRIORITY`, and `SYSTEM HEALTH`. They must show model/evidence versions, capability states, nulls, raw confidence separately from display labels, component contributions and missing components. They must label the evidence score as unvalidated and surface the SHIPWRECK limitation.

Allowed claims: learned candidate generation plus transparent acquisition, acoustic, persistence, open-set, human-review, geo/change and prioritization evidence; open-set candidates are surfaced for review; feedback is persistent future training/calibration memory; unsurveyed differs from re-observed; clutter gate was rejected for recall loss.

Forbidden claims: calibrated probabilities, universal unknown detection, production-grade shipwreck recognition, autonomous learning, learned ecological risk, sonar-derived GPS without navigation, meter accuracy without calibration, image-only motion measurement, or a clutter-suppression improvement claim. The 17.39% FP reduction must always state the loss of both baseline TPs.

## Open-set v1 runtime

Open-set v1 is `PATCHCORE_STYLE_OPEN_SET` advisory evidence using frozen production YOLO11s layer-16 embeddings. Its memory contains only SubPipe annotation-safe train background, with a q99.5 annotation-safe validation-background threshold. Runtime fields are nullable and provenance-bearing: anomaly score, threshold and source, feature source, memory version, status, and open-set candidate state. The score is distance from reference memory and is never probability, known-class confidence, or proof of artificiality. A threshold exceedance keeps the raw class unchanged and requests analyst review; it does not create a fourth YOLO class. Missing open-set evidence remains missing in fusion.
