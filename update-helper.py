#!/usr/bin/python3
"""Safely replace the per-user GNOME extension after package verification."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import zipfile

MAX_ENTRIES = 800
MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024


def atomic_json(path: Path, value: dict[str, object]) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(prefix=".update-result-", dir=path.parent)
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as stream:
            json.dump(value, stream, separators=(",", ":"))
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def safe_archive(archive: Path, staging: Path, uuid: str, version: str) -> None:
    with zipfile.ZipFile(archive) as bundle:
        entries = bundle.infolist()
        if not entries or len(entries) > MAX_ENTRIES:
            raise ValueError("archive entry count is invalid")
        total = 0
        for entry in entries:
            name = entry.filename
            path = PurePosixPath(name)
            mode = entry.external_attr >> 16
            if (
                not name
                or "\\" in name
                or path.is_absolute()
                or any(part in ("", ".", "..") for part in path.parts)
                or stat.S_ISLNK(mode)
            ):
                raise ValueError("archive contains an unsafe path")
            total += entry.file_size
            if total > MAX_UNCOMPRESSED_BYTES:
                raise ValueError("archive expands beyond the safety limit")
            target = staging.joinpath(*path.parts)
            if entry.is_dir():
                target.mkdir(mode=0o755, parents=True, exist_ok=True)
                continue
            target.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
            with bundle.open(entry) as source, target.open("xb") as destination:
                shutil.copyfileobj(source, destination, length=1024 * 1024)
            os.chmod(target, 0o755 if name == "update-helper.py" else 0o644)

    metadata_path = staging / "metadata.json"
    version_path = staging / "VERSION"
    required = [metadata_path, version_path, staging / "extension.js", staging / "stylesheet.css"]
    if not all(path.is_file() and not path.is_symlink() for path in required):
        raise ValueError("archive is missing required extension files")
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    if metadata.get("uuid") != uuid or metadata.get("version-name") != version:
        raise ValueError("archive identity or version does not match the manifest")
    if version_path.read_text(encoding="utf-8").strip() != version:
        raise ValueError("archive VERSION does not match the manifest")


def run() -> int:
    if len(sys.argv) != 6:
        return 64
    result_path = Path(sys.argv[5]).resolve(strict=False)
    archive = None
    destination = None
    staging = None
    backup = None
    replaced = False
    old_present = False
    version = sys.argv[4]
    try:
        archive = Path(sys.argv[1]).resolve(strict=True)
        expected_hash, uuid = sys.argv[2:4]
        if uuid != "shadow-panel@shadowokx" or len(expected_hash) != 64:
            raise ValueError("invalid update request")
        if sha256(archive) != expected_hash.lower():
            raise ValueError("download checksum does not match")

        data_home = Path(
            os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share")
        ).resolve()
        extensions = data_home / "gnome-shell/extensions"
        destination = extensions / uuid
        extensions.mkdir(mode=0o755, parents=True, exist_ok=True)
        if extensions.is_symlink() or destination.is_symlink():
            raise ValueError("extension installation path must not be a symbolic link")

        staging = Path(tempfile.mkdtemp(prefix=".shadow-update-", dir=extensions))
        backup = extensions / f".{uuid}.backup-{os.getpid()}"
        old_present = destination.exists()
        safe_archive(archive, staging, uuid, version)
        time.sleep(1.0)
        subprocess.run(["gnome-extensions", "disable", uuid], check=False,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if backup.exists():
            raise ValueError("update backup path already exists")
        if old_present:
            os.replace(destination, backup)
        try:
            os.replace(staging, destination)
            replaced = True
            enabled = subprocess.run(
                ["gnome-extensions", "enable", uuid],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            ).returncode == 0
            if not enabled:
                raise RuntimeError("GNOME did not enable the updated extension")
        except Exception:
            if destination.exists():
                shutil.rmtree(destination)
            if old_present and backup.exists():
                os.replace(backup, destination)
                subprocess.run(["gnome-extensions", "enable", uuid], check=False,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            raise
        if backup.exists():
            shutil.rmtree(backup)
        atomic_json(result_path, {
            "status": "installed",
            "version": version,
            "sign_out_recommended": True,
        })
        archive.unlink(missing_ok=True)
        return 0
    except Exception as error:
        if (replaced and destination is not None and destination.exists() and
                old_present and backup is not None and backup.exists()):
            shutil.rmtree(destination)
            os.replace(backup, destination)
        atomic_json(result_path, {
            "status": "failed",
            "version": version,
            "message": type(error).__name__,
        })
        return 1
    finally:
        if staging is not None and staging.exists():
            shutil.rmtree(staging)
        if (backup is not None and backup.exists() and destination is not None and
                destination.exists()):
            shutil.rmtree(backup)


if __name__ == "__main__":
    raise SystemExit(run())
