"""Deterministic, isolated product fixture. Not a detector run or research artifact.

Run: python -m sagar.api.demo [--reset]
Reset archives the dedicated demo directory and starts a fresh fixture.
The backend must be stopped; a shared file lock prevents a live reset.
"""
import argparse
import fcntl
import os
from pathlib import Path
from sagar.api.product import ProductService, MODEL_ID, base_evidence, evidence, validate_runtime_root
from sagar.api.product_models import Contact, ProductMission
from sagar.perception.runtime import EXPECTED_SHA256

STAMP = '2026-09-28T00:00:00+00:00'
MISSION = 'demo_mission_arabian_sea_07'
SURVEY = 'demo_survey_01'

def seed(service):
    repo = service.demo
    with repo.connect() as db:
        db.execute('BEGIN IMMEDIATE')
        if db.execute('SELECT 1 FROM product_records WHERE id=?', (MISSION,)).fetchone():
            return service.mission(MISSION)
        mission = ProductMission(mission_id=MISSION, name='Arabian Sea Survey 07 — DEMO',
            created_at=STAMP, demo=True, provenance='SYNTHETIC_DEMO', survey_ids=[SURVEY],
            notes='Deterministic product demonstration; not measured scientific output.').model_dump(mode='json')
        repo.put(db, 'mission', MISSION, MISSION, mission)
        repo.put(db, 'survey', SURVEY, MISSION, {'survey_id': SURVEY, 'survey_ref': SURVEY,
            'mission_id': MISSION, 'upload_id': 'demo_upload_01', 'name': 'Survey 01 — DEMO',
            'demo': True, 'provenance': 'SYNTHETIC_DEMO', 'membership_provenance': 'DEMO_FIXTURE',
            'status': 'READY', 'frame_ids': [], 'frames': [], 'sensor': None, 'acquired_at': None,
            'navigation_provenance': 'SYNTHETIC_DEMO', 'job_id': 'demo_job_01'})
        repo.put(db, 'upload', 'demo_upload_01', MISSION, {'upload_id': 'demo_upload_01',
            'mission_id': MISSION, 'demo': True, 'provenance': 'SYNTHETIC_DEMO', 'status': 'READY',
            'sha256': None, 'filename': None, 'source': 'BUILTIN_SYNTHETIC_FIXTURE', 'job_id': 'demo_job_01'})
        repo.put(db, 'job', 'demo_job_01', MISSION, {'job_id': 'demo_job_01', 'mission_id': MISSION,
            'demo': True, 'state': 'COMPLETED', 'stage': 'FIXTURE_LOAD', 'started_at': STAMP,
            'completed_at': STAMP, 'error': None, 'warnings': ['DEMO: no detector was run']})
        # A and B start UNREVIEWED so a presenter performs the analyst workflow live; C carries one
        # scripted verdict so a populated review history exists from the start.
        for letter, cls, score, label, priority, xy in [
            ('a', 'CRAB_POT', .74, None, None, [72.5, 15.5]),
            ('b', None, None, None, None, [72.501, 15.501]),
            ('c', 'PIPELINE', .61, 'CABLE_PIPELINE_RELATED', 'LOW', [72.502, 15.502]),
        ]:
            identifier = 'demo_contact_' + letter
            machine = {'supervised_class': cls, 'raw_detector_score': score, 'model_id': MODEL_ID,
                       'model_sha': EXPECTED_SHA256, 'demo': True} if cls else None
            ev = base_evidence(STAMP, demo=True)
            if machine:
                ev['detector'] = evidence('AVAILABLE', 'DEMO_FIXTURE_NOT_INFERENCE',
                    values=machine, timestamp=STAMP, demo=True, provenance='SYNTHETIC_DEMO')
            ev['navigation'] = evidence('AVAILABLE', 'DEMO_FIXTURE_NOT_LOCALIZATION',
                values={'geometry': {'type': 'Point', 'coordinates': xy}}, timestamp=STAMP,
                demo=True, provenance='SYNTHETIC_DEMO')
            before = {'classification': 'UNRESOLVED', 'status': 'UNREVIEWED', 'priority': 'UNSET', 'reviewed_at': None}
            after = {'classification': label, 'status': 'CONFIRMED', 'priority': priority, 'reviewed_at': STAMP} if label else before
            contact = Contact(contact_id=identifier, mission_id=MISSION, survey_refs=[SURVEY],
                created_at=STAMP, demo=True, provenance='SYNTHETIC_DEMO', association_basis='DEMO_SINGLE_LOOK',
                look_count=1, looks=[{'look_id': identifier + '_look_0', 'contact_id': identifier,
                    'survey_ref': SURVEY, 'frame_refs': [], 'basis': 'DEMO_FIXTURE',
                    'is_independent': False, 'provenance': 'SYNTHETIC_DEMO', 'demo': True}],
                detections=[], machine=machine, evidence=ev, analyst=after).model_dump(mode='json')
            repo.put(db, 'contact', identifier, MISSION, contact)
            if not label:
                continue
            event = {'review_id': 'demo_review_' + letter, 'contact_id': identifier, 'actor': 'DEMO_FIXTURE',
                     'identity_verified': False, 'action': 'fixture_analyst_verdict', 'before': before, 'after': after,
                     'timestamp': STAMP, 'note': 'Scripted analyst verdict; not a real person or machine prediction',
                     'demo': True, 'provenance': 'SYNTHETIC_DEMO'}
            import json
            db.execute('INSERT INTO product_history(id,contact_id,payload) VALUES (?,?,?)', (event['review_id'], identifier, json.dumps(event)))
    return service.mission(MISSION)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--reset', action='store_true')
    args = parser.parse_args()
    root = Path(os.environ.get('SAGARDRISHTI_RUNTIME_DIR', 'data/runtime')).expanduser().resolve()
    root = validate_runtime_root(root)
    if args.reset:
        # Offline-only reset: preserve append-only audit history in a numbered backup.
        root.mkdir(parents=True, exist_ok=True)
        lock = (root / 'demo.lock').open('a+')
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            parser.error('Stop the backend before resetting the demo; it holds the demo lock.')
        demo = root / 'demo'
        if demo.exists():
            index = 1
            while (root / f'demo.archive.{index}').exists():
                index += 1
            demo.rename(root / f'demo.archive.{index}')
        fcntl.flock(lock, fcntl.LOCK_UN)
        lock.close()
    print(seed(ProductService(root))['mission_id'])

if __name__ == '__main__':
    main()
