import json
from pathlib import Path

from app.ai import cli


def test_image_only_does_not_call_video(monkeypatch, tmp_path):
    events = []

    class FakeProvider:
        def __init__(self, *args, **kwargs):
            events.append('init')

        def generate_image(self, page_no, prompt, path, reference):
            events.append('image')
            from app.ai.video_doubao import ImageResult
            path.write_bytes(b'png')
            return ImageResult(page_no=page_no, path=str(path), model_version='mock',
                               prompt_hash='hash', status='ok')

        def generate(self, *args, **kwargs):
            raise AssertionError('Video must never be submitted in image-only mode')

    monkeypatch.setattr(cli, 'DoubaoProvider', FakeProvider)
    output = tmp_path / 'sample.png'
    result = cli.main(['doubao-image', '--page-no', '1', '--image-prompt', 'rabbit', '--out', str(output)])
    manifest = json.loads(output.with_suffix('.generation.json').read_text(encoding='utf-8'))
    assert result == 0
    assert events == ['init', 'image']
    assert output.exists()
    assert manifest['image']['status'] == 'ok'
    assert manifest['video'] is None


def test_video_only_reuses_image_without_image_generation(monkeypatch, tmp_path):
    from app.ai.video import VideoResult
    events = []

    class FakeProvider:
        def __init__(self, *args, **kwargs):
            events.append('init')

        def generate_image(self, *args, **kwargs):
            raise AssertionError('Existing-image mode must not generate another picture')

        def generate(self, page_no, image, prompt, output):
            events.append('video')
            output.write_bytes(b'mock-video')
            return VideoResult(page_no=page_no, path=str(output), generation_mode='i2v',
                               model_version='mock', prompt_hash='hash', status='ok')

    monkeypatch.setattr(cli, 'DoubaoProvider', FakeProvider)
    image = tmp_path / 'sample.png'
    image.write_bytes(b'mock-image')
    output = tmp_path / 'sample.mp4'
    args = ['doubao-video', '--page-no', '1', '--image', str(image),
            '--video-prompt', 'gentle movement', '--out', str(output)]
    assert cli.main(args) == 0
    manifest = json.loads(output.with_suffix('.generation.json').read_text(encoding='utf-8'))
    assert events == ['init', 'video']
    assert manifest['image']['status'] == 'reused'
    assert manifest['video']['status'] == 'ok'
    import pytest
    with pytest.raises(SystemExit):
        cli.main(args)
    assert events == ['init', 'video']
