"""Hostile checks on the product API's scientific invariants. Isolated storage only."""
import json
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from sagar.api import create_app
from sagar.api.product import validate_runtime_root
from sagar.perception.runtime import FinalDetector
from sagar.vnext.contacts import fuse_contacts
from test_a7_association import _obs, _box, CONTIGUOUS
from test_runtime_api_resilience import _fake_infer, _png_bytes, _zip_bytes, _await

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv('SAGARDRISHTI_RUNTIME_DIR', str(tmp_path / 'runtime'))
    monkeypatch.setattr(FinalDetector, 'load', lambda self: None)
    return TestClient(create_app(ROOT))


def _mission(client, name='Invariant mission'):
    return client.post('/api/v1/missions', json={'name': name}).json()['mission_id']


def _walk(value):
    if isinstance(value, dict):
        yield value
        for item in value.values():
            yield from _walk(item)
    elif isinstance(value, list):
        for item in value:
            yield from _walk(item)


def test_duplicate_rasters_are_inferred_once_per_upload(client, monkeypatch):
    calls = []
    def counting(self, path, survey_id, frame_id):
        calls.append(frame_id)
        return _fake_infer(self, path, survey_id, frame_id)
    monkeypatch.setattr(FinalDetector, 'infer', counting)
    image = _png_bytes()
    response = client.post(f'/api/v1/missions/{_mission(client)}/uploads',
                           files={'file': ('dup.zip', _zip_bytes({'a.png': image, 'b.png': image, 'c.png': image}))})
    assert response.status_code == 202, response.text
    assert _await(client, response.json()['job_id'])['state'] == 'COMPLETED'
    assert calls == ['frame_0000']
    frames = [f for s in client.get(f"/api/v1/missions/{response.json()['mission_id']}/surveys").json()['items'] for f in s['frames']]
    assert sorted(f['inference_mode'] for f in frames).count('DUPLICATE_SKIPPED') == 2


def test_measured_platform_fix_never_becomes_contact_position(client, monkeypatch):
    monkeypatch.setattr(FinalDetector, 'infer', _fake_infer)
    mission = _mission(client)
    bundle = _zip_bytes({'a.png': _png_bytes(), 'navigation.csv': 'frame,timestamp_utc,latitude,longitude\na.png,2026-09-01T15:30:00Z,18.9,72.8\n',
                         'provenance.json': '{"navigation_provenance":"MEASURED"}'})
    response = client.post(f'/api/v1/missions/{mission}/uploads', files={'file': ('nav.zip', bundle)})
    assert _await(client, response.json()['job_id'])['state'] == 'COMPLETED'
    contact = client.get(f'/api/v1/missions/{mission}/contacts').json()['items'][0]
    assert contact['evidence']['navigation']['status'] == 'UNAVAILABLE'
    assert contact['evidence']['navigation']['values'] is None
    encoded = json.dumps(contact)
    assert '18.9' not in encoded and '72.8' not in encoded
    assert not any(k in node for node in _walk(contact) for k in ('latitude', 'longitude', 'lat', 'lon', 'geometry'))
    report = client.post(f'/api/v1/missions/{mission}/reports').json()
    assert report['map']['features'] == []
    assert report['map']['platform_context'][0]['properties']['role'] == 'PLATFORM_FIX_NOT_CONTACT_LOCATION'
    assert client.get('/api/v1/system/capabilities').json()['contact_localization']['availability'] == 'UNAVAILABLE'


def test_demo_recovery_output_is_refused_by_a_real_mission(client, monkeypatch):
    def recovered(self, path, survey_id, frame_id):
        meta, findings = _fake_infer(self, path, survey_id, frame_id)
        for f in findings:
            f.update(candidate_recovery=True, demo=True, evidence_provenance='SYNTHETIC_DEMO', classification_source='DEMO_HEURISTIC')
        return meta, findings
    monkeypatch.setattr(FinalDetector, 'infer', recovered)
    mission = _mission(client)
    response = client.post(f'/api/v1/missions/{mission}/uploads', files={'file': ('one.png', _png_bytes())})
    assert _await(client, response.json()['job_id'])['state'] == 'FAILED'
    assert client.get(f'/api/v1/missions/{mission}/contacts').json()['items'] == []
    assert client.get(f'/api/v1/missions/{mission}/uploads').json()['items'][0]['status'] == 'FAILED'


def test_provenance_and_capabilities_report_the_live_recovery_switch(client):
    store = client.app.state.store
    assert store.runtime.shipwreck_recovery is False
    assert client.get('/api/v1/system/provenance').json()['shipwreck_recovery'] is False
    assert client.get('/api/v1/system/capabilities').json()['shipwreck_demo_recovery']['mode'] == 'OFF'
    store.runtime.shipwreck_recovery = True  # simulate a misconfiguration: the surface must not lie
    provenance = client.get('/api/v1/system/provenance').json()
    assert provenance['shipwreck_recovery'] is True and provenance['scientific_mode'] is False
    assert client.get('/api/v1/system/capabilities').json()['shipwreck_demo_recovery']['mode'] == 'ON'


