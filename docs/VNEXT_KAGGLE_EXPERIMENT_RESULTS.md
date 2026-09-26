# VNEXT Kaggle experiment results

## Provenance

The immutable source archive is `ml/artifacts/vnext/kaggle_20260902_final/Aqualens_VNEXT_Final_Artifacts.zip`. Its 18 notebook-exported file hashes were verified against the extracted payload. The archive is retained read-only; no experiment artifact was overwritten. Environment: Python 3.12.13, torch 2.10.0+cu128, Ultralytics 8.4.135, NVIDIA RTX PRO 6000 Blackwell Server Edition (94.97 GiB).

Dataset `multidomain_sonar_v1_1_20260831` had 406 samples: train 76 ARTIFICIAL / 272 NATURAL_OR_ARTEFACT; validation 11 / 47. QA reported no group leakage, no exact duplicates, and `held_out_test_count: 0`.

## Natural Clutter Suppressor v1 — REJECTED_FOR_AUTOMATIC_SUPPRESSION

Classifier validation: TP 6, FP 15, FN 5, TN 32; precision 0.285714, recall 0.545455, F1 0.375. AUROC is unavailable and must not be inferred.

The real frozen-YOLO operational ablation used 25 validation images at IoU 0.3 and did not use a test set. Baseline was TP 2 / FP 23 / FN 69 (precision 0.08; recall 2.82%). With the suppressor it was TP 0 / FP 19 / FN 71 (precision 0; recall 0%). Thus false positives decreased by 4/23 (17.39%), **but the suppressor eliminated both baseline true positives**.

It fails the recall-preservation constraint and is rejected as an automatic suppression/veto gate. The checkpoint remains immutable experiment provenance. Runtime may represent it only as nullable, experimental `ADVISORY_ONLY` evidence; it cannot reject a Contact or change raw YOLO confidence and is not a calibrated probability.

This result does not establish that learned clutter suppression is fundamentally ineffective. It establishes only that this model, dataset, training protocol, and operating configuration are unsuitable as an automatic suppression gate.

## Detector limitation

The frozen YOLO SHA256 is `2aa3ac71051856bcfc8ec400804995f03568aa26d1a1fb24583e4eb1b7a10b15`. Held-out SHIPWRECK precision 1.0 with recall 0.0, AP50 0.0148502170, and mAP50-95 0.0042534500 is not useful learnability evidence. The new candidate-generation subset is likewise weak (TP 2, FN 69, recall about 2.82%). VNEXT does not fix shipwreck recognition.
