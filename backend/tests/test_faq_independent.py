import json
from pathlib import Path
import pytest
from pydantic import ValidationError
from app import db, workflow_routes as flow
from app.services import cloud_vision, video_runtime
from test_reading_workflow import setup, url, prepare, video_setup


def test_partial_book_cannot_be_approved_or_charged(setup):
    client,run,book,calls,_=setup
    client.post(url(run,'/vision'),json={'page_nos':[1],'confirm_paid':True})
    client.post(url(run,'/storyboard'))
    state=client.get(url(run)).json()
    assert state['coverage']['missing_page_nos']==[2]
    assert state['coverage']['unanalyzed_page_nos']==[2]
    assert not state['coverage']['complete']
    assert client.post(url(run,'/storyboard/approve'),json={'expected_revision':state['revision'],'coverage_confirmed':True}).status_code==409
    assert client.post(url(run,'/video'),json={'confirm_paid':True}).status_code==409
    assert len(calls)==1


def test_wordless_page_not_silently_excluded(setup):
    client,run,book,_,_=setup
    client.patch(f'/api/books/{book}/pages/2/revision',json={'ocr':{'text':''}})
    client.post(url(run,'/vision'),json={'page_nos':[1],'confirm_paid':True})
    client.post(url(run,'/storyboard'))
    assert client.get(url(run)).json()['coverage']['missing_page_nos']==[2]


def test_review_requires_explicit_semantic_confirmation_and_valid_mapping(setup):
    client,run,_,_,_=setup
    state=prepare(client,run)
    shot=state['storyboard']['shots'][0]
    response=client.put(url(run,'/storyboard'),json={'expected_revision':state['revision'],'character_guide':'','shots':[shot]})
    assert response.status_code==200
    revision=response.json()['revision']
    assert client.post(url(run,'/storyboard/approve'),json={'expected_revision':revision,'coverage_confirmed':True}).status_code==409
    # Cross-page merge is permitted, but not merely by deleting a source page.
    merged=shot|{'source_page_nos':[1,2],'caption':'第一页的重要事件；第二页的重要无字情节'}
    response=client.put(url(run,'/storyboard'),json={'expected_revision':revision,'character_guide':'','shots':[merged]})
    assert response.status_code==200
    revision=response.json()['revision']
    assert client.post(url(run,'/storyboard/approve'),json={'expected_revision':revision}).status_code==422
    assert client.post(url(run,'/storyboard/approve'),json={'expected_revision':revision,'coverage_confirmed':True}).status_code==200
    state=client.get(url(run)).json()
    assert state['approved'] and state['coverage']['pages']==[{'page_no':1,'shot_numbers':[1]},{'page_no':2,'shot_numbers':[1]}]
    for sources in [[2,1],[1,1],[1,3]]:
        assert client.put(url(run,'/storyboard'),json={'expected_revision':revision,'character_guide':'','shots':[merged|{'source_page_nos':sources}]}).status_code==422


def test_old_approval_without_coverage_review_is_not_valid(setup):
    client,run,_,_,_=setup
    state=prepare(client,run)
    with db.get_connection() as c:
        story=state['storyboard'];story.pop('coverage_review_revision')
        c.execute('UPDATE reading_workflows SET storyboard_json=? WHERE run_id=?',(json.dumps(story),run))
    assert not client.get(url(run)).json()['approved']
    assert client.post(url(run,'/video'),json={'confirm_paid':True}).status_code==409


def text_model(monkeypatch,*,matches=None,uncertain=False):
    calls=[]
    def invoke(instruction,data,schema,image=None):
        calls.append((instruction,data,image))
        assert schema is cloud_vision.TextMeaning
        assert 'reviewed_text' not in data and '字幕' in instruction
        return schema(matches=matches if matches is not None else [{'text':'Hello','confidence':.95,'bounding_box':[.1,.2,.7,.4]}],uncertain=uncertain)
    monkeypatch.setattr(cloud_vision,'call_json',invoke)
    return calls


def test_original_text_authorization_ownership_and_archived_model_image(setup):
    client,run,_,_,monkeypatch=setup
    calls=text_model(monkeypatch)
    endpoint=f'/api/runs/{run}/interaction/text'
    payload={'query_text':'hello','current_page_no':1,'confirm_paid':True}
    assert client.post(endpoint,json=payload|{'confirm_paid':False}).status_code==422
    assert client.post(endpoint,json=payload,headers={'Authorization':'Bearer other-secret'}).status_code==404
    assert client.post(endpoint,json=payload|{'query_text':'  '}).status_code==422
    assert not calls
    result=client.post(endpoint,json=payload).json()
    assert result['status']=='located' and result['width']==32
    assert result['frame_source']=='server_original_page' and result['matches'][0]['text']=='Hello'
    import base64
    expected=base64.b64decode(calls[0][2].split(',')[1])
    route=f'/api/runs/{run}/assets/{result["evidence_asset_id"]}/content'
    assert client.get(route).content==expected
    assert client.get(route,headers={'Authorization':'Bearer other-secret'}).status_code==404
    assert any(e['event']=='text_evidence_saved' for e in client.get(url(run)).json()['events'])


@pytest.mark.parametrize('matches,uncertain,status',[
    ([],False,'not_found'),([{'text':'Hello','confidence':.99,'bounding_box':[.1,.2,.7,.4]}],True,'uncertain'),
    ([{'text':'other','confidence':.99,'bounding_box':[.1,.2,.7,.4]}],False,'uncertain'),
    ([{'text':'Hello','confidence':.79,'bounding_box':[.1,.2,.7,.4]}],False,'uncertain')])
