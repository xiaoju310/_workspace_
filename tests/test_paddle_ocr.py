from pathlib import Path

import pytest
from PIL import Image, ImageDraw


@pytest.mark.integration
def test_paddle_ocr_provider_on_synthetic_image(tmp_path: Path):
    paddle = pytest.importorskip("paddle")
    path = tmp_path / "ocr.png"
    image = Image.new("RGB", (640, 200), "white")
    ImageDraw.Draw(image).text((40, 80), "SYNTHETIC PAGE", fill="black")
    image.save(path)
    from app.ai.providers import PaddleOCRProvider

    provider = PaddleOCRProvider()
    text, boxes, confidence = provider.recognize(path, 1)
    assert "SYNTHETIC" in text.upper()
    assert boxes and boxes[0]["page_no"] == 1
    assert confidence > 0.5
    assert provider.last_elapsed_s is not None
