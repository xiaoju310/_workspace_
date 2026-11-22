import io
import os
import uuid
from PIL import Image
from fastapi.testclient import TestClient
from pymongo import MongoClient

test_db = 'paper_companion_mobile_test_' + uuid.uuid4().hex[:12]
os.environ['MONGODB_DATABASE'] = test_db
os.environ['MONGODB_URI'] = 'mongodb://127.0.0.1:27017'
from server.main import app

try:
    with TestClient(app) as client:
        assert client.get('/health').json()['service'] == 'paper-companion-mobile-mongodb-api'
        a = client.post('/api/auth/register', json={'username': 'reader_a', 'password': 'test-password-12345'})
        b = client.post('/api/auth/register', json={'username': 'reader_b', 'password': 'test-password-12345'})
        print('register', a.status_code, b.status_code)
        assert a.status_code in (200, 201) and b.status_code in (200, 201)
        h = {'Authorization': 'Bearer ' + a.json()['access_token']}
        hb = {'Authorization': 'Bearer ' + b.json()['access_token']}
        book = client.post('/api/books', json={'title': '小熊绘本', 'authorization_ref': 'original'}, headers=h)
        print('book', book.status_code, book.text[:180]); assert book.status_code == 201
        book_id = book.json()['id']
        assert client.get('/api/books/' + book_id, headers=hb).status_code == 404
        c = client.post(f'/api/books/{book_id}/classify', json={}, headers=h)
        print('classify', c.status_code, c.text[:220]); assert c.status_code == 200
        im = Image.new('RGB', (50, 50), (255, 180, 120)); buf = io.BytesIO(); im.save(buf, format='PNG')
        up = client.post(f'/api/books/{book_id}/pages?page_no=1', content=buf.getvalue(), headers={**h, 'Content-Type': 'image/png'})
        print('upload', up.status_code, up.text[:220]); assert up.status_code == 201
        assert client.get(f'/api/books/{book_id}/pages/1/content', headers=h).content == buf.getvalue()
        assert client.get(f'/api/books/{book_id}/pages/1/content', headers=hb).status_code == 404
        assert client.patch(f'/api/books/{book_id}/pages/1/revision', json={'ocr': {'text': '小熊'}, 'vision': None}, headers=h).status_code == 200
        assert client.patch(f'/api/books/{book_id}/classification', json={'confirmed_type': 'picture_book'}, headers=h).status_code == 200
        workspace = {'schema_version': 1, 'state': {'schema': 1, 'books': [{'server_book_id': book_id}], 'notes': [], 'grants': [], 'interactions': []}}
        assert client.put('/api/mobile/workspace', json=workspace, headers=h).status_code == 200
        assert client.get('/api/mobile/workspace', headers=h).json()['state'] == workspace['state']
        assert client.get('/api/mobile/workspace', headers=hb).json()['state'] is None
        run = client.post(f'/api/books/{book_id}/analyze', json={'analysis_profile': 'default'}, headers=h)
        print('analysis enqueue', run.status_code, run.text[:180]); assert run.status_code == 202
        job = client.get('/api/jobs/' + run.json()['job_id'], headers=h)
        print('analysis result', job.status_code, job.json()); assert job.json()['status'] == 'FAILED' # no provider configured, no false success
        assert client.get('/api/runs/' + run.json()['run_id'], headers=hb).status_code == 404
        assert client.get('/api/notes/nonexistent', headers=h).status_code == 404
    print('MOBILE_MONGO_SMOKE_OK')
finally:
    MongoClient('mongodb://127.0.0.1:27017')[test_db].client.drop_database(test_db)
