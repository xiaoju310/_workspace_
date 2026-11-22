"""Deletion tests use only a temporary database/files; no real account or provider."""
import uuid
import hashlib
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from app import db
from app.main import app

@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv('AUTH_BACKEND', 'legacy')
    monkeypatch.setenv('ALLOW_LEGACY_TOKENS', '1')
    monkeypatch.setenv('APP_USER_TOKENS', '{"owner-local":"test-secret","other":"other-secret"}')
    monkeypatch.setattr(db, 'DATABASE_PATH', tmp_path / 'test.db')
    monkeypatch.setattr('app.main.DATA_ROOT', tmp_path / 'data')
    with TestClient(app) as value:
        value.headers.update({'Authorization': 'Bearer test-secret'})
        yield value

def book(client, title='old book'):
    response = client.post('/api/books', json={'title':title, 'authorization_ref':'test only'})
    assert response.status_code == 201
    return response.json()['id']

def seed_run(book_id, status='SUCCEEDED'):
    run = str(uuid.uuid4())
    with db.get_connection() as c:
        c.execute('INSERT INTO runs(id,book_id,status,config_json,model_manifest_json,created_at) VALUES(?,?,?,?,?,?)', (run,book_id,status,'{}','{}','2026-11-16'))
    return run

def test_owner_only_and_not_found(client):
    b = book(client)
    assert client.delete(f'/api/books/{b}', headers={'Authorization':''}).status_code == 401
    assert client.delete(f'/api/books/{b}', headers={'Authorization':'Bearer other-secret'}).status_code == 404
    assert client.get(f'/api/books/{b}').status_code == 200
    assert client.delete('/api/books/missing').status_code == 404
    assert client.delete(f'/api/books/{b}').status_code == 204
    assert client.delete(f'/api/books/{b}').status_code == 404

@pytest.mark.parametrize('status', ['QUEUED','RUNNING','RETRYING'])
@pytest.mark.parametrize('in_job', [False, True])
def test_active_generation_blocks_delete(client, status, in_job):
    b = book(client)
    r = seed_run(b, 'SUCCEEDED' if in_job else status)
    if in_job:
        with db.get_connection() as c:
            c.execute('INSERT INTO jobs(id,run_id,stage,status,created_at) VALUES(?,?,?,?,?)', ('job',r,'analysis',status,'now'))
    assert client.delete(f'/api/books/{b}').status_code == 409
    assert client.get(f'/api/books/{b}').status_code == 200

def test_cascade_and_files_preserve_other_book(client, tmp_path):
    b, other = book(client), book(client, 'keep me')
    r, other_run = seed_run(b), seed_run(other)
    data = tmp_path / 'data'
    for kind, identifier in [('books',b),('books',other),('runs',r),('runs',other_run)]:
        folder = data / kind / identifier
        folder.mkdir(parents=True)
        (folder / 'asset.txt').write_text('test')
    outside = tmp_path / 'outside.txt'
    outside.write_text('must not delete')
    with db.get_connection() as c:
        c.execute('INSERT INTO pages(id,book_id,page_no,image_path,sha256,mime_type,size_bytes,created_at) VALUES(?,?,?,?,?,?,?,?)', ('page',b,1,str(outside),'hash','image/png',3,'now'))
        c.execute('INSERT INTO page_revisions(id,page_id,revision,editor_id,created_at) VALUES(?,?,?,?,?)', ('rev','page',1,'owner-local','now'))
        c.execute('INSERT INTO book_classifications(book_id,predicted_type,confidence,reasons_json,created_at,updated_at) VALUES(?,?,?,?,?,?)',(b,'picture_book',0.8,'[]','now','now'))
        c.execute('INSERT INTO chapters(id,book_id,chapter_no,created_at) VALUES(?,?,?,?)',('chapter',b,1,'now'))
        c.execute('INSERT INTO book_entities(id,book_id,entity_type,name,created_at) VALUES(?,?,?,?,?)',('entity',b,'character','owl','now'))
        c.execute('INSERT INTO jobs(id,run_id,stage,status,created_at) VALUES(?,?,?,?,?)', ('job',r,'analysis','SUCCEEDED','now'))
        c.execute('INSERT INTO media_assets(id,run_id,asset_type,file_path,mime_type,sha256,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?)',('media',r,'illustration',str(outside),'image/png','hash','{}','now'))
        c.execute('INSERT INTO segments(id,run_id,start_ms,end_ms,source_json,created_at) VALUES(?,?,?,?,?,?)',('segment',r,0,100,'{}','now'))
        c.execute('INSERT INTO interactions(id,run_id,interaction_type,input_json,output_json,created_at) VALUES(?,?,?,?,?,?)',('interaction',r,'touch','{}','{}','now'))
        c.execute('INSERT INTO run_logs(id,run_id,level,event,safe_metadata_json,created_at) VALUES(?,?,?,?,?,?)',('log',r,'INFO','test','{}','now'))
        c.execute('INSERT INTO reading_notes(id,book_id,owner_id,content_json,created_at,updated_at) VALUES(?,?,?,?,?,?)',('note',b,'owner-local','{}','now','now'))
        c.execute('INSERT INTO note_revisions(id,note_id,editor_id,content_json,version,created_at) VALUES(?,?,?,?,?,?)',('nr','note','owner-local','{}',1,'now'))
        c.execute('INSERT INTO note_shares(id,note_id,owner_id,share_mode,token_hash,created_at) VALUES(?,?,?,?,?,?)',('share','note','owner-local','link',hashlib.sha256(b'test-share').hexdigest(),'now'))
        c.execute("UPDATE reading_notes SET status='SHARED',created_at=?,updated_at=? WHERE id='note'", ('2026-11-16T00:00:00+00:00','2026-11-16T00:00:00+00:00'))
    assert client.get('/api/shared-notes/test-share').status_code == 200
    result = client.delete(f'/api/books/{b}')
    assert result.status_code == 204 and not result.content
    assert client.get(f'/api/books/{b}').status_code == 404
    assert client.get('/api/notes/note').status_code == 404
    assert client.get('/api/shared-notes/test-share').status_code == 404
    assert client.get(f'/api/runs/{r}').status_code == 404
    assert client.get(f'/api/books/{other}').status_code == 200
    with db.get_connection() as c:
        for table in ['pages','page_revisions','book_classifications','chapters','book_entities','jobs','media_assets','segments','interactions','run_logs','reading_notes','note_revisions','note_shares']:
            assert c.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0] == 0, table
        assert c.execute('PRAGMA foreign_key_check').fetchall() == []
        assert c.execute('SELECT id FROM runs').fetchone()[0] == other_run
    assert not (data/'books'/b).exists()
    assert not (data/'runs'/r).exists()
    assert (data/'books'/other/'asset.txt').exists()
    assert (data/'runs'/other_run/'asset.txt').exists()
    assert outside.read_text() == 'must not delete'


def test_cleanup_failure_does_not_undo_record_deletion(client, tmp_path, monkeypatch):
    b = book(client)
    folder = tmp_path / 'data' / 'books' / b
    folder.mkdir(parents=True)
    def fail(_path):
        raise PermissionError('locked test file')
    monkeypatch.setattr('shutil.rmtree', fail)
    assert client.delete(f'/api/books/{b}').status_code == 204
    assert client.get(f'/api/books/{b}').status_code == 404
    assert folder.exists()  # The orphan is logged for maintenance, not reported as an existing book.
