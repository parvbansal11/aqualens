"""Additive product API; frozen and legacy runtime endpoints retain their contracts."""
from __future__ import annotations
import os
import json
import hashlib
import sqlite3
import subprocess
from typing import Literal
from fastapi import APIRouter, File, Query, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse
from sagar.api.product import CLASSES, LIMITATIONS, MODEL_ID, capabilities, deployment_mode, error, render_html
from sagar.api.product_models import (AnalystClass, Contact, ClassificationInput,
    NoteInput, Priority, PriorityInput, ReviewInput, ReviewEvent, MapResponse, MissionReport)


def install_product_routes(app, store, upload_handler):
    router = APIRouter(prefix='/api/v1', tags=['Mission workspace'])
    service = store.product
    try:
        build = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=store.root,
                               capture_output=True, text=True, check=True).stdout.strip()
        dirty = bool(subprocess.run(['git', 'status', '--porcelain'], cwd=store.root,
                                   capture_output=True, text=True, check=True).stdout.strip())
    except (OSError, subprocess.CalledProcessError):
        build, dirty = None, None

    source_digests = {str(path.relative_to(store.root)): hashlib.sha256(path.read_bytes()).hexdigest()
        for name in ('api/app.py', 'api/jobs.py', 'api/product.py', 'api/product_models.py',
                     'api/product_routes.py', 'api/demo.py', 'vnext/contacts.py', 'perception/runtime.py')
        if (path := store.root / 'packages/sagar' / name).is_file()}

    @router.get('/system/capabilities')
    def capability_states():
        return capabilities(store.runtime.health()['runtime_available'], store.runtime.shipwreck_recovery)

    @router.get('/system/provenance')
    def provenance():
        health = store.runtime.health()
        recovery = store.runtime.shipwreck_recovery
        return {'product': 'Aqualens', 'model_id': MODEL_ID, 'model_sha': health['model_sha256'],
            'deployment': deployment_mode(), 'scientific_mode': not recovery, 'shipwreck_recovery': recovery,
            'shipwreck_recovery_invocations': store.runtime.recovery_invocations,
            'build_version': build, 'source_files_sha256': source_digests,
            'association_policy': 'contact_fusion@v1.1_point_target_guard', 'working_tree_modified_at_start': dirty, 'api_version': '0.2.0',
            'capabilities': capability_states(), 'limitations': LIMITATIONS,
            'machine_classes': CLASSES, 'analyst_classes': [v.value for v in AnalystClass],
            'authentication': 'LOCAL_ONLY_ACTOR_DECLARATION',
            'evaluation': evaluation()}

    def evaluation():
        path = store.root / 'ml/artifacts/final_v1/detector/metrics.json'
        if not path.is_file():
            return {'status': 'UNAVAILABLE', 'reason': 'Metrics artifact not installed'}
        encoded = path.read_bytes()
        metrics = json.loads(encoded)
        return {'status': 'AVAILABLE', 'source': str(path.relative_to(store.root)),
            'sha256': hashlib.sha256(encoded).hexdigest(), 'representation': metrics['dataset_layer'],
            'held_out_test_per_class': metrics['winner']['heldout_test_per_class'],
            'validation_per_class_map50_95': metrics['winner']['validation']['per_class_map50_95'],
            'shipwreck_status': 'FAILED', 'shipwreck_precision_degenerate': True,
            'runtime_path_evaluation_ref': 'docs/ROUND2_H0_FREEZE.md',
            'note': 'Training representation metrics; class and sensor confounded. H0 is separately frozen.'}

    @app.get('/readiness', include_in_schema=False)
    @router.get('/readiness')
    def readiness():
        import importlib.util
        checks = {'api': True, 'database': False, 'storage': False,
                  'detector': store.runtime.health()['runtime_available'] and importlib.util.find_spec('ultralytics') is not None,
                  'reporting': True}
        try:
            with service.real.connect() as db:
                db.execute('SELECT 1').fetchone()
            checks['database'] = True
            import tempfile
            with tempfile.TemporaryFile(dir=store.uploads) as handle:
                handle.write(b'check')
            checks['storage'] = True
        except (OSError, sqlite3.Error):
            pass
        checks['feature_cache'] = 'NOT_REQUIRED_FOR_PRODUCT_API'
        ready = all(checks[k] for k in ('api', 'database', 'storage', 'detector', 'reporting'))
        return JSONResponse({'status': 'READY' if ready else 'NOT_READY', 'services': checks,
            'detector_loaded': store.runtime.health()['model_loaded'],
            'note': 'Dependency/artifact checks; first inference may still fail. Research validity is separate.'}, status_code=200 if ready else 503)

    @router.get('/missions/{mission_id}/uploads')
    def uploads(mission_id: str):
        service.mission(mission_id)
        return {'items': service.repo(mission_id).rows('upload', mission_id)}

    @router.post('/missions/{mission_id}/uploads', status_code=202)
    async def upload(mission_id: str, file: UploadFile = File(...)):
        return await upload_handler(file, mission_id)

    @router.get('/missions/{mission_id}/surveys')
    def surveys(mission_id: str):
        service.mission(mission_id)
        return {'items': service.repo(mission_id).rows('survey', mission_id)}

    @router.get('/missions/{mission_id}/jobs')
    def jobs(mission_id: str):
        mission = service.mission(mission_id)
        if mission['demo']:
            return {'items': service.demo.rows('job', mission_id)}
        return {'items': [store.jobs.get(u['job_id']) for u in service.real.rows('upload', mission_id)]}

    @router.post('/surveys/{survey_id}/process')
    def process(survey_id: str):
        # Ingest already starts processing. Repeated calls return the same run;
        # they never duplicate Contacts or silently rerun a failed detector.
        repo = service.repo(survey_id)
        survey = repo.get('survey', survey_id)
        job = repo.get('job', survey['job_id']) if survey['demo'] else store.jobs.get(survey['job_id'])
        if job is None:
            raise error('JOB_NOT_FOUND', 'Processing record unavailable', 409)
        return job

    @router.get('/missions/{mission_id}/contacts')
    def mission_contacts(mission_id: str, survey_ref: str | None = None,
                         machine_class: Literal['PIPELINE', 'SHIPWRECK', 'CRAB_POT'] | None = None,
                         analyst_class: AnalystClass | None = None,
                         status: Literal['UNREVIEWED', 'CONFIRMED', 'REJECTED', 'UNRESOLVED'] | None = None,
                         priority: Priority | None = None, reviewed: bool | None = None,
                         search: str | None = Query(None, max_length=160),
                         sort: Literal['created', 'reviewed', 'priority'] = 'created',
                         offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=200)):
        service.mission(mission_id)
        repo = service.repo(mission_id)
        if survey_ref:
            survey = repo.get('survey', survey_ref)
            if survey['mission_id'] != mission_id:
                raise error('INVALID_SURVEY_REFERENCE', 'Survey does not belong to this Mission', 422)
        rows = repo.rows('contact', mission_id)
        rows = [c for c in rows if (not survey_ref or survey_ref in c['survey_refs'])
            and (not machine_class or (c['machine'] or {}).get('supervised_class') == machine_class)
            and (not analyst_class or c['analyst']['classification'] == analyst_class.value)
            and (not status or c['analyst']['status'] == status)
            and (not priority or c['analyst']['priority'] == priority.value)
            and (reviewed is None or bool(c['analyst']['reviewed_at']) == reviewed)
            and (not search or search in c['contact_id'])]
        rank = {'CRITICAL': 0, 'HIGH': 1, 'MEDIUM': 2, 'LOW': 3, 'UNSET': 4}
        rows.sort(key=lambda c: (rank[c['analyst']['priority']] if sort == 'priority' else
            c['analyst']['reviewed_at'] or '' if sort == 'reviewed' else c['created_at'], c['contact_id']), reverse=sort != 'priority')
        return {'items': [service.contact(c['contact_id']) for c in rows[offset:offset + limit]],
                'total': len(rows), 'offset': offset, 'limit': limit, 'demo': mission_id.startswith('demo_')}

    @router.get('/contacts/{contact_id}', response_model=Contact)
    def contact(contact_id: str):
        return service.contact(contact_id)

    @router.get('/contacts/{contact_id}/history')
    def history(contact_id: str):
        value = service.contact(contact_id)
        return {'items': value['history'], 'demo': value['demo']}

    @router.get('/contacts/{contact_id}/evidence')
    def contact_evidence(contact_id: str):
        value = service.contact(contact_id)
        return {'contact_id': contact_id, 'evidence': value['evidence'], 'demo': value['demo']}

    @router.post('/contacts/{contact_id}/review', response_model=ReviewEvent)
    def review(contact_id: str, payload: ReviewInput):
        return service.repo(contact_id).mutate(contact_id, 'review', payload.model_dump(mode='json'))

    @router.post('/contacts/{contact_id}/classification', response_model=ReviewEvent)
    def classification(contact_id: str, payload: ClassificationInput):
        return service.repo(contact_id).mutate(contact_id, 'classification', payload.model_dump(mode='json'))

    @router.post('/contacts/{contact_id}/priority', response_model=ReviewEvent)
    def priority(contact_id: str, payload: PriorityInput):
        return service.repo(contact_id).mutate(contact_id, 'priority', payload.model_dump(mode='json'))

    @router.post('/contacts/{contact_id}/notes', response_model=ReviewEvent)
    def note(contact_id: str, payload: NoteInput):
        return service.repo(contact_id).mutate(contact_id, 'notes', payload.model_dump(mode='json'))

    @router.get('/missions/{mission_id}/map', response_model=MapResponse)
    def map_data(mission_id: str):
        return service.map(mission_id)

    @router.post('/missions/{mission_id}/reports', status_code=201, response_model=MissionReport)
    def create_report(mission_id: str):
        return service.report(mission_id, provenance(), jobs(mission_id)['items'])

    @router.get('/reports/{report_id}')
    def report(report_id: str, format: Literal['json', 'html'] = 'json', download: bool = False):
        value = service.repo(report_id).get('report', report_id)
        headers = {'Content-Disposition': f'attachment; filename="{value["report_id"]}.{format}"'} if download else {}
        return HTMLResponse(render_html(value), headers=headers) if format == 'html' else JSONResponse(value, headers=headers)

    @router.get('/demo/missions')
    def demo_missions():
        return {'items': service.demo.rows('mission'), 'demo': True}

    @router.post('/demo/seed')
    def seed_demo():
        if os.environ.get('AQUALENS_DEMO_MODE') != '1':
            raise error('DEMO_MODE_DISABLED', 'Use offline seed command or explicitly enable AQUALENS_DEMO_MODE=1', 403)
        from sagar.api.demo import seed
        return seed(service)

    app.include_router(router)
