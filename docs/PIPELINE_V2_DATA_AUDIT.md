# Pipeline v2 data audit

The current PIPELINE supervision source is SubPipeMini2, materialized as YOLO axis-aligned tile boxes. The generated inventory and box audit are read-only. Pixel/tightness and visual-gallery conclusions require source-raster audit execution; no dark-pixel statistic is ground truth for shadow.

OBB feasibility: `NOT_DEFENSIBLE` from AABB labels alone. Segmentation feasibility: `NO_MASKS` in this materialization. Recommended next model path is frozen YOLO plus verifier until provenance-rich analyst-rejected pipeline negatives and a complete pixel/tightness audit exist. Do not claim a hard-negative-trained improvement, OBB labels, segmentation masks, or shadow ground truth.
