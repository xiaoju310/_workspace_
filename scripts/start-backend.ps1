param([int]$Port = 8000, [string]$Bind = "127.0.0.1", [switch]$WithFrontend)
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
if ($WithFrontend) {
    if (-not (Test-Path (Join-Path $repo 'frontend-wonderland\dist\index.html'))) {
        throw 'Build the desktop UI first: npm --prefix frontend-wonderland run build'
    }
    # Build checks and the server must agree on the same, sole supported UI.
    $env:DESKTOP_FRONTEND = 'frontend-wonderland'
    $env:SERVE_FRONTEND = '1'
}
if ($Bind -ne '127.0.0.1' -and $Bind -ne 'localhost') {
    Write-Warning 'Network mode: use only on a trusted LAN/VPN. Do not forward port 8000 to the internet; configure HTTPS and MongoDB authentication first.'
}
. (Join-Path $PSScriptRoot 'backend-runtime.ps1')
$runtime = Get-PaperBackendRuntime $repo $python $Bind $Port
# Argument arrays passed directly do not need Start-Process quoting.
$arguments = @($runtime.Arguments | ForEach-Object { $_.Trim('"') })
& $runtime.Executable @arguments
