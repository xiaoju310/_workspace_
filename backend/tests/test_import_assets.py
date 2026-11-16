"""B manifest -> A owner-protected asset integration, all offline and no paid API."""
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.ai.import_assets import import_generation
from app import db
from test_api import client, create_confirmed_book  # noqa: F401


def test_import_successful_image_and_video(client: TestClient, tmp_path: Path, monkeypatch):
    import app.main as main
    book_id = create_confirmed_book(client)
    job = client.post(f'/api/books/{book_id}/analyze', json={}).json()
    run_id = job['run_id']
    media = tmp_path / 'generated'
    media.mkdir()
    picture = media / 'sample.png'
    Image.new('RGB', (12, 12), 'blue').save(picture)
    video = media / 'sample.mp4'
    # Container signature is only a basic gate, never proof of decodable video.
    video.write_bytes(b'\x00\x00\x00\x18ftypisom' + b'\x00' * 24)
    manifest = media / 'sample.generation.json'
    manifest.write_text(json.dumps({
        'image': {'status': 'ok', 'page_no': 1, 'path': str(picture), 'model_version': 'local-test'},
        'video': {'status': 'ok', 'page_no': 1, 'path': str(video), 'model_version': 'local-test'},
    }), encoding='utf-8')
    assets = import_generation(manifest, run_id, main.DATA_ROOT, client)
    assert len(assets) == 2
    response = client.get(f'/api/runs/{run_id}/assets')
    assert response.status_code == 200
    records = response.json()
    assert {item['asset_type'] for item in records} == {'image', 'video'}
    assert {json.loads(item['metadata_json'])['page_no'] for item in records} == {1}
    assert client.get(f'/api/runs/{run_id}/assets/{assets[0]["id"]}/content').content == picture.read_bytes()
    with pytest.raises(ValueError, match='已导入'):
        import_generation(manifest, run_id, main.DATA_ROOT, client)
    client.headers['Authorization'] = 'Bearer other-secret'
    with pytest.raises(Exception):
        import_generation(manifest, run_id, main.DATA_ROOT, client)


def test_relative_cli_output_path_is_accepted(client: TestClient, tmp_path: Path, monkeypatch):
    import app.main as main
    book_id = create_confirmed_book(client)
    run_id = client.post(f'/api/books/{book_id}/analyze', json={}).json()['run_id']
    folder = tmp_path / 'outputs'
    folder.mkdir()
    Image.new('RGB', (4, 4)).save(folder / 'sample.png')
    manifest = folder / 'sample.generation.json'
    manifest.write_text(json.dumps({'image': {'status': 'ok', 'page_no': 1,
        'path': 'outputs/sample.png', 'model_version': 'test'}}), encoding='utf-8')
    monkeypatch.chdir(tmp_path)
    assert len(import_generation(manifest, run_id, main.DATA_ROOT, client)) == 1


def test_failed_video_keeps_successful_picture(client: TestClient, tmp_path: Path):
    import app.main as main
    book_id = create_confirmed_book(client)
    run_id = client.post(f'/api/books/{book_id}/analyze', json={}).json()['run_id']
    picture = tmp_path / 'safe.png'
    Image.new('RGB', (4, 4)).save(picture)
    manifest = tmp_path / 'safe.generation.json'
    manifest.write_text(json.dumps({'image': {'status': 'ok', 'page_no': 1,
        'path': str(picture), 'model_version': 'test'},
        'video': {'status': 'failed', 'page_no': 1, 'path': str(tmp_path / 'bad.mp4')}}), encoding='utf-8')
    assert [item['asset_type'] for item in import_generation(manifest, run_id, main.DATA_ROOT, client)] == ['image']


def test_import_refuses_failed_missing_or_foreign_pages(client: TestClient, tmp_path: Path):
    import app.main as main
    book_id = create_confirmed_book(client)
    run_id = client.post(f'/api/books/{book_id}/analyze', json={}).json()['run_id']
    image = tmp_path / 'image.png'
    Image.new('RGB', (4, 4)).save(image)
    manifest = tmp_path / 'test.generation.json'
    for status, page, path in [('failed', 1, str(image)), ('ok', 2, str(image)), ('ok', 1, str(tmp_path / 'missing.png'))]:
        manifest.write_text(json.dumps({'image': {'status': status, 'page_no': page, 'path': path, 'model_version': 'test'}}), encoding='utf-8')
        with pytest.raises((ValueError, FileNotFoundError)):
            import_generation(manifest, run_id, main.DATA_ROOT, client)
    assert client.get(f'/api/runs/{run_id}/assets').json() == []
