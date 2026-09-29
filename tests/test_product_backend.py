"""Public API integration tests use isolated storage, never frozen research artifacts."""
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from sagar.api import create_app

ROOT = Path(__file__).resolve().parents[1]

@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv('SAGARDRISHTI_RUNTIME_DIR', str(tmp_path / 'runtime'))
    return TestClient(create_app(ROOT))

def test_mission_creation_is_durable_and_strict(client):
    response = client.post('/api/v1/missions', json={'name': 'Real mission'})
    assert response.status_code == 201, response.text
    mission = response.json()
    assert mission['demo'] is False
    assert client.get('/api/v1/missions/' + mission['mission_id']).json()['name'] == 'Real mission'
    assert client.post('/api/v1/missions', json={'name': 'bad', 'demo': True}).status_code == 422

@pytest.fixture
def demo(client, monkeypatch):
    monkeypatch.setenv('AQUALENS_DEMO_MODE', '1')
    response = client.post('/api/v1/demo/seed')
    assert response.status_code == 200, response.text
    return response.json()['mission_id']

def test_complete_demo_story_and_immutable_report(client, demo):
    assert client.get(f'/api/v1/missions/{demo}/surveys').json()['items'][0]['demo']
    assert client.post('/api/v1/surveys/demo_survey_01/process').json()['stage'] == 'FIXTURE_LOAD'
    a = '/api/v1/contacts/demo_contact_a'
    assert client.post(a + '/review', json={'actor': 'test analyst', 'status': 'CONFIRMED'}).status_code == 200
    assert client.post(a + '/classification', json={'actor': 'test analyst', 'classification': 'FISHING_GEAR'}).status_code == 200
    b = '/api/v1/contacts/demo_contact_b'
    assert client.post(b + '/classification', json={'actor': 'test analyst', 'classification': 'PLASTIC_DEBRIS'}).status_code == 200
    assert client.post(b + '/priority', json={'actor': 'test analyst', 'priority': 'CRITICAL'}).status_code == 200
    note = '<script>alert(1)</script>'
    assert client.post(b + '/notes', json={'actor': 'test analyst', 'note': note}).status_code == 200
    contact = client.get(b).json()
    assert contact['machine'] is None
    assert contact['analyst']['classification'] == 'PLASTIC_DEBRIS'
    assert contact['evidence']['local_anomaly']['status'] == 'NOT_VALIDATED'
    assert contact['evidence']['local_anomaly']['values'] is None
    # Demo B starts UNREVIEWED: every history entry here is the analyst's own action.
    assert len(contact['history']) == 3
    assert contact['history'][0]['before']['classification'] == 'UNRESOLVED'
    assert contact['history'][0]['after']['classification'] == 'PLASTIC_DEBRIS'
    assert contact['history'][-1]['after']['priority'] == 'CRITICAL'
    assert all(event['demo'] for event in contact['history'])
    geo = client.get(f'/api/v1/missions/{demo}/map').json()
    assert geo['availability'] == 'AVAILABLE'
    assert all(f['properties']['provenance'] == 'SYNTHETIC_DEMO' for f in geo['features'])
    response = client.post(f'/api/v1/missions/{demo}/reports')
    assert response.status_code == 201, response.text
    report = response.json()
    assert report['demo'] and report['limitations']
    assert report['provenance']['shipwreck_recovery'] is False
    assert report['contacts'][1]['machine'] is None
    url = '/api/v1/reports/' + report['report_id']
    exported = client.get(url + '?format=html&download=true')
    assert '<script>' not in exported.text
    assert '&lt;script&gt;' in exported.text
    assert 'attachment' in exported.headers['content-disposition']
    client.post(b + '/priority', json={'actor': 'second', 'priority': 'LOW'})
    assert client.get(url).json() == report  # immutable review snapshot
    assert client.get('/api/v1/system/capabilities').json()['metric_depth']['availability'] == 'UNAVAILABLE'
    assert client.get('/api/v1/system/provenance').json()['shipwreck_recovery'] is False
    # Seeding twice never overwrites review history.
    client.post('/api/v1/demo/seed')
    assert len(client.get(b + '/history').json()['items']) == 4

