"""Warm ASGI factory for the internal demo. Serves the unmodified application.

``sagar.api.create_app`` builds the real app, and the frozen detector is loaded
lazily by the survey worker (``store.runtime.load()``), so a freshly started
backend answers ``/api/v1/runtime/health`` with ``model_loaded: false`` until
somebody uploads a survey. That is the state that has repeatedly looked like a
broken demo.

This factory calls that same ``load()`` once, before uvicorn starts serving. It
is the detector's own initialization path: weights are constructed, no inference
is run, no request is faked and nothing is written to runtime state. Warmup
failure is reported and the app is still served unwarmed, so the operator sees a
diagnosable service rather than a dead port.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent


def _find_store(app: Any) -> Any | None:
    """Locate the application's Store without modifying the application.

    ``app.state.store`` is preferred and used if the application ever publishes
    it. Today the Store is a closure local of ``create_app``, reachable through
    the route endpoints that close over it.
    """
    from sagar.api.app import Store

    candidate = getattr(getattr(app, "state", None), "store", None)
    if isinstance(candidate, Store):
        return candidate
    for route in getattr(app, "routes", []):
        endpoint = getattr(route, "endpoint", None)
        for cell in getattr(endpoint, "__closure__", None) or ():
            try:
                value = cell.cell_contents
            except ValueError:
                continue
            if isinstance(value, Store):
                return value
    return None


def _seed_demo_fixture(app: Any) -> None:
    """Make the deterministic demo Mission available (``/workspace?demo=1``).

    Uses the backend's own offline seed (``sagar.api.demo.seed``) in-process. It is idempotent and
    non-destructive: an existing demo Mission, including analyst edits made during a presentation,
    is returned unchanged. It writes only to the isolated demo store, never to real Missions, and it
    is never a detector run. Set AQUALENS_SEED_DEMO=0 to skip it.
    """
    if os.environ.get("AQUALENS_SEED_DEMO", "1") == "0":
        print("DEMO_SEED SKIPPED: AQUALENS_SEED_DEMO=0", flush=True)
        return
    store = _find_store(app)
    if store is None:
        print("DEMO_SEED UNAVAILABLE: the application store could not be reached.", flush=True)
        return
    try:
        from sagar.api.demo import seed

        mission = seed(store.product)
        print(f"DEMO_SEED OK: {mission['mission_id']}", flush=True)
    except Exception as exc:  # reported, never fatal to serving
        print(f"DEMO_SEED FAILED: {type(exc).__name__}: {exc}", flush=True)


def create_demo_app() -> Any:
    packages = str(ROOT / "packages")
    if packages not in sys.path:
        sys.path.insert(0, packages)
    from sagar.api import create_app

    app = create_app(root=ROOT)
    _seed_demo_fixture(app)

    if os.environ.get("SAGARDRISHTI_DEMO_WARM", "1") == "0":
        print("DEMO_WARMUP SKIPPED: SAGARDRISHTI_DEMO_WARM=0", flush=True)
        return app

    store = _find_store(app)
    if store is None:
        print(
            "DEMO_WARMUP UNAVAILABLE: the application store could not be reached from this "
            "process; the detector will load on the first real survey instead.",
            flush=True,
        )
        return app
    try:
        store.runtime.load()
    except Exception as exc:  # reported, never fatal to serving
        print(f"DEMO_WARMUP FAILED: {type(exc).__name__}: {exc}", flush=True)
        return app

    health = store.runtime.health()
    print(
        "DEMO_WARMUP OK: model_loaded={model_loaded} device={device} sha256={model_sha256}".format(**health),
        flush=True,
    )
    return app
