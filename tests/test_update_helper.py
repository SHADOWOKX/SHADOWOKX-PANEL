#!/usr/bin/python3
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest import mock
import zipfile


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("shadow_update_helper", ROOT / "update-helper.py")
assert SPEC and SPEC.loader
HELPER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HELPER)


def create_archive(path: Path, version: str = "2.4.0", extra=None) -> None:
    files = {
        "metadata.json": json.dumps({
            "uuid": "shadow-panel@shadowokx",
            "version-name": version,
        }),
        "VERSION": f"{version}\n",
        "extension.js": "export default class Test {}\n",
        "stylesheet.css": ".test {}\n",
    }
    if extra:
        files.update(extra)
    with zipfile.ZipFile(path, "w") as bundle:
        for name, contents in files.items():
            if isinstance(contents, zipfile.ZipInfo):
                bundle.writestr(contents, b"target")
            else:
                bundle.writestr(name, contents)


class UpdateHelperTests(unittest.TestCase):
    def test_valid_package_stages_required_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / "update.zip"
            staging = root / "staging"
            staging.mkdir()
            create_archive(archive)
            HELPER.safe_archive(archive, staging, "shadow-panel@shadowokx", "2.4.0")
            self.assertEqual((staging / "VERSION").read_text().strip(), "2.4.0")

    def test_wrong_uuid_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / "update.zip"
            staging = root / "staging"
            staging.mkdir()
            create_archive(archive)
            with self.assertRaises(ValueError):
                HELPER.safe_archive(archive, staging, "another@extension", "2.4.0")

    def test_traversal_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / "update.zip"
            staging = root / "staging"
            staging.mkdir()
            create_archive(archive, extra={"../escape": "bad"})
            with self.assertRaises(ValueError):
                HELPER.safe_archive(archive, staging, "shadow-panel@shadowokx", "2.4.0")
            self.assertFalse((root / "escape").exists())

    def test_symlink_entry_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / "update.zip"
            staging = root / "staging"
            staging.mkdir()
            link = zipfile.ZipInfo("unsafe-link")
            link.create_system = 3
            link.external_attr = (stat.S_IFLNK | 0o777) << 16
            create_archive(archive, extra={"unsafe-link": link})
            with self.assertRaises(ValueError):
                HELPER.safe_archive(archive, staging, "shadow-panel@shadowokx", "2.4.0")

    def test_successful_replace_preserves_per_user_data_outside_extension(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data_home = root / "data"
            destination = data_home / "gnome-shell/extensions/shadow-panel@shadowokx"
            destination.mkdir(parents=True)
            (destination / "old.txt").write_text("old")
            user_state = data_home / "shadow-panel/codex-history.json"
            user_state.parent.mkdir(parents=True)
            user_state.write_text("keep")
            archive = root / "update.zip"
            result = root / "result.json"
            create_archive(archive)
            digest = hashlib.sha256(archive.read_bytes()).hexdigest()
            completed = mock.Mock(returncode=0)
            argv = ["update-helper.py", str(archive), digest,
                    "shadow-panel@shadowokx", "2.4.0", str(result)]
            with mock.patch.dict("os.environ", {"XDG_DATA_HOME": str(data_home)}), \
                    mock.patch.object(sys, "argv", argv), \
                    mock.patch.object(HELPER.subprocess, "run", return_value=completed), \
                    mock.patch.object(HELPER.time, "sleep"):
                self.assertEqual(HELPER.run(), 0)
            self.assertEqual((destination / "VERSION").read_text().strip(), "2.4.0")
            self.assertEqual(user_state.read_text(), "keep")
            self.assertEqual(json.loads(result.read_text())["status"], "installed")

    def test_enable_failure_rolls_back_previous_extension(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data_home = root / "data"
            destination = data_home / "gnome-shell/extensions/shadow-panel@shadowokx"
            destination.mkdir(parents=True)
            (destination / "old.txt").write_text("old")
            archive = root / "update.zip"
            result = root / "result.json"
            create_archive(archive)
            digest = hashlib.sha256(archive.read_bytes()).hexdigest()
            responses = [mock.Mock(returncode=0), mock.Mock(returncode=1), mock.Mock(returncode=0)]
            argv = ["update-helper.py", str(archive), digest,
                    "shadow-panel@shadowokx", "2.4.0", str(result)]
            with mock.patch.dict("os.environ", {"XDG_DATA_HOME": str(data_home)}), \
                    mock.patch.object(sys, "argv", argv), \
                    mock.patch.object(HELPER.subprocess, "run", side_effect=responses), \
                    mock.patch.object(HELPER.time, "sleep"):
                self.assertEqual(HELPER.run(), 1)
            self.assertEqual((destination / "old.txt").read_text(), "old")
            self.assertFalse((destination / "VERSION").exists())
            self.assertEqual(json.loads(result.read_text())["status"], "failed")

    def test_checksum_mismatch_never_replaces_and_records_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data_home = root / "data"
            destination = data_home / "gnome-shell/extensions/shadow-panel@shadowokx"
            destination.mkdir(parents=True)
            (destination / "old.txt").write_text("old")
            archive = root / "update.zip"
            result = root / "result.json"
            create_archive(archive)
            argv = ["update-helper.py", str(archive), "0" * 64,
                    "shadow-panel@shadowokx", "2.4.0", str(result)]
            with mock.patch.dict("os.environ", {"XDG_DATA_HOME": str(data_home)}), \
                    mock.patch.object(sys, "argv", argv), \
                    mock.patch.object(HELPER.subprocess, "run") as command:
                self.assertEqual(HELPER.run(), 1)
            command.assert_not_called()
            self.assertEqual((destination / "old.txt").read_text(), "old")
            self.assertEqual(json.loads(result.read_text())["status"], "failed")


if __name__ == "__main__":
    unittest.main()