def test_demo_is_separate_and_requests_are_strict(client, demo):
    real = client.post('/api/v1/missions', json={'name': 'Scientific mission'}).json()['mission_id']
    assert client.get(f'/api/v1/missions/{real}/contacts').json()['items'] == []
    assert client.get(f'/api/v1/missions/{real}/map').json()['availability'] == 'UNAVAILABLE'
    report = client.post(f'/api/v1/missions/{real}/reports').json()
    assert report['demo'] is False and report['contacts'] == []
    assert client.get(f'/api/v1/missions/{real}/contacts?survey_ref=demo_survey_01').status_code == 404
    url = '/api/v1/contacts/demo_contact_a'
    before = client.get(url).json()
    for suffix, payload in [('classification', {'classification': 'PLASTIC'}), ('priority', {'priority': 'URGENT'}),
                            ('review', {'status': 'AUTO_CONFIRMED'})]:
        assert client.post(url + '/' + suffix, json={'actor': 'analyst', **payload}).status_code == 422
    assert client.post(url + '/classification', json={'actor': 'analyst', 'classification': 'PLASTIC_DEBRIS', 'machine_class': 'PLASTIC_DEBRIS'}).status_code == 422
    assert client.get(url).json() == before
    assert client.get(f'/api/v1/missions/{demo}/contacts?priority=LOW&machine_class=PIPELINE&reviewed=true').json()['total'] == 1
    assert client.get(f'/api/v1/missions/{demo}/contacts?machine_class=CRAB_POT&status=UNREVIEWED&reviewed=false').json()['total'] == 1
    assert client.get(f'/api/v1/missions/{demo}/contacts?machine_class=PLASTIC_DEBRIS').status_code == 422
    assert client.get(f'/api/v1/missions/{demo}/contacts?limit=0').status_code == 422


def test_real_upload_to_report_and_idempotency(client, monkeypatch):
    from test_runtime_api_resilience import _fake_infer, _png_bytes, _await
    from sagar.perception.runtime import FinalDetector
    monkeypatch.setattr(FinalDetector, 'infer', _fake_infer)
    monkeypatch.setattr(FinalDetector, 'load', lambda self: None)
    mission = client.post('/api/v1/missions', json={'name': 'Real upload test'}).json()['mission_id']
    url = f'/api/v1/missions/{mission}/uploads'
    response = client.post(url, files={'file': ('sonar.png', _png_bytes(), 'image/png')})
    assert response.status_code == 202, response.text
    accepted = response.json()
    assert len(accepted['survey_refs']) == 1
    job = _await(client, accepted['job_id'])
    assert job['state'] == 'COMPLETED', job
    survey = client.get('/api/v1/surveys/' + accepted['survey_refs'][0]).json()
    assert survey['membership_provenance'] == 'SINGLETON'
    assert survey['status'] == 'READY'
    assert client.post('/api/v1/surveys/' + survey['survey_id'] + '/process').json()['job_id'] == accepted['job_id']
    assert client.post(url, files={'file': ('copy.png', _png_bytes(), 'image/png')}).status_code == 409
    # The Mission list reports the same uploads and Surveys as the Mission itself.
    detail = client.get(f'/api/v1/missions/{mission}').json()
    listed = next(m for m in client.get('/api/v1/missions?limit=200').json() if m['mission_id'] == mission)
    assert listed['upload_ids'] == detail['upload_ids'] == [accepted['upload_id']]
    assert listed['survey_ids'] == detail['survey_ids'] == accepted['survey_refs']
    rows = client.get(f'/api/v1/missions/{mission}/contacts').json()['items']
    assert len(rows) == 1
    contact = rows[0]
    assert contact['look_count'] == 1
    assert contact['machine']['raw_detector_score'] == .42
    assert contact['machine']['supervised_class'] == 'SHIPWRECK'
    assert 'confidence' not in str(contact.keys())
    assert contact['evidence']['persistence']['status'] == 'UNAVAILABLE'
    assert contact['evidence']['raised_relief']['values'] is None
    assert client.post('/api/v1/contacts/' + contact['contact_id'] + '/classification', json={'actor': 'actual supplied actor', 'classification': 'PLASTIC_DEBRIS'}).status_code == 200
    updated = client.get('/api/v1/contacts/' + contact['contact_id']).json()
    assert updated['machine'] == contact['machine']
    report = client.post(f'/api/v1/missions/{mission}/reports')
    assert report.status_code == 201, report.text
    assert not report.json()['demo']
    assert report.json()['map']['availability'] == 'UNAVAILABLE'


