import json
from unittest.mock import patch

import cv2
import numpy as np

from app.ai.qc_video import qc_video


class FakeCapture:
    def __init__(self, opened=True, frames=30):
        self.opened = opened
        self.frames = frames
        self.released = False

    def isOpened(self):
        return self.opened

    def get(self, property_id):
        return {
            cv2.CAP_PROP_FPS: 24,
            cv2.CAP_PROP_FRAME_COUNT: 120,
            cv2.CAP_PROP_FRAME_WIDTH: 160,
            cv2.CAP_PROP_FRAME_HEIGHT: 90,
        }[property_id]

    def read(self):
        if self.frames <= 0:
            return False, None
        self.frames -= 1
        return True, np.zeros((90, 160, 3), dtype=np.uint8)

    def release(self):
        self.released = True


def test_missing_ffprobe_is_partial_review_not_pass(tmp_path):
    video = tmp_path / "clip.mp4"
    video.write_bytes(b"test placeholder")
    capture = FakeCapture()
    with patch("app.ai.qc_video.shutil.which", return_value=None), \
         patch("app.ai.qc_video.cv2.VideoCapture", return_value=capture):
        report = qc_video(video, expected_duration_s=5)
    assert report["status"] == "review"
    assert report["error_code"] == "FFPROBE_UNAVAILABLE"
    assert report["checks"]["metadata_source"] == "opencv_estimate"
    assert report["checks"]["duration_ok"] is True
    assert report["checks"]["has_audio"] is None
    assert report["checks"]["sampled_frames"] >= 2
    assert capture.released


def test_missing_ffprobe_and_undecodable_video_fails(tmp_path):
    video = tmp_path / "bad.mp4"
    video.write_bytes(b"invalid")
    capture = FakeCapture(opened=False)
    with patch("app.ai.qc_video.shutil.which", return_value=None), \
         patch("app.ai.qc_video.cv2.VideoCapture", return_value=capture):
        report = qc_video(video)
    assert report["status"] == "failed"
    assert report["error_code"] == "VIDEO_DECODE_FAILED"
    assert capture.released


def test_missing_file_fails_before_opening_video(tmp_path):
    report = qc_video(tmp_path / "missing.mp4")
    assert report["status"] == "failed"
    assert report["error_code"] == "FILE_NOT_FOUND"

