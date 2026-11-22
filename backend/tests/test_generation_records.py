"""Read-only receipts use isolated data; no model or provider calls."""
import json
import uuid
import pytest
from fastapi.testclient import TestClient
from app import db
from app.main import app

@pytest.fixture
def setup(tmp_path,monkeypatch):
    monkeypatch.setenv('AUTH_BACKEND','legacy')
    monkeypatch.setenv('ALLOW_LEGACY_TOKENS','1')
    monkeypatch.setenv('APP_USER_TOKENS','{"owner-local":"test-secret","other":"other-secret"}')
    monkeypatch.setattr(db,'DATABASE_PATH',tmp_path/'records.db')
    monkeypatch.setattr('app.main.DATA_ROOT',tmp_path/'data')
    with TestClient(app,headers={'Authorization':'Bearer test-secret'}) as client:
        book=client.post('/api/books',json={'title':'records','authorization_ref':'authorized test'}).json()['id']
        run=str(uuid.uuid4())
        with db.get_connection() as c:
            c.execute('INSERT INTO runs(id,book_id,status,config_json,model_manifest_json,created_at) VALUES(?,?,?,?,?,?)',(run,book,'SUCCEEDED','{}','{}','2026-11-19'))
        yield client,book,run

def job(run,stage,status='SUCCEEDED'):
    id=str(uuid.uuid4())
    with db.get_connection() as c:
        c.execute('INSERT INTO jobs(id,run_id,stage,status,created_at) VALUES(?,?,?,?,?)',(id,run,stage,status,'2026-11-19'))
    return id

def test_empty_not_zero_cost_and_authorization(setup):
    client,book,_=setup
    value=client.get(f'/api/books/{book}/generation-records').json()
    assert value['records']==[] and value['amount'] is None
    assert '不是扣费次数' in value['billing_note']
    assert client.get(f'/api/books/{book}/generation-records',headers={'Authorization':'Bearer other-secret'}).status_code==404
    assert client.get('/api/books/missing/generation-records').status_code==404

def test_workflow_reuse_uncertain_and_no_secrets(setup):
    client,book,run=setup
    id=job(run,'book_video','FAILED')
    request={'story':{'shots':[{'page_no':1},{'page_no':2},{'page_no':3},{'page_no':4}]},'narration':True,'model':'private-model','secret':'dont-return'}
    with db.get_connection() as c:
        c.execute('INSERT INTO workflow_tasks VALUES(?,?,?,?)',(run,'book_video',id,json.dumps(request)))
        for number,task,started,path in [(1,'cgt-private',1,'C:/private/one'),(2,'cgt-other',1,None),(3,None,1,None),(4,None,0,None)]:
            c.execute('INSERT INTO workflow_clips(run_id,page_no,task_id,submission_started,file_path) VALUES(?,?,?,?,?)',(run,number,task,started,path))
    response=client.get(f'/api/books/{book}/generation-records')
    r=response.json()['records'][0]
    assert r['page_nos']==[1,2,3,4] and r['narration']
    assert (r['submitted_count'],r['downloaded_count'],r['uncertain_count'])==(2,1,1)
    assert r['amount'] is None and r['status']=='FAILED'
    assert all(secret not in response.text for secret in ['private-model','dont-return','cgt-private','C:/private'])
    # Repeated reads never create jobs or change submission state.
    assert client.get(f'/api/books/{book}/generation-records').json()==response.json()
    with db.get_connection() as c:
        assert c.execute('SELECT COUNT(*) FROM jobs').fetchone()[0]==1

def test_vision_counts_only_recorded_success_not_attempts(setup):
    client,book,run=setup
    id=job(run,'vision','FAILED')
    with db.get_connection() as c:
        c.execute('UPDATE jobs SET attempts=9 WHERE id=?',(id,))
        c.execute('INSERT INTO workflow_tasks VALUES(?,?,?,?)',(run,'vision',id,json.dumps({'page_nos':[8,12]})))
        c.execute('INSERT INTO run_logs(id,run_id,level,event,safe_metadata_json,created_at) VALUES(?,?,?,?,?,?)',('log',run,'info','vision_page_completed','{}','2026-11-19'))
    r=client.get(f'/api/books/{book}/generation-records').json()['records'][0]
    assert r['completed_vision_calls']==1 and r['submitted_count'] is None
    assert r['page_nos']==[8,12] and r['amount'] is None

def test_single_video_uncertainty_and_legacy_call_count_unknown(setup):
    client,book,run=setup
    id=job(run,'video','FAILED')
    job(run,'analyze')
    with db.get_connection() as c:
        c.execute('INSERT INTO video_generations(run_id,job_id,page_no,prompt,model,submission_started,created_at) VALUES(?,?,?,?,?,?,?)',(run,id,8,'private prompt','secret model',1,'2026-11-19'))
    records=client.get(f'/api/books/{book}/generation-records').json()['records']
    video=next(r for r in records if r['stage']=='video')
    assert video['uncertain_count']==1 and video['submitted_count']==0
    legacy=next(r for r in records if r['stage']=='analyze')
    assert legacy['submitted_count'] is None and legacy['page_scope']=='current_book'

def test_history_includes_other_runs_without_cross_book_leak(setup):
    client,book,run=setup
    job(run,'analyze')
    other=client.post('/api/books',json={'title':'other','authorization_ref':'authorized test'}).json()['id']
    run2=str(uuid.uuid4());run3=str(uuid.uuid4())
    with db.get_connection() as c:
        for id,b in [(run2,book),(run3,other)]:
            c.execute('INSERT INTO runs(id,book_id,status,config_json,model_manifest_json,created_at) VALUES(?,?,?,?,?,?)',(id,b,'FAILED','{}','{}','2026-11-19'))
    job(run2,'analyze','FAILED');job(run3,'analyze')
    records=client.get(f'/api/books/{book}/generation-records').json()['records']
    assert {r['run_id'] for r in records}=={run,run2}
