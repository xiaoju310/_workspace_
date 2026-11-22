param([string]$ModelId)
# 只保存非敏感的视觉模型标识；复用现有加密密钥，不读取或打印密钥。
$ErrorActionPreference = 'Stop'
if (-not $ModelId) { $ModelId = Read-Host '请输入支持看图的豆包模型 ID 或推理接入点 ID（不是 API Key）' }
$ModelId = $ModelId.Trim()
if ($ModelId -notmatch '^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$') { throw '模型 ID 格式无效，未修改配置。' }
$folder = Join-Path $env:LOCALAPPDATA 'PaperCompanion\Doubao'
New-Item -ItemType Directory -Path $folder -Force | Out-Null
$target = Join-Path $folder 'models.json'
$config = [ordered]@{}
if (Test-Path -LiteralPath $target) {
    $old = Get-Content -LiteralPath $target -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($property in $old.PSObject.Properties) { $config[$property.Name] = $property.Value }
    Copy-Item -LiteralPath $target -Destination ($target + '.vision-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
}
$config['vision_model'] = $ModelId
$temp = $target + '.tmp'
$config | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $temp -Encoding UTF8
Move-Item -LiteralPath $temp -Destination $target -Force
Write-Host '视觉模型标识已保存。不要把 API Key 填到浏览器中。'
Write-Host '无需重启服务，刷新电脑版“故事工坊”即可检查配置状态。配置存在不代表该模型已开通权限。'
Write-Host '本脚本不会发起任何模型请求，也不会消耗额度。'
