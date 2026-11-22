"""Frame QA and incremental long-book workflow; all models are offline fakes."""
import base64
import hashlib
import json
from pathlib import Path
import pytest
from app import db, workflow_routes as flow
from app.services import cloud_vision, video_runtime
from test_reading_workflow import setup, url, video_setup


def frame_model(monkeypatch, confidence=.9, uncertain=False):
    calls=[]
    def model(instruction,data,schema,image=None):
        calls.append((instruction,data,schema,image))
        return schema(answer='画面里有乌龟。',confidence=confidence,uncertain=uncertain)
    monkeypatch.setattr(cloud_vision,'call_json',model)
    return calls


def test_frame_qa_requires_consent_source_and_ownership_before_call(setup):
    client,run,_,_,monkeypatch=setup
    calls=frame_model(monkeypatch)
    endpoint=f'/api/runs/{run}/interaction/frame-qa'
    body={'query_text':'现在有什么？','current_page_no':1,'confirm_paid':True}
    assert client.post(endpoint,json=body|{'confirm_paid':False}).status_code==422
    assert client.post(endpoint,json=body|{'query_text':'  '}).status_code==422
    assert client.post(endpoint,json=body|{'current_page_no':None}).status_code==422
    assert client.post(endpoint,json=body|{'asset_id':'video'}).status_code==422
    assert client.post(endpoint,json=body|{'frame_kind':'video','frame_image_base64':'fake'}).status_code==422
    assert client.post(endpoint,json=body,headers={'Authorization':'Bearer other-secret'}).status_code==404
    assert not calls


def test_frame_qa_sends_actual_image_without_ocr_and_archives_exact_input(setup):
    client,run,_,_,monkeypatch=setup
    calls=frame_model(monkeypatch)
    response=client.post(f'/api/runs/{run}/interaction/frame-qa',json={'query_text':'画面里有什么？','current_page_no':1,'confirm_paid':True,'session_id':'x'})
    assert response.status_code==200
    result=response.json()
    assert result['status']=='answered' and result['frame_source']=='server_original_page'
    assert calls[0][1]=={'query_text':'画面里有什么？'} and calls[0][2] is cloud_vision.FrameAnswer
    raw=base64.b64decode(calls[0][3].split(',',1)[1])
    assert result['frame_sha256']==hashlib.sha256(raw).hexdigest()
    with db.get_connection() as c:
        record=dict(c.execute('SELECT * FROM media_assets WHERE id=?',(result['evidence_asset_id'],)).fetchone())
        assert not c.execute('SELECT * FROM reading_dialogue').fetchall()
    assert Path(record['file_path']).read_bytes()==raw
    metadata=json.loads(record['metadata_json'])
    assert metadata['query_text']=='画面里有什么？' and metadata['answer']==result['answer']
    route=f'/api/runs/{run}/assets/{result["evidence_asset_id"]}/content'
    assert client.get(route).status_code==200
    assert client.get(route,headers={'Authorization':'Bearer other-secret'}).status_code==404
    assert any(e['event']=='frame_qa_evidence_saved' for e in client.get(url(run)).json()['events'])


@pytest.mark.parametrize('confidence,uncertain',[(.59,False),(.99,True)])
def test_frame_qa_does_not_present_unreliable_answer_as_fact(setup,confidence,uncertain):
    client,run,_,_,monkeypatch=setup
    frame_model(monkeypatch,confidence,uncertain)
    result=client.post(f'/api/runs/{run}/interaction/frame-qa',json={'query_text':'什么？','current_page_no':1,'confirm_paid':True}).json()
    assert result['status']=='uncertain' and '无法可靠回答' in result['answer'] and '画面里有乌龟' not in result['answer']


def test_frame_qa_model_failure_not_retried_or_leaked(setup):
    client,run,_,_,monkeypatch=setup
    calls=[]
    def broken(*args):calls.append(1);raise ValueError('private provider url')
    monkeypatch.setattr(cloud_vision,'call_json',broken)
    response=client.post(f'/api/runs/{run}/interaction/frame-qa',json={'query_text':'什么？','current_page_no':1,'confirm_paid':True})
    assert response.status_code==502 and 'private' not in response.text and len(calls)==1