def test_health_capabilities_and_restart(client):
    assert client.get('/api/v1/health').status_code == 200
    ready = client.get('/api/v1/readiness')
    assert ready.status_code in (200, 503)
    assert ready.json()['services']['database'] is True
    assert client.app.state.store.runtime.shipwreck_recovery is False
    mission = client.post('/api/v1/missions', json={'name': 'Retained'}).json()
    restarted = TestClient(create_app(ROOT))
    assert restarted.get('/api/v1/missions/' + mission['mission_id']).json()['name'] == 'Retained'


def test_upload_guards_and_demo_navigation_isolation(client, demo, monkeypatch):
    from test_runtime_api_resilience import _fake_infer, _png_bytes, _zip_bytes
    from sagar.perception.runtime import FinalDetector
    monkeypatch.setattr(FinalDetector, 'infer', _fake_infer)
    monkeypatch.setattr(FinalDetector, 'load', lambda self: None)
    mission = client.post('/api/v1/missions', json={'name': 'Guarded'}).json()['mission_id']
    url = f'/api/v1/missions/{mission}/uploads'
    assert client.post(url, files={'file': ('bad.exe', b'bad')}).status_code == 422
    assert client.post(url, files={'file': ('bad.png', b'bad')}).status_code == 422
    assert client.post(url, files={'file': ('bad.zip', _zip_bytes({'../escape.png': _png_bytes()}))}).status_code == 422
    assert client.post(url, files={'file': ('bad.zip', _zip_bytes({'a/one.png': _png_bytes(), 'b/one.png': _png_bytes()}))}).json()['error']['code'] == 'DUPLICATE_ARCHIVE_NAME'
    # Synthetic navigation enters the normal path with its provenance kept (see test_navigation_provenance).
    synthetic = _zip_bytes({'one.png': _png_bytes(), 'provenance.json': '{"navigation_provenance":"SYNTHETIC_DEMO"}'})
    response = client.post(url, files={'file': ('demo.zip', synthetic)})
    assert response.status_code == 202, response.text
    assert client.get(url).json()['items'][0]['navigation_provenance'] == 'SYNTHETIC_DEMO'
    assert client.get(f'/api/v1/missions/{mission}').json()['demo'] is False
    derived = _zip_bytes({'one.png': _png_bytes(), 'provenance.json': '{"navigation_provenance":"DERIVED_FROM_SOURCE"}'})
    assert client.post(url, files={'file': ('derived.zip', derived)}).status_code == 422
    assert client.post(f'/api/v1/missions/{demo}/uploads', files={'file': ('real.png', _png_bytes())}).status_code == 409
    # Only the synthetic-track bundle was accepted; every guarded upload left nothing behind.
    assert [u['filename'] for u in client.get(f'/api/v1/missions/{mission}/uploads').json()['items']] == ['demo.zip']


def test_concurrent_review_history_is_serialized_and_persistent(client, demo):
    from concurrent.futures import ThreadPoolExecutor
    path = '/api/v1/contacts/demo_contact_a'
    with ThreadPoolExecutor(max_workers=4) as pool:
        responses = list(pool.map(lambda i: client.post(path + '/notes', json={'actor': f'actor-{i}', 'note': f'note-{i}'}), range(8)))
    assert all(r.status_code == 200 for r in responses)
    history = client.get(path + '/history').json()['items']
    assert len(history) == 8
    assert len({e['review_id'] for e in history}) == 8
    for prior, current in zip(history, history[1:]):
        assert prior['after'] == current['before']
    restarted = TestClient(create_app(ROOT))
    assert restarted.get(path + '/history').json()['items'] == history


