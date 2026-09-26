#!/usr/bin/env python3
"""Acquire AI4Shipwrecks from Deep Blue; failure to bypass an access challenge is explicit."""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import urllib.error
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages"))
from sagar.io.common import write_json  # noqa: E402

RECORD_URL = "https://deepblue.lib.umich.edu/data/concern/data_sets/8623hz41x?locale=en"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", help="Official direct archive URL supplied by an authorized browser.")
    args = parser.parse_args()
    raw = ROOT / "data" / "raw" / "ai4shipwrecks"
    raw.mkdir(parents=True, exist_ok=True)
    archive = raw / "ai4shipwrecks.zip"
    try:
        if not args.url:
            # The repository record is authoritative for terms and file links. Do not guess a
            # Hyrax download route when the record cannot be read by this environment.
            with urllib.request.urlopen(urllib.request.Request(RECORD_URL, headers={"User-Agent": "Aqualens/0.1"})) as response:
                if response.status >= 400:
                    raise RuntimeError(f"record endpoint returned HTTP {response.status}")
                if "html" in response.headers.get("Content-Type", "").lower():
                    raise RuntimeError("source host returned HTML rather than a machine-readable record")
            raise RuntimeError("record was reachable but no machine-readable direct archive URL was supplied")
        with urllib.request.urlopen(urllib.request.Request(args.url, headers={"User-Agent": "Aqualens/0.1"})) as response:
            content_type = response.headers.get("Content-Type", "")
            if response.status >= 400 or "text/html" in content_type:
                raise RuntimeError(f"unexpected response content type: {content_type}")
            with archive.open("wb") as output:
                while chunk := response.read(1024 * 1024):
                    output.write(chunk)
    except (urllib.error.HTTPError, urllib.error.URLError, RuntimeError) as exc:
        write_json(raw / "manifest.json", {
            "dataset_id": "ai4shipwrecks", "source_url": args.url, "record_url": RECORD_URL,
            "licence": "CC-BY-4.0", "acquisition_state": "BLOCKED_EXTERNAL_HOST", "observed_at": datetime.now(timezone.utc).isoformat(),
            "error": str(exc), "resolution": "Download the official archive through an authorized browser and rerun with --url <direct archive URL>.",
        })
        print(f"AI4Shipwrecks acquisition blocked by source host: {exc}", file=sys.stderr)
        return 2
    if not zipfile.is_zipfile(archive):
        archive.unlink(missing_ok=True)
        raise RuntimeError("AI4Shipwrecks download is not a valid archive")
    destination = raw / "extracted"
    with zipfile.ZipFile(archive) as zipped:
        zipped.extractall(destination)
    write_json(raw / "manifest.json", {
        "dataset_id": "ai4shipwrecks", "source_url": args.url, "record_url": RECORD_URL,
        "licence": "CC-BY-4.0", "acquisition_state": "COMPLETE", "acquired_at": datetime.now(timezone.utc).isoformat(),
        "archive_sha256": sha256(archive), "archive_size": archive.stat().st_size,
        "integrity": "zipfile central directory verified; publisher did not expose a checksum in this environment",
    })
    print(f"AI4Shipwrecks acquired: {archive}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
