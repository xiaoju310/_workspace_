from pathlib import Path

from app.ai.video_doubao import DoubaoProvider


class FailedResponse:
    status_code = 429

    def __init__(self, code):
        self.code = code

    def json(self):
        return {"error": {"code": self.code,
                          "message": "secret-key account-id signed-url"}}


class FailedSession:
    def __init__(self, code):
        self.code = code
        self.calls = 0

    def request(self, *args, **kwargs):
        self.calls += 1
        assert args[0] == "POST"
        assert args[1].endswith("/images/generations")
        return FailedResponse(self.code)


def test_ark_error_code_only_no_message_or_repeat(tmp_path):
    session = FailedSession("RateLimitExceeded")
    provider = DoubaoProvider("model", api_key="secret-key", session=session)
    result = provider.generate_image(1, "rabbit", tmp_path / "out.png")
    assert result.status == "failed"
    assert result.error_code == "RateLimitExceeded"
    assert result.error_message == "Ark HTTP 429 (RateLimitExceeded)"
    assert "secret-key" not in result.model_dump_json()
    assert "account-id" not in result.model_dump_json()
    assert session.calls == 1
    assert not (tmp_path / "out.png").exists()


def test_unsafe_ark_error_code_is_not_logged(tmp_path):
    session = FailedSession("ark-secret-key-123")
    provider = DoubaoProvider("model", api_key="secret-key", session=session)
    result = provider.generate_image(1, "rabbit", tmp_path / "out.png")
    assert result.error_code == "HTTP_429"
    assert result.error_message == "Ark HTTP 429"
    assert "secret" not in result.model_dump_json()
