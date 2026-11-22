"""Cross-device library tests only touch a temporary DB and tiny generated images."""
import hashlib
from io import BytesIO
import pytest
from PIL import Image
from fastapi.testclient import TestClient
from app import db
from app.main import app

@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv('AUTH_BACKEND','legacy')
    monkeypatch.setenv('ALLOW_LEGACY_TOKENS','1')
    monkeypatch.setenv('APP_USER_TOKENS','{"alice":"a-secret","bob":"b-secret"}')
    monkeypatch.setattr(db,'DATABASE_PATH',tmp_path/'sync.db')
    monkeypatch.setattr('app.main.DATA_ROOT',tmp_path/'data')
    with TestClient(app) as c:
        c.headers['Authorization']='Bearer a-secret'
        yield c

def image():
    b=BytesIO();Image.new('RGB',(4,4),'red').save(b,format='PNG');return b.getvalue()

def test_two_devices_originals_drafts_and_account_isolation(client):
    blob=image();digest=hashlib.sha256(blob).hexdigest()
    assert client.post('/api/library/images',content=blob).json()['sha256']==digest
    data={'id':'import-one','title':'龟兔赛跑','pages':[{'cloud_asset':digest,'name':'1.png'}]}
    assert client.put('/api/library/drafts/import-one',json={'data':data,'expected_revision':0}).json()['revision']==1
    # No cookie or browser storage required on the second device, only the same account.
    assert client.get('/api/library/drafts/import-one').json()['data']==data
    assert client.get('/api/library/images/'+digest).content==blob
    assert client.get('/api/library/drafts').json()[0]['title']=='龟兔赛跑'
    client.headers['Authorization']='Bearer b-secret'
    assert client.get('/api/library/drafts').json()==[]
    assert client.get('/api/library/drafts/import-one').json()['data'] is None
    assert client.get('/api/library/images/'+digest).status_code==404
    assert client.put('/api/library/drafts/import-one',json={'data':data,'expected_revision':0}).status_code==422
    client.headers.clear()
    assert client.get('/api/library/drafts').status_code==401


def test_stale_device_and_deleted_draft_cannot_overwrite(client):
    data={'id':'draft-a','pages':[],'title':'first'}
    path='/api/library/drafts/draft-a'
    assert client.put(path,json={'data':data,'expected_revision':0}).status_code==200
    data['title']='second'
    assert client.put(path,json={'data':data,'expected_revision':1}).status_code==200
    assert client.put(path,json={'data':data,'expected_revision':1}).status_code==409
    assert client.delete(path+'?expected_revision=1').status_code==409
    assert client.delete(path+'?expected_revision=2').status_code==204
    assert client.get(path).json()['data'] is None
    assert client.get('/api/library/drafts').json()==[]
    assert client.put(path,json={'data':data,'expected_revision':2}).status_code==409


def test_bad_image_and_body_rejected(client):
    assert client.post('/api/library/images',content=b'not an image').status_code==422
    assert client.put('/api/library/images/'+'0'*64,content=image()).status_code==422
    for data in (None,[],{'expected_revision':True,'data':{}},{'expected_revision':0,'data':{}},{'expected_revision':0,'data':{'id':'wrong','pages':[]}}):
        assert client.put('/api/library/drafts/draft-a',json=data).status_code==422
    assert client.put('/api/library/drafts/workspace',json={'data':{},'expected_revision':0}).status_code==422


def test_workspace_roundtrip_and_legacy_book_recovery(client):
    # Includes pending correction, local private note and last position; no AI request.
    data={'books':[{'id':'local-1','reading_position':{'time_ms':5000,'page_index':2},'pages':[]}], 'notes':[{'summary':'私密草稿'}],'grants':[],'interactions':[]}
    path='/api/library/drafts/workspace'
    assert client.put(path,json={'data':data,'expected_revision':0}).status_code==200
    assert client.get(path).json()['data']==data
    assert client.delete(path+'?expected_revision=1').status_code==422
    book=client.post('/api/books',json={'title':'已有书','authorization_ref':'原创'}).json()['id']
    assert client.post(f'/api/books/{book}/pages?page_no=1',content=image(),headers={'Content-Type':'image/png'}).status_code==201
    rows=client.get('/api/library/books').json()
    assert rows[0]['id']==book
    assert 'image_path' not in rows[0]['pages'][0]
    assert client.get(f'/api/library/books/{book}/pages/1/image').content==image()
    client.headers['Authorization']='Bearer b-secret'
    assert client.get('/api/library/books').json()==[]
    assert client.get(f'/api/library/books/{book}/pages/1/image').status_code==404
