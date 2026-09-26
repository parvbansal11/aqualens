# Pipeline acoustic verifier

The frozen YOLO11s detector remains a candidate generator. This verifier records local raster evidence for raw `PIPELINE` candidates and never changes the class, confidence, or box.

It measures local robust intensity contrast, bright and dark pixel fractions, and axis-aligned bbox elongation. A local elevated-intensity response can support a candidate; a predominantly dark elongated region with no such response is `ACOUSTICALLY_INCONSISTENT`. That state is not a false-positive verdict.

Axis-aligned boxes do not establish object orientation. Shadow direction and highlight-shadow consistency remain unavailable without calibrated range-side/nadir orientation. A dark patch is never called a shadow by this verifier.

Pipeline false-positive reviews remain append-only training memory. Future hard-negative data must use analyst-rejected candidates with source raster, contextual crop, bbox, raw evidence, condition and verifier provenance; unlabelled detector hits are not negatives. Future OBB requires legitimate oriented annotations; segmentation requires real pixel masks. Rectangles must not be converted into fabricated masks.

## Current investigation status

Current pipeline acoustic verification is conservative and has not demonstrated discrimination between true and false `PIPELINE` candidates under missing calibrated range-side geometry.

The observed shadow-like browser candidate retained its raw `PIPELINE` class and `0.3075626790523529` raw confidence. It returned `INSUFFICIENT_EVIDENCE`, `hard_return_status=NOT_OBSERVED`, local contrast `-0.16180083049559574`, and unavailable shadow geometry. Five inspected legitimate SubPipe `PIPELINE` references also returned `INSUFFICIENT_EVIDENCE`. This is not evidence of false-positive suppression and does not justify threshold tuning or retraining.

`INSUFFICIENT_EVIDENCE` is a missing-evidence state. It is not a false-positive verdict, negative physics evidence, or evidence that a hard return is confirmed absent. `NOT_OBSERVED` means the local measurement did not observe a coherent elevated-intensity return. It does not prove that no physical hard return exists. When this state is present, evidence fusion excludes the physics component and transparently renormalizes only the genuinely available channels.

The Workspace technical disclosure presents the raw detector result separately from pipeline acoustic verification. It exposes the verification state, hard-return observation state, shadow-geometry availability, local contrast, bright fraction, elongation, missing inputs, and measurement reasons. These details remain evidence for analyst review, not a replacement detector decision.
