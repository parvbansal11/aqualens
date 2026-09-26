from pathlib import Path

import numpy as np
from PIL import Image

from sagar.core.models import Channel, Geometry
from sagar.core.pics import PICSRangeUnit, frame_pixel_to_pics
from sagar.io.tiling import TILE_SIZE, build_tiles, clip_box


def test_clipping_discards_micro_fragments():
    assert clip_box((500, 500, 100, 100), 0, 0, TILE_SIZE, TILE_SIZE) is None
    assert clip_box((400, 400, 200, 200), 0, 0, TILE_SIZE, TILE_SIZE) == (400, 400, 112, 112)


def test_edge_tile_is_retained_and_padded(tmp_path):
    image_path = tmp_path / "frame.png"
    Image.fromarray(np.ones((500, 700), dtype=np.uint8) * 80).save(image_path)
    frame = {"frame_id": "frame", "dataset_id": "d", "group_key": "g", "source_path": str(image_path),
             "geometry": Geometry(channel=Channel.DUAL, level_reason="test").model_dump(mode="json"), "annotations": []}
    tiles = build_tiles([frame], {"frame": "train"}, tmp_path / "out")
    assert any(tile["padded_right_px"] > 0 for tile in tiles)
    assert any(tile["padded_bottom_px"] > 0 for tile in tiles)


def test_pics_never_mislabels_pixel_range_as_metric():
    geometry = Geometry(channel=Channel.DUAL, nadir_offset_px=100, level_reason="test")
    pics = frame_pixel_to_pics(50, 140, geometry)
    assert pics.side is Channel.STARBOARD
    assert pics.range_from_nadir == 40
    assert pics.range_unit is PICSRangeUnit.PIXEL_RANGE
