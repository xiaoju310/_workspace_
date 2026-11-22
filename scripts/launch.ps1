# One-click local launcher. All generated files stay inside ignored folders.
[CmdletBinding()]
param(
    [ValidateRange(1, 65535)][int]$Port = 8000,
    [switch]$NoBrowser,
    [ValidateSet("frontend-wonderland")][string]$Frontend = "frontend-wonderland",
    [switch]$Share,
    [string]$InterfaceAlias
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$backend = Join-Path $repo 'backend'
$frontendDir = Join-Path $repo $Frontend
# The backend must serve the same UI that this launcher builds.
$env:DESKTOP_FRONTEND = $Frontend
$python = Join-Path $backend '.venv\Scripts\python.exe'
$url = "http://127.0.0.1:$Port/"
$shareAddress = $null

function Fail([string]$message) { throw $message }
function Get-LocalFileHash([string]$Path) {
    # Work even when Windows PowerShell cannot auto-load Get-FileHash.
    $stream = [IO.File]::OpenRead($Path)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '') }
    finally { $stream.Dispose(); $sha.Dispose() }
}

function Run-Checked([string]$program, [string[]]$arguments) {
    & $program @arguments
    if ($LASTEXITCODE -ne 0) { Fail "$program failed (exit code $LASTEXITCODE)." }
}
function Get-AppHealth([string]$Address) {
    # Bypass system proxies: a LAN IP must be checked on this machine, not via a proxy.
    $request = [Net.HttpWebRequest][Net.WebRequest]::Create("http://$($Address):$Port/health")
    $request.Proxy = $null
    $request.Timeout = 2000
    $request.ReadWriteTimeout = 2000
    try {
        $response = $request.GetResponse()
        try {
            $reader = New-Object IO.StreamReader($response.GetResponseStream())
            try { $health = $reader.ReadToEnd() | ConvertFrom-Json }
            finally { $reader.Dispose() }
            return ($health.status -eq 'ok' -and $health.service -eq 'paper-companion-api')
        } finally { $response.Dispose() }
    } catch { return $false }
}
function Open-App {
    if ($Share) { Write-Host "For other computers on the same trusted network: http://$($shareAddress):$Port/" }
    if (-not $NoBrowser) {
        try { Start-Process $url | Out-Null }
        catch { Write-Warning "Could not open a browser automatically. Open $url yourself." }
    }
    Write-Host "KaiJuan YouLing is ready: $url"
}

function Assert-MongoLocalOnly {
    # A stopped service has no listeners; run this again after starting MongoDB.
    $mongoListeners = @(Get-NetTCPConnection -LocalPort 27017 -State Listen -ErrorAction SilentlyContinue)
    if (@($mongoListeners | Where-Object { $_.LocalAddress -notin @('127.0.0.1', '::1') }).Count) {
        Fail 'MongoDB is listening on a network address. Restrict MongoDB to 127.0.0.1 before sharing.'
    }
}

