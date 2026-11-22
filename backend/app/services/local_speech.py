"""Opt-in on-server Windows speech. No cloud credentials, requests or persistent audio."""
import functools
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import time
import wave
from . import video_runtime

_GATE = threading.BoundedSemaphore(1)
MAX_BYTES = 4 * 1024 * 1024
MAX_SECONDS = 20

class SpeechError(Exception):
    def __init__(self, message, status=503):
        super().__init__(message)
        self.status = status


def _invoke(request, directory, timeout=60):
    executable = Path(os.environ.get('WINDIR', r'C:\Windows')) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
    if os.name != 'nt' or not executable.is_file():
        raise SpeechError('本机没有 Windows 中文语音组件，请使用浏览器识别或打字。')
    request_path = Path(directory) / 'speech-request.json'
    request_path.write_text(json.dumps(request, ensure_ascii=False), encoding='utf-8')
    try:
        result = subprocess.run([str(executable), '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
            str(Path(__file__).with_name('windows_speech.ps1')), '-RequestPath', str(request_path)],
            capture_output=True, text=True, encoding='utf-8-sig', errors='replace', timeout=timeout,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        if result.returncode:
            raise SpeechError('本机中文语音组件未能完成处理，请检查系统语音组件。')
        try:
            return json.loads(result.stdout)
        except (ValueError, TypeError):
            raise SpeechError('本机语音组件返回了无效结果。') from None
    except OSError:
        raise SpeechError('本机语音程序无法启动，请检查 Windows 语音组件。') from None
    except subprocess.TimeoutExpired:
        raise SpeechError('本机语音处理超时，请缩短内容或直接打字。', 504) from None


@functools.lru_cache(maxsize=2)
def _capabilities(bucket):
    try:
        with tempfile.TemporaryDirectory(prefix='paper-speech-check-') as directory:
            data = _invoke({'operation': 'capabilities'}, directory, 15)
        return {'narration_available': bool(data['voices']),
                'asr_available': bool(data['recognizers']) and bool(video_runtime.ffmpeg_path()),
                'voices': data['voices'], 'languages': data['recognizers'], 'provider': 'windows_system_speech',
                'processing': 'server_local_no_cloud', 'max_duration_seconds': MAX_SECONDS}
    except Exception:
        return {'narration_available': False, 'asr_available': False, 'voices': [], 'languages': [],
                'provider': 'windows_system_speech', 'processing': 'server_local_no_cloud',
                'max_duration_seconds': MAX_SECONDS}


def capabilities():
    return dict(_capabilities(int(time.monotonic() // 60)))


def synthesize(text, output, voice):
    if not text.strip() or len(text) > 1200:
        raise SpeechError('配音文字需要为 1–1200 字。', 422)
    if not _GATE.acquire(blocking=False):
        raise SpeechError('本机语音组件正在处理其他请求，请稍后重试。', 429)
    try:
        with tempfile.TemporaryDirectory(prefix='paper-narration-') as directory:
            _invoke({'operation': 'synthesize', 'text': text, 'voice': voice,
                     'output': str(Path(output).resolve())}, directory, 180)
        with wave.open(str(output), 'rb') as audio:
            seconds = audio.getnframes() / audio.getframerate()
        if not 0 < seconds <= 600:
            raise SpeechError('配音时长不符合要求。', 422)
        return seconds
    finally:
        _GATE.release()


def transcribe(raw, language='zh-CN'):
    if language not in {'zh-CN', 'en-US'}:
        raise SpeechError('仅支持中文或英文识别。', 422)
    if not raw or len(raw) > MAX_BYTES:
        raise SpeechError('录音为空或超过 4 MB。', 413)
    is_audio = ((raw.startswith(b'RIFF') and raw[8:12] == b'WAVE') or raw.startswith(b'\x1a\x45\xdf\xa3')
                or raw.startswith(b'OggS') or raw[4:8] == b'ftyp')
    if not is_audio:
        raise SpeechError('文件不是支持的录音格式，请重新录制。', 422)
    caps = capabilities()
    if not caps['asr_available'] or language not in caps.get('languages', ['zh-CN']):
        raise SpeechError('所选语言的本机语音识别未就绪，请使用浏览器识别或打字。')
    if not _GATE.acquire(blocking=False):
        raise SpeechError('本机语音组件忙，请稍后重试。', 429)
    try:
        with tempfile.TemporaryDirectory(prefix='paper-asr-') as directory:
            source, target = Path(directory)/'input.audio', Path(directory)/'normalized.wav'
            source.write_bytes(raw)
            try:
                result = subprocess.run([video_runtime.ffmpeg_path(), '-v', 'error', '-nostdin', '-y',
                    '-protocol_whitelist', 'file,pipe', '-i', str(source), '-vn', '-t', str(MAX_SECONDS+1),
                    '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', str(target)],
                    capture_output=True, timeout=30, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                if result.returncode:
                    raise SpeechError('录音无法解码，请重新录制。', 422)
                with wave.open(str(target), 'rb') as audio:
                    seconds = audio.getnframes() / audio.getframerate()
                if not .1 <= seconds <= MAX_SECONDS:
                    raise SpeechError('录音需要在 0.1–20 秒以内。', 422)
                data = _invoke({'operation':'transcribe', 'input':str(target), 'language':language}, directory)
            except subprocess.TimeoutExpired:
                raise SpeechError('录音解码超时。', 504) from None
        items = [item for item in data['items'] if float(item['confidence']) >= .35]
        return {'text': ' '.join(item['text'] for item in items), 'is_final': True,
                'provider':'windows_system_speech', 'duration_ms': round(seconds*1000),
                'audio_storage':'temporary_deleted', 'processing':'server_local_no_cloud'}
    finally:
        _GATE.release()
