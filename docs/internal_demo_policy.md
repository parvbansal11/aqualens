# Internal demo SHIPWRECK display policy

`sagar.perception.demo_policy` is **INTERNAL DEMO ONLY - NOT PRODUCTION CALIBRATION**. Raw model values are persisted unchanged. A real class-1 signal, or an existing anomaly signal, may be presented as SHIPWRECK using `min(0.94, max(0.72, raw_signal * 0.85 + 0.15))`. It persists `classification_source=DEMO_HEURISTIC` and `production_qualified=false`. It is not a metric and must never appear in Model Lab as measured performance.
