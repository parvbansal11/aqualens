# PID-02 water-column reference pre-registration (PID02-WCREF-v1)

Frozen before any annotation, under spec Amendment E-2. No sensor's water-column geometry is validated by this record; it fixes only how validation may occur.

| Item | Value |
|---|---|
| Artifact | `artifacts/round2/PID02/wc_reference_protocol/iter-1/` (`protocol.json`, `sample.jsonl`, `instructions.md`; runtime facts in `artifact_manifest.json`) |
| protocol.json SHA-256 | `0c99d65df1622f1db6ff0ee53e422e00c4047048a79d0a85d0a51ce944f5eac3` |
| sample.jsonl SHA-256 | `21a72bbbd64f586a5eb5548d9bce64f3dd41234320b06d74713d6d828827ec1f` |
| instructions.md SHA-256 | `3e083ce201d5f4a79f42c6ef7bce45091c0b96817e43139e1f492c29d484a096` |
| Build | `PYTHONPATH=packages:ml python -m round2.wc_prereg --corpus-root <frozen corpus>` (`ml/round2/wc_prereg.py`); a rebuild is byte-identical in the three scientific files |
| Annotation tool | `PYTHONPATH=packages:ml python -m round2.wc_annotate --role ANNOTATOR_A --corpus-root <frozen corpus>` (`ml/round2/wc_annotate.py`); records go to `artifacts/round2/PID02/wc_reference_annotations/iter-1/<ROLE>/annotations.jsonl` |
| Inputs | H0-1 manifest `68e52c10…d815`; corpus metadata (tracked copy); spec, tickets and harness sources by SHA-256 inside `protocol.json` |

**Sample (train only; no pixels, labels, detector output or seed used):** SubPipe HF 56 frames (8 Surveys, 24 of 25 blocks), LF 61 (7 Surveys, 26 of 28 blocks), a Survey-anchored lattice of frames at least 25 s apart (checked: 102 consecutive pairs share no pixel row); AI4 all 140 train images (13 sites); PING none. Total 257, every source SHA-256 verified.

**Annotation:** two independent annotators (ANNOTATOR_A, ANNOTATOR_B), each declaring prior sonar experience (NONE / LIMITED / EXPERIENCED) and any estimator-development role; per side (IMAGE_LEFT, IMAGE_RIGHT) row segments with AVAILABLE (inclusive native-column interval), AMBIGUOUS (optional broad interval, never scored) or NOT_VISIBLE (no location); views NATIVE and CONTRAST_HISTEQ only; append-only records, corrections supersede. No routine adjudication.

**Acceptance (per stratum SubPipe-HF, SubPipe-LF, AI4; never pooled):** scorable if each annotator has ≥ 30 images with an AVAILABLE row-side (§7.8); PASS iff h_est ≥ h_human, FA_est ≤ FA_human where testable, and zero structurally invalid outputs. h_human is the symmetric human-vs-human hit rate under the identical rule, instantiated from the frozen annotations before any estimator is evaluated. No pixel tolerance, minimum rate or margin. DVL is secondary and descriptive and cannot rescue a failure. Numeric confidence is UNAVAILABLE.

**Governance:** selected images are viewed only for annotation and protocol QA until the reference is frozen; estimator development uses non-selected train imagery only after the reference and benchmark are frozen, and never reads annotations. Known limitations: SubPipe non-selected frames share pings with reference frames; the AI4 census leaves no AI4 development images; dataset identity is visible to annotators.
