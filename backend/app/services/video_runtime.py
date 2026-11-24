"""视频工具探测与实测时长；不把请求的 5 秒当成真实结果。"""
import os
import shutil
import subprocess
from pathlib import Path


def ffmpeg_path() -> str | None:
    explicit = os.getenv('FFMPEG_PATH', '').strip()
    if explicit:
        return explicit if Path(explicit).is_file() else None
    found = shutil.which('ffmpeg')
    if found:
        return found
    candidate = Path(os.getenv('LOCALAPPDATA', '')) / 'oopz/ffmpeg.exe'
    return str(candidate) if os.name == 'nt' and candidate.is_file() else None


def duration_ms(path: Path) -> int:
    ffmpeg = ffmpeg_path()
    if not ffmpeg:
        raise ValueError('ffmpeg unavailable')
    # 实际解码全部视频帧，既测量时长，也拒绝只有 MP4 文件头的坏文件。
    from fractions import Fraction
    result = subprocess.run([ffmpeg, '-v', 'error', '-xerror', '-nostdin', '-i', str(path),
        '-map', '0:v:0', '-an', '-fps_mode', 'passthrough', '-c:v', 'rawvideo', '-f', 'framecrc', 'pipe:1'],
        capture_output=True, timeout=120, text=True, encoding='utf-8', errors='replace',
        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    # framecrc 的时间戳加上最后一帧持续时间，避免漏掉最后一帧而逐页累积偏移。
    timebase = None
    starts, ends = [], []
    for line in result.stdout.splitlines():
        if line.startswith('#tb 0:'):
            timebase = Fraction(line.split(':', 1)[1].strip())
        elif line and not line.startswith('#'):
            fields = line.split(',')
            if len(fields) >= 4:
                pts, duration = int(fields[2]), int(fields[3])
                starts.append(pts)
                ends.append(pts + duration)
    measured = round(float((max(ends) - min(starts)) * timebase) * 1000) if timebase and starts else 0
    if result.returncode or not 100 <= measured <= 600_000:
        raise ValueError('invalid video duration or decode')
    return measured


def concatenate(paths: list[Path], output: Path, narration: list[Path] | None = None) -> list[int]:
    from ..ai.compose import concatenate_segments
    from ..ai.video import VideoResult
    ffmpeg = ffmpeg_path()
    if not ffmpeg or not paths:
        raise ValueError('ffmpeg unavailable')
    if narration is not None and len(narration) != len(paths):
        raise ValueError('narration count mismatch')
    normalized = []
    durations = []
    targets = []
    try:
        # 不同页云端片段的大小/帧率可能不同，先统一画幅，保留长宽比且不拉伸角色。
        for index, path in enumerate(paths):
            target = output.parent / f'{output.stem}-normalized-{index}.mp4'
            targets.append(target)
            command = [ffmpeg, '-v', 'error', '-nostdin', '-y', '-i', str(path)]
            filters = 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24'
            if narration is None:
                command += ['-map', '0:v:0', '-an', '-vf', filters]
            else:
                import wave
                import math
                with wave.open(str(narration[index]), 'rb') as audio:
                    speech_seconds = audio.getnframes() / audio.getframerate()
                # Keep every spoken word, with a short pause. Quantize to video frames for exact segments.
                clip_seconds = duration_ms(path)/1000
                seconds = math.ceil(max(clip_seconds, speech_seconds+.25)*24)/24
                # Stretch the complete motion over narration, rather than freezing the final frame.
                motion_filters = ('setpts=' + str(seconds/clip_seconds) + '*(PTS-STARTPTS),' + filters
                    + ',tpad=stop_mode=clone:stop_duration=0.05')
                command += ['-i', str(narration[index]), '-map', '0:v:0', '-map', '1:a:0',
                    '-vf', motion_filters,
                    '-af', 'apad,atrim=duration='+str(seconds), '-t', str(seconds),
                    '-c:a', 'aac', '-ar', '48000', '-ac', '2']
            command += ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', str(target)]
            result = subprocess.run(command, capture_output=True, timeout=180,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            if result.returncode:
                raise ValueError('normalization failed')
            durations.append(duration_ms(target))
            normalized.append(VideoResult(page_no=index + 1, path=str(target), generation_mode='i2v',
                model_version='normalized', prompt_hash='', status='ok'))
        result = concatenate_segments(normalized, output, ffmpeg=ffmpeg)
        if result['status'] != 'ok' or abs(duration_ms(output) - sum(durations)) > 150:
            raise ValueError('composition failed')
        return durations
    finally:
        for target in targets:
            target.unlink(missing_ok=True)


def extract_frame(path: Path, at_ms: int) -> bytes:
    """Decode an actual server-owned video frame, never trust browser screenshot provenance."""
    executable = ffmpeg_path()
    if not executable:
        raise ValueError('ffmpeg unavailable')
    result = subprocess.run([executable, '-v', 'error', '-nostdin', '-ss', str(at_ms/1000),
        '-i', str(path), '-frames:v', '1', '-vf', 'scale=1280:1280:force_original_aspect_ratio=decrease',
        '-f', 'image2pipe', '-c:v', 'mjpeg', 'pipe:1'], capture_output=True, timeout=30,
        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode or not result.stdout or len(result.stdout) > 4_000_000:
        raise ValueError('frame unavailable')
    return result.stdout
