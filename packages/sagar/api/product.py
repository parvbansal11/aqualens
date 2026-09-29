"""Durable product services over the existing runtime. No research artifact writes.

The demo repository is a different SQLite file. Legacy run artifacts are never
imported implicitly: only uploads attached to a product Mission enter this store.
"""
from __future__ import annotations
import fcntl
import os
import html
import json
import logging
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from fastapi import HTTPException
from sagar.api.product_models import (Analyst, Capability, Contact, Evidence, MissionInput,
                                      ProductMission, MissionReport)
from sagar.perception.runtime import EXPECTED_SHA256

log = logging.getLogger('aqualens.product')
MODEL_ID = 'sagardrishti_multidomain_v1_1_yolo11s'
CLASSES = ['PIPELINE', 'SHIPWRECK', 'CRAB_POT']
LIMITATIONS = [
    'Raw detector scores are uncalibrated scores, not probabilities of correctness.',
    'SHIPWRECK is a failed supervised class: held-out recall 0; precision 1.0 is degenerate.',
    'Class and sensor are confounded; metrics do not establish cross-sensor generalization.',
    'Local anomaly and water-column validation remain pending; PID-02 does not unlock D1.',
    'Raised relief is unavailable here; acoustic shadow alone would not imply artificiality.',
    'Metric depth and metric object height are unavailable.',
    'Point targets do not gain persistence from adjacent frames or matching range.',
    'Frame navigation is platform context, not a localized object position. MEASURED is declaration-only.',
    'Analyst classifications are human semantic judgments, not machine material predictions.',
    'Local workstation deployment; actor names are supplied declarations, not authenticated identities.',
]

def now():
    return datetime.now(timezone.utc).isoformat()

def error(code, message, status=404):
    return HTTPException(status, {'error': {'code': code, 'message': message, 'detail': {}}})

def display_confidence_fields(runtime_contact: dict) -> dict:
    """Product presentation confidence for one Contact, from the historical SagarDrishti mapping.

    ``sagar.vnext.fuse_contact_confidence`` fuses the Contact's available evidence (weighted
    noisy-OR, CONTACT_EVIDENCE_FUSION_V1) and normalizes the result with
    ``normalize_demo_confidence`` (DEMO_BOUNDED_SIGMOID_V1: 0.70 + 0.20 * sigmoid(28 * (x - 0.3140))).
    A runtime Contact already carries that result from processing and it is reused unchanged;
    otherwise the same function computes it from the fields given. The raw detector score is
    never modified, and scientific paths never read this value.
    """
    from sagar.vnext import fuse_contact_confidence

    normalized = runtime_contact.get('normalized_confidence')
    fused = runtime_contact.get('raw_fused_confidence')
    normalization = runtime_contact.get('confidence_normalization')
    method = runtime_contact.get('confidence_method')
    if normalized is None or fused is None:
        result = fuse_contact_confidence(runtime_contact)
        normalized, fused = result['normalized_confidence'], result['raw_fused_confidence']
        normalization, method = result['confidence_normalization'], result['confidence_method']
    return {'display_confidence': float(normalized), 'raw_fused_confidence': float(fused),
            'display_confidence_method': f"{normalization or 'DEMO_BOUNDED_SIGMOID_V1'} over {method or 'CONTACT_EVIDENCE_FUSION_V1'}"}


def validate_runtime_root(runtime_root: Path, project_root: Path | None = None):
    """Operational storage must never point at frozen/source evidence trees."""
    root = (project_root or Path(__file__).resolve().parents[3]).resolve()
    runtime_root = runtime_root.resolve()
    protected = [root / 'artifacts', root / 'ml/artifacts', root / 'models', root / 'runs',
                 root / 'data/processed', root / 'data/raw', root / 'data/interim', root / 'data/registry',
                 root / 'docs', root / 'packages', root / 'tests', root / '.git', root.parent / 'sagardrishti']
    if runtime_root == root or any(runtime_root == p.resolve() or p.resolve() in runtime_root.parents for p in protected):
        raise ValueError('Runtime storage cannot use a frozen/source evidence directory')
    return runtime_root

