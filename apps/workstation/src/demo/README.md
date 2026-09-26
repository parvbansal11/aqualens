# src/demo

Explanatory content for the **public** experience only.

What lives here:

- Prose that explains the system to a non specialist reader.
- Stage contracts for the "How it works" pipeline explorer.
- Labels for the illustrative sonar swath animation.

What must never live here:

- Detections, anomaly scores, class confidences.
- Coordinates, dimensions, or any measured quantity.
- Benchmark metrics of any kind.
- Anything an operational screen reads at runtime.

Nothing in this directory is imported by any file under `src/app/app/` or
`src/components/platform/`. That boundary is the whole point of the directory,
and a lint rule or a review check should enforce it.

Runtime fixtures for the operational screens are **not** here. They stay in the
repository at `apps/workstation/src/test/fixtures/`, reachable only through the
fixture-disabled proxy in `src/lib/service.ts`, which throws on every call
rather than returning fabricated data.
