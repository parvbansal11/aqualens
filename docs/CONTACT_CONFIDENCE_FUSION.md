# Contact Confidence fusion

`confidence_method = "CONTACT_EVIDENCE_FUSION_V1"` first produces `raw_fused_confidence`, a deterministic fused system-confidence score in `[0, 1]`. It is not a statistically calibrated probability.

The method preserves the raw detector output as `raw_detector_confidence` and retains the prior technical provenance field as `evidence_strength` (also available as `evidence_score`). It then combines available, non-negative normalized support with weighted noisy-OR and a bounded pairwise-agreement contribution. A stronger available supporting component cannot lower Confidence. Missing channels are excluded rather than supplied as positive or negative evidence.

`confidence_components` retains the raw value, normalized support, availability, and influence weight for raw detector confidence, temporal persistence, acoustic verification, physics, sonar condition, open-set anomaly, artificiality, and navigation consistency. Open-set anomaly is normalized only as distance beyond its own frozen threshold and is explicitly advisory; it is never presented as a supervised detector probability. Navigation consistency remains unavailable until there is real object-level navigation evidence.

For the internal Epitome demo, the user-facing `confidence` and explicit `normalized_confidence` are `DEMO_BOUNDED_SIGMOID_V1`: `0.70 + 0.20 * sigmoid(28 * (raw_fused_confidence - 0.3139777305538386))`. The center is the median raw-fused value from the Epitome v2 regression run. The fixed global parameters preserve strict ordering and return values strictly inside `[0.70, 0.90]`; they are machine-readable as `confidence_normalization`, `confidence_normalization_range`, `confidence_normalization_reference_center`, and `confidence_normalization_steepness`. This is demo normalization, not calibration.

`UNKNOWN` classification semantics are independent of either score: fusion never changes a Contact class.
