# Mobile/tablet launcher. Never starts or changes the desktop API or its SQLite files.
[CmdletBinding()]
param([ValidateRange(1,65535)][int]$Port = 5174, [ValidateRange(1,65535)][int]$ApiPort = 8001)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$repo = (Resolve-Path -LiteralPath (Join-Path $root '..')).Path
$python = Join-Path $root '.venv\Scripts\python.exe'
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$mongoUri = if ($env:MONGODB_URI) { $env:MONGODB_URI } else { 'mongodb://127.0.0.1:27017' }
if ($mongoUri -notmatch '^mongodb://(127\.0\.0\.1|localhost)(:27017)?(/|$)') { throw 'Only local MongoDB at 127.0.0.1 is allowed.' }
if ($ApiPort -ne 8001) { throw 'The isolated UI proxy uses API port 8001. Keep -ApiPort 8001.' }
$mongoListen = @(Get-NetTCPConnection -LocalPort 27017 -State Listen -ErrorAction SilentlyContinue)
if (@($mongoListen | Where-Object { $_.LocalAddress -notin @('127.0.0.1','::1') }).Count) { throw 'MongoDB listens on the network. Restrict mongod to localhost first.' }
if (-not (Test-Path -LiteralPath $python)) {
    & (Get-Command python -ErrorAction Stop).Source -m venv (Join-Path $root '.venv')
    if ($LASTEXITCODE -ne 0) { throw 'Could not create mobile virtual environment.' }
    & $python -m pip install -r (Join-Path $repo 'backend\requirements.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Could not install mobile server dependencies.' }
}
$env:MONGODB_URI = $mongoUri
$env:MONGODB_DATABASE = 'paper_companion_mobile'
$env:PYTHONPATH = (Join-Path $repo 'backend') + [IO.Path]::PathSeparator + $root
& $python -c "from app.accounts import initialize_accounts; initialize_accounts(); print('Local MongoDB ready')"
if ($LASTEXITCODE -ne 0) { throw 'Local MongoDB unavailable.' }
$logs = Join-Path $root 'logs'; New-Item -ItemType Directory -Path $logs -Force | Out-Null
$apiListen = @(Get-NetTCPConnection -LocalPort $ApiPort -State Listen -ErrorAction SilentlyContinue)
if (-not $apiListen.Count) {
    Start-Process -FilePath $python -ArgumentList @('-m','uvicorn','server.main:app','--host','127.0.0.1','--port',"$ApiPort") -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'api-out.log') -RedirectStandardError (Join-Path $logs 'api-error.log') | Out-Null
}
$ready = $false
for ($i=0; $i -lt 35; $i++) {
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$ApiPort/health" -TimeoutSec 2 -Proxy $null
        if ($health.service -eq 'paper-companion-mobile-mongodb-api') { $ready = $true; break }
        throw "Port $ApiPort belongs to a different service."
    } catch { if ($i -eq 34) { throw "Mobile API failed to start: $($_.Exception.Message). See $logs" }; Start-Sleep -Milliseconds 400 }
}
if (-not (Test-Path -LiteralPath (Join-Path $root 'node_modules'))) {
    & $npm --prefix $root ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Mobile UI dependency installation failed.' }
}
& $npm --prefix $root run build
if ($LASTEXITCODE -ne 0) { throw 'Mobile UI build failed.' }
function Test-OwnMobileUi {
    param([int]$UiPort)
    try {
        # Both checks matter: /health is proxied to our isolated API, and / is our own UI.
        # Never treat an unrelated service on the same port as a successful startup.
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$UiPort/health" -TimeoutSec 2 -Proxy $null
        $page = Invoke-WebRequest -Uri "http://127.0.0.1:$UiPort/" -UseBasicParsing -TimeoutSec 2 -Proxy $null
        return ($health.service -eq 'paper-companion-mobile-mongodb-api' -and
            $page.StatusCode -eq 200 -and $page.Content.Contains('id="root"') -and $page.Content.Contains('/assets/index-'))
    } catch { return $false }
}
if (@(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue).Count) {
    if (Test-OwnMobileUi -UiPort $Port) {
        Write-Host "Mobile/tablet already running: http://127.0.0.1:$Port/ (MongoDB: paper_companion_mobile)"
        exit 0
    }
    throw "Port $Port is used by another service. Close that service or select another UI port."
}
Start-Process -FilePath $npm -ArgumentList @('--prefix', $root, 'run', 'preview', '--', '--port', "$Port", '--host', '127.0.0.1') -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'ui-out.log') -RedirectStandardError (Join-Path $logs 'ui-error.log') | Out-Null
for ($i=0; $i -lt 35; $i++) {
    if (Test-OwnMobileUi -UiPort $Port) {
        Write-Host "Mobile/tablet ready: http://127.0.0.1:$Port/ (MongoDB: paper_companion_mobile)"
        exit 0
    }
    Start-Sleep -Milliseconds 400
}
throw "Mobile UI failed to start. Check $logs"
