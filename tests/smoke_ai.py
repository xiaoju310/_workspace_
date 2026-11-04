from pathlib import Path
from tempfile import TemporaryDirectory
from PIL import Image
from app.ai import analyze_page, build_book_graph, draft_story, UnavailableVideoProvider
from app.ai.analyzers import analyze_text
from app.ai.compose import concatenate_segments

with TemporaryDirectory() as folder:
    image_path = Path(folder) / "synthetic.png"
    Image.new("RGB", (100, 60), "white").save(image_path)
    page = analyze_page("demo", 1, image_path)
    assert page.status == "mock" and page.source.page_no == 1
    book = build_book_graph("demo", [page])
    assert book.status == "mock"
    assert draft_story(book).status == "low_confidence"
assert analyze_text("第一章 开始", page_no=1).note.sources[0].page_no == 1
assert analyze_text("test").note.status == "low_confidence"
result = UnavailableVideoProvider().generate(1, None, "demo", Path("out.mp4"))
assert result.status == "failed" and result.error_code == "VIDEO_PROVIDER_UNAVAILABLE"
try:
    concatenate_segments([result], "out.mp4")
except ValueError:
    pass
else:
    raise AssertionError("Invalid video segment accepted")
print("AI smoke checks passed")