@pytest.mark.parametrize('relative', ['artifacts/round2/PID02', 'artifacts/round2/H0', 'ml/artifacts/final_v1',
                                      'data/interim/subpipe', 'data/processed', 'docs', '.'])
def test_runtime_storage_refuses_frozen_and_source_trees(relative):
    with pytest.raises(ValueError, match='frozen/source evidence'):
        validate_runtime_root(ROOT / relative, ROOT)


def test_runtime_storage_refuses_sibling_research_repository():
    with pytest.raises(ValueError):
        validate_runtime_root(ROOT.parent / 'sagardrishti' / 'data' / 'runtime', ROOT)


def test_capabilities_have_no_fake_green_research_states(client):
    caps = client.get('/api/v1/system/capabilities').json()
    assert all(c['status'] != 'IMPLEMENTED_AND_VALIDATED' for c in caps.values())
    assert caps['local_anomaly']['availability'] == 'NOT_VALIDATED'
    assert caps['water_column']['availability'] == 'NOT_VALIDATED'
    for key in ('raised_relief', 'metric_depth', 'metric_height', 'contact_localization'):
        assert caps[key]['availability'] == 'UNAVAILABLE'
    assert caps['material_classification']['mode'] == 'ANALYST_ONLY'
    assert caps['shipwreck_supervised']['availability'] == 'FAILED'
    assert caps['known_target_detection']['classes'] == ['PIPELINE', 'SHIPWRECK', 'CRAB_POT']


# --- association: synthetic navigation, platform coordinates and order never create Looks

def test_synthetic_ping_relationship_creates_no_look_even_for_pipeline():
    rows = [_obs(i, p, _box(1000, 100), provenance='SYNTHETIC_DEMO') for i, p in enumerate(CONTIGUOUS)]
    contacts = fuse_contacts(rows, 'u')
    assert len(contacts) == 2 and all(c['look_count'] == 1 for c in contacts)


def test_identical_platform_coordinates_do_not_merge_point_targets():
    rows = [_obs(i, p, _box(1000, 100), raw_class='CRAB_POT', provenance=None) for i, p in enumerate(CONTIGUOUS)]
    for row in rows:
        row['geo'] = {'lat': 18.9, 'lon': 72.8}
    contacts = fuse_contacts(rows, 'u')
    assert len(contacts) == 2 and all(c['look_count'] == 1 for c in contacts)


@pytest.mark.parametrize('raw_class', ['CRAB_POT', 'SHIPWRECK'])
def test_upload_order_permutations_never_create_point_target_persistence(raw_class):
    from itertools import permutations
    pings = [(0, 499), (500, 999), (1000, 1499)]
    rows = [_obs(i, p, _box(1000, 100), raw_class=raw_class) for i, p in enumerate(pings)]
    for order in permutations(rows):
        contacts = fuse_contacts(list(order), 'u')
        assert len(contacts) == 3
        assert {c['persistence_evidence_type'] for c in contacts} == {'SINGLE_OBSERVATION'}


# --- deterministic demo, end to end

