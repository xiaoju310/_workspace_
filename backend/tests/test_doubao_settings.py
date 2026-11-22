import os
from app.ai import doubao_settings as settings


def test_env_takes_precedence(monkeypatch):
    monkeypatch.setenv('ARK_API_KEY', 'fake-env-key')
    monkeypatch.setenv('DOUBAO_VIDEO_MODEL', 'fake-env-model')
    monkeypatch.setattr(settings, '_unprotect', lambda _: (_ for _ in ()).throw(AssertionError('must not read saved credential')))
    assert settings.video_settings() == ('fake-env-key', 'fake-env-model')


def test_missing_local_config_is_safe(monkeypatch, tmp_path):
    monkeypatch.delenv('ARK_API_KEY', raising=False)
    monkeypatch.delenv('DOUBAO_VIDEO_MODEL', raising=False)
    monkeypatch.setenv('LOCALAPPDATA', str(tmp_path))
    assert settings.video_settings() == ('', '')
