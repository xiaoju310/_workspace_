"""Display-name regression checks; no database, accounts, or paid requests."""
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
NAME = "开卷有灵"
OLD_NAME = "纸书智伴"


@pytest.mark.parametrize("relative", [
    "frontend-wonderland/index.html",
    "frontend-wonderland/src/App.tsx",
    "frontend-wonderland/src/components/WorkspaceShell.tsx",
    "frontend-wonderland/src/features/interaction/BenchmarkRunner.tsx",
    "frontend-wonderland/scripts/build-offline.cjs",
    "mobile-tablet/index.html",
    "mobile-tablet/src/App.tsx",
    "mobile-tablet/src/components/WorkspaceShell.tsx",
    "mobile-tablet/src/features/interaction/BenchmarkRunner.tsx",
    "mobile-tablet/server/main.py",
    "backend/app/main.py",
])
def test_visible_entrypoints_use_current_product_name(relative):
    source = (ROOT / relative).read_text(encoding="utf-8")
    assert NAME in source
    assert OLD_NAME not in source


@pytest.mark.parametrize("suffix", ["", "-局域网共享", "-Tailscale共享"])
def test_current_launchers_preserve_compatible_behavior(suffix):
    current = ROOT / f"启动{NAME}{suffix}.cmd"
    legacy = ROOT / f"启动{OLD_NAME}{suffix}.cmd"
    assert current.read_bytes() == legacy.read_bytes()


def test_browser_titles_and_backend_api_title():
    for folder in ("frontend-wonderland", "mobile-tablet"):
        html = (ROOT / folder / "index.html").read_text(encoding="utf-8")
        assert f"<title>{NAME} · " in html
    from app.main import app
    assert app.title == f"{NAME} API"
    assert app.openapi()["info"]["title"] == f"{NAME} API"
