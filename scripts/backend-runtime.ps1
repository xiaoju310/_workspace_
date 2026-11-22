# Shared per-user runtime selection. Never change global PATH, policy or credentials.
function Get-PaperBackendRuntime([string]$Repo, [string]$VenvPython, [string]$BindAddress, [int]$Port) {
    $configPath = Join-Path $env:LOCALAPPDATA 'PaperCompanion\runtime.json'
    $config = $null
    if (Test-Path -LiteralPath $configPath) {
        $config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    }
    if ($config.ffmpeg_path -and -not $env:FFMPEG_PATH) {
        if (-not (Test-Path -LiteralPath $config.ffmpeg_path -PathType Leaf)) { throw 'Configured FFmpeg was moved or removed. Update runtime.json.' }
        $env:FFMPEG_PATH = [string]$config.ffmpeg_path
    }
    if ($config.python_executable) {
        $executable = [string]$config.python_executable
        if (-not [IO.Path]::IsPathRooted($executable) -or -not (Test-Path -LiteralPath $executable -PathType Leaf)) {
            throw 'Configured Python was moved or removed. Update runtime.json.'
        }
        $entry = Join-Path $Repo 'scripts\run-backend.py'
        # Isolate global/user packages; the entry point loads this project's dependencies.
        return @{Executable=$executable;Arguments=@('-I','-S',('"' + $entry + '"'),'--host',$BindAddress,'--port',"$Port")}
    }
    return @{Executable=$VenvPython;Arguments=@('-m','uvicorn','app.main:app','--host',$BindAddress,'--port',"$Port")}
}
