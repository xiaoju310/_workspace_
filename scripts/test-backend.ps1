$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$env:PYTHONPATH = Join-Path $repo 'backend'
$python = Join-Path $repo 'backend\.venv\Scripts\python.exe'
if (-not (Test-Path $python)) { throw 'Create venv and install backend/requirements.txt first.' }
& $python -m pytest -q (Join-Path $repo 'backend\tests')
exit $LASTEXITCODE
