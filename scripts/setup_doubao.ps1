# Save the Ark credential with Windows DPAPI for the current user only.
# Run this script locally; never paste a credential into chat or command history.
$ErrorActionPreference = 'Stop'
$folder = Join-Path $env:LOCALAPPDATA 'PaperCompanion\Doubao'
New-Item -ItemType Directory -Path $folder -Force | Out-Null
$keyPath = Join-Path $folder 'ark-key.dpapi'
$configPath = Join-Path $folder 'models.json'

$key = Read-Host 'Paste your Volcengine Ark API key (input hidden)' -AsSecureString
if ($key.Length -eq 0) { throw 'An Ark API key is required.' }
try {
    ConvertFrom-SecureString -SecureString $key | Set-Content -LiteralPath $keyPath -Encoding utf8
} finally {
    $key.Dispose()
}
$imageModel = Read-Host 'Seedream image model ID from Ark console'
$videoModel = Read-Host 'Seedance video model ID from Ark console'
if ([string]::IsNullOrWhiteSpace($imageModel) -or [string]::IsNullOrWhiteSpace($videoModel)) {
    throw 'Both model IDs are required. Run this setup again when you have them.'
}
@{ image_model = $imageModel.Trim(); video_model = $videoModel.Trim() } |
    ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding utf8
Write-Host 'Local Doubao configuration saved for this Windows user. The credential was not printed.'
Write-Host "Config folder: $folder"
