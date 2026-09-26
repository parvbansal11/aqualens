# VNEXT frontend contract

Keep existing screens and information architecture. The primary object is `CONTACT`; the contract supports the analyst workflow INGEST → ASSESS → DETECT → VERIFY → FUSE → LOCALIZE → REVIEW → PRIORITIZE → REPORT. Clients need `MISSION`, `SURVEY`, `CONTACT`, `OBSERVATION`, `EVIDENCE`, `REVIEW`, `CHANGE`, `PRIORITY`, and `SYSTEM HEALTH`.

Survey responses may add `sonar_condition`, `model_registry`, and `contacts`. A Contact exposes identity, raw known-class prediction and separate display classification, open-set state/source/provenance, source observation IDs/frame IDs, real pings only where supplied, association/persistence basis, raw detector confidence/model/version/bbox, quality and physics evidence, nullable natural-clutter advisory, geo/status/uncertainty, unvalidated evidence-score components/missing components, review history, change state and priority explanation. `null` means unavailable—not zero.

Frontend requirements: label `UNVALIDATED_EVIDENCE_FUSION` as an Evidence Score, never probability; do not render anomaly as a known/artificial class; show raw YOLO confidence unchanged; show Natural Clutter v1 as experimental `ADVISORY_ONLY` / `REJECTED_FOR_AUTOMATIC_SUPPRESSION`, never a rejection; show `NOT_DETECTED` separately from `REMOVED` and `NOT_SURVEYED`; surface SHIPWRECK's recall limitation and `DEMO_ONLY` qualification. Model registry availability lets views disable optional controls without errors.

Full pixel-to-world georeferencing requires calibrated ping timing/range, side/channel orientation, heading/attitude, altitude, and validated sensor/platform alignment; without these, coordinates and uncertainty must remain unavailable.

`model_registry.*.availability` is one of `AVAILABLE`, `UNAVAILABLE`, `NOT_CONFIGURED`, or `FAILED`; existing views must tolerate all VNEXT fields being absent.