def test_frame_qa_video_uses_server_frame_and_timeline(setup):
    client,run,_=video_setup(setup)
    client.post(url(run,'/video'),json={'confirm_paid':True})
    asset_id=client.get(url(run)).json()['asset_id']
    with db.get_connection() as c:
        asset=dict(c.execute('SELECT * FROM media_assets WHERE id=?',(asset_id,)).fetchone())
        page=dict(c.execute('SELECT * FROM pages LIMIT 1').fetchone())
    extracted=[]
    def extract(path,at):extracted.append((path,at));return Path(page['image_path']).read_bytes()
    monkeypatch=setup[4];monkeypatch.setattr(video_runtime,'extract_frame',extract)
    calls=frame_model(monkeypatch)
    body={'query_text':'有什么？','confirm_paid':True,'frame_kind':'video','asset_id':asset_id,'asset_sha256':asset['sha256'],'video_ms':1500,'current_page_no':1,'frame_image_base64':'invalid browser image'}
    endpoint=f'/api/runs/{run}/interaction/frame-qa'
    for change,code in [({'asset_id':None},422),({'asset_id':'foreign'},404),({'asset_sha256':'0'*64},409),({'video_ms':3000},422)]:
        assert client.post(endpoint,json=body|change).status_code==code
    assert not calls and not extracted
    result=client.post(endpoint,json=body).json()
    assert result['page_no']==2 and result['video_ms']==1500 and result['frame_source']=='server_video_frame'
    assert len(calls)==1 and extracted[0][1]==1500


def extend_pages(client,book,last):
    with db.get_connection() as c:raw=Path(c.execute('SELECT image_path FROM pages LIMIT 1').fetchone()['image_path']).read_bytes()
    for number in range(3,last+1):
        assert client.post(f'/api/books/{book}/pages?page_no={number}',content=raw,headers={'Content-Type':'image/png'}).status_code==201


def analyze(client,run,pages):
    return client.post(url(run,'/vision'),json={'page_nos':pages,'confirm_paid':True})


def test_long_book_three_batches_reuses_pages_and_full_story_is_editable(setup):
    client,run,book,calls,_=setup
    extend_pages(client,book,25)
    jobs=[]
    for batch in [list(range(1,13)),list(range(13,25)),[25]]:
        response=analyze(client,run,batch);assert response.status_code==202
        jobs.append(response.json()['job_id'])
        assert analyze(client,run,list(reversed(batch))).json()['job_id']==jobs[-1]
    assert len(set(jobs))==3 and len(calls)==25
    state=client.get(url(run)).json()
    assert [p['page_no'] for p in state['vision']]==list(range(1,26))
    assert len(state['tasks'])==3 and all(t['status']=='SUCCEEDED' for t in state['tasks'])
    assert client.post(url(run,'/storyboard')).status_code==200
    state=client.get(url(run)).json();assert state['coverage']['complete'] and len(state['storyboard']['shots'])==25
    edit={'expected_revision':state['revision'],'character_guide':'乌龟','shots':state['storyboard']['shots']}
    assert client.put(url(run,'/storyboard'),json=edit).status_code==200
    state=client.get(url(run)).json()
    assert client.post(url(run,'/storyboard/approve'),json={'expected_revision':state['revision'],'coverage_confirmed':True}).status_code==200
    records=client.get(f'/api/books/{book}/generation-records').json()['records']
    vision=[r for r in records if r['stage']=='vision']
    assert [r['page_nos'] for r in vision]==[list(range(1,13)),list(range(13,25)),[25]]
    assert [r['completed_vision_calls'] for r in vision]==[12,12,1]
    assert [r['job_id'] for r in vision]==jobs


