from scripts.refit_turn_threshold import clamp_step, suggest_lower, suggest_raise


def test_suggest_raise_no_unreasonable_keeps_current():
    assert suggest_raise(5, [(True, 2), (True, 6)]) == 5


def test_suggest_raise_targets_past_earliest_unreasonable_turn():
    assert suggest_raise(2, [(False, 3), (True, 6), (False, 7)]) == 4


def test_suggest_raise_never_goes_below_current():
    assert suggest_raise(5, [(False, 1)]) == 5


def test_suggest_lower_no_missed_keeps_current():
    assert suggest_lower(5, []) == 5


def test_suggest_lower_targets_smallest_missed_turn_count():
    assert suggest_lower(5, [8, 3, 6]) == 3


def test_suggest_lower_never_goes_above_current():
    assert suggest_lower(5, [9]) == 5


def test_clamp_step_caps_raise_at_max_step():
    assert clamp_step(5, 9) == 6


def test_clamp_step_caps_lower_at_max_step():
    assert clamp_step(5, 1) == 4


def test_clamp_step_no_change_when_equal():
    assert clamp_step(5, 5) == 5
