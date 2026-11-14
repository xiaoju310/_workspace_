import base64
import io
import json
from pathlib import Path

from PIL import Image

from app.ai.video_doubao import DoubaoProvider


class Response:
    status_code = 200
    headers = {"Content-Length": "8"}

    def __init__(self, payload=None):
        self.payload = payload

    def json(self):
        return self.payload

    def iter_content(self, chunk_size=65536):
        yield b"fake-mp4"

    def close(self):
        pass


class Session:
    def __init__(self, image):
        self.image = image
        self.calls = []

    def request(self, method, url, *, headers, json, timeout, allow_redirects):
        self.calls.append((method, url, json))
        assert headers["Authorization"] == "Bearer secret"
        assert allow_redirects is False
        if url.endswith("/images/generations"):
            return Response({"data": [{"b64_json": self.image}]})
        if method == "POST":
            return Response({"id": "cgt-test123"})
        return Response({"status": "succeeded", "content": {
            "video_url": "https://ark-content-generation-v2-cn-beijing.tos-cn-beijing.volces.com/video.mp4?signature=secret"}})

    def get(self, url, **kwargs):
        assert "Authorization" not in kwargs
        assert kwargs["allow_redirects"] is False
        return Response()


def test_doubao_two_stage_generation(tmp_path):
    buffer = io.BytesIO()
    Image.new("RGB", (16, 16), "red").save(buffer, "JPEG")
    session = Session(base64.b64encode(buffer.getvalue()).decode())
    provider = DoubaoProvider("seedream-test", "seedance-test", api_key="secret", session=session)
    picture = tmp_path / "story.png"
    result = provider.generate_image(1, "小兔子", picture)
    assert result.status == "ok"
    assert Image.open(picture).format == "PNG"
    video = provider.generate(1, picture, "小兔子缓慢向前走", tmp_path / "story.mp4")
    assert video.status == "ok"
    assert video.generation_mode == "i2v"
    assert video.generation_config["task_id"] == "cgt-test123"
    assert (tmp_path / "story.mp4").read_bytes() == b"fake-mp4"
    assert session.calls[1][2]["content"][1]["role"] == "first_frame"
    assert "secret" not in video.model_dump_json()


def test_no_credentials_no_request(tmp_path):
    provider = DoubaoProvider("seedream", "seedance", api_key="")
    image = provider.generate_image(1, "test", tmp_path / "a.png")
    assert image.status == "failed" and image.error_code == "VALUEERROR"
    assert not (tmp_path / "a.png").exists()


def test_untrusted_download_blocked(tmp_path):
    provider = DoubaoProvider("seedream", "seedance", api_key="secret")
    for url in ("http://localhost/file", "https://volces.com.evil.test/file", "https://127.0.0.1/file"):
        try:
            provider._download_video(url, tmp_path / "a.mp4")
        except ValueError:
            pass
        else:
            raise AssertionError("Unsafe URL accepted")