def test_incremental_analysis_invalidates_old_draft_and_blocks_overlap(setup):
    client,run,_,calls,_=setup
    assert analyze(client,run,[1]).status_code==202
    assert client.post(url(run,'/storyboard')).status_code==200
    before=client.get(url(run)).json()
    assert analyze(client,run,[1,2]).status_code==409 and len(calls)==1
    assert analyze(client,run,[2]).status_code==202
    after=client.get(url(run)).json()
    assert after['revision']>before['revision'] and after['storyboard'] is None and not after['approved']
    assert len(calls)==2


def test_incremental_analysis_does_not_mix_changed_source_or_model(setup):
    client,run,book,calls,monkeypatch=setup
    assert analyze(client,run,[1]).status_code==202
    monkeypatch.setattr(flow,'vision_settings',lambda:('fixture','different-model'))
    assert analyze(client,run,[2]).status_code==409 and len(calls)==1
    monkeypatch.setattr(flow,'vision_settings',lambda:('fixture','fixture-vision'))
    client.patch(f'/api/books/{book}/pages/1/revision',json={'ocr':{'text':'changed'}})
    assert analyze(client,run,[2]).status_code==409
    assert analyze(client,run,[1]).status_code==409 and len(calls)==1


def test_partial_paid_results_saved_but_failed_batch_never_retried(setup):
    client,run,_,calls,monkeypatch=setup
    original=cloud_vision.call_json
    def model(instruction,data,schema,image=None):
        if data['page_no']==2:calls.append('failed');raise ValueError('private')
        return original(instruction,data,schema,image)
    monkeypatch.setattr(cloud_vision,'call_json',model)
    response=analyze(client,run,[1,2]);assert response.status_code==202
    state=client.get(url(run)).json()
    assert [p['page_no'] for p in state['vision']]==[1] and state['tasks'][0]['status']=='FAILED'
    assert analyze(client,run,[1,2]).json()['job_id']==response.json()['job_id']
    assert analyze(client,run,[2]).status_code==409
    assert client.post(f'/api/jobs/{response.json()["job_id"]}/retry').status_code==409
    assert client.post(url(run,'/storyboard')).status_code==409 and len(calls)==2


def test_unfinished_batch_blocks_new_batch_and_duplicate_worker(setup,monkeypatch):
    client,run,_,calls,_=setup
    original=flow.run_vision
    monkeypatch.setattr(flow,'run_vision',lambda *args:None)
    first=analyze(client,run,[1]).json()
    assert analyze(client,run,[2]).status_code==409
    assert analyze(client,run,[1]).json()['job_id']==first['job_id'] and not calls
    original(run);original(run)
    assert len(calls)==1
    assert analyze(client,run,[2]).status_code==202
    state=client.get(url(run)).json();second=state['tasks'][1]
    original(run,second['stage']);original(run,second['stage'])
    assert len(calls)==2

def test_page_edit_during_paid_response_is_not_saved_or_mixed(setup):
    client,run,book,calls,monkeypatch=setup
    original=cloud_vision.call_json
    def model(*args,**kwargs):
        result=original(*args,**kwargs)
        with db.get_connection() as c:
            c.execute('UPDATE pages SET revision=revision+1 WHERE book_id=? AND page_no=1',(book,))
        return result
    monkeypatch.setattr(cloud_vision,'call_json',model)
    assert analyze(client,run,[1]).status_code==202
    state=client.get(url(run)).json()
    assert state['vision'] is None and state['tasks'][0]['status']=='FAILED'
    assert analyze(client,run,[1]).status_code==409 and len(calls)==1


def test_legacy_completion_log_only_counts_for_original_batch(setup):
    client,run,book,_,_=setup
    assert analyze(client,run,[1]).status_code==202
    with db.get_connection() as c:
        c.execute("UPDATE run_logs SET safe_metadata_json=? WHERE run_id=? AND event='vision_page_completed'",(json.dumps({'page_no':1}),run))
    assert analyze(client,run,[2]).status_code==202
    records=client.get(f'/api/books/{book}/generation-records').json()['records']
    assert [r['completed_vision_calls'] for r in records if r['stage']=='vision']==[1,1]
