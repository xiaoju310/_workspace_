# Decrypt the user-local Ark credential for this process, then launch one paid trial.
# The key is never passed as a command-line argument or written into the repository.
param(
    [string]$ImagePrompt,
    [string]$VideoPrompt,
    [Parameter(Mandatory = $true)][string]$Out,
    [int]$PageNo = 1,
    [int]$Duration = 5,
    [switch]$ImageOnly,
    [string]$ExistingImage
)
$ErrorActionPreference = 'Stop'
if ($ImageOnly -and $ExistingImage) { throw 'Choose either -ImageOnly or -ExistingImage.' }
if ($ImageOnly) {
    if ([IO.Path]::GetExtension($Out) -ne '.png') { throw 'Image-only output must end in .png.' }
} else {
    if ([string]::IsNullOrWhiteSpace($VideoPrompt)) { throw 'VideoPrompt is required unless -ImageOnly is specified.' }
    if ($ExistingImage -and -not (Test-Path -LiteralPath $ExistingImage -PathType Leaf)) { throw 'ExistingImage does not exist.' }
    if ([IO.Path]::GetExtension($Out) -ne '.mp4') { throw 'Video output must end in .mp4.' }
}
$folder = Join-Path $env:LOCALAPPDATA 'PaperCompanion\Doubao'
$keyPath = Join-Path $folder 'ark-key.dpapi'
$configPath = Join-Path $folder 'models.json'
if (-not (Test-Path -LiteralPath $keyPath) -or -not (Test-Path -LiteralPath $configPath)) {
    throw 'Doubao is not configured. Run scripts/setup_doubao.ps1 first.'
}
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
if ((-not $ExistingImage -and -not $config.image_model) -or (-not $ImageOnly -and -not $config.video_model)) { throw 'Required model IDs are missing. Run setup again.' }
$encryptedKey = Get-Content -LiteralPath $keyPath -TotalCount 1
$secure = ConvertTo-SecureString -String $encryptedKey
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $env:ARK_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    $secure.Dispose()
}
try {
    $env:DOUBAO_IMAGE_MODEL = $config.image_model
    $env:DOUBAO_VIDEO_MODEL = $config.video_model
    $scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
    $projectRoot = Split-Path -Parent $scriptRoot
    Push-Location $projectRoot
    try {
        if ($ImageOnly) {
            python -m app.ai.cli doubao-image --page-no $PageNo --image-prompt $ImagePrompt --out $Out
        } elseif ($ExistingImage) {
            python -m app.ai.cli doubao-video --page-no $PageNo --image $ExistingImage `
                --video-prompt $VideoPrompt --duration $Duration --out $Out
        } else {
            python -m app.ai.cli doubao-media --page-no $PageNo --image-prompt $ImagePrompt `
                --video-prompt $VideoPrompt --duration $Duration --out $Out
        }
        if ($LASTEXITCODE -ne 0) { throw "Doubao generation failed (exit code $LASTEXITCODE); check the generation JSON." }
    } finally {
        Pop-Location
    }
} finally {
    Remove-Item Env:ARK_API_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:DOUBAO_IMAGE_MODEL -ErrorAction SilentlyContinue
    Remove-Item Env:DOUBAO_VIDEO_MODEL -ErrorAction SilentlyContinue
}
