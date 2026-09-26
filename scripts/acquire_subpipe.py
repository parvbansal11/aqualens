#!/usr/bin/env python3
"""Acquire the authoritative SubPipe archive with published Zenodo checksum validation."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages"))
from sagar.io.common import write_json  # noqa: E402

RECORD_URL = "https://zenodo.org/api/records/12666132"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def md5(path: Path) -> str:
    digest = hashlib.md5()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def download(url: str, destination: Path) -> None:
    aria2 = shutil.which("aria2c")
    if aria2:
        print("SubPipe: using aria2c with 16 resumable connections")
        subprocess.run([
            aria2, "--continue=true", "--max-connection-per-server=16", "--split=16",
            "--min-split-size=8M", "--file-allocation=none", "--summary-interval=10",
            "--dir", str(destination.parent), "--out", destination.name, url,
        ], check=True)
        return
    existing = destination.stat().st_size if destination.exists() else 0
    request = urllib.request.Request(url, headers={"Range": f"bytes={existing}-"} if existing else {})
    with urllib.request.urlopen(request) as response:
        content_range = response.headers.get("Content-Range")
        append = existing > 0 and content_range is not None
        if existing and not append:
            destination.unlink()
            existing = 0
        total = response.headers.get("Content-Length")
        total_bytes = existing + int(total) if total else None
        with destination.open("ab" if append else "wb") as target:
            downloaded = existing
            while chunk := response.read(1024 * 1024):
                target.write(chunk)
                downloaded += len(chunk)
                if total_bytes:
                    print(f"\rSubPipe: {downloaded / 2**30:.2f}/{total_bytes / 2**30:.2f} GiB", end="", flush=True)
    print()


def safe_extract(archive: Path, destination: Path) -> None:
    with zipfile.ZipFile(archive) as zipped:
        root = destination.resolve()
        for member in zipped.infolist():
            target = (destination / member.filename).resolve()
            if not str(target).startswith(str(root) + os.sep):
                raise RuntimeError(f"unsafe archive member: {member.filename}")
        zipped.extractall(destination)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mini", action="store_true", help="Acquire official Mini release.")
    parser.add_argument("--mini2", action="store_true", help="Use the official Mini2 release.")
    parser.add_argument("--extract-existing", action="store_true", help="Validate and extract an existing archive without downloading.")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    raw = ROOT / "data" / "raw" / "subpipe"
    raw.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(RECORD_URL) as response:
        record = json.load(response)
    if args.mini and args.mini2:
        raise RuntimeError("choose only one Mini archive")
    name = "SubPipeMini2.zip" if args.mini2 else "SubPipeMini.zip" if args.mini else "SubPipe.zip"
    try:
        file = next(item for item in record["files"] if item["key"] == name)
    except StopIteration:
        raise RuntimeError(f"Zenodo record does not contain {name}")
    archive = raw / name
    if args.dry_run:
        print(json.dumps({"file": name, "url": file["links"]["self"], "checksum": file["checksum"], "size": file["size"]}, indent=2))
        return 0
    if not args.extract_existing:
        download(file["links"]["self"], archive)
    if not archive.exists():
        raise RuntimeError(f"archive not found: {archive}")
    expected = file["checksum"].removeprefix("md5:")
    observed = md5(archive)
    if observed != expected:
        raise RuntimeError(f"archive MD5 mismatch: expected {expected}, got {observed}")
    extract_root = raw / "extracted"
    marker = extract_root / f".{archive.stem}.complete.json"
    if not marker.exists():
        safe_extract(archive, extract_root)
        write_json(marker, {"archive": name, "md5": observed, "completed_at": datetime.now(timezone.utc).isoformat()})
    manifest = {
        "dataset_id": "subpipe", "dataset_version": f"Zenodo:{record['doi']}", "source_url": file["links"]["self"],
        "record_url": RECORD_URL, "licence": "GPL-3.0", "acquired_at": datetime.now(timezone.utc).isoformat(),
        "archive": name, "archive_md5": observed, "archive_sha256": sha256(archive), "archive_size": archive.stat().st_size,
        "extraction_complete": marker.exists(),
    }
    write_json(raw / "manifest.json", manifest)
    print(f"SubPipe acquired and validated: {archive}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
