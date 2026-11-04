from app.ai import analyze_page, build_book_graph
from app.ai.analyzers import analyze_text, classify_book
from app.ai.models import SourceRef
from app.ai.video import UnavailableVideoProvider
from app.ai.compose import concatenate_segments
from app.ai.cli import main
from app.ai.media import build_timeline, extract_frame, probe_duration_ms
from pathlib import Path
import pytest
from pydantic import ValidationError
from PIL import Image


@pytest.fixture
def synthetic_image(tmp_path):
    path = tmp_path / "synthetic.png"
    Image.new("RGB", (100, 60), "white").save(path)
    return path

def test_mock_page_is_explicit():
    page = analyze_page("demo", 1, "missing.png")
    assert page.status == "failed"
    assert page.error_code == "FILENOTFOUNDERROR"
    assert page.source.page_no == 1

def test_book_graph_keeps_sources(synthetic_image):
    page = analyze_page("demo", 2, synthetic_image)
    graph = build_book_graph("demo", [page])
    assert graph.pages[0].source.location == "page:2"
    assert graph.model_manifest["ocr"].startswith("mock-")


def test_partial_mock_never_claims_real_result(synthetic_image):
    class RealOCR:
        version = "synthetic-ocr/1"
        def recognize(self, image_path, page_no):
            return "小熊", [], 0.9

    page = analyze_page("demo", 1, synthetic_image, ocr=RealOCR())
    assert page.status == "mock"
    assert page.ocr_version == "synthetic-ocr/1"
    assert page.vision_version == "mock-vlm/1.0"


def test_failed_provider_preserves_failure(synthetic_image):
    class BrokenOCR:
        version = "broken/1"
        def recognize(self, image_path, page_no):
            raise RuntimeError("unavailable")

    page = analyze_page("demo", 1, synthetic_image, ocr=BrokenOCR())
    assert page.status == "failed"
    assert page.error_code == "RUNTIMEERROR"
    assert build_book_graph("demo", [page]).status == "failed"


def test_book_graph_rejects_mixed_books_and_duplicate_pages(synthetic_image):
    first = analyze_page("one", 1, synthetic_image)
    second = analyze_page("two", 2, synthetic_image)
    with pytest.raises(ValueError):
        build_book_graph("one", [first, second])
    with pytest.raises(ValueError):
        build_book_graph("one", [first, first])


@pytest.mark.parametrize("text,kind", [
    ("绘本：小熊", "picture_book"),
    ("第一章 开始", "novel"),
    ("学习目标：理解分数", "textbook"),
    ("科学实验：为什么下雨", "popular_science"),
])
def test_four_minimal_book_types(text, kind):
    assert classify_book(text).book_type == kind
    result = analyze_text(text, page_no=2)
    assert result.book_type == kind
    assert result.note.review_required
    assert result.note.sources[0].page_no == 2


def test_unknown_source_keeps_note_low_confidence():
    result = analyze_text("没有来源")
    assert result.note.status == "low_confidence"
    assert result.note.sources == []
    with pytest.raises(ValidationError):
        SourceRef()


def test_unavailable_video_cannot_be_composed(tmp_path):
    result = UnavailableVideoProvider().generate(1, None, "小熊走路", tmp_path / "page.mp4")
    assert result.status == "failed"
    with pytest.raises(ValueError):
        concatenate_segments([result], tmp_path / "book.mp4")


def test_reading_cli_writes_reviewable_json(tmp_path):
    source = tmp_path / "excerpt.txt"
    output = tmp_path / "analysis.json"
    source.write_text("第一章 开始\n人物：小熊\n事件：走进森林", encoding="utf-8")
    assert main(["reading", "--input", str(source), "--page-no", "1", "--out", str(output)]) == 0
    payload = __import__("json").loads(output.read_text(encoding="utf-8"))
    assert payload["book_type"] == "novel"
    assert payload["characters"] == ["小熊"]
    assert payload["note"]["sources"][0]["page_no"] == 1
    assert payload["note"]["review_required"]


def test_ffmpeg_timeline_and_frame_extraction(tmp_path):
    import shutil
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        pytest.skip("ffmpeg and ffprobe are required")
    segment = tmp_path / "synthetic.mp4"
    frame = tmp_path / "frame.png"
    import subprocess
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i",
                    "color=c=blue:s=160x90:d=0.5", "-pix_fmt", "yuv420p",
                    str(segment)], check=True)
    assert probe_duration_ms(segment) > 0
    timeline = build_timeline([{"page_no": 1, "path": segment,
                                "generation_mode": "synthetic_test",
                                "model_version": "ffmpeg-test/1"}])
    assert timeline[0]["start_ms"] == 0
    assert timeline[0]["end_ms"] > timeline[0]["start_ms"]
    assert extract_frame(segment, 0, frame).is_file()


def test_concatenate_segments_preserves_audio(tmp_path):
    import json
    import shutil
    import subprocess
    from app.ai.video import VideoResult

    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        pytest.skip("ffmpeg and ffprobe are required")
    segments = []
    for page_no in (1, 2):
        path = tmp_path / f"page-{page_no}.mp4"
        subprocess.run([
            "ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i",
            "color=c=blue:s=160x90:d=0.5", "-f", "lavfi", "-i",
            "sine=frequency=440:duration=0.5", "-shortest", "-c:v", "libx264",
            "-pix_fmt", "yuv420p", "-c:a", "aac", str(path),
        ], check=True)
        segments.append(VideoResult(page_no=page_no, path=str(path), generation_mode="i2v",
                                    model_version="synthetic-test/1", prompt_hash="test", status="ok"))
    output = tmp_path / "book.mp4"
    result = concatenate_segments(segments, output)
    assert result["status"] == "ok"
    probe = subprocess.run([
        "ffprobe", "-v", "error", "-show_entries", "stream=codec_type",
        "-of", "json", str(output),
    ], check=True, capture_output=True, text=True)
    assert {stream["codec_type"] for stream in json.loads(probe.stdout)["streams"]} == {"video", "audio"}
