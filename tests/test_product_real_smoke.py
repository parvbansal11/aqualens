"""Operational smoke test: retained real SubPipe frame -> frozen detector -> Contact -> Mission report.

This checks plumbing only. One frame is not an evaluation and supports no performance claim.
The retained frame lives in the sibling research repository and is only read (bytes are sent as an
upload into isolated tmp storage). Skipped when the frame or frozen weights are not installed.
"""
import hashlib
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from sagar.api import create_app
from sagar.perception.runtime import EXPECTED_SHA256
from test_runtime_api_resilience import _await

ROOT = Path(__file__).resolve().parents[1]
FRAME = ROOT.parent / 'sagardrishti/data/interim/subpipe/frames/subpipe_hf_f08e01ebe9790048.png'
WEIGHTS = ROOT / 'ml/artifacts/final_v1/detector/best.pt'

pytestmark = pytest.mark.skipif(not (FRAME.is_file() and WEIGHTS.is_file()),
                                reason='retained SubPipe frame or frozen weights not installed')


def test_real_frame_reaches_a_mission_report(monkeypatch, tmp_path):
    monkeypatch.setenv('SAGARDRISHTI_RUNTIME_DIR', str(tmp_path / 'runtime'))
    source_digest = hashlib.sha256(FRAME.read_bytes()).hexdigest()
    client = TestClient(create_app(ROOT))
    detector = client.app.state.store.runtime
    assert detector.shipwreck_recovery is False
    mission = client.post('/api/v1/missions', json={'name': 'Real smoke'}).json()['mission_id']
    response = client.post(f'/api/v1/missions/{mission}/uploads',
                           files={'file': (FRAME.name, FRAME.read_bytes(), 'image/png')})
    assert response.status_code == 202, response.text
    job = _await(client, response.json()['job_id'], timeout=300)
    assert job['state'] == 'COMPLETED', job
    assert hashlib.sha256(WEIGHTS.read_bytes()).hexdigest() == EXPECTED_SHA256
    assert detector.health()['model_sha256'] == EXPECTED_SHA256
    assert detector.recovery_invocations == 0
    contacts = client.get(f'/api/v1/missions/{mission}/contacts').json()['items']
    assert len(contacts) >= 1
    for contact in contacts:
        assert contact['demo'] is False and contact['provenance'] == 'REAL'
        assert contact['machine']['model_sha'] == EXPECTED_SHA256
        assert contact['machine']['supervised_class'] in {'PIPELINE', 'SHIPWRECK', 'CRAB_POT'}
        assert contact['evidence']['detector']['provenance'] == 'FROZEN_DETECTOR'
        assert contact['evidence']['navigation']['status'] == 'UNAVAILABLE'
        assert contact['evidence']['local_anomaly']['status'] == 'NOT_VALIDATED'
    report = client.post(f'/api/v1/missions/{mission}/reports')
    assert report.status_code == 201, report.text
    body = report.json()
    assert body['demo'] is False
    assert len(body['contacts']) == len(contacts)
    assert body['map']['availability'] == 'UNAVAILABLE' and body['map']['features'] == []
    assert body['provenance']['model_sha'] == EXPECTED_SHA256
    assert body['provenance']['shipwreck_recovery'] is False
    assert body['provenance']['shipwreck_recovery_invocations'] == 0
    assert hashlib.sha256(FRAME.read_bytes()).hexdigest() == source_digest  # retained input untouched
