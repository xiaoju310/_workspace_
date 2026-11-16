"""Automatic OCR returns editable draft; it never confirms book pages."""
from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image

from app.main import app
from app.services import ocr


def image_bytes():
    out = BytesIO()
    Image.new("RGB", (64, 64), "white").save(out, format="PNG")
    return out.getvalue()


def test_ocr_authentication_and_validation(monkeypatch):
    monkeypatch.setenv("AUTH_BACKEND", "legacy")
    monkeypatch.setenv("ALLOW_LEGACY_TOKENS", "1")
    monkeypatch.setenv("APP_USER_TOKENS", '{"owner-local":"test-secret"}')
    with TestClient(app) as client:
        url = "/api/ocr/recognize"
        assert client.post(url, content=image_bytes(), headers={"content-type":"image/png"}).status_code == 401
        auth = {"Authorization":"Bearer test-secret", "content-type":"image/png"}
        assert client.post(url, content=b"garbage", headers=auth).status_code == 415
        assert client.post(url, content=b"x", headers={**auth,"content-type":"text/plain"}).status_code == 415
        assert client.post(url, content=b"x" * (20*1024*1024+1), headers=auth).status_code == 413


def test_ocr_returns_draft_without_saving(monkeypatch):
    monkeypatch.setenv("AUTH_BACKEND", "legacy")
    monkeypatch.setenv("ALLOW_LEGACY_TOKENS", "1")
    monkeypatch.setenv("APP_USER_TOKENS", '{"owner-local":"test-secret"}')
    class Engine:
        def __call__(self, path):
            assert path.endswith(".png")
            return type("Result", (), {"txts": ["乌龟和兔子"], "scores": [0.97]})()
    monkeypatch.setattr(ocr, "_engine", Engine())
    with TestClient(app) as client:
        result = client.post("/api/ocr/recognize", content=image_bytes(), headers={"Authorization":"Bearer test-secret", "content-type":"image/png"})
        assert result.status_code == 200
        assert result.json() == {"text":"乌龟和兔子", "confidence":0.97, "provider":"rapidocr_local", "source":"automatic_ocr_unreviewed"}


def test_ocr_preserves_suspect_characters(monkeypatch):
    """UI hints must not cause the service to delete possible original text."""
    class Engine:
        def __call__(self, path):
            return type("Result", (), {"txts": ["正文", "●", "à", "II", "一", "3"], "scores": [.99] * 6})()
    monkeypatch.setattr(ocr, "_engine", Engine())
    result = ocr.recognize_image(image_bytes(), "image/png")
    assert result["text"] == "正文\n●\nà\nII\n一\n3"
    assert result["source"] == "automatic_ocr_unreviewed"


def test_ocr_empty_result_is_not_fabricated(monkeypatch):
    class Engine:
        def __call__(self, path):
            return type("Result", (), {"txts": None, "scores": None})()
    monkeypatch.setattr(ocr, "_engine", Engine())
    result = ocr.recognize_image(image_bytes(), "image/png")
    assert result["text"] == ""
    assert result["confidence"] == 0.0
