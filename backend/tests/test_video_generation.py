"""Web video flow tests: isolated database and fake provider, never paid requests."""
import io
import uuid

import pytest
from PIL import Image
from fastapi.testclient import TestClient
from app import db, video_routes as video
from app.main import app

PAYLOAD = {'page_no': 1, 'prompt': 'gentle storybook motion', 'duration': 5, 'confirm_paid': True}
MP4 = b'\x00\x00\x00\x18ftypisom\x00\x00\x00\x00isommp42'


class FakeProvider:
    max_wait = 600
    poll_interval = 0
    _image_data = staticmethod(video.DoubaoProvider._image_data)

    def __init__(self):
        self.calls = []
        self.state = 'succeeded'
        self.post_error = False
        self.bad_download = False

    def _json(self, method, path, payload=None):
        self.calls.append((method, path, payload))
        if method == 'POST':
            if self.post_error:
                raise RuntimeError('secret-key/signed-url must not escape')
            return {'id': 'cgt-test123'}
        return {'status': self.state, 'content': {'video_url': 'https://test.volces.com/mock.mp4'}}

    def _download_video(self, url, output):
        output.write_bytes(b'not an mp4' if self.bad_download else MP4)


@pytest.fixture()
def setup(tmp_path, monkeypatch):
    monkeypatch.setenv('AUTH_BACKEND', 'legacy')
    monkeypatch.setenv('ALLOW_LEGACY_TOKENS', '1')
    monkeypatch.setenv('APP_USER_TOKENS', '{"owner-local":"test-secret","other":"other-secret"}')
    monkeypatch.setenv('ARK_API_KEY', 'test-key-not-real')
    monkeypatch.setenv('DOUBAO_VIDEO_MODEL', 'seedance-mock')
    monkeypatch.setattr(db, 'DATABASE_PATH', tmp_path / 'test.db')
    monkeypatch.setattr('app.main.DATA_ROOT', tmp_path / 'data')
    provider = FakeProvider()
    monkeypatch.setattr(video, 'provider_for', lambda model: provider)
    with TestClient(app) as client:
        client.headers.update({'Authorization': 'Bearer test-secret'})
        b = client.post('/api/books', json={'title': 'test', 'authorization_ref': 'test only'}).json()['id']
        buffer = io.BytesIO()
        Image.new('RGB', (32, 32), 'red').save(buffer, 'PNG')
        assert client.post(f'/api/books/{b}/pages?page_no=1', content=buffer.getvalue(), headers={'Content-Type': 'image/png'}).status_code == 201
        run = str(uuid.uuid4())
        with db.get_connection() as c:
            c.execute('INSERT INTO runs(id,book_id,status,config_json,model_manifest_json,created_at) VALUES(?,?,?,?,?,?)', (run,b,'SUCCEEDED','{}','{}','2026-11-16'))
        yield client, run, b, provider


def status(client, run):
    response = client.get(f'/api/runs/{run}/video')
    assert response.status_code == 200
    return response.json()


def start(client, run, **overrides):
    return client.post(f'/api/runs/{run}/video', json=PAYLOAD | overrides)


def test_success_dedupe_playback_and_cascade(setup):
    client, run, book, provider = setup
    assert status(client, run) == {'status': 'NOT_STARTED'}
    assert start(client, run).status_code == 202
    result = status(client, run)
    assert result['status'] == 'SUCCEEDED'
    assert result['page_no'] == 1
    assert start(client, run).status_code == 202
    assert len([c for c in provider.calls if c[0] == 'POST']) == 1
    payload = provider.calls[0][2]
    assert payload['duration'] == 5 and payload['watermark'] is True
    assert payload['content'][1]['image_url']['url'].startswith('data:image/png;base64,')
    assets = client.get(f'/api/runs/{run}/assets').json()
    assert len(assets) == 1 and assets[0]['mime_type'] == 'video/mp4'
    assert client.get(f"/api/runs/{run}/assets/{result['asset_id']}/content").content == MP4
    segments = client.get(f'/api/runs/{run}/segments').json()
    assert len(segments) == 1 and segments[0]['page_no'] == 1 and segments[0]['end_ms'] == 5000
    assert client.get(f'/api/runs/{run}').json()['status'] == 'SUCCEEDED'
    assert client.delete(f'/api/books/{book}').status_code == 204
    with db.get_connection() as c:
        assert c.execute('SELECT count(*) FROM video_generations').fetchone()[0] == 0


