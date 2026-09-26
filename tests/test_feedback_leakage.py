from sagar.evaluation.splits import feedback_training_eligible


def test_reviewed_test_frame_is_never_training_eligible():
    split = {"frame_assignments": {"train": "train", "val": "val", "test": "test"}}
    assert feedback_training_eligible("test", split, True, True) == (False, "EVALUATION_SPLIT")
    assert feedback_training_eligible("val", split, True, True) == (False, "EVALUATION_SPLIT")
    assert feedback_training_eligible("train", split, True, True) == (True, None)
