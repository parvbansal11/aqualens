# Open-set v1

Open-set v1 is an advisory `PATCHCORE_STYLE_OPEN_SET` channel. It uses nearest-neighbour distance from a memory of frozen YOLO11s layer-16 embeddings. The frozen detector remains the only known-class candidate generator; no supervised `UNKNOWN` class is added.

## Reference and calibration

The immutable artifact at `ml/artifacts/vnext/open_set_v1/` was built from SubPipe annotation-safe background tiles in the train split. It contains 56,928 train background patch embeddings reduced deterministically to 2,048 memory vectors. The threshold is the q99.5 value of annotation-safe background patches in the validation split: `0.4616784453392029`. No held-out test, Epitome demo, screenshot, or artificial-object crop was used.

The feature extractor is the frozen production YOLO11s layer-16 representation, with checkpoint SHA256 `2aa3ac71051856bcfc8ec400804995f03568aa26d1a1fb24583e4eb1b7a10b15`, Ultralytics preprocessing at `imgsz=640`, 4x4 adaptive pooling, and L2 normalization. The memory and threshold are versioned and hash recorded.

## Runtime semantics

For each detector observation with a source raster, runtime scores a padded candidate context crop and attaches `anomaly_score`, `threshold`, `threshold_source`, `feature_source`, `memory_version`, `status`, and `is_open_set_candidate`. The score is distance to the reference memory, not a probability, confidence, class, or artificiality judgment. Missing artifact or feature extraction produces `NOT_CONFIGURED` or `FAILED`, never zero.

If a threshold is exceeded, the observation retains its raw known class and is surfaced as an open-set candidate requiring analyst review. Open-set evidence is one separate component of `UNVALIDATED_EVIDENCE_FUSION`; it cannot independently mark a Contact artificial or overwrite raw detector confidence.

## Limits

The background-only threshold supports anomaly evidence relative to this SubPipe reference representation. Positive artificial-target distributions were not used to claim AUROC, TPR, FPR, or cross-domain unknown-object recognition. A high open-set anomaly score indicates dissimilarity from the reference memory. It is not proof that a contact is artificial, hazardous, or previously unseen in a semantic sense.
