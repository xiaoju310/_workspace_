"""Low-memory HTTP integration check using isolated data, never the real account DB.

Build frontend-wonderland first. Runs the real TypeScript client against FastAPI.
The test-only legacy identity is confined to an ephemeral loopback service.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, build_opener

ROOT = Path(__file__).resolve().parents[1]


def main():
    output = ROOT / "test-results"
    output.mkdir(exist_ok=True)
    # Retain the isolated logs for diagnosis, without recursive cleanup on Windows.
    work = Path(tempfile.mkdtemp(prefix="wonderland-http-", dir=output))
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    base = f"http://127.0.0.1:{port}"
    env = os.environ.copy()
    env.update({
        "PYTHONPATH": str(ROOT / "backend"),
        "TEMP": str(work), "TMP": str(work),
        "DATABASE_PATH": str(work / "test.db"),
        "DATA_ROOT": str(work / "data"),
        "AUTH_BACKEND": "legacy", "ALLOW_LEGACY_TOKENS": "1",
        "APP_USER_TOKENS": json.dumps({"owner-local": "wonderland-test-only"}),
        "AI_PROVIDER": "", "SERVE_FRONTEND": "1",
        "DESKTOP_FRONTEND": "frontend-wonderland",
        "LIVE_BACKEND_URL": base, "LIVE_DATABASE_PATH": str(work / "test.db"),
        "LIVE_TOKEN": "wonderland-test-only", "LIVE_PYTHON": sys.executable,
    })
    opener = build_opener(ProxyHandler({}))
    with (work / "server.log").open("wb") as log:
        process = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(port)],
            cwd=ROOT, env=env, stdout=log, stderr=log,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
        try:
            for _ in range(60):
                try:
                    with opener.open(base + "/health", timeout=1) as response:
                        assert json.load(response)["status"] == "ok"
                    break
                except (URLError, OSError):
                    if process.poll() is not None:
                        raise RuntimeError("Isolated server exited; inspect frontend build")
                    time.sleep(0.2)
            else:
                raise RuntimeError("Isolated server did not become ready")
            with opener.open(base + "/") as response:
                html = response.read().decode("utf-8")
            assert 'name="paper-companion-ui" content="frontend-wonderland"' in html
            import re
            assets = re.findall(r'(?:src|href)="(/assets/[^" ]+)"', html)
            assert len(assets) >= 2
            for asset in assets:
                with opener.open(base + asset) as response:
                    assert response.status == 200 and len(response.read()) > 100
            try:
                opener.open(base + "/api/books/not-a-real-book")
                raise AssertionError("Unauthenticated books request unexpectedly allowed")
            except HTTPError as error:
                assert error.code == 401
            npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
            assert npm, "npm is required"
            subprocess.run(
                [npm, "test", "--", "src/lib/__tests__/liveBookFlow.live.test.ts"],
                cwd=ROOT / "frontend-wonderland", env=env, check=True,
            )
            print("PASS: new UI HTML/assets, API authentication and real HTTP client flow")
        finally:
            if os.name == "nt":
                # The venv launcher has a child Python process; stop our whole test tree.
                subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            else:
                process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


if __name__ == "__main__":
    main()
