"""Desktop routing selection; no production data or model requests."""
from pathlib import Path

import pytest

from app.desktop_frontend import resolve_desktop_frontend


def build(root: Path, name: str) -> Path:
    dist = root / name / "dist"
    dist.mkdir(parents=True)
    (dist / "index.html").write_text(name, encoding="utf-8")
    return dist


def test_uses_only_wonderland_even_if_legacy_build_remains(tmp_path):
    build(tmp_path, "frontend")
    new = build(tmp_path, "frontend-wonderland")
    assert resolve_desktop_frontend(tmp_path) == new
    assert resolve_desktop_frontend(tmp_path, "frontend-wonderland") == new


def test_legacy_only_checkout_requires_current_ui(tmp_path):
    build(tmp_path, "frontend")
    with pytest.raises(RuntimeError, match="frontend-wonderland run build"):
        resolve_desktop_frontend(tmp_path)


@pytest.mark.parametrize("name", ["frontend", "../mobile-tablet", "mobile-tablet", "C:/", "", "data"])
def test_rejects_retired_and_non_desktop_directories(tmp_path, name):
    with pytest.raises(RuntimeError, match="DESKTOP_FRONTEND"):
        resolve_desktop_frontend(tmp_path, name)


def test_missing_selected_build_does_not_silently_fallback(tmp_path):
    build(tmp_path, "frontend")
    (tmp_path / "frontend-wonderland").mkdir()
    with pytest.raises(RuntimeError, match="frontend-wonderland run build"):
        resolve_desktop_frontend(tmp_path)