@pytest.mark.parametrize('suffix,method', [('', 'get'), ('','post'), ('/resume','post')])
def test_owner_isolation(setup, suffix, method):
    client, run, _, provider = setup
    response = getattr(client, method)(f'/api/runs/{run}/video{suffix}', headers={'Authorization': 'Bearer other-secret'}, **({'json': PAYLOAD} if method == 'post' and not suffix else {}))
    assert response.status_code == 404
    assert provider.calls == []


@pytest.mark.parametrize('change,expected', [({'confirm_paid': False},422),({'page_no':2},404),({'duration':10},422),({'prompt':'   '},422)])
def test_validation_prevents_paid_call(setup, change, expected):
    client, run, _, provider = setup
    assert start(client, run, **change).status_code == expected
    assert provider.calls == []


def test_missing_config(setup, monkeypatch):
    client, run, _, provider = setup
    monkeypatch.setattr(video, 'video_settings', lambda: ('', 'seedance-mock'))
    assert start(client, run).status_code == 503
    assert provider.calls == []


def test_terminal_failure_keeps_analysis_and_no_asset(setup):
    client, run, _, provider = setup
    provider.state = 'failed'
    assert start(client, run).status_code == 202
    result = status(client, run)
    assert result['status'] == 'FAILED' and not result['can_resume']
    assert client.post(f'/api/runs/{run}/video/resume').status_code == 409
    assert client.get(f'/api/runs/{run}/assets').json() == []
    assert client.get(f'/api/runs/{run}').json()['status'] == 'SUCCEEDED'


def test_timeout_resume_does_not_repost(setup, monkeypatch):
    client, run, _, provider = setup
    provider.state = 'running'
    provider.max_wait = 0.001
    assert start(client, run).status_code == 202
    result = status(client, run)
    assert result['error_code'] == 'VIDEO_TIMEOUT' and result['can_resume']
    provider.state = 'succeeded'
    provider.max_wait = 600
    assert client.post(f'/api/runs/{run}/video/resume').status_code == 202
    assert status(client, run)['status'] == 'SUCCEEDED'
    assert len([c for c in provider.calls if c[0] == 'POST']) == 1


def test_uncertain_submit_not_retried_or_leaked(setup):
    client, run, _, provider = setup
    provider.post_error = True
    assert start(client, run).status_code == 202
    result = status(client, run)
    assert result['status'] == 'FAILED' and not result['can_resume']
    assert 'secret-key' not in str(result)
    assert start(client, run).status_code == 202
    assert len(provider.calls) == 1
    assert client.post(f"/api/jobs/{result['job_id']}/retry").status_code == 409


def test_bad_download_not_registered_resume_only_downloads(setup):
    client, run, _, provider = setup
    provider.bad_download = True
    start(client, run)
    assert status(client, run)['can_resume']
    assert client.get(f'/api/runs/{run}/assets').json() == []
    provider.bad_download = False
    client.post(f'/api/runs/{run}/video/resume')
    assert status(client, run)['status'] == 'SUCCEEDED'
    assert len([c for c in provider.calls if c[0] == 'POST']) == 1


def test_running_blocks_deletion_and_duplicate_background_claim(setup, monkeypatch):
    client, run, book, provider = setup
    original = video.run_video
    monkeypatch.setattr(video, 'run_video', lambda _: None)
    start(client, run)
    assert client.delete(f'/api/books/{book}').status_code == 409
    original(run)
    original(run)
    assert status(client, run)['status'] == 'SUCCEEDED'
    assert len([c for c in provider.calls if c[0] == 'POST']) == 1


def test_changed_image_rejected_before_submit(setup):
    client, run, _, provider = setup
    with db.get_connection() as c:
        path = c.execute('SELECT image_path FROM pages').fetchone()[0]
    from pathlib import Path
    Path(path).write_bytes(b'corrupt')
    assert start(client, run).status_code == 422
    assert provider.calls == []


def test_resume_busy_book_is_blocked(setup):
    client, run, book, provider = setup
    provider.bad_download = True
    start(client, run)
    assert status(client, run)['can_resume']
    with db.get_connection() as c:
        c.execute("INSERT INTO jobs(id,run_id,stage,status,created_at) VALUES('other-job',?,'analyze','RUNNING','now')", (run,))
    assert client.post(f'/api/runs/{run}/video/resume').status_code == 409
    assert len([c for c in provider.calls if c[0] == 'POST']) == 1
