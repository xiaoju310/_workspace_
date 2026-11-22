"""Runtime configuration never alters global settings or exposes credentials."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[2]
POWERSHELL = shutil.which('powershell.exe')


@pytest.mark.skipif(os.name != 'nt' or not POWERSHELL, reason='Windows desktop launcher')
@pytest.mark.parametrize('configured', [False, True, 'missing'])
def test_runtime_selects_explicit_config_or_venv(tmp_path, configured):
    folder = tmp_path / 'PaperCompanion'
    folder.mkdir()
    if configured:
        (folder / 'runtime.json').write_text(json.dumps({
            'python_executable': str(Path(sys.base_prefix) / 'python.exe') if configured is True else str(tmp_path / 'missing.exe'),
        }), encoding='utf-8')
    script = ROOT / 'scripts' / 'backend-runtime.ps1'
    def quote(value): return "'" + str(value).replace("'", "''") + "'"
    command = f". {quote(script)}; $r=Get-PaperBackendRuntime {quote(ROOT)} 'project-venv.exe' '127.0.0.1' 8765; $r | ConvertTo-Json -Compress"
    result = subprocess.run([POWERSHELL, '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', "$ErrorActionPreference='Stop';"+command],
                            env={**os.environ, 'LOCALAPPDATA': str(tmp_path)}, capture_output=True, text=True)
    if configured == 'missing':
        assert result.returncode != 0
        assert 'moved or removed' in result.stderr
        return
    assert result.returncode == 0, result.stderr
    data = json.loads(result.stdout)
    if configured:
        assert Path(data['Executable']) == Path(sys.base_prefix) / 'python.exe'
        assert data['Arguments'][:2] == ['-I', '-S']
        assert data['Arguments'][2] == '"' + str(ROOT / 'scripts' / 'run-backend.py') + '"'
    else:
        assert data['Executable'] == 'project-venv.exe'
        assert data['Arguments'][:2] == ['-m', 'uvicorn']
    assert data['Arguments'][-4:] == ['--host', '127.0.0.1', '--port', '8765']


def test_entrypoint_preserves_cli_and_uses_only_project_packages(monkeypatch):
    spec = importlib.util.spec_from_file_location('backend_entrypoint', ROOT/'scripts/run-backend.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    added, launched = [], []
    monkeypatch.setattr(module.site, 'addsitedir', added.append)
    monkeypatch.setattr(module.runpy, 'run_module', lambda *a, **k: launched.append((a,k)))
    monkeypatch.setattr(sys, 'path', list(sys.path))
    monkeypatch.setattr(sys, 'argv', ['run-backend.py','--host','127.0.0.1','--port','8765'])
    module.main()
    assert added == [str(ROOT/'backend/.venv/Lib/site-packages')]
    assert sys.path[0] == str(ROOT/'backend')
    assert sys.argv == ['uvicorn','app.main:app','--host','127.0.0.1','--port','8765']
    assert launched == [(('uvicorn',), {'run_name':'__main__'})]
