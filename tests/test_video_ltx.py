from app.ai.video_ltx import LTXVideoProvider


def test_ltx_provider_requires_image(tmp_path):
    provider = LTXVideoProvider(tmp_path / "model", tmp_path / "prompt", tmp_path / "runner")
    result = provider.generate(1, None, "moon", tmp_path / "out.mp4")
    assert result.status == "failed"
    assert result.error_code == "FILENOTFOUNDERROR"


def test_ltx_provider_returns_runner_failure(tmp_path):
    for name in ("model", "prompt", "runner"):
        (tmp_path / name).write_bytes(b"x")
    image = tmp_path / "page.png"
    image.write_bytes(b"page")
    (tmp_path / "runner").write_text("raise SystemExit(3)", encoding="utf-8")
    provider = LTXVideoProvider(tmp_path / "model", tmp_path / "prompt", tmp_path / "runner")
    result = provider.generate(1, image, "moon", tmp_path / "out.mp4")
    assert result.status == "failed"
    assert result.error_code == "RUNTIMEERROR"
