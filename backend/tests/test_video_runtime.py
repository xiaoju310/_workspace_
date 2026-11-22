"""视频时长验证的命令兼容性；真实解码/拼接另见 reading_workflow 测试。"""
import subprocess
from pathlib import Path

import pytest

from app.services import video_runtime


FRAMECRC = "#tb 0: 1/24\n0, 0, 0, 1, 100, 0x00000000\n0, 1, 1, 1, 100, 0x00000000\n0, 2, 2, 1, 100, 0x00000000\n"


def test_duration_uses_passthrough_and_counts_last_frame(monkeypatch):
    monkeypatch.setattr(video_runtime, "ffmpeg_path", lambda: "ffmpeg-test")

    def run(command, **kwargs):
        assert "-vsync" not in command
        assert command[command.index("-fps_mode") + 1] == "passthrough"
        assert "-xerror" in command
        assert command[command.index("-f") + 1] == "framecrc"
        return subprocess.CompletedProcess(command, 0, FRAMECRC, "")

    monkeypatch.setattr(video_runtime.subprocess, "run", run)
    assert video_runtime.duration_ms(Path("synthetic.mp4")) == 125


@pytest.mark.parametrize(("returncode", "stdout"), [(1, FRAMECRC), (0, "")])
def test_duration_still_rejects_decode_errors_and_empty_video(monkeypatch, returncode, stdout):
    monkeypatch.setattr(video_runtime, "ffmpeg_path", lambda: "ffmpeg-test")
    monkeypatch.setattr(video_runtime.subprocess, "run", lambda command, **kwargs:
                        subprocess.CompletedProcess(command, returncode, stdout, "decode failed"))
    with pytest.raises(ValueError, match="invalid video duration or decode"):
        video_runtime.duration_ms(Path("invalid.mp4"))
