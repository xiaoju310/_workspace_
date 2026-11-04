from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any


def probe_duration_ms(path: str | Path, *, ffprobe: str = "ffprobe", timeout_s: int = 15) -> int:
    video = Path(path)
    if not video.is_file():
        raise FileNotFoundError(video)
    proc = subprocess.run(
        [ffprobe, "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(video)],
        capture_output=True, text=True, timeout=timeout_s, check=True,
    )
    duration_ms = round(float(proc.stdout.strip()) * 1000)
    if duration_ms <= 0:
        raise ValueError("video duration must be positive")
    return duration_ms


def build_timeline(segments: list[dict[str, Any]], *, ffprobe: str = "ffprobe") -> list[dict[str, Any]]:
    timeline = []
    start = 0
    for item in segments:
        duration = probe_duration_ms(item["path"], ffprobe=ffprobe)
        timeline.append({
            "page_no": item["page_no"], "start_ms": start,
            "end_ms": start + duration, "video_path": str(item["path"]),
            "generation_mode": item["generation_mode"],
            "model_version": item["model_version"],
        })
        start += duration
    return timeline


def extract_frame(path: str | Path, at_ms: int, output: str | Path, *,
                  ffmpeg: str = "ffmpeg", timeout_s: int = 30) -> Path:
    if at_ms < 0:
        raise ValueError("at_ms must be nonnegative")
    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError(path)
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([ffmpeg, "-v", "error", "-y", "-ss", f"{at_ms / 1000:.3f}",
                    "-i", str(path), "-frames:v", "1", str(output)],
                   capture_output=True, text=True, timeout=timeout_s, check=True)
    if not output.is_file() or output.stat().st_size == 0:
        raise RuntimeError("FFmpeg did not write a frame")
    return output
