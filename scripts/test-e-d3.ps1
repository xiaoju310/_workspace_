param([string]$Python = 'python')
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent $PSScriptRoot
$env:PYTHONPATH=Join-Path $repo 'backend'
$env:E_D3_RESULTS=Join-Path $repo 'docs/test-results/d3'
& $Python -m pytest -q (Join-Path $repo 'backend/tests/test_e_d3.py') --junitxml=(Join-Path $env:E_D3_RESULTS 'junit-d3.xml')
exit $LASTEXITCODE
