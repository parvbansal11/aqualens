"""Post-freeze correction: point targets need repeated physical observations."""
import pytest
from test_a7_association import _obs, _box, CONTIGUOUS
from sagar.vnext.contacts import fuse_contacts

@pytest.mark.parametrize('provenance', ['DERIVED_FROM_SOURCE', 'SYNTHETIC_DEMO', None])
@pytest.mark.parametrize('reverse', [False, True])
def test_point_targets_do_not_gain_persistence_from_adjacent_windows(provenance, reverse):
    rows = [_obs(i, p, _box(1000, 100), raw_class='CRAB_POT', provenance=provenance)
            for i, p in enumerate(CONTIGUOUS)]
    if reverse:
        rows.reverse()
    contacts = fuse_contacts(rows, 'u')
    assert len(contacts) == 2
    assert all(c['look_count'] == 1 for c in contacts)
    assert all(c['persistence_evidence_type'] == 'SINGLE_OBSERVATION' for c in contacts)

def test_duplicate_observation_cannot_create_a_look():
    row = _obs(0, (0, 499), _box(1000, 100), raw_class='CRAB_POT')
    assert fuse_contacts([row, row], 'u')[0]['look_count'] == 1

def test_point_target_overlapping_source_pings_remain_one_look():
    rows = [_obs(0, (0, 499), (1000, 120, 1100, 220), raw_class='CRAB_POT'),
            _obs(1, (20, 519), (1000, 100, 1100, 200), raw_class='CRAB_POT')]
    contacts = fuse_contacts(rows, 'u')
    assert len(contacts) == 1
    assert contacts[0]['look_count'] == 1
    assert contacts[0]['association_basis'] == 'SAME_LOOK_OVERLAPPING_WINDOWS'

def test_pipeline_continuity_is_preserved():
    rows = [_obs(i, p, _box(1000, 100)) for i, p in enumerate(CONTIGUOUS)]
    contacts = fuse_contacts(rows, 'u')
    assert len(contacts) == 1
    assert contacts[0]['look_count'] == 2
