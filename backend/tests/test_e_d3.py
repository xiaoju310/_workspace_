"""E D3: real local API checks on synthetic inputs; no model inference."""
import csv
import hashlib
import json
import os
import secrets
import time
from io import BytesIO
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from app import db
from app.main import app

OUT = Path(os.environ.get('E_D3_RESULTS', 'work/e-d3-results'))
RECORDS = []


@pytest.fixture
def api(tmp_path, monkeypatch):
    token = secrets.token_urlsafe(32)
    monkeypatch.setenv('APP_USER_TOKENS', json.dumps({'e-local': token}))
    monkeypatch.setattr(db, 'DATABASE_PATH', tmp_path / 'd3.db')
    monkeypatch.setattr('app.main.DATA_ROOT', tmp_path / 'data')
    with TestClient(app) as client:
        client.headers['Authorization'] = 'Bearer ' + token
        yield client


def image(fmt='PNG'):
    stream = BytesIO()
    Image.new('RGB', (48, 32), 'blue').save(stream, format=fmt)
    return stream.getvalue()


def record(case, expected, response, started, extra=True, feature='上传校验'):
    ok = response.status_code == expected and extra
    RECORDS.append(dict(case_id=case, date='2026-11-06', feature=feature,
        book_type='picture_book', input_ref='synthetic generated in test_e_d3.py',
        expected=f'HTTP {expected}; semantic check true', actual=f'HTTP {response.status_code}; semantic={extra}',
        status='通过' if ok else '失败', duration_ms=round((time.perf_counter()-started)*1000, 3),
        evidence_ref=f'raw-responses.json#{case}', owner='E', next_action='项目真实provider及授权样本待验收'))
    OUT.mkdir(parents=True, exist_ok=True)
    rawfile = OUT / 'raw-responses.json'
    raw = json.loads(rawfile.read_text('utf-8')) if rawfile.exists() else {}
    raw[case] = {'http_status': response.status_code, 'body': response.json()}
    rawfile.write_text(json.dumps(raw, ensure_ascii=False, indent=2), 'utf-8')
    with (OUT / 'test-cases.csv').open('w', encoding='utf-8-sig', newline='') as handle:
        writer = csv.DictWriter(handle, fieldnames=list(RECORDS[0]))
        writer.writeheader(); writer.writerows(RECORDS)
    assert ok, raw[case]


def book(api, confirm=False):
    bid = api.post('/api/books', json={'title': 'E自制绘本', 'authorization_ref': 'synthetic-local-test'}).json()['id']
    if confirm:
        assert api.post(f'/api/books/{bid}/classify', json={}).status_code == 200
        assert api.patch(f'/api/books/{bid}/classification', json={'confirmed_type': 'picture_book'}).status_code == 200
    return bid


@pytest.mark.parametrize('case,mime,payload,page,expected', [
    ('D3-001','image/png',image(),1,201),
    ('D3-002','image/jpeg',image('JPEG'),1,201),
    ('D3-003','image/png',b'',1,400),
    ('D3-004','text/plain',b'not image',1,415),
    ('D3-005','image/png',b'not image',1,415),
    ('D3-006','image/png',image()[:40],1,415),
    ('D3-007','image/png',image('JPEG'),1,415),
    ('D3-008','image/png',image(),0,422),
    ('D3-009','image/png',b'x'*(10*1024*1024+1),1,413),
    ('D3-010','application/pdf',b'%PDF-1.4 test',1,415),
], ids=[f'D3-{n:03d}' for n in range(1,11)])
def test_upload(api, case, mime, payload, page, expected):
    bid = book(api)
    started = time.perf_counter()
    res = api.post(f'/api/books/{bid}/pages?page_no={page}', content=payload, headers={'Content-Type': mime})
    extra = res.json().get('sha256') == hashlib.sha256(payload).hexdigest() if expected == 201 else bool(res.json().get('detail'))
    record(case, expected, res, started, extra)


def test_duplicate_and_order(api):
    bid = book(api)
    endpoint=f'/api/books/{bid}/pages'
    for page in [2,1]:
        assert api.post(endpoint+f'?page_no={page}', content=image(), headers={'Content-Type':'image/png'}).status_code == 201
    started=time.perf_counter()
    res=api.post(endpoint+'?page_no=1', content=image(), headers={'Content-Type':'image/png'})
    record('D3-011',409,res,started)
    started=time.perf_counter();res=api.get(endpoint)
    record('D3-012',200,res,started,[p['page_no'] for p in res.json()]==[1,2],feature='页序')


def test_analyze_preconditions_and_missing_provider(api):
    bid=book(api)
    started=time.perf_counter();res=api.post(f'/api/books/{bid}/analyze',json={})
    record('D3-013',409,res,started,feature='分析前置条件')
    api.post(f'/api/books/{bid}/classify',json={})
    api.patch(f'/api/books/{bid}/classification',json={'confirmed_type':'picture_book'})
    started=time.perf_counter();res=api.post(f'/api/books/{bid}/analyze',json={})
    record('D3-014',409,res,started,feature='无页面分析')
    api.post(f'/api/books/{bid}/pages?page_no=1',content=image(),headers={'Content-Type':'image/png'})
    started=time.perf_counter();res=api.post(f'/api/books/{bid}/analyze',json={})
    record('D3-015',202,res,started,feature='分析任务接收')
    run=res.json()['run_id']
    started=time.perf_counter();res=api.get(f'/api/runs/{run}/history')
    record('D3-016',200,res,started,res.json()['jobs'][0]['error_code']=='PROVIDER_NOT_CONFIGURED',feature='缺provider明确失败')

