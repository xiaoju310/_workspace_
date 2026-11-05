param([int]$Port = 8000)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $repo 'backend'
$python = Join-Path $backend '.venv\Scripts\python.exe'
if (-not (Test-Path $python)) {
    Write-Host 'Creating Python virtual environment...'
    $hostPython = Get-Command python -ErrorAction Stop
    & $hostPython.Source -m venv (Join-Path $backend '.venv')
    & $python -m pip install -r (Join-Path $backend 'requirements.txt')
}
$env:PYTHONPATH = $backend
$env:DATABASE_PATH = Join-Path $repo 'data\paper_companion.db'
if (-not $env:APP_USER_TOKENS) { throw 'Set APP_USER_TOKENS to a JSON mapping of user IDs to secret bearer tokens before starting.' }
& $python -m uvicorn app.main:app --host 127.0.0.1 --port $Port
