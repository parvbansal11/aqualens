import numpy as np

from sagar.preprocess import estimate_nadir


def test_nadir_estimator_refuses_flat_image():
    result = estimate_nadir(np.full((128, 512), 127, dtype=np.uint8))
    assert result.position_px is None
    assert result.state in {"UNKNOWN", "LOW_QUALITY"}


def test_nadir_estimator_recovers_clear_central_low_return_band():
    image = np.full((200, 512), 180, dtype=np.uint8)
    image[95:106, :] = 20
    result = estimate_nadir(image)
    assert result.position_px is not None
    assert 90 <= result.position_px <= 110