def test_failed_job_is_durable_and_report_is_refused(client, monkeypatch):
    from test_runtime_api_resilience import _png_bytes, _await
    from sagar.perception.runtime import FinalDetector
    monkeypatch.setattr(FinalDetector, 'load', lambda self: None)
    def failure(*args, **kwargs):
        raise RuntimeError('private internal path should not be returned')
    monkeypatch.setattr(FinalDetector, 'infer', failure)
    mission = client.post('/api/v1/missions', json={'name': 'Failed run'}).json()['mission_id']
    response = client.post(f'/api/v1/missions/{mission}/uploads', files={'file': ('one.png', _png_bytes())})
    assert response.status_code == 202, response.text
    job = _await(client, response.json()['job_id'])
    assert job['state'] == 'FAILED'
    assert 'private' not in job['error']['message']
    assert client.post(f'/api/v1/missions/{mission}/reports').status_code == 409
    restarted = TestClient(create_app(ROOT))
    assert restarted.get('/api/v1/jobs/' + job['job_id']).json()['state'] == 'FAILED'
    assert restarted.get(f'/api/v1/missions/{mission}/uploads').json()['items'][0]['status'] == 'FAILED'


def test_duplicate_rasters_do_not_create_persistence(client, monkeypatch):
    from test_runtime_api_resilience import _png_bytes, _zip_bytes, _fake_infer, _await
    from sagar.perception.runtime import FinalDetector
    monkeypatch.setattr(FinalDetector, 'load', lambda self: None)
    monkeypatch.setattr(FinalDetector, 'infer', _fake_infer)
    mission = client.post('/api/v1/missions', json={'name': 'Duplicate rasters'}).json()['mission_id']
    image = _png_bytes()
    bundle = _zip_bytes({'a.png': image, 'b.png': image})
    response = client.post(f'/api/v1/missions/{mission}/uploads', files={'file': ('images.zip', bundle)})
    assert response.status_code == 202, response.text
    assert _await(client, response.json()['job_id'])['state'] == 'COMPLETED'
    contacts = client.get(f'/api/v1/missions/{mission}/contacts').json()['items']
    assert len(contacts) == 1
    assert all(c['look_count'] == 1 and c['evidence']['persistence']['status'] == 'UNAVAILABLE' for c in contacts)
    surveys = client.get(f'/api/v1/missions/{mission}/surveys').json()['items']
    assert all(f['raster_duplicate_status'] == 'DUPLICATE_RASTER' for s in surveys for f in s['frames'])


def test_measured_navigation_is_platform_context_not_contact_position(client, monkeypatch):
    from test_runtime_api_resilience import _png_bytes, _zip_bytes, _fake_infer, _await
    from sagar.perception.runtime import FinalDetector
    monkeypatch.setattr(FinalDetector, 'load', lambda self: None)
    monkeypatch.setattr(FinalDetector, 'infer', _fake_infer)
    mission = client.post('/api/v1/missions', json={'name': 'Declared navigation'}).json()['mission_id']
    bundle = _zip_bytes({'a.png': _png_bytes(), 'navigation.csv': 'frame,timestamp_utc,latitude,longitude\na.png,2026-09-01T15:30:00Z,18.9,72.8\n',
                         'provenance.json': '{"navigation_provenance":"MEASURED"}'})
    result = client.post(f'/api/v1/missions/{mission}/uploads', files={'file': ('nav.zip', bundle)})
    assert result.status_code == 202, result.text
    assert _await(client, result.json()['job_id'])['state'] == 'COMPLETED'
    geo = client.get(f'/api/v1/missions/{mission}/map').json()
    assert geo['availability'] == 'UNAVAILABLE'
    assert geo['features'] == []
    fix = geo['platform_context'][0]
    assert fix['geometry']['coordinates'] == [72.8, 18.9]
    assert fix['properties']['role'] == 'PLATFORM_FIX_NOT_CONTACT_LOCATION'
    assert fix['properties']['verification'] == 'UPLOADER_DECLARATION_ONLY'
    assert fix['properties']['provenance'] == 'MEASURED'


def test_frozen_evidence_cannot_be_runtime_storage(monkeypatch):
    monkeypatch.setenv('SAGARDRISHTI_RUNTIME_DIR', str(ROOT / 'artifacts/round2/H0'))
    with pytest.raises(ValueError, match='frozen/source evidence'):
        create_app(ROOT)


def test_demo_reset_refuses_live_backend(client):
    import os
    import subprocess
    result = subprocess.run([str(ROOT / '.venv/bin/python'), '-m', 'sagar.api.demo', '--reset'],
        cwd=ROOT, env={**os.environ, 'PYTHONPATH': str(ROOT / 'packages')}, capture_output=True, text=True)
    assert result.returncode != 0
    assert 'Stop the backend' in result.stderr
