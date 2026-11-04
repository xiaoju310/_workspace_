from __future__ import annotations
import json
import subprocess
import tempfile
from pathlib import Path
from .video import VideoResult

def concatenate_segments(segments: list[VideoResult], output: str | Path, *, ffmpeg: str = "ffmpeg", timeout_s: int = 600) -> dict:
    if not segments or any(s.status != "ok" or s.generation_mode not in {"i2v", "t2v"} or not s.path for s in segments):
        raise ValueError("Segments require an i2v/t2v provider result with status ok and a path")
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    for segment in segments:
        if not Path(segment.path).is_file():
            raise FileNotFoundError(segment.path)
    # The temporary manifest stays out of the source tree and is removed automatically.
    with tempfile.TemporaryDirectory() as temp_dir:
        manifest = Path(temp_dir) / "segments.txt"
        manifest.write_text("".join("file '" + str(Path(s.path).resolve()).replace("'", "'\\''") + "'\n" for s in segments), encoding="utf-8")
        try:
            proc = subprocess.run([ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", str(manifest),
                                   "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", str(output)],
                                  capture_output=True, text=True, timeout=timeout_s)
            result = {"status": "ok" if proc.returncode == 0 else "failed", "output": str(output),
                      "segment_count": len(segments), "error_code": None if proc.returncode == 0 else "FFMPEG_FAILED",
                      "stderr_tail": proc.stderr[-2000:]}
        except subprocess.TimeoutExpired:
            result = {"status": "failed", "output": str(output), "segment_count": len(segments),
                      "error_code": "FFMPEG_TIMEOUT", "stderr_tail": ""}
        except OSError as exc:
            result = {"status": "failed", "output": str(output), "segment_count": len(segments),
                      "error_code": type(exc).__name__.upper(), "stderr_tail": ""}
        output.with_suffix(".generation.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        return result
