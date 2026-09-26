# Aqualens brand and identifier audit

The public product name is **Aqualens**. User-facing app chrome, page metadata, API title, README, report download names, and public SVG copy use this name.

The following old strings remain only as technical compatibility identifiers or preserved scientific provenance:

- `packages/sagar/` and imports such as `sagar.api`: Python package/module identifier; retained to avoid breaking imports.
- `SAGARDRISHTI_*`: existing runtime environment variable names, still read by the backend and documented as compatibility names.
- `sagardrishti_*` model IDs and frozen metric card project labels: model/dataset identifiers and experiment provenance.
- `sagardrishti.runtimeSurvey` and `sagardrishti.runtimeJob`: browser storage keys; retained so existing saved browser state remains readable.
- Historic competition terms and references in `docs/HACKATHON_DEPLOYMENT.md`, `docs/INTERNAL_HACK_FREEZE.md`, `docs/JUDGE_DEMO_RUNBOOK.md`, `docs/RESEARCH.md`, `docs/ROUND2_*`, `docs/VNEXT_PRETRAINING_AUDIT.md`, and `docs/architecture-brief.html` are retained as internal evaluation provenance, not product UI or current deployment identity.

The clean repository excludes the original Git history and excluded prototype archive. It contains no AI-tool author or co-author attribution.
