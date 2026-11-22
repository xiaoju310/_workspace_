"""备份工具的安全边界测试；仅操作测试目录，不连接正式数据库。"""
import importlib.util
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[2]


def module(name):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), ROOT / "scripts" / (name + ".py"))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def test_source_inventory_excludes_mobile_dependencies_and_scratch(tmp_path, monkeypatch):
    tool = module("backup-desktop")
    for name in ["README.md", ".env", "backend/app/main.py", "frontend-wonderland/src/App.tsx",
                 "mobile-tablet/src/keep.ts", "backend/.venv/ignore.py", "frontend-wonderland/node_modules/ignore.js",
                 "backend/app/__pycache__/ignore.pyc", ".tmp-test/script.py", ".git", ".tmp-script.py"]:
        target = tmp_path / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("fixture", encoding="utf-8")
    monkeypatch.setattr(tool, "ROOT", tmp_path)
    assert {p.relative_to(tmp_path).as_posix() for p in tool.source_files()} == {
        "README.md", ".env", "backend/app/main.py", "frontend-wonderland/src/App.tsx"}


def test_backup_refuses_project_as_destination(tmp_path, monkeypatch):
    tool = module("backup-desktop")
    monkeypatch.setattr(tool, "ROOT", tmp_path)
    with pytest.raises(ValueError, match="outside"):
        tool.make_backup(tmp_path / "private-backups")


def test_verifier_refuses_incomplete_snapshot(tmp_path):
    tool = module("verify-desktop-backup")
    (tmp_path / "BACKUP-COMPLETE").write_text("ok")
    (tmp_path / "BACKUP-INCOMPLETE").write_text("failed")
    with pytest.raises(ValueError, match="completed"):
        tool.verify(tmp_path)


def test_chunked_hash_is_stable(tmp_path):
    tool = module("backup-desktop")
    path = tmp_path / "fixture.txt"
    path.write_bytes(b"abc")
    assert tool.sha256(path) == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
