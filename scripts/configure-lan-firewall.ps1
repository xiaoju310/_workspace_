# This helper is elevated only after the user approves UAC from launch.ps1.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateRange(1, 65535)][int]$Port,
    [Parameter(Mandatory)][string]$LocalAddress
)
$ErrorActionPreference = 'Stop'
try {
    $parsed = [Net.IPAddress]::Parse($LocalAddress)
    if ($parsed.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork -or $LocalAddress -in @('0.0.0.0', '127.0.0.1')) { throw 'Invalid LAN address' }
    $ip = Get-NetIPAddress -IPAddress $LocalAddress -AddressFamily IPv4 -ErrorAction Stop
    $profile = Get-NetConnectionProfile -InterfaceIndex $ip.InterfaceIndex -ErrorAction Stop
    if ($profile.NetworkCategory -ne 'Private') { throw 'The selected network is not Private.' }
    $name = "PaperCompanion-LAN-$Port-$LocalAddress"
    $existing = Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue
    if ($existing) { $existing | Remove-NetFirewallRule -ErrorAction Stop }
    New-NetFirewallRule -Name $name -DisplayName "KaiJuan YouLing LAN ($LocalAddress`:$Port)" `
        -Description 'KaiJuan YouLing: trusted private LAN only, local IPv4 subnet, no MongoDB exposure.' `
        -Direction Inbound -Action Allow -Enabled True -Profile Private -Protocol TCP `
        -LocalAddress $LocalAddress -LocalPort $Port -RemoteAddress LocalSubnet4 -ErrorAction Stop | Out-Null
    exit 0
} catch {
    Write-Error "Could not configure LAN firewall: $($_.Exception.Message)"
    exit 1
}