class ProductRepository:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('CREATE TABLE IF NOT EXISTS product_records (kind TEXT NOT NULL, id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, payload TEXT NOT NULL)')
            db.execute('CREATE INDEX IF NOT EXISTS product_mission ON product_records(kind,mission_id)')
            db.execute('CREATE TABLE IF NOT EXISTS product_history (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, contact_id TEXT NOT NULL, payload TEXT NOT NULL)')
            db.execute('CREATE TRIGGER IF NOT EXISTS product_history_no_update BEFORE UPDATE ON product_history BEGIN SELECT RAISE(ABORT,"append-only history"); END')
            db.execute('CREATE TRIGGER IF NOT EXISTS product_history_no_delete BEFORE DELETE ON product_history BEGIN SELECT RAISE(ABORT,"append-only history"); END')

    def connect(self):
        return sqlite3.connect(self.path, timeout=30)

    @staticmethod
    def put(db, kind, identifier, mission_id, payload):
        db.execute('INSERT INTO product_records VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',
                   (kind, identifier, mission_id, json.dumps(payload, allow_nan=False)))

    def get(self, kind, identifier):
        with self.connect() as db:
            row = db.execute('SELECT payload FROM product_records WHERE kind=? AND id=?', (kind, identifier)).fetchone()
        if not row:
            raise error(f'{kind.upper()}_NOT_FOUND', f'{kind} not found')
        return json.loads(row[0])

    def rows(self, kind, mission_id=None):
        with self.connect() as db:
            sql = 'SELECT payload FROM product_records WHERE kind=?'
            args = [kind]
            if mission_id is not None:
                sql += ' AND mission_id=?'
                args.append(mission_id)
            return [json.loads(row[0]) for row in db.execute(sql + ' ORDER BY id', args)]

    def history(self, contact_id):
        with self.connect() as db:
            return [json.loads(row[0]) for row in db.execute('SELECT payload FROM product_history WHERE contact_id=? ORDER BY sequence', (contact_id,))]

    def mutate(self, contact_id, action, payload):
        # One transaction serializes read-before/write-after/history across request threads.
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute("SELECT payload FROM product_records WHERE kind='contact' AND id=?", (contact_id,)).fetchone()
            if row is None:
                raise error('CONTACT_NOT_FOUND', 'Contact not found')
            contact = json.loads(row[0])
            before = dict(contact['analyst'])
            after = dict(before)
            field = {'review': 'status', 'classification': 'classification', 'priority': 'priority'}.get(action)
            if field:
                after[field] = payload[field]
            timestamp = now()
            after['reviewed_at'] = timestamp
            event = {'review_id': 'review_' + uuid.uuid4().hex, 'contact_id': contact_id,
                     'actor': payload['actor'], 'identity_verified': False, 'action': action,
                     'before': before, 'after': after, 'timestamp': timestamp, 'note': payload.get('note'),
                     'demo': contact['demo'], 'provenance': 'SYNTHETIC_DEMO' if contact['demo'] else 'ANALYST_DECLARED'}
            contact['analyst'] = after
            Contact.model_validate(contact)
            self.put(db, 'contact', contact_id, contact['mission_id'], contact)
            db.execute('INSERT INTO product_history(id,contact_id,payload) VALUES (?,?,?)', (event['review_id'], contact_id, json.dumps(event)))
        log.info('review_mutation contact_id=%s action=%s demo=%s', contact_id, action, contact['demo'])
        return event


def evidence(status, method, reason=None, values=None, *, timestamp, demo=False, provenance=None):
    return Evidence(status=status, source='Aqualens', method=method, reason=reason, values=values,
                    timestamp=timestamp, demo=demo, provenance=provenance).model_dump(mode='json')


def base_evidence(timestamp, demo=False):
    def e(status, method, reason):
        return evidence(status, method, reason, timestamp=timestamp, demo=demo)
    return {
        'detector': e('UNAVAILABLE', 'frozen_yolo11s', 'No supervised observation attached'),
        'local_anomaly': e('NOT_VALIDATED', 'survey_referenced_range_matched', 'Scientific validation pending; no p-value is emitted'),
        'persistence': e('UNAVAILABLE', 'independent_looks', 'No defensible repeated physical observation'),
        'raised_relief': e('UNAVAILABLE', 'range_matched_acoustic_shadow', 'Validated geometry and relief procedure unavailable'),
        'navigation': e('UNAVAILABLE', 'contact_localization', 'No defensible contact localization source'),
        'analyst': e('UNAVAILABLE', 'human_semantic_review', 'Contact has not been reviewed'),
    }

