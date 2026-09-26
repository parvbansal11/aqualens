# H0-8 runtime-path detector baseline (test only)

Runtime-path metrics: the deployed tiled/full-frame path at production floors, recovery off, PID-06 matching.
AI4 is FRAGMENT-LEVEL (GT = mask fragments; not wreck objects). AI4 object-level metrics: UNAVAILABLE_PENDING_PID_01.
PING primary = one image per augmentation parent (n = 324); all variants = SENSITIVITY only.
Rates with fewer than 30 events are reported but not for claims (spec §7.8). null = undefined, never 0.

## SUBPIPE|Klein 3500|ALL_TEST (PRIMARY, BOX; 1800 images, 37 bootstrap groups)

IoU 0.5 (primary)

| class | TP | detections | GT | precision [95 % bootstrap] | precision for claims | recall [95 % bootstrap] | recall for claims |
|---|---|---|---|---|---|---|---|
| CRAB_POT | 0 | 7 | 0 | 0.000 [0.000, 0.000] | no (n = 7 < 30) | null [null, null] | no (n = 0 < 30) |
| PIPELINE | 1496 | 2701 | 1800 | 0.554 [0.493, 0.623] | yes | 0.831 [0.741, 0.912] | yes |

IoU 0.3 (secondary)

| class | TP | detections | GT | precision [95 % bootstrap] | precision for claims | recall [95 % bootstrap] | recall for claims |
|---|---|---|---|---|---|---|---|
| CRAB_POT | 0 | 7 | 0 | 0.000 [0.000, 0.000] | no (n = 7 < 30) | null [null, null] | no (n = 0 < 30) |
| PIPELINE | 1653 | 2701 | 1800 | 0.612 [0.554, 0.683] | yes | 0.918 [0.853, 0.976] | yes |

## SUBPIPE|Klein 3500|HF (CHANNEL_BREAKDOWN, BOX; 975 images, 19 bootstrap groups)

IoU 0.5 (primary)

| class | TP | detections | GT | precision [95 % bootstrap] | precision for claims | recall [95 % bootstrap] | recall for claims |
|---|---|---|---|---|---|---|---|
| CRAB_POT | 0 | 2 | 0 | 0.000 [0.000, 0.000] | no (n = 2 < 30) | null [null, null] | no (n = 0 < 30) |
| PIPELINE | 785 | 1678 | 975 | 0.468 [0.410, 0.532] | yes | 0.805 [0.664, 0.926] | yes |

IoU 0.3 (secondary)

| class | TP | detections | GT | precision [95 % bootstrap] | precision for claims | recall [95 % bootstrap] | recall for claims |
|---|---|---|---|---|---|---|---|
| CRAB_POT | 0 | 2 | 0 | 0.000 [0.000, 0.000] | no (n = 2 < 30) | null [null, null] | no (n = 0 < 30) |
| PIPELINE | 889 | 1678 | 975 | 0.530 [0.474, 0.601] | yes | 0.912 [0.803, 0.989] | yes |

## SUBPIPE|Klein 3500|LF (CHANNEL_BREAKDOWN, BOX; 825 images, 18 bootstrap groups)

IoU 0.5 (primary)

| class | TP | detections | GT | precision [95 % bootstrap] | precision for claims | recall [95 % bootstrap] | recall for claims |
|---|---|---|---|---|---|---|---|
| CRAB_POT | 0 | 5 | 0 | 0.000 [0.000, 0.000] | no (n = 5 < 30) | null [null, null] | no (n = 0 < 30) |
| PIPELINE | 711 | 1023 | 825 | 0.695 [0.601, 0.791] | yes | 0.862 [0.754, 0.955] | yes |

IoU 0.3 (secondary)