function Ensure-LanFirewall {
    $ruleName = "PaperCompanion-LAN-$Port-$shareAddress"
    $rule = Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue
    if ($rule) {
        $portFilter = $rule | Get-NetFirewallPortFilter
        $addressFilter = $rule | Get-NetFirewallAddressFilter
        if ($rule.Enabled -eq 'True' -and $rule.Direction -eq 'Inbound' -and $rule.Action -eq 'Allow' -and
            $rule.Profile -eq 'Private' -and $portFilter.Protocol -eq 'TCP' -and "$($portFilter.LocalPort)" -eq "$Port" -and
            $addressFilter.LocalAddress -eq $shareAddress -and $addressFilter.RemoteAddress -eq 'LocalSubnet4') { return }
    }
    Write-Host 'Windows will request administrator approval to allow this port only on the private local subnet.'
    $helper = Join-Path $PSScriptRoot 'configure-lan-firewall.ps1'
    $args = "-NoProfile -ExecutionPolicy Bypass -File `"$helper`" -Port $Port -LocalAddress $shareAddress"
    try { $result = Start-Process powershell.exe -ArgumentList $args -Verb RunAs -Wait -PassThru -WindowStyle Hidden }
    catch { Fail 'Firewall approval was canceled or failed. The app was not shared.' }
    if ($result.ExitCode -ne 0) { Fail 'The private-network firewall rule could not be configured; LAN sharing was not started.' }
}

try {
    if ($Share) {
        # Share only on a trusted Private adapter, never on all interfaces or a public Wi-Fi.
        $profiles = @(Get-NetConnectionProfile | Where-Object { $_.NetworkCategory -eq 'Private' })
        if ($InterfaceAlias) { $profiles = @($profiles | Where-Object { $_.InterfaceAlias -eq $InterfaceAlias }) }
        $candidates = @(
            foreach ($profile in $profiles) {
                Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $profile.InterfaceIndex -ErrorAction SilentlyContinue |
                    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.AddressState -eq 'Preferred' } |
                    ForEach-Object { [pscustomobject]@{ Address = $_.IPAddress; Alias = $profile.InterfaceAlias; Index = $profile.InterfaceIndex } }
            }
        )
        if ($candidates.Count -ne 1) {
            $current = (Get-NetConnectionProfile | ForEach-Object { "$($_.InterfaceAlias): $($_.NetworkCategory)" }) -join '; '
            Fail "LAN sharing requires exactly one active Private network IPv4 address (found $($candidates.Count)). Current networks: $current. For a trusted home network, mark it Private in Windows settings; do not mark public Wi-Fi Private. If several exist, choose -InterfaceAlias <name>."
        }
        $shareAddress = $candidates[0].Address
        $mongoUri = if ($env:MONGODB_URI) { $env:MONGODB_URI } else { 'mongodb://127.0.0.1:27017' }
        if ($mongoUri -notmatch '^mongodb://(127\.0\.0\.1|localhost)(:27017)?(/|$)') {
            Fail 'LAN sharing requires MongoDB on this computer at 127.0.0.1:27017; remote MongoDB configuration is not allowed.'
        }
        Assert-MongoLocalOnly
        Write-Warning 'LAN mode uses HTTP (no encryption). Use only on a trusted private network with non-sensitive demo data. Never forward this port to the Internet.'
    }
    # Never take over a port used by an unrelated application.
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($listener) {
        if ($Share) {
            # Do not mistake a loopback service, a wildcard listener, or another app for this LAN service.
            if (-not @($listener | Where-Object { $_.LocalAddress -eq $shareAddress }).Count -or
                @($listener | Where-Object { $_.LocalAddress -in @('0.0.0.0', '::') }).Count -or
                -not (Get-AppHealth $shareAddress)) {
                Fail "Port $Port is already in use but has no matching LAN service on $shareAddress. Stop it or choose another port."
            }
            $url = "http://$($shareAddress):$Port/"
            Ensure-LanFirewall
        } elseif (-not @($listener | Where-Object { $_.LocalAddress -eq '127.0.0.1' }).Count -or
                  @($listener | Where-Object { $_.LocalAddress -in @('0.0.0.0', '::') }).Count -or
                  -not (Get-AppHealth '127.0.0.1')) {
            Fail "Port $Port is already in use but has no matching loopback-only service. Stop it or choose another port."
        }
        # Do not silently reopen an old UI when switching desktop versions.
        $rootResponse = Invoke-WebRequest -Uri $url -UseBasicParsing
        if ($Frontend -eq 'frontend-wonderland' -and $rootResponse.Content -notmatch 'paper-companion-ui" content="frontend-wonderland') {
            Fail 'The running service still serves the old UI. Restart the desktop service before switching to Wonderland; your data will be preserved.'
        }
        Open-App
        exit 0
    }

    # Try the installed local service, but never reconfigure or expose MongoDB.
    $mongoService = Get-Service -Name MongoDB -ErrorAction SilentlyContinue
    if ($mongoService -and $mongoService.Status -ne 'Running') {
        Write-Host 'Starting MongoDB service...'
        try { Start-Service -Name MongoDB -ErrorAction Stop }
        catch { Fail 'MongoDB is stopped and could not be started. Start the MongoDB service in Windows Services, then retry.' }
    }
    if (-not $mongoService -and -not $env:MONGODB_URI) {
        Fail 'MongoDB service was not found. Install MongoDB Community Server as a Windows service (local-only), then retry.'
    }
    if ($Share) { Assert-MongoLocalOnly }
    # Prefer the Windows Python launcher, then the ordinary PATH command.
    if (-not (Test-Path -LiteralPath $python)) {
        $hostPython = $null
        $py = Get-Command py.exe -ErrorAction SilentlyContinue
        if ($py) {
            & $py.Source -3 -c 'import sys; print(sys.executable)' *> $null
            if ($LASTEXITCODE -eq 0) { $hostPython = $py.Source }
        }
        if (-not $hostPython) {
            $candidate = Get-Command python.exe -ErrorAction SilentlyContinue
            if ($candidate) {
                & $candidate.Source -c 'import sys; print(sys.executable)' *> $null
                if ($LASTEXITCODE -eq 0) { $hostPython = $candidate.Source }
            }
        }
        if (-not $hostPython) { Fail 'Python 3 is missing. Install Python 3.11+ (include pip), then run this launcher again.' }
        Write-Host 'Creating local Python environment...'
        $args = if ($hostPython -eq $py.Source) { @('-3', '-m', 'venv', (Join-Path $backend '.venv')) } else { @('-m', 'venv', (Join-Path $backend '.venv')) }
        Run-Checked $hostPython $args
    }
    $requirements = Join-Path $backend 'requirements.txt'
    $pythonStamp = Join-Path $backend '.venv\.paper-companion-requirements.sha256'
    $requirementsHash = (Get-LocalFileHash $requirements)
    if (-not (Test-Path -LiteralPath $pythonStamp) -or (Get-Content -LiteralPath $pythonStamp -Raw).Trim() -ne $requirementsHash) {
        Write-Host 'Installing Python dependencies (first run may take a few minutes)...'
        Run-Checked $python @('-m', 'pip', 'install', '-r', $requirements)
        Set-Content -LiteralPath $pythonStamp -Value $requirementsHash -Encoding ascii
    }

    $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $npm) { Fail 'Node.js/npm is missing. Install Node.js LTS, then run this launcher again.' }
    $lock = Join-Path $frontendDir 'package-lock.json'
    $nodeModules = Join-Path $frontendDir 'node_modules'
    $nodeStamp = Join-Path $nodeModules '.paper-companion-lock.sha256'
    $lockHash = (Get-LocalFileHash $lock)
    if (-not (Test-Path -LiteralPath $nodeStamp) -or (Get-Content -LiteralPath $nodeStamp -Raw).Trim() -ne $lockHash) {
        Write-Host 'Installing frontend dependencies (first run may take a few minutes)...'
        Run-Checked $npm.Source @('--prefix', $frontendDir, 'ci', '--no-audit', '--no-fund')
        Set-Content -LiteralPath $nodeStamp -Value $lockHash -Encoding ascii
    }
    Write-Host 'Building the interface...'
    Run-Checked $npm.Source @('--prefix', $frontendDir, 'run', 'build')

    if ($Share) { Ensure-LanFirewall }
    $logDir = Join-Path $repo 'data\logs'
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    # Preserve user-provided database settings; never place credentials in the repository.
    if (-not $env:DATABASE_PATH) { $env:DATABASE_PATH = Join-Path $repo 'data\paper_companion.db' }
    if (-not $env:DATA_ROOT) { $env:DATA_ROOT = Join-Path $repo 'data' }
    $env:PYTHONPATH = $backend
    $env:SERVE_FRONTEND = '1'
    # Explicit desktop fallback: local text excerpts, not a visual/semantic model.
    # Preserve any advanced provider deliberately configured by the owner.
    if (-not $env:AI_PROVIDER) { $env:AI_PROVIDER = 'text_local' }
    $stdout = Join-Path $logDir "server-$Port-out.log"
    $stderr = Join-Path $logDir "server-$Port-error.log"
    Write-Host 'Starting local service...'
    . (Join-Path $PSScriptRoot 'backend-runtime.ps1')
    $runtime = Get-PaperBackendRuntime $repo $python $(if ($Share) { $shareAddress } else { '127.0.0.1' }) $Port
    $process = Start-Process -FilePath $runtime.Executable -ArgumentList $runtime.Arguments `
        -WorkingDirectory $repo -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        if ($Share) {
            if (Get-AppHealth $shareAddress) { $ready = $true; break }
        } elseif (Get-AppHealth '127.0.0.1') { $ready = $true; break }
        if ($process.HasExited) { break }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) {
        $tail = if (Test-Path -LiteralPath $stderr) { (Get-Content -LiteralPath $stderr -Tail 18) -join "`n" } else { '(no error log)' }
        Fail "The service did not start. Check MongoDB and see $stderr`n$tail"
    }
    if ($Share) { $url = "http://$($shareAddress):$Port/" }
    Open-App
    exit 0
} catch {
    Write-Error "Startup failed: $($_.Exception.Message)"
    exit 1
}