class ProductService:
    def __init__(self, runtime_root: Path):
        runtime_root = validate_runtime_root(runtime_root)
        runtime_root.mkdir(parents=True, exist_ok=True)
        self._demo_lock = (runtime_root / 'demo.lock').open('a+')
        fcntl.flock(self._demo_lock, fcntl.LOCK_SH)
        self.real = ProductRepository(runtime_root / 'reviews.sqlite3')
        self.demo = ProductRepository(runtime_root / 'demo' / 'product.sqlite3')

    def backfill_display_confidence(self, runtime_surveys):
        """Give Contacts stored before display confidence existed their value, once.

        Real Contacts reuse the value their processing run already computed (runtime survey
        records); demo Contacts use the same function on their fixture detector score. Only the
        ``machine`` presentation fields are added; raw scores, analyst state and history are untouched.
        """
        runtime = {c.get('contact_id'): c for record in runtime_surveys.values() for c in record.get('contacts', [])}
        updated = 0
        for repo in (self.real, self.demo):
            with repo.connect() as db:
                db.execute('BEGIN IMMEDIATE')
                rows = db.execute("SELECT id, mission_id, payload FROM product_records WHERE kind='contact'").fetchall()
                for identifier, mission_id, payload in rows:
                    contact = json.loads(payload)
                    machine = contact.get('machine')
                    if not machine or machine.get('display_confidence') is not None:
                        continue
                    source = runtime.get(identifier) or {'max_raw_confidence': machine['raw_detector_score']}
                    fields = display_confidence_fields(source)
                    machine.update(fields)
                    detector = (contact.get('evidence') or {}).get('detector') or {}
                    if isinstance(detector.get('values'), dict) and 'raw_detector_score' in detector['values']:
                        detector['values'].update(fields)
                    repo.put(db, 'contact', identifier, mission_id, contact)
                    updated += 1
        if updated:
            log.info('display_confidence_backfilled contacts=%s', updated)
        return updated

    def repo(self, identifier):
        return self.demo if identifier.startswith('demo_') else self.real

    def create_mission(self, payload: MissionInput):
        mission = ProductMission(mission_id='mission_' + uuid.uuid4().hex, **payload.model_dump()).model_dump(mode='json')
        with self.real.connect() as db:
            self.real.put(db, 'mission', mission['mission_id'], mission['mission_id'], mission)
        log.info('mission_created mission_id=%s', mission['mission_id'])
        return mission

    def mission(self, mission_id):
        repo = self.repo(mission_id)
        value = repo.get('mission', mission_id)
        value['survey_ids'] = [s['survey_id'] for s in repo.rows('survey', mission_id)]
        value['upload_ids'] = [u['upload_id'] for u in repo.rows('upload', mission_id)]
        return value

    def contact(self, contact_id):
        repo = self.repo(contact_id)
        with repo.connect() as db:
            db.execute('BEGIN')
            row = db.execute("SELECT payload FROM product_records WHERE kind='contact' AND id=?", (contact_id,)).fetchone()
            if row is None:
                raise error('CONTACT_NOT_FOUND', 'Contact not found')
            contact = json.loads(row[0])
            contact['history'] = [json.loads(r[0]) for r in db.execute(
                'SELECT payload FROM product_history WHERE contact_id=? ORDER BY sequence', (contact_id,))]
        if contact['history']:
            contact['evidence']['analyst'] = evidence('AVAILABLE', 'human_semantic_review',
                values=contact['analyst'], timestamp=contact['history'][-1]['timestamp'], demo=contact['demo'],
                provenance='SYNTHETIC_DEMO' if contact['demo'] else 'ANALYST_DECLARED')
        return Contact.model_validate(contact).model_dump(mode='json')

    def register_upload(self, mission_id, upload, surveys):
        mission = self.mission(mission_id)
        if mission['demo']:
            raise error('DEMO_ISOLATION', 'Use the deterministic fixture for demo Missions', 409)
        with self.real.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            for row in db.execute("SELECT payload FROM product_records WHERE kind='upload' AND mission_id=?", (mission_id,)):
                previous = json.loads(row[0])
                if previous['sha256'] == upload['sha256']:
                    raise error('DUPLICATE_UPLOAD', 'Identical upload already registered: ' + previous['upload_id'], 409)
            self.real.put(db, 'upload', upload['upload_id'], mission_id, upload)
            for survey in surveys:
                self.real.put(db, 'survey', survey['survey_id'], mission_id, survey)
        log.info('upload_registered mission_id=%s upload_id=%s surveys=%s', mission_id, upload['upload_id'], len(surveys))

    def finish_upload(self, upload_id, record):
        upload = self.real.get('upload', upload_id)
        mission_id = upload['mission_id']
        timestamp = record['created_at']
        findings = {f['detection_id']: f for f in record['findings']}
        frames = {f['frame_id']: f for f in record['frames']}
        contacts = []
        for raw in record['contacts']:
            observations = [findings[i] for i in raw['source_detection_ids']]
            if any(o.get('candidate_recovery') or o.get('demo') for o in observations):
                raise ValueError('Demo detector output refused in real Mission')
            best = findings[raw['best_observation_id']]
            machine = {'supervised_class': best['raw_class'], 'raw_detector_score': best['raw_confidence'],
                       'model_id': best['model_id'], 'model_sha': best['model_sha256'], 'demo': False,
                       **display_confidence_fields(raw)}
            ev = base_evidence(timestamp)
            ev['detector'] = evidence('AVAILABLE', 'frozen_yolo11s', values=machine, timestamp=timestamp, provenance='FROZEN_DETECTOR')
            count = raw['look_count']
            if count > 1 and raw['resolved_class'] == 'PIPELINE' and raw['association_basis'] == 'INDEPENDENT_LOOKS_ALONG_TRACK':
                ev['persistence'] = evidence('AVAILABLE', 'verified_along_track_continuity',
                    values={'independent_looks': count, 'basis': raw['association_basis'], 'validation': 'NOT_VALIDATED'},
                    timestamp=timestamp, provenance='DERIVED_FROM_SOURCE')
            # Expose Look memberships by the same established relation used by association.
            from sagar.vnext.contacts import _association_relation, ContactFusionPolicy
            groups = [[]]
            for obs in observations:
                if groups[-1] and _association_relation(groups[-1][-1], obs, ContactFusionPolicy()) == 'INDEPENDENT_LOOKS_ALONG_TRACK':
                    groups.append([])
                groups[-1].append(obs)
            looks = [{'look_id': f"{raw['contact_id']}_look_{i}", 'contact_id': raw['contact_id'],
                      'survey_ref': group[0]['survey_ref'], 'frame_refs': sorted({o['source_frame_id'] for o in group}),
                      'detection_ids': [o['detection_id'] for o in group], 'basis': raw['association_basis'],
                      'is_independent': count > 1, 'demo': False,
                      'provenance': 'DERIVED_FROM_SOURCE' if count > 1 else 'RASTER_OBSERVATION'} for i, group in enumerate(groups)]
            detections = [{'detection_id': o['detection_id'], 'survey_ref': o['survey_ref'],
                           'frame_ref': o['source_frame_id'], 'source_image': Path(o['source_image_path']).name,
                           'bbox': o['bbox_px'], 'machine_class': o['raw_class'], 'raw_detector_score': o['raw_confidence'],
                           'model_id': o['model_id'], 'model_sha': o['model_sha256'], 'inference_run_id': o['run_id'],
                           'demo': False} for o in observations]
            contacts.append(Contact(contact_id=raw['contact_id'], mission_id=mission_id,
                survey_refs=sorted({o['survey_ref'] for o in observations}), created_at=timestamp,
                association_basis=raw['association_basis'], look_count=count, looks=looks,
                detections=detections, machine=machine, evidence=ev).model_dump(mode='json'))
        with self.real.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            for survey in record['surveys']:
                value = self.real.get('survey', survey['survey_ref'])
                value['status'] = 'READY'
                value['frames'] = []
                for frame_id in survey['frame_ids']:
                    source = frames[frame_id]
                    frame = {k: source.get(k) for k in ('frame_id', 'survey_ref', 'width_px', 'height_px',
                        'inference_mode', 'raster_sha256', 'raster_duplicate_status', 'duplicate_raster_frame_ids', 'navigation')}
                    frame['demo'] = False
                    frame['raster_url'] = f"/api/v1/runtime/surveys/{record['survey_id']}/frames/{frame_id}/raster"
                    condition = source.get('sonar_condition', {})
                    frame['assessment'] = {'status': 'AVAILABLE', 'method': condition.get('engine_version'),
                        'interpretation': 'Descriptive raster statistics; not sonar geometry or calibrated quality',
                        'values': {k: condition.get(k) for k in ('dynamic_range', 'entropy', 'near_black_fraction')}}
                    value['frames'].append(frame)
                self.real.put(db, 'survey', value['survey_id'], mission_id, value)
            for contact in contacts:
                # A completed run never overwrites an analyst's later decision.
                if not db.execute('SELECT 1 FROM product_records WHERE id=?', (contact['contact_id'],)).fetchone():
                    self.real.put(db, 'contact', contact['contact_id'], mission_id, contact)
            upload['status'] = 'READY'
            self.real.put(db, 'upload', upload_id, mission_id, upload)
        log.info('contacts_created mission_id=%s upload_id=%s count=%s', mission_id, upload_id, len(contacts))

    def fail_upload(self, upload_id):
        upload = self.real.get('upload', upload_id)
        upload['status'] = 'FAILED'
        with self.real.connect() as db:
            self.real.put(db, 'upload', upload_id, upload['mission_id'], upload)
            for survey in self.real.rows('survey', upload['mission_id']):
                if survey['upload_id'] == upload_id:
                    survey['status'] = 'FAILED'
                    self.real.put(db, 'survey', survey['survey_id'], upload['mission_id'], survey)

    def map(self, mission_id):
        mission = self.mission(mission_id)
        features = []
        for contact in self.repo(mission_id).rows('contact', mission_id):
            nav = contact['evidence']['navigation']
            if nav['status'] == 'AVAILABLE':
                if nav['provenance'] == 'SYNTHETIC_DEMO' and not mission['demo']:
                    raise error('DEMO_ISOLATION', 'Synthetic geometry refused', 409)
                features.append({'type': 'Feature', 'geometry': nav['values']['geometry'],
                    'properties': {'contact_id': contact['contact_id'], 'provenance': nav['provenance'], 'demo': mission['demo']}})
        platform = []
        for survey in self.repo(mission_id).rows('survey', mission_id):
            provenance = survey.get('navigation_provenance')
            # Supplied tracks are drawn for orientation. SYNTHETIC_DEMO keeps its own provenance and is
            # display-only: it is never a Contact location and never evidence.
            if provenance not in ('MEASURED', 'SYNTHETIC_DEMO'):
                continue
            for frame in survey.get('frames', []):
                nav = frame.get('navigation') or {}
                if nav.get('latitude') is None or nav.get('longitude') is None:
                    continue
                platform.append({'type': 'Feature', 'geometry': {'type': 'Point',
                    'coordinates': [nav['longitude'], nav['latitude']]}, 'properties': {
                    'role': 'PLATFORM_FIX_NOT_CONTACT_LOCATION', 'survey_ref': survey['survey_ref'],
                    'frame_ref': frame['frame_id'], 'provenance': provenance,
                    'timestamp_utc': nav.get('timestamp_utc'),
                    'verification': 'UPLOADER_DECLARATION_ONLY' if provenance == 'MEASURED' else 'DISPLAY_ONLY_NOT_EVIDENCE',
                    'demo': False}})
        # Platform fixes must never be silently rendered as localized Contact coordinates.
        return {'availability': 'AVAILABLE' if features else 'UNAVAILABLE', 'demo': mission['demo'],
                'reason': None if features else 'No defensible contact localization source',
                'type': 'FeatureCollection', 'features': features, 'platform_context': platform}

    def report(self, mission_id, provenance, jobs):
        repo = self.repo(mission_id)
        # Hold the writer lock while taking the snapshot. Review mutations and
        # upload completion cannot interleave a contact with a different history.
        with repo.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            mission = self.mission(mission_id)
            uploads = repo.rows('upload', mission_id)
            if any(u['status'] != 'READY' for u in uploads):
                raise error('REPORT_NOT_READY', 'Uploads must finish successfully before reporting', 409)
            contacts = [self.contact(c['contact_id']) for c in repo.rows('contact', mission_id)]
            surveys = repo.rows('survey', mission_id)
            if any(c['demo'] != mission['demo'] for c in contacts + surveys + uploads):
                raise error('DEMO_ISOLATION', 'Mixed report provenance refused', 409)
            result = {'report_id': ('demo_' if mission['demo'] else '') + 'report_' + uuid.uuid4().hex,
                      'generated_at': now(), 'demo': mission['demo'], 'label': 'DEMO — SYNTHETIC FIXTURE' if mission['demo'] else 'MISSION REPORT',
                      'mission': mission, 'uploads': uploads, 'surveys': surveys, 'contacts': contacts,
                      'map': self.map(mission_id), 'provenance': provenance, 'processing_runs': jobs,
                      'limitations': LIMITATIONS + (['All fixture evidence and coordinates are DEMO; no scientific evaluation.'] if mission['demo'] else [])}
            result = MissionReport.model_validate(result).model_dump(mode='json')
            repo.put(db, 'report', result['report_id'], mission_id, result)
        log.info('report_generated mission_id=%s report_id=%s demo=%s', mission_id, result['report_id'], mission['demo'])
        return result


