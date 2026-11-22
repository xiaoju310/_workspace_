# Share the local application only inside the user's Tailscale private network.
[CmdletBinding()]
param([ValidateRange(1, 65535)][int]$Port = 8000)
$ErrorActionPreference = 'Stop'

function Fail([string]$Message) { throw $Message }
function Invoke-Tailscale([string[]]$Arguments) {
    $result = & $script:tailscale @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) { Fail "Tailscale $($Arguments -join ' ') failed: $($result -join ' ')" }
    return ($result -join "`n")
}

try {
    $command = Get-Command tailscale.exe -ErrorAction SilentlyContinue
    $candidate = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
    if ($command) { $script:tailscale = $command.Source }
    elseif (Test-Path -LiteralPath $candidate) { $script:tailscale = $candidate }
    else { Fail 'Tailscale is not installed. Install it from tailscale.com/download, sign in, and rerun this launcher.' }

    $state = Invoke-Tailscale -Arguments @('status', '--json') | ConvertFrom-Json
    if ($state.BackendState -ne 'Running' -or -not $state.Self.DNSName) {
        Fail 'Tailscale is not connected. Open Tailscale, sign in and connect this computer first.'
    }
    $dnsName = [string]$state.Self.DNSName
    if ($dnsName -notmatch '^[a-zA-Z0-9.-]+\.$') { Fail 'Tailscale did not provide a valid private DNS name.' }

    # Do not replace another Tailscale Serve site, even on a different path/port.
    $serveStatus = Invoke-Tailscale -Arguments @('serve', 'status', '--json')
    $serveConfig = if ([string]::IsNullOrWhiteSpace($serveStatus)) { $null } else { $serveStatus | ConvertFrom-Json }
    if ($serveConfig -and @($serveConfig.PSObject.Properties).Count -gt 0) {
        Fail 'Tailscale Serve is already configured on this computer. Inspect "tailscale serve status" before making any changes; this launcher will not overwrite it.'
    }

    $launcher = Join-Path $PSScriptRoot 'launch.ps1'
    & $launcher -Port $Port -NoBrowser
    if ($LASTEXITCODE -ne 0) { Fail 'The local application did not start; Tailscale sharing was not enabled.' }

    # Refuse a wildcard or VPN/LAN listener. MongoDB must also remain local.
    $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop)
    if (-not @($listeners | Where-Object { $_.LocalAddress -eq '127.0.0.1' }).Count -or
        @($listeners | Where-Object { $_.LocalAddress -notin @('127.0.0.1', '::1') }).Count) {
        Fail 'The application is not loopback-only. Tailscale sharing was not enabled.'
    }
    $mongoUri = if ($env:MONGODB_URI) { $env:MONGODB_URI } else { 'mongodb://127.0.0.1:27017' }
    if ($mongoUri -notmatch '^mongodb://(127\.0\.0\.1|localhost)(:27017)?(/|$)') {
        Fail 'Private sharing requires local MongoDB at 127.0.0.1:27017; remote MongoDB is not allowed.'
    }
    $mongoListeners = @(Get-NetTCPConnection -LocalPort 27017 -State Listen -ErrorAction SilentlyContinue)
    if (@($mongoListeners | Where-Object { $_.LocalAddress -notin @('127.0.0.1', '::1') }).Count) {
        Fail 'MongoDB is exposed on a network interface. Restrict it to localhost before sharing.'
    }

    # Serve, not Funnel: tailnet access only, with HTTPS on the Tailscale name.
    Invoke-Tailscale -Arguments @('serve', '--bg', '--https=443', "http://127.0.0.1:$Port") | Write-Host
    $url = "https://$($dnsName.TrimEnd('.'))/"
    Write-Host "Private Tailscale URL: $url"
    Write-Host 'Only people allowed by your Tailscale access rules can use this URL. They still need a KaiJuan YouLing account.'
    Write-Host 'To stop sharing: tailscale serve --https=443 off'
    Write-Host 'Closing this window does NOT stop the background app or Tailscale Serve.'
    exit 0
} catch {
    [Console]::Error.WriteLine("Private sharing failed: $($_.Exception.Message)")
    exit 1
}





