"""PICS conversion functions. Range units are always explicit."""
from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel

from .models import Channel, Geometry


class PICSRangeUnit(str, Enum):
    PIXEL_RANGE = "PIXEL_RANGE"
    METRIC_RANGE = "METRIC_RANGE"


class PICSLocation(BaseModel):
    ping: float | None
    range_from_nadir: float | None
    range_unit: PICSRangeUnit
    side: Channel
    source_frame_x_px: float
    source_frame_y_px: float
    nadir_known: bool


def tile_pixel_to_frame(tile: Any, x_px: float, y_px: float) -> tuple[float, float]:
    return tile.x_origin_px + x_px, tile.y_origin_px + y_px


def frame_pixel_to_pics(frame_x_px: float, frame_y_px: float, geometry: Geometry) -> PICSLocation:
    nadir = geometry.nadir_offset_px
    if nadir is None:
        return PICSLocation(
            ping=None, range_from_nadir=None, range_unit=PICSRangeUnit.PIXEL_RANGE,
            side=Channel.UNKNOWN, source_frame_x_px=frame_x_px, source_frame_y_px=frame_y_px,
            nadir_known=False,
        )
    # Contract examples define COLS as along-track. Support ROWS for readers that expose it.
    along = frame_x_px if geometry.along_track_axis == "COLS" else frame_y_px
    across = frame_y_px if geometry.along_track_axis == "COLS" else frame_x_px
    ping = None if geometry.ping_index_start is None else (
        geometry.ping_index_start + geometry.along_sign * along * (geometry.ping_stride or 1.0)
    )
    offset = across - nadir
    side = Channel.PORT if offset < 0 else Channel.STARBOARD
    pixel_range = abs(offset)
    if geometry.range_scale_m_per_px is not None:
        range_value = pixel_range * geometry.range_scale_m_per_px
        unit = PICSRangeUnit.METRIC_RANGE
    else:
        range_value = pixel_range
        unit = PICSRangeUnit.PIXEL_RANGE
    return PICSLocation(
        ping=ping, range_from_nadir=range_value, range_unit=unit, side=side,
        source_frame_x_px=frame_x_px, source_frame_y_px=frame_y_px, nadir_known=True,
    )