def render_html(report):
    # Escaping the entire structured payload also protects notes/operator names.
    return '<!doctype html><html><head><meta charset="utf-8"><title>Aqualens report</title></head><body><h1>' + html.escape(report['label']) + '</h1><pre>' + html.escape(json.dumps(report, indent=2, ensure_ascii=False)) + '</pre></body></html>'


def deployment_mode():
    """Where this service runs, reported truthfully. Render sets RENDER=true on every service;
    AQUALENS_DEPLOYMENT overrides for other hosts."""
    declared = os.environ.get('AQUALENS_DEPLOYMENT', '').strip().upper()
    if declared in ('HOSTED_SERVICE', 'LOCAL_WORKSTATION'):
        return declared
    return 'HOSTED_SERVICE' if os.environ.get('RENDER') else 'LOCAL_WORKSTATION'


def capabilities(detector_ready, shipwreck_recovery=False):
    def cap(status, availability, reason, **kwargs):
        return Capability(status=status, availability=availability, reason=reason, **kwargs).model_dump(mode='json')
    # Reported from the live detector, so this surface cannot claim OFF while recovery runs.
    recovery = (cap('PROVISIONAL', 'FAILED', 'Demo heuristic ENABLED on the live detector; its output is refused by product Missions', mode='ON')
                if shipwreck_recovery else
                cap('NOT_APPLICABLE', 'NOT_APPLICABLE', 'Disabled in backend; explicit legacy library demo opt-in only', mode='OFF'))
    return {
        'known_target_detection': cap('IMPLEMENTED_NOT_VALIDATED', 'AVAILABLE' if detector_ready else 'UNAVAILABLE', 'Frozen detector; historical per-class evaluation exists, runtime-path validation is separate', classes=CLASSES),
        'shipwreck_supervised': cap('IMPLEMENTED_NOT_VALIDATED', 'FAILED', 'Held-out recall 0; precision 1.0 is degenerate'),
        'shipwreck_demo_recovery': recovery,
        'contact_localization': cap('UNAVAILABLE', 'UNAVAILABLE', 'No defensible sonar-to-world geometry; platform fixes are context only'),
        'local_anomaly': cap('PROVISIONAL', 'NOT_VALIDATED', 'Survey-referenced range-matched research pending'),
        'water_column': cap('PROVISIONAL', 'NOT_VALIDATED', 'PID-02 validation pending; D1 remains blocked'),
        'raised_relief': cap('UNAVAILABLE', 'UNAVAILABLE', 'Validated geometry and relief method unavailable'),
        'metric_depth': cap('UNAVAILABLE', 'UNAVAILABLE', 'No defensible physical geometry'),
        'metric_height': cap('UNAVAILABLE', 'UNAVAILABLE', 'No defensible physical geometry'),
        'material_classification': cap('IMPLEMENTED_NOT_VALIDATED', 'AVAILABLE', 'Human semantic labels only; no machine material model', mode='ANALYST_ONLY'),
        'persistence': cap('IMPLEMENTED_NOT_VALIDATED', 'AVAILABLE', 'Conditional per Contact: verified PIPELINE continuity only; no point-target adjacency inference', mode='CONDITIONAL'),
        'navigation': cap('IMPLEMENTED_NOT_VALIDATED', 'AVAILABLE', 'Source platform context only; contact localization unavailable without defensible geometry', mode='CONDITIONAL'),
        'reporting': cap('IMPLEMENTED_NOT_VALIDATED', 'AVAILABLE', 'Structured JSON and escaped HTML with limitations'),
        'deployment': cap('IMPLEMENTED_NOT_VALIDATED', 'AVAILABLE',
            ('Hosted service' if deployment_mode() == 'HOSTED_SERVICE' else 'Local workstation') + '; no enterprise authentication', mode=deployment_mode()),
    }
