#!/usr/bin/env python3
"""Deploy the built frontend to storage.noahcohn.com.

Zips the contents of dist/ and POSTs it as multipart form field 'archive'
to the deploy endpoint, which extracts it into the remote target folder.

Requires DEPLOY_TOKEN in the environment; the script fails closed if it is
unset. Never hardcode the token here -- this repository is public.

JC-303 / wasm assets served from wasm.noahcohn.com are NOT handled here;
deploy those independently if they changed.

Usage:
    DEPLOY_TOKEN=... python deploy.py [--dry-run] [--include-sourcemaps]
"""

from __future__ import annotations

import argparse
import io
import os
import sys
import uuid
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

ENDPOINT = os.environ.get(
    "DEPLOY_ENDPOINT",
    "https://storage.noahcohn.com/api/deploy/web-sequencer/bundle",
)
DIST_DIR = Path(__file__).resolve().parent / "dist"
EXCLUDED_DIRS = {".git", "node_modules", "__pycache__"}


def collect_files(root: Path, include_sourcemaps: bool) -> list[Path]:
    files = []
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        if EXCLUDED_DIRS & set(path.relative_to(root).parts):
            continue
        if not include_sourcemaps and path.suffix == ".map":
            continue
        files.append(path)
    return files


def build_archive(files: list[Path], root: Path) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in files:
            zf.write(path, path.relative_to(root).as_posix())
    return buf.getvalue()


def _multipart_body(field_name: str, filename: str, data: bytes, content_type: str) -> tuple[bytes, str]:
    """Build a multipart/form-data body. Returns (body_bytes, content_type_header)."""
    boundary = f"----HyphonDeploy{uuid.uuid4().hex}"
    preamble = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="{field_name}"; filename="{filename}"\r\n'
        f"Content-Type: {content_type}\r\n"
        f"\r\n"
    ).encode("utf-8")
    epilogue = f"\r\n--{boundary}--\r\n".encode("utf-8")
    body = preamble + data + epilogue
    return body, f"multipart/form-data; boundary={boundary}"


def upload(archive: bytes, token: str) -> None:
    # API expects multipart form upload with field name archive|bundle|file
    # (not a raw application/zip body).
    body, content_type = _multipart_body(
        field_name="archive",
        filename="bundle.zip",
        data=archive,
        content_type="application/zip",
    )
    request = urllib.request.Request(
        ENDPOINT,
        data=body,
        method="POST",
        headers={
            # Server expects X-Deploy-Token (not Authorization: Bearer).
            "X-Deploy-Token": token,
            "Content-Type": content_type,
            "Content-Length": str(len(body)),
        },
    )
    with urllib.request.urlopen(request, timeout=600) as response:
        body_text = response.read().decode("utf-8", "replace").strip()
        print(f"HTTP {response.status} {body_text}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="build the archive and report its size without uploading",
    )
    parser.add_argument(
        "--include-sourcemaps",
        action="store_true",
        help="include .map files (excluded by default; they are large and public)",
    )
    args = parser.parse_args()

    if not DIST_DIR.is_dir():
        print(f"error: {DIST_DIR} not found -- run the build first", file=sys.stderr)
        return 1

    token = os.environ.get("DEPLOY_TOKEN")
    if not token and not args.dry_run:
        print("error: DEPLOY_TOKEN is not set", file=sys.stderr)
        return 1

    files = collect_files(DIST_DIR, args.include_sourcemaps)
    if not files:
        print(f"error: {DIST_DIR} is empty", file=sys.stderr)
        return 1

    archive = build_archive(files, DIST_DIR)
    size_mb = len(archive) / 1_000_000
    print(f"{len(files)} files, {size_mb:.1f} MB archive")

    if args.dry_run:
        print("dry run -- not uploading")
        return 0

    print(f"uploading to {ENDPOINT} ...")
    try:
        upload(archive, token)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace").strip()
        print(f"error: HTTP {exc.code} {detail}", file=sys.stderr)
        return 1
    except urllib.error.URLError as exc:
        print(f"error: {exc.reason}", file=sys.stderr)
        return 1

    print("deployed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
