"""Natural female narration. Online text transfer is disclosed before generation.

Windows speech is used only for immutable legacy tasks, never as a silent fallback.
"""
import importlib.util
import json
import subprocess
import sys
import tempfile
import wave
from pathlib import Path
from . import local_speech, video_runtime

SpeechError = local_speech.SpeechError
VOICE = 'zh-CN-XiaoxiaoNeural'
PROVIDER = 'edge_neural'
RATE = '-12%'
PITCH = '-2Hz'


def capabilities():
    ready = importlib.util.find_spec('edge_tts') is not None and bool(video_runtime.ffmpeg_path())
    return {'narration_available': ready, 'voices': [VOICE] if ready else [],
            'narration_provider': PROVIDER, 'narration_processing': 'online_text_only',
            'narration_voice_label': '晓晓 · 柔和中文女声',
            'narration_rate': RATE, 'narration_pitch': PITCH}


def synthesize(text, output, voice=VOICE, provider=PROVIDER):
    if provider == 'windows_system_speech':
        return local_speech.synthesize(text, output, voice)
    if provider != PROVIDER or voice != VOICE:
        raise SpeechError('配音配置不支持；不会自动改用机械音。')
    if not text.strip() or len(text) > 1200:
        raise SpeechError('配音文字需要为 1–1200 字。', 422)
    if not capabilities()['narration_available']:
        raise SpeechError('自然女声组件未就绪，请安装 edge-tts 并检查 FFmpeg。')
    output = Path(output)
    try:
        with tempfile.TemporaryDirectory(prefix='paper-neural-') as directory:
            source = Path(directory) / 'narration.txt'
            media = Path(directory) / 'narration.mp3'
            # Keep the reviewed narration intact, including its punctuation and paragraphs.
            source.write_text(text.strip(), encoding='utf-8')
            # The desktop launcher uses an isolated Python with injected project packages.
            # Forward those paths explicitly instead of relying on global/user packages.
            bootstrap = 'import sys,json,runpy;sys.path[:0]=json.loads(sys.argv.pop(1));runpy.run_module("edge_tts",run_name="__main__")'
            result = subprocess.run([sys.executable, '-I', '-S', '-c', bootstrap,
                json.dumps([str(Path(p).resolve()) for p in sys.path if p and Path(p).is_dir()]), '--voice', voice,
                '--rate='+RATE, '--pitch='+PITCH, '--file', str(source), '--write-media', str(media)],
                capture_output=True, timeout=180, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            if result.returncode or not media.is_file() or not media.stat().st_size:
                raise SpeechError('联网女声合成未完成，请检查网络后恢复；不会改用机械音。')
            result = subprocess.run([video_runtime.ffmpeg_path(), '-v', 'error', '-nostdin', '-y',
                '-i', str(media), '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', str(output)],
                capture_output=True, timeout=90, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            if result.returncode:
                raise SpeechError('女声音频转换未完成。')
        with wave.open(str(output), 'rb') as audio:
            seconds = audio.getnframes() / audio.getframerate()
        if not 0 < seconds <= 600:
            raise SpeechError('配音时长不符合要求。', 422)
        return seconds
    except SpeechError:
        output.unlink(missing_ok=True)
        raise
    except (OSError, subprocess.TimeoutExpired, wave.Error, EOFError):
        output.unlink(missing_ok=True)
        raise SpeechError('联网女声合成中断，请检查网络后恢复；不会改用机械音。') from None