def test_no_guessed_text_boxes(setup,matches,uncertain,status):
    client,run,_,_,monkeypatch=setup
    text_model(monkeypatch,matches=matches,uncertain=uncertain)
    result=client.post(f'/api/runs/{run}/interaction/text',json={'query_text':'hello','confirm_paid':True,'current_page_no':1}).json()
    assert result['status']==status and result['matches']==[]


@pytest.mark.parametrize('box',[[True,0,1,1],['0',0,1,1],[0,0,2,1],[.5,0,.2,1],[0,0,0,1],None,[0,0,1]])
def test_text_schema_rejects_unreliable_geometry(box):
    with pytest.raises(ValidationError):
        cloud_vision.TextMatch(text='x',confidence=.9,bounding_box=box)


def test_text_bad_model_is_not_retried(setup):
    client,run,_,_,monkeypatch=setup
    calls=[]
    def broken(*args,**kwargs):calls.append(1);raise ValueError('private upstream details')
    monkeypatch.setattr(cloud_vision,'call_json',broken)
    response=client.post(f'/api/runs/{run}/interaction/text',json={'query_text':'hello','confirm_paid':True,'current_page_no':1})
    assert response.status_code==502 and len(calls)==1 and 'private' not in response.text


def test_text_uses_registered_video_hash_time_and_server_frame(setup):
    client,run,_=video_setup(setup)
    client.post(url(run,'/video'),json={'confirm_paid':True})
    asset_id=client.get(url(run)).json()['asset_id']
    with db.get_connection() as c:
        asset=dict(c.execute('SELECT * FROM media_assets WHERE id=?',(asset_id,)).fetchone())
        page=dict(c.execute('SELECT * FROM pages LIMIT 1').fetchone())
    monkeypatch=setup[4]
    extracted=[]
    def extract(path,at):extracted.append((path,at));return Path(page['image_path']).read_bytes()
    monkeypatch.setattr(video_runtime,'extract_frame',extract)
    calls=text_model(monkeypatch)
    endpoint=f'/api/runs/{run}/interaction/text'
    body={'query_text':'hello','confirm_paid':True,'frame_kind':'video','asset_id':asset_id,'asset_sha256':asset['sha256'],'video_ms':1500,'current_page_no':1}
    for change,code in [({'asset_id':None},422),({'asset_id':'foreign'},404),({'asset_sha256':'0'*64},409),({'video_ms':3000},422)]:
        assert client.post(endpoint,json=body|change).status_code==code
    assert not calls and not extracted
    result=client.post(endpoint,json=body).json()
    assert result['frame_source']=='server_video_frame' and result['page_no']==2 and result['video_ms']==1500
    assert len(calls)==1 and extracted[0][1]==1500


def test_old_pending_task_cannot_submit_new_paid_clips_without_coverage_review(setup):
    client,run,provider=video_setup(setup)
    provider.interrupt=True
    client.post(url(run,'/video'),json={'confirm_paid':True})
    assert len(provider.posts)==1
    with db.get_connection() as c:
        task=c.execute("SELECT request_json FROM workflow_tasks WHERE run_id=? AND stage='book_video'",(run,)).fetchone()
        request=json.loads(task['request_json']);request['story'].pop('coverage_review_revision')
        c.execute("UPDATE workflow_tasks SET request_json=? WHERE run_id=? AND stage='book_video'",(json.dumps(request),run))
    provider.interrupt=False
    assert client.post(url(run,'/video/resume'),json={'confirm_paid':True}).status_code==409
    assert len(provider.posts)==1


def test_cross_page_merge_preserves_review_mapping_in_timeline_and_asset(setup):
    client,run,_,_,monkeypatch=setup
    state=prepare(client,run)
    merged=state['storyboard']['shots'][0]|{'source_page_nos':[1,2],'caption':'第一和第二页的重要事件均已核对','prompt':'先走路，再开门'}
    edited=client.put(url(run,'/storyboard'),json={'expected_revision':state['revision'],'character_guide':'乌龟','shots':[merged]}).json()
    assert client.post(url(run,'/storyboard/approve'),json={'expected_revision':edited['revision'],'coverage_confirmed':True}).status_code==200
    from test_reading_workflow import FakeVideo
    provider=FakeVideo();monkeypatch.setattr(flow,'provider_for',lambda m:provider)
    monkeypatch.setattr(video_runtime,'duration_ms',lambda p:1234)
    def compose(paths,output):output.write_bytes(b'merged-video');return [1234]
    monkeypatch.setattr(video_runtime,'concatenate',compose)
    assert client.post(url(run,'/video'),json={'confirm_paid':True}).status_code==202
    asset_id=client.get(url(run)).json()['asset_id']
    assert asset_id and len(provider.posts)==1
    with db.get_connection() as c:
        source=json.loads(c.execute('SELECT source_json FROM segments WHERE run_id=?',(run,)).fetchone()['source_json'])
        metadata=json.loads(c.execute('SELECT metadata_json FROM media_assets WHERE id=?',(asset_id,)).fetchone()['metadata_json'])
    assert source['source_page_nos']==[1,2] and source['page_no']==1
    assert metadata['pages']==[1,2] and metadata['coverage_review_revision']==edited['revision']
