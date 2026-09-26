from pathlib import Path
import pytest

from sagar.core import load_class_mapper
from sagar.core.models import UnifiedClass


ROOT = Path(__file__).resolve().parents[1]


def test_frozen_mappings_are_explicit():
    mapper = load_class_mapper(ROOT / "configs/classes.yaml")
    assert mapper.map("subpipe", "pipeline").category is UnifiedClass.PIPELINE
    assert mapper.map("ai4shipwrecks", "wreck").category is UnifiedClass.WRECK_OR_STRUCTURAL_DEBRIS


def test_unknown_is_never_yolo_label():
    mapper = load_class_mapper(ROOT / "configs/classes.yaml")
    with pytest.raises(ValueError):
        mapper.yolo_index(UnifiedClass.UNKNOWN_ANOMALY_CANDIDATE)
