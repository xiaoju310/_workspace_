param([Parameter(Mandatory=$true)][string]$RequestPath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Speech
$r = Get-Content -LiteralPath $RequestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($r.operation -eq 'capabilities') {
    $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
    try {
        $voices = @($s.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -match '^(zh-CN|en-US)$' } | ForEach-Object { $_.VoiceInfo.Name })
        $usable = @()
        foreach ($voice in $voices) {
            $probe = Join-Path (Split-Path -Parent $RequestPath) 'voice-probe.wav'
            try {
                $s.SelectVoice($voice)
                $s.SetOutputToWaveFile($probe)
                $s.Speak([string][char]0x597d)
                $s.SetOutputToNull()
                $usable += $voice
            } catch { } finally { if ([System.IO.File]::Exists($probe)) { [System.IO.File]::Delete($probe) } }
        }
        $voices = @($usable)
        $recognizers = @()
        $installed = @([System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | ForEach-Object { $_.Culture.Name } | Select-Object -Unique)
        foreach ($language in @('zh-CN','en-US')) {
            if ($language -notin $installed) { continue }
            $recognition = $null
            $silence = $null
            try {
                $recognition = New-Object System.Speech.Recognition.SpeechRecognitionEngine([System.Globalization.CultureInfo]::GetCultureInfo($language))
                $recognition.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
                $silence = Join-Path (Split-Path -Parent $RequestPath) 'recognizer-probe.wav'
                $stream = [System.IO.File]::Create($silence)
                $writer = New-Object System.IO.BinaryWriter($stream)
                try {
                    $writer.Write([System.Text.Encoding]::ASCII.GetBytes('RIFF'))
                    $writer.Write([int]3236)
                    $writer.Write([System.Text.Encoding]::ASCII.GetBytes('WAVEfmt '))
                    $writer.Write([int]16); $writer.Write([int16]1); $writer.Write([int16]1)
                    $writer.Write([int]16000); $writer.Write([int]32000)
                    $writer.Write([int16]2); $writer.Write([int16]16)
                    $writer.Write([System.Text.Encoding]::ASCII.GetBytes('data'))
                    $writer.Write([int]3200); $writer.Write((New-Object byte[] 3200))
                } finally { $writer.Dispose(); $stream.Dispose() }
                $recognition.SetInputToWaveFile($silence)
                $null = $recognition.Recognize([TimeSpan]::FromSeconds(1))
                $recognizers += $language
            } catch { } finally { if ($null -ne $recognition) { $recognition.Dispose() }; if ($silence -and [System.IO.File]::Exists($silence)) { [System.IO.File]::Delete($silence) } }
        }
        @{voices=$voices;recognizers=$recognizers} | ConvertTo-Json -Compress
    } finally { $s.Dispose() }
} elseif ($r.operation -eq 'synthesize') {
    $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
    try {
        $s.SelectVoice($r.voice)
        $s.Rate = 0
        $s.SetOutputToWaveFile($r.output)
        $s.Speak([string]$r.text)
        $s.SetOutputToNull()
        @{ok=$true} | ConvertTo-Json -Compress
    } finally { $s.Dispose() }
} elseif ($r.operation -eq 'transcribe') {
    $language = if ($r.language) { [string]$r.language } else { 'zh-CN' }
    $s = New-Object System.Speech.Recognition.SpeechRecognitionEngine([System.Globalization.CultureInfo]::GetCultureInfo($language))
    try {
        $s.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
        $s.SetInputToWaveFile($r.input)
        $items = @()
        while ($true) {
            try { $result = $s.Recognize([TimeSpan]::FromSeconds(22)) }
            catch {
                $cause = $_.Exception
                while ($null -ne $cause.InnerException) { $cause = $cause.InnerException }
                if ($cause -is [System.InvalidOperationException] -and $s.AudioState -eq [System.Speech.Recognition.AudioState]::Stopped) { break }
                throw
            }
            if ($null -eq $result) { break }
            $items += @{text=$result.Text;confidence=$result.Confidence}
            if ($s.AudioState -eq [System.Speech.Recognition.AudioState]::Stopped) { break }
        }
        @{items=$items} | ConvertTo-Json -Compress -Depth 4
    } finally { $s.Dispose() }
} else { throw 'Unsupported operation' }
