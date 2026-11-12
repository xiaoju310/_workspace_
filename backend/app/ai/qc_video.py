from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Any
import cv2
import numpy as np

from .media import probe_duration_ms


def _probe(path: Path, ffprobe: str = "ffprobe") -> dict[str, Any]:
    proc = subprocess.run([ffprobe, "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)],
                          capture_output=True, text=True, timeout=30, check=True)
    return json.loads(proc.stdout)


def qc_video(video: str | Path, *, expected_duration_s: float | None = None, ffprobe: str = "ffprobe") -> dict[str, Any]:
    path = Path(video)
    report: dict[str, Any] = {"path": str(path), "status": "failed", "checks": {}}
    if not path.is_file():
        report["error_code"] = "FILE_NOT_FOUND"
        return report
    if not shutil.which(ffprobe):
        report["error_code"] = "FFPROBE_UNAVAILABLE"
        return report
    try:
        info = _probe(path, ffprobe)
        streams = info.get("streams", [])
        video_stream = next((s for s in streams if s.get("codec_type") == "video"), None)
        if not video_stream:
            report["error_code"] = "VIDEO_STREAM_MISSING"
            return report
        duration = probe_duration_ms(path, ffprobe=ffprobe) / 1000
        fps_text = video_stream.get("r_frame_rate", "0/1")
        numerator, denominator = (int(v) for v in fps_text.split("/"))
        fps = numerator / denominator if denominator else 0
        report["checks"] = {"duration_s": duration, "fps": fps,
                            "dimensions": [video_stream.get("width"), video_stream.get("height")],
                            "has_audio": any(s.get("codec_type") == "audio" for s in streams),
                            "duration_ok": expected_duration_s is None or abs(duration - expected_duration_s) <= 1,
                            "fps_ok": 20 <= fps <= 30}
        capture = cv2.VideoCapture(str(path))
        sampled: list[np.ndarray] = []
        step = max(1, round(fps / 2))
        frame_index = 0
        while len(sampled) < 120:
            ok, frame = capture.read()
            if not ok:
                break
            if frame_index % step == 0:
                sampled.append(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY))
            frame_index += 1
        capture.release()
        if len(sampled) >= 2:
            brightness_changes = []
            ssim_values = []
            flow_means = []
            for previous, current in zip(sampled, sampled[1:]):
                brightness_changes.append(abs(float(current.mean()) - float(previous.mean())) / 255)
                # Global SSIM, sufficient for detecting gross instability in a sampled clip.
                a, b = previous.astype(np.float64), current.astype(np.float64)
                ma, mb = a.mean(), b.mean()
                va, vb = a.var(), b.var()
                covariance = ((a - ma) * (b - mb)).mean()
                c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
                ssim_values.append(float(((2 * ma * mb + c1) * (2 * covariance + c2)) /
                                         ((ma * ma + mb * mb + c1) * (va + vb + c2))))
                flow = cv2.calcOpticalFlowFarneback(previous, current, None, 0.5, 3, 15, 3, 5, 1.2, 0)
                flow_means.append(float(np.linalg.norm(flow, axis=2).mean()))
            report["checks"].update({
                "sampled_frames": len(sampled), "sampling_hz_approx": fps / step,
                "max_brightness_change_fraction": max(brightness_changes),
                "min_adjacent_ssim": min(ssim_values),
                "mean_optical_flow_px_per_sample": float(np.mean(flow_means)),
                "stability_ok": max(brightness_changes) <= 0.05 and min(ssim_values) >= 0.85,
            })
        else:
            report["checks"]["stability_ok"] = False
        report["status"] = "ok" if report["checks"]["duration_ok"] and report["checks"]["fps_ok"] else "review"
        if not report["checks"]["stability_ok"]:
            report["status"] = "review"
    except (OSError, ValueError, subprocess.SubprocessError, json.JSONDecodeError) as exc:
        report["error_code"] = type(exc).__name__.upper()
        report["error_message"] = str(exc)[:300]
    return report