def test_demo_end_to_end_is_tagged_and_isolated(client, monkeypatch):
    monkeypatch.setenv('AQUALENS_DEMO_MODE', '1')
    mission = client.post('/api/v1/demo/seed').json()
    assert mission['mission_id'] == 'demo_mission_arabian_sea_07' and mission['demo'] is True
    assert client.post('/api/v1/demo/seed').json() == mission  # deterministic, idempotent
    mid = mission['mission_id']
    assert [m['mission_id'] for m in client.get('/api/v1/missions?demo=true').json()] == [mid]
    assert all(not m.get('demo') for m in client.get('/api/v1/missions').json())
    surveys = client.get(f'/api/v1/missions/{mid}/surveys').json()['items']
    contacts = client.get(f'/api/v1/missions/{mid}/contacts').json()['items']
    assert {c['contact_id'] for c in contacts} == {'demo_contact_a', 'demo_contact_b', 'demo_contact_c'}
    assert client.get(f'/api/v1/missions/{mid}/contacts').json()['items'] == contacts  # stable order
    known = client.get('/api/v1/contacts/demo_contact_a').json()
    assert known['machine']['supervised_class'] == 'CRAB_POT'
    assert known['analyst']['status'] == 'UNREVIEWED' and known['history'] == []
    assert known['evidence']['analyst']['status'] == 'UNAVAILABLE'
    assert known['evidence']['detector']['provenance'] == 'SYNTHETIC_DEMO'
    client.post('/api/v1/contacts/demo_contact_a/review', json={'actor': 'presenter', 'status': 'CONFIRMED'})
    client.post('/api/v1/contacts/demo_contact_a/classification', json={'actor': 'presenter', 'classification': 'FISHING_GEAR'})
    known = client.get('/api/v1/contacts/demo_contact_a').json()
    assert known['analyst']['classification'] == 'FISHING_GEAR'
    assert known['machine']['supervised_class'] == 'CRAB_POT'  # analyst verdict never rewrites machine output
    anomaly = client.get('/api/v1/contacts/demo_contact_b').json()
    assert anomaly['machine'] is None and anomaly['analyst']['status'] == 'UNREVIEWED'
    assert anomaly['evidence']['local_anomaly']['status'] == 'NOT_VALIDATED'
    assert anomaly['evidence']['local_anomaly']['values'] is None
    client.post('/api/v1/contacts/demo_contact_b/classification', json={'actor': 'presenter', 'classification': 'PLASTIC_DEBRIS'})
    event = client.post('/api/v1/contacts/demo_contact_b/priority', json={'actor': 'presenter', 'priority': 'CRITICAL'}).json()
    assert event['before']['priority'] == 'UNSET' and event['after']['priority'] == 'CRITICAL' and event['demo']
    anomaly = client.get('/api/v1/contacts/demo_contact_b').json()
    assert anomaly['machine'] is None and anomaly['analyst']['classification'] == 'PLASTIC_DEBRIS'
    history = client.get('/api/v1/contacts/demo_contact_b/history').json()['items']
    assert [h['action'] for h in history] == ['classification', 'priority']
    assert client.get('/api/v1/contacts/demo_contact_c/history').json()['items'][0]['review_id'] == 'demo_review_c'
    geo = client.get(f'/api/v1/missions/{mid}/map').json()
    assert geo['demo'] is True and len(geo['features']) == 3
    assert {f['properties']['provenance'] for f in geo['features']} == {'SYNTHETIC_DEMO'}
    report = client.post(f'/api/v1/missions/{mid}/reports').json()
    assert report['demo'] is True and report['label'].startswith('DEMO')
    assert report['report_id'].startswith('demo_')
    assert any('DEMO' in line for line in report['limitations'])
    assert 'DEMO' in client.get(f"/api/v1/reports/{report['report_id']}?format=html").text
    # Every record that describes a demo object carries the demo tag.
    tagged = [mission, *surveys, *contacts, *history, geo, report]
    for payload in tagged:
        for node in _walk(payload):
            if node.get('demo') is not None and ('contact_id' in node or 'survey_id' in node or 'mission_id' in node or 'review_id' in node):
                assert node['demo'] is True, node
    for contact in contacts:
        assert contact['provenance'] == 'SYNTHETIC_DEMO'
        assert all(e['demo'] for e in contact['evidence'].values())
        assert all(look['demo'] for look in contact['looks'])
    assert client.get('/api/v1/system/capabilities').status_code == 200
    assert client.get('/api/v1/system/provenance').json()['model_sha'] == '2aa3ac71051856bcfc8ec400804995f03568aa26d1a1fb24583e4eb1b7a10b15'
    # Demo records are invisible to real Missions and never sit in the real store.
    real = _mission(client, 'Real')
    assert client.get(f'/api/v1/missions/{real}/contacts').json()['total'] == 0
    assert client.app.state.store.product.real.rows('contact') == []
    assert client.app.state.store.product.real.rows('mission', mid) == []


def test_checked_in_frontend_contracts_match_the_implementation():
    import os
    import subprocess
    import sys
    result = subprocess.run([sys.executable, str(ROOT / 'scripts/export_product_contracts.py'), '--check'], cwd=ROOT,
                            env={**os.environ, 'PYTHONPATH': str(ROOT / 'packages')}, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr + '\nRegenerate: scripts/export_product_contracts.py'


def test_offline_demo_reset_archives_and_restores_the_fixture(tmp_path):
    import os
    import subprocess
    import sys
    from sagar.api.product import ProductRepository
    runtime = tmp_path / 'runtime'
    env = {**os.environ, 'PYTHONPATH': str(ROOT / 'packages'), 'SAGARDRISHTI_RUNTIME_DIR': str(runtime)}
    run = lambda *args: subprocess.run([sys.executable, '-m', 'sagar.api.demo', *args], cwd=ROOT, env=env, capture_output=True, text=True)
    assert run().stdout.strip() == 'demo_mission_arabian_sea_07'
    repo = ProductRepository(runtime / 'demo' / 'product.sqlite3')
    repo.mutate('demo_contact_a', 'priority', {'actor': 'presenter', 'priority': 'LOW'})
    assert len(repo.history('demo_contact_a')) == 1
    assert run('--reset').returncode == 0
    assert (runtime / 'demo.archive.1' / 'product.sqlite3').is_file()  # audit history archived, not destroyed
    fresh = ProductRepository(runtime / 'demo' / 'product.sqlite3')
    assert fresh.history('demo_contact_a') == []
    assert fresh.get('contact', 'demo_contact_a')['analyst']['status'] == 'UNREVIEWED'
    assert fresh.get('contact', 'demo_contact_a')['analyst']['priority'] == 'UNSET'
    assert not (runtime / 'reviews.sqlite3').exists() or ProductRepository(runtime / 'reviews.sqlite3').rows('contact') == []
