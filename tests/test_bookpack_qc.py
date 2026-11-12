import json
import shutil
import subprocess

import pytest
from PIL import Image

from app.ai.bookpack import validate_bookpack, write_repro_manifest
from app.ai.qc_video import qc_video


def test_bookpack_schema_and_repro_manifest(tmp_path):
    root = tmp_path / "bookpack"
    (root / "pages").mkdir(parents=True)
    page = {"page_no": 1, "text": "小满看月亮。", "scene": "河边夜色", "characters": ["xiaoman"],
            "motion": {"level": "L2", "camera": "push_in_slow", "subject": ["水面波纹"], "duration_s": 6,
                        "prompt": "watercolor children's book illustration", "seed": 1},
            "audio": {"narration": "小满看月亮。", "duration_s": 6},
            "source": {"type": "synthetic", "book_id": "pb001", "page": 1, "license": "self-created"}}
    (root / "pages/01.json").write_text(json.dumps(page, ensure_ascii=False), encoding="utf-8")
    Image.new("RGB", (30, 40), "blue").save(root / "pages/01.png")
    manifest = {"book_id": "pb001", "title": "小满与月亮", "pages": [page]}
    (root / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    assert validate_bookpack(root).book_id == "pb001"
    out = write_repro_manifest(root, tmp_path / "repro/manifest.json", model_manifest={"video": "untested"})
    assert out.is_file()
    assert json.loads(out.read_text(encoding="utf-8"))["files_sha256"]["pages/01.json"]


@pytest.mark.skipif(not shutil.which("ffmpeg") or not shutil.which("ffprobe"), reason="ffmpeg required")
def test_qc_video_reports_duration_and_fps(tmp_path):
    video = tmp_path / "clip.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=160x90:d=1",
                    "-r", "24", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(video)], check=True)
    report = qc_video(video, expected_duration_s=1)
    assert report["status"] == "ok"
    assert report["checks"]["fps_ok"]
