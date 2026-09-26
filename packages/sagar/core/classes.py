from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from .models import LabelCertainty, UnifiedClass


@dataclass(frozen=True)
class ClassMapping:
    category: UnifiedClass | None
    certainty: LabelCertainty | None
    negative: bool = False
    annotation: str | None = None


class ClassMapper:
    def __init__(self, config: dict[str, Any]):
        self.version = int(config["version"])
        self.indices = {name: value["index"] for name, value in config["classes"].items()}
        self._mappings = config["mappings"]

    def map(self, dataset_id: str, source_class: str) -> ClassMapping:
        try:
            raw = self._mappings[dataset_id][source_class]
        except KeyError as exc:
            raise ValueError(f"no explicit canonical mapping for {dataset_id}:{source_class}") from exc
        if raw.get("negative"):
            return ClassMapping(None, None, negative=True, annotation=raw.get("annotation"))
        return ClassMapping(
            UnifiedClass(raw["class"]), LabelCertainty(raw.get("certainty", "CERTAIN")),
            annotation=raw.get("annotation"),
        )

    def yolo_index(self, category: UnifiedClass) -> int:
        if category is UnifiedClass.UNKNOWN_ANOMALY_CANDIDATE:
            raise ValueError("unknown anomaly is not a supervised YOLO class")
        try:
            return self.indices[category.value]
        except KeyError as exc:
            raise ValueError(f"class {category.value} has no training index") from exc


def load_class_mapper(path: str | Path) -> ClassMapper:
    with Path(path).open() as handle:
        return ClassMapper(yaml.safe_load(handle))
