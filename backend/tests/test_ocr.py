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
        def __call__(self, image):
            assert isinstance(image, Image.Image)
            assert image.mode == "RGB"
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


def test_ocr_does_not_require_temporary_directory(monkeypatch):
    """Windows TEMP can be unavailable; OCR must still use only the supplied image."""
    import tempfile
    def unavailable(*args, **kwargs):
        raise PermissionError("TEMP unavailable")
    monkeypatch.setattr(tempfile, "TemporaryDirectory", unavailable)
    class Engine:
        def __call__(self, image):
            assert isinstance(image, Image.Image)
            return type("Result", (), {"txts": ["原文"], "scores": [.98]})()
    monkeypatch.setattr(ocr, "_engine", Engine())
    assert ocr.recognize_image(image_bytes(), "image/png")["text"] == "原文"


def test_specific_watermark_clauses_and_mixed_body_text():
    assert ocr.filter_watermark('仅供第二届北京市大学生”人工智能+”创新大赛”') == ''
    assert ocr.filter_watermark('纸书智伴赛款参赛使用，请勿外') == ''
    assert ocr.filter_watermark('纸书智伴“赛题参赛使用，请勿外传') == ''
    assert ocr.filter_watermark('积木没有倒。仅供第二届北京市大学生“人工智能+”创新大赛') == '积木没有倒。'
    assert ocr.filter_watermark('小满去大学参赛，请勿外传这封信。') == '小满去大学参赛，请勿外传这封信。'


def test_watermark_is_not_in_text_or_confidence(monkeypatch):
    class Engine:
        def __call__(self, image):
            return type('Result', (), {'txts': ['小满搭积木。', '纸书智伴赛题参赛使用，请勿外传'], 'scores': [.98, .5]})()
    monkeypatch.setattr(ocr, '_engine', Engine())
    result = ocr.recognize_image(image_bytes(), 'image/png')
    assert result['text'] == '小满搭积木。'
    assert result['confidence'] == .98


def test_punctuation_reread_and_left_page_order():
    from types import SimpleNamespace
    image = Image.new('RGB', (400, 200), 'white')
    class Engine:
        def __init__(self):
            self.reset = False
        def __call__(self, image, **kwargs):
            if kwargs:
                return SimpleNamespace(txts=['“我们一起搭城堡，搭高高，还不倒。”'])
            return SimpleNamespace(txts=['三块、', '“我们一起搭城堡，搭高高，还不倒'],
                                   scores=[.99, .98],
                                   boxes=[[[250,10],[300,10],[300,30],[250,30]], [[10,50],[180,50],[180,70],[10,70]]])
        def update_params(self, **kwargs):
            self.reset = kwargs == dict(use_det=True, use_cls=True, use_rec=True)
    engine = Engine()
    try:
        rows = ocr.recognize_layout(engine, image)
        assert [r[0] for r in rows] == ['“我们一起搭城堡，搭高高，还不倒。”', '三块、']
        assert engine.reset
    finally:
        image.close()


def test_reread_does_not_replace_words_based_on_confidence():
    from types import SimpleNamespace
    class Engine:
        def __call__(self, image, **kwargs):
            if kwargs:
                return SimpleNamespace(txts=['小禾拿起一本红色的书。'], scores=[1.0])
            return SimpleNamespace(txts=['小禾拿起一本绿色的书走进教室'], scores=[.7],
                                   boxes=[[[5,5],[180,5],[180,25],[5,25]]])
        def update_params(self, **kwargs):
            pass
    image = Image.new('RGB', (200,100), 'white')
    try:
        assert ocr.recognize_layout(Engine(), image)[0][0] == '小禾拿起一本绿色的书走进教室'
    finally:
        image.close()