| class | TP | detections | GT | precision [95 % bootstrap] | precision for claims | recall [95 % bootstrap] | recall for claims |
|---|---|---|---|---|---|---|---|
| CRAB_POT | 0 | 5 | 0 | 0.000 [0.000, 0.000] | no (n = 5 < 30) | null [null, null] | no (n = 0 < 30) |
| PIPELINE | 764 | 1023 | 825 | 0.747 [0.670, 0.826] | yes | 0.926 [0.838, 0.995] | yes |

## AI4SHIPWRECKS|EdgeTech 2205|FRAGMENT_LEVEL (PRIMARY, FRAGMENT_LEVEL; 120 images, 13 bootstrap groups)

IoU 0.5 (primary)

| class | TP | detections | GT | precision [95 % bootstrap] | precision for claims | recall [95 % bootstrap] | recall for claims |
|---|---|---|---|---|---|---|---|
| CRAB_POT | 0 | 89 | 0 | 0.000 [0.000, 0.000] | yes | null [null, null] | no (n = 0 < 30) |
| PIPELINE | 0 | 97 | 0 | 0.000 [0.000, 0.000] | yes | null [null, null] | no (n = 0 < 30) |
| SHIPWRECK | 0 | 0 | 347 | null [null, null] | no (n = 0 < 30) | 0.000 [0.000, 0.000] | yes |

IoU 0.3 (secondary)

| class | TP | detections | GT | precision [95 % bootstrap] | precision for claims | recall [95 % bootstrap] | recall for claims |
|---|---|---|---|---|---|---|---|
| CRAB_POT | 0 | 89 | 0 | 0.000 [0.000, 0.000] | yes | null [null, null] | no (n = 0 < 30) |
| PIPELINE | 0 | 97 | 0 | 0.000 [0.000, 0.000] | yes | null [null, null] | no (n = 0 < 30) |
| SHIPWRECK | 0 | 0 | 347 | null [null, null] | no (n = 0 < 30) | 0.000 [0.000, 0.000] | yes |

## PING_GHOSTVISION|Humminbird|PRIMARY_ONE_PER_PARENT (PRIMARY, BOX; 324 images, 145 bootstrap groups)

IoU 0.5 (primary)

| class | TP | detections | GT | precision [95 % bootstrap] | precision for claims | recall [95 % bootstrap] | recall for claims |
|---|---|---|---|---|---|---|---|
| CRAB_POT | 227 | 333 | 494 | 0.682 [0.612, 0.761] | yes | 0.460 [0.339, 0.657] | yes |

IoU 0.3 (secondary)

| class | TP | detections | GT | precision [95 % bootstrap] | precision for claims | recall [95 % bootstrap] | recall for claims |
|---|---|---|---|---|---|---|---|
| CRAB_POT | 251 | 333 | 494 | 0.754 [0.700, 0.814] | yes | 0.508 [0.389, 0.695] | yes |

## PING_GHOSTVISION|Humminbird|SENSITIVITY_ALL_VARIANTS (SENSITIVITY, BOX; 873 images, 145 bootstrap groups)

IoU 0.5 (primary)

| class | TP | detections | GT | precision [95 % bootstrap] | precision for claims | recall [95 % bootstrap] | recall for claims |
|---|---|---|---|---|---|---|---|
| CRAB_POT | 378 | 591 | 1085 | 0.640 [0.596, 0.722] | yes | 0.348 [0.255, 0.612] | yes |

IoU 0.3 (secondary)

| class | TP | detections | GT | precision [95 % bootstrap] | precision for claims | recall [95 % bootstrap] | recall for claims |
|---|---|---|---|---|---|---|---|
| CRAB_POT | 425 | 591 | 1085 | 0.719 [0.685, 0.780] | yes | 0.392 [0.291, 0.664] | yes |

## Training-representation metrics (for labelled comparison only)

From the frozen detector's metrics.json: Kaggle tile representation, Ultralytics validation; not the runtime path.

- PIPELINE: precision 0.680, recall 0.549, AP50 0.524
- SHIPWRECK: precision 1.000, recall 0.000, AP50 0.015
- CRAB_POT: precision 0.524, recall 0.441, AP50 0.428
