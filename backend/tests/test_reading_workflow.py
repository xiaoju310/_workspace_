"""所有云端调用均替换为测试模型；只在临时目录写数据，不花费额度。"""
import base64
import io
import json
import uuid
from pathlib import Path
import pytest
from PIL import Image
from fastapi.testclient import TestClient
from app import db, workflow_routes as flow
from app.main import app
from app.services import cloud_vision, video_runtime

@pytest.fixture
def setup(tmp_path, monkeypatch):
    monkeypatch.setenv('AUTH_BACKEND','legacy')
    monkeypatch.setenv('ALLOW_LEGACY_TOKENS','1')
    monkeypatch.setenv('APP_USER_TOKENS','{"owner-local":"test-secret","other":"other-secret"}')
    monkeypatch.setattr(db,'DATABASE_PATH',tmp_path/'test.db')
    monkeypatch.setattr('app.main.DATA_ROOT',tmp_path/'data')
    monkeypatch.setattr(flow,'vision_settings',lambda:('fixture-key','fixture-vision'))
    monkeypatch.setattr(flow,'video_settings',lambda:('fixture-key','fixture-video'))
    monkeypatch.setattr(video_runtime,'ffmpeg_path',lambda:'fixture-ffmpeg')
    calls=[]
    def model(instruction,data,schema,image=None):
        calls.append((instruction,data,schema,image))
        if schema is cloud_vision.PageMeaning:
            return schema(summary='小乌龟慢慢向前走',scene='森林小路',entities=[{'name':'乌龟','description':'绿色背甲','confidence':.8}],events=['乌龟向前走'],uncertain=False)
        if schema is cloud_vision.TouchMeaning:
            return schema(target_name='乌龟',explanation='点击处能看到绿色背甲',confidence=.8,uncertain=False)
        return schema(answer='乌龟在森林小路上行走。',page_nos=[1],confidence=.8,uncertain=False)
    monkeypatch.setattr(cloud_vision,'call_json',model)
    with TestClient(app) as client:
        client.headers.update({'Authorization':'Bearer test-secret'})
        book=client.post('/api/books',json={'title':'测试绘本','authorization_ref':'authorized test'}).json()['id']
        buf=io.BytesIO();Image.new('RGB',(32,32),'green').save(buf,'PNG')
        for number in [1,2]:
            assert client.post(f'/api/books/{book}/pages?page_no={number}',content=buf.getvalue(),headers={'Content-Type':'image/png'}).status_code==201
            assert client.patch(f'/api/books/{book}/pages/{number}/revision',json={'ocr':{'text':'主人校对：乌龟在走路'}}).status_code==200
        run=str(uuid.uuid4())
        with db.get_connection() as c:
            c.execute('INSERT INTO runs(id,book_id,status,config_json,model_manifest_json,created_at) VALUES(?,?,?,?,?,?)',(run,book,'SUCCEEDED','{}','{}','2026-11-16'))
        yield client,run,book,calls,monkeypatch


def url(run,suffix=''):
    return f'/api/runs/{run}/workflow'+suffix


def prepare(client,run):
    assert client.post(url(run,'/vision'),json={'page_nos':[1,2],'confirm_paid':True}).status_code==202
    assert client.post(url(run,'/storyboard')).status_code==200
    state=client.get(url(run)).json()
    assert client.post(url(run,'/storyboard/approve'),json={'expected_revision':state['revision'],'coverage_confirmed':True}).status_code==200
    return client.get(url(run)).json()


def test_pipeline_review_dedupe_preserves_corrections_and_export(setup):
    client,run,book,calls,_=setup
    initial=client.get(url(run)).json()
    assert initial['vision'] is None and initial['tasks']==[]
    assert not calls
    assert client.post(url(run,'/vision'),json={'page_nos':[1,2]}).status_code==422
    assert not calls
    result=prepare(client,run)
    assert result['approved'] and len(result['storyboard']['shots'])==2
    assert len(calls)==2 and all(c[3].startswith('data:image/jpeg;base64,') for c in calls)
    assert client.post(url(run,'/vision'),json={'page_nos':[1,2],'confirm_paid':True}).status_code==202
    assert len(calls)==2
    with db.get_connection() as c:
        pages=c.execute('SELECT ocr_json FROM pages WHERE book_id=?',(book,)).fetchall()
    assert all(json.loads(p['ocr_json'])['text']=='主人校对：乌龟在走路' for p in pages)
    with db.get_connection() as c:
        logs=[x[0] for x in c.execute('SELECT event FROM run_logs WHERE run_id=?',(run,))]
    assert 'storyboard_approved' in logs and logs.count('vision_page_completed')==2
    assert 'fixture-key' not in json.dumps(result)


def test_review_revision_and_source_invalidation(setup):
    client,run,book,_,_=setup
    state=prepare(client,run)
    story=state['storyboard']
    response=client.put(url(run,'/storyboard'),json={'expected_revision':state['revision'],'character_guide':'绿色小乌龟','shots':story['shots']})
    assert response.status_code==200
    assert not client.get(url(run)).json()['approved']
    assert client.post(url(run,'/storyboard/approve'),json={'expected_revision':state['revision'],'coverage_confirmed':True}).status_code==409
    state=client.get(url(run)).json()
    assert client.post(url(run,'/storyboard/approve'),json={'expected_revision':state['revision'],'coverage_confirmed':True}).status_code==200
    client.patch(f'/api/books/{book}/pages/1/revision',json={'ocr':{'text':'已修订'}})
    assert not client.get(url(run)).json()['approved']
    assert client.post(url(run,'/video'),json={'confirm_paid':True}).status_code==409


@pytest.mark.parametrize('path,method,body',[
    ('','get',None),('/vision','post',{'page_nos':[1],'confirm_paid':True}),('/storyboard','post',None),
    ('/storyboard','put',{'expected_revision':1,'character_guide':'','shots':[{'page_no':1,'caption':'a','prompt':'b'}]}),
    ('/storyboard/approve','post',{'expected_revision':1}),('/video','post',{'confirm_paid':True}),('/video/resume','post',{})])
def test_owner_isolation(setup,path,method,body):
    client,run,_,calls,_=setup
    response=client.request(method,url(run,path),json=body,headers={'Authorization':'Bearer other-secret'})
    assert response.status_code==404
    assert not calls


def test_missing_model_and_invalid_page_never_charge(setup):
    client,run,_,calls,monkeypatch=setup
    assert client.post(url(run,'/vision'),json={'page_nos':[1,1],'confirm_paid':True}).status_code==422
    assert client.post(url(run,'/vision'),json={'page_nos':[99],'confirm_paid':True}).status_code==404
    monkeypatch.setattr(flow,'vision_settings',lambda:('',''))
    assert client.post(url(run,'/vision'),json={'page_nos':[1],'confirm_paid':True}).status_code==503
    assert not calls


def test_bad_vision_no_retry_or_exception_leak(setup):
    client,run,_,calls,monkeypatch=setup
    def broken(*args,**kwargs):
        calls.append('broken');raise ValueError('do not leak secret or signed URL')
    monkeypatch.setattr(cloud_vision,'call_json',broken)
    assert client.post(url(run,'/vision'),json={'page_nos':[1],'confirm_paid':True}).status_code==202
    state=client.get(url(run)).json()
    assert state['tasks'][0]['status']=='FAILED'
    assert 'signed URL' not in json.dumps(state)
    assert client.post(f'/api/jobs/{state["tasks"][0]["job_id"]}/retry').status_code==409
    assert client.post(url(run,'/vision'),json={'page_nos':[1],'confirm_paid':True}).status_code==202
    assert len(calls)==1


def test_pure_illustration_failed_text_run_can_use_vision(setup):
    client,run,_,calls,_=setup
    with db.get_connection() as c:
        c.execute("UPDATE runs SET status='FAILED' WHERE id=?",(run,))
    assert client.post(url(run,'/vision'),json={'page_nos':[1],'confirm_paid':True}).status_code==202
    assert len(calls)==1 and client.get(url(run)).json()['vision']


def test_interactions_consent_real_image_and_grounded_pages(setup):
    client,run,book,calls,monkeypatch=setup
    touch=f'/api/runs/{run}/interaction/touch'
    body={'touch_point':{'norm_x':.2,'norm_y':.3},'current_page_no':1,'confirm_paid':True}
    assert client.post(touch,json=body|{'confirm_paid':False}).status_code==422
    assert client.post(touch,json=body|{'touch_point':{'norm_x':1.1,'norm_y':.3}}).status_code==422
    assert client.post(touch,json=body|{'frame_kind':'video'}).status_code==422
    assert not calls
    result=client.post(touch,json=body).json()
    assert result['target_name']=='乌龟' and result['evidence']['page_no']==1
    assert calls[0][1]['point']=={'norm_x':.2,'norm_y':.3}
    assert calls[0][3].startswith('data:image/jpeg;base64,')
    assert client.post(touch,json=body,headers={'Authorization':'Bearer other-secret'}).status_code==404
    question=f'/api/runs/{run}/interaction/qa'
    assert client.post(question,json={'query_text':'乌龟在哪？','confirm_paid':False}).status_code==422
    result=client.post(question,json={'query_text':'乌龟在哪？','confirm_paid':True}).json()
    assert result['status']=='success' and result['evidence'][0]['page_no']==1
    monkeypatch.setattr(cloud_vision,'call_json',lambda *a,**kw:cloud_vision.QAMeaning(answer='wrong',page_nos=[999],confidence=.9,uncertain=False))
    result=client.post(question,json={'query_text':'乌龟在哪？','confirm_paid':True}).json()
    assert result['status']=='no_evidence' and not result['evidence']


class FakeVideo:
    max_wait=1
    poll_interval=.001
    def __init__(self):
        self.posts=[];self.gets=[];self.interrupt=False;self.terminal=False;self.ambiguous=False
    def _json(self,method,path,payload=None):
        if method=='POST':
            self.posts.append(payload)
            if self.ambiguous:raise ValueError('network interrupted after submission')
            return {'id':f'cgt-fixture-{len(self.posts)}'}
        self.gets.append(path)
        if self.interrupt:raise ValueError('poll network')
        return {'status':'failed' if self.terminal else 'succeeded','content':{'video_url':'https://test.volces.com/fixture.mp4'}}
    def _download_video(self,url,output):
        output.write_bytes(b'fixture-video')


def video_setup(setup):
    client,run,book,calls,monkeypatch=setup
    state=prepare(client,run)
    provider=FakeVideo()
    monkeypatch.setattr(flow,'provider_for',lambda m:provider)
    monkeypatch.setattr(video_runtime,'duration_ms',lambda p:1234)
    def compose(paths,output):
        assert all(p.is_file() for p in paths)
        output.write_bytes(b'fixture-composed')
        return [1250,1750]
    monkeypatch.setattr(video_runtime,'concatenate',compose)
    return client,run,provider


def test_multi_page_video_measured_timeline_dedup_and_cascade(setup):
    client,run,provider=video_setup(setup)
    assert client.post(url(run,'/video'),json={'confirm_paid':True}).status_code==202
    state=client.get(url(run)).json()
    assert next(t for t in state['tasks'] if t['stage']=='book_video')['status']=='SUCCEEDED' and state['asset_id']
    assert len(provider.posts)==2 and all('绿色背甲' in p['content'][0]['text'] for p in provider.posts)
    segments=client.get(f'/api/runs/{run}/segments').json()
    assert [(s['page_no'],s['start_ms'],s['end_ms']) for s in segments]==[(1,0,1250),(2,1250,3000)]
    assert client.get(f'/api/runs/{run}/assets/{state["asset_id"]}/content').content==b'fixture-composed'
    assert client.post(url(run,'/video'),json={'confirm_paid':True}).status_code==202
    assert len(provider.posts)==2
    assert client.post(url(run,'/storyboard')).status_code==409
    book=setup[2]
    assert client.delete(f'/api/books/{book}').status_code==204
    with db.get_connection() as c:
        assert c.execute('SELECT count(*) FROM workflow_clips').fetchone()[0]==0
        assert c.execute('SELECT count(*) FROM reading_workflows').fetchone()[0]==0


def test_resume_reuses_task_ids_and_needs_consent_for_unsubmitted(setup):
    client,run,provider=video_setup(setup)
    provider.interrupt=True
    client.post(url(run,'/video'),json={'confirm_paid':True})
    state=client.get(url(run)).json()
    assert next(t for t in state['tasks'] if t['stage']=='book_video')['status']=='FAILED' and len(provider.posts)==1
    assert client.post(url(run,'/video/resume'),json={}).status_code==422
    provider.interrupt=False
    assert client.post(url(run,'/video/resume'),json={'confirm_paid':True}).status_code==202
    assert len(provider.posts)==2 # 第一页只继续 GET；仅第二页提交新的 POST。
    assert client.get(url(run)).json()['asset_id']


@pytest.mark.parametrize('failure',['terminal','ambiguous'])
def test_terminal_or_uncertain_never_resubmitted(setup,failure):
    client,run,provider=video_setup(setup)
    setattr(provider,failure,True)
    client.post(url(run,'/video'),json={'confirm_paid':True})
    assert client.post(url(run,'/video/resume'),json={'confirm_paid':True}).status_code==409
    assert len(provider.posts)==1


def test_unapproved_missing_composer_never_submit(setup):
    client,run,_,_,monkeypatch=setup
    assert client.post(url(run,'/video'),json={'confirm_paid':True}).status_code==409
    prepare(client,run)
    monkeypatch.setattr(video_runtime,'ffmpeg_path',lambda:None)
    assert client.post(url(run,'/video'),json={'confirm_paid':True}).status_code==503


def test_real_local_composition_without_paid_provider(tmp_path):
    import subprocess
    ffmpeg=video_runtime.ffmpeg_path()
    if not ffmpeg:pytest.skip('No local FFmpeg')
    paths=[]
    for index,color in enumerate(['red','green']):
        path=tmp_path/f'page-{index}.mp4'
        subprocess.run([ffmpeg,'-v','error','-y','-f','lavfi','-i',f'color=c={color}:s=160x120:r=24:d=0.5','-an','-c:v','libx264','-pix_fmt','yuv420p',str(path)],check=True,capture_output=True,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        paths.append(path)
    durations=video_runtime.concatenate(paths,tmp_path/'book.mp4')
    assert durations==[500,500]
    assert abs(video_runtime.duration_ms(tmp_path/'book.mp4')-1000)<80
    bad=tmp_path/'bad.mp4';bad.write_bytes(b'\x00\x00\x00\x18ftypisom')
    with pytest.raises(ValueError):video_runtime.duration_ms(bad)


def test_reviewed_visual_storyboard_note_is_private_and_reuses_server_content(setup):
    client,run,book,_,_=setup
    with db.get_connection() as c:
        c.execute("UPDATE runs SET status='FAILED' WHERE id=?",(run,))
    prepare(client,run)
    response=client.post(f'/api/books/{book}/notes/generate',json={'note_template':'standard'})
    assert response.status_code==201
    note=response.json()
    assert note['status']=='DRAFT'
    assert note['content']['summary']=='小乌龟慢慢向前走\n\n小乌龟慢慢向前走'
    assert note['content']['summary_method']=='owner_reviewed_visual_storyboard'
    assert note['content']['sources'][1]['page_no']==2
    assert client.post(f'/api/notes/{note["id"]}/shares',json={'share_mode':'link'}).status_code==409
    client.patch(f'/api/books/{book}/pages/1/revision',json={'ocr':{'text':'changed'}})
    assert client.post(f'/api/books/{book}/notes/generate',json={'note_template':'standard'}).status_code==409


def test_single_page_video_cannot_override_book_timeline(setup):
    client,run,provider=video_setup(setup)
    client.post(url(run,'/video'),json={'confirm_paid':True})
    response=client.post(f'/api/runs/{run}/video',json={'page_no':1,'prompt':'test','duration':5,'confirm_paid':True})
    assert response.status_code==409
    assert len(provider.posts)==2

@pytest.mark.parametrize('raw',['not base64!','aGVsbG8='])
def test_invalid_video_snapshot_does_not_call_provider(setup,raw):
    client,run,_,calls,_=setup
    response=client.post(f'/api/runs/{run}/interaction/touch',json={'confirm_paid':True,'current_page_no':1,'frame_kind':'video','frame_image_base64':raw,'touch_point':{'norm_x':.5,'norm_y':.5}})
    assert response.status_code==422 and not calls


def test_background_worker_can_only_claim_once(setup):
    client,run,_,calls,_=setup
    prepare(client,run)
    flow.run_vision(run)
    flow.run_vision(run)
    assert len(calls)==2


def test_generation_receipts_follow_real_workflow_and_resume(setup):
    """API-to-worker-to-receipt check with the isolated fake provider, never paid."""
    client, run, provider = video_setup(setup)
    with db.get_connection() as c:
        book = c.execute('SELECT book_id FROM runs WHERE id=?', (run,)).fetchone()[0]
    receipts_url = f'/api/books/{book}/generation-records'
    provider.interrupt = True
    assert client.post(url(run, '/video'), json={'confirm_paid': True}).status_code == 202
    records = client.get(receipts_url).json()['records']
    vision = next(r for r in records if r['stage'] == 'vision')
    video = next(r for r in records if r['stage'] == 'book_video')
    assert vision['completed_vision_calls'] == 2 and vision['page_nos'] == [1, 2]
    assert video['status'] == 'FAILED' and video['page_nos'] == [1, 2]
    assert video['submitted_count'] == 1 and video['downloaded_count'] == 0
    assert video['uncertain_count'] == 0 and video['amount'] is None
    original_job = video['job_id']
    provider.interrupt = False
    assert client.post(url(run, '/video/resume'), json={'confirm_paid': True}).status_code == 202
    completed = client.get(receipts_url).json()['records']
    videos = [r for r in completed if r['stage'] == 'book_video']
    assert len(videos) == 1 and videos[0]['job_id'] == original_job
    assert videos[0]['status'] == 'SUCCEEDED'
    assert videos[0]['submitted_count'] == videos[0]['downloaded_count'] == 2
    assert videos[0]['amount'] is None and len(provider.posts) == 2


@pytest.mark.parametrize('confidence,uncertain,name',[(.59,False,'黄瓜'),(.9,True,'辣椒'),(.9,False,'   ')])
def test_touch_uncertain_never_exposes_a_confident_target(setup,confidence,uncertain,name):
    client,run,_,_,monkeypatch=setup
    monkeypatch.setattr(cloud_vision,'call_json',lambda *a,**kw:cloud_vision.TouchMeaning(
        target_name=name,explanation='画面不够清楚，请重新选择物体',confidence=confidence,uncertain=uncertain))
    response=client.post(f'/api/runs/{run}/interaction/touch',json={
        'confirm_paid':True,'current_page_no':1,'touch_point':{'norm_x':.25,'norm_y':.5}})
    assert response.status_code==200
    result=response.json()
    assert result['status']=='uncertain' and result['target_name']==''
    with db.get_connection() as c:
        asset=c.execute("SELECT metadata_json FROM media_assets WHERE id=?",(result['evidence']['evidence_asset_id'],)).fetchone()
    record=json.loads(asset['metadata_json'])
    assert record['status']=='uncertain' and record['target_name']==''


def test_touch_saves_verifiable_original_page_evidence(setup):
    import hashlib
    client,run,_,calls,_=setup
    response=client.post(f'/api/runs/{run}/interaction/touch',json={
        'confirm_paid':True,'current_page_no':2,'frame_kind':'page','video_ms':12000,
        'touch_point':{'norm_x':.25,'norm_y':.5}})
    assert response.status_code==200
    result=response.json()
    assert result['frame_source']=='server_original_page'
    assert result['evidence']['page_no']==2
    with db.get_connection() as c:
        asset=c.execute('SELECT * FROM media_assets WHERE id=? AND run_id=?',
            (result['evidence']['evidence_asset_id'],run)).fetchone()
        logs=c.execute("SELECT safe_metadata_json FROM run_logs WHERE run_id=? AND event='touch_evidence_saved'",(run,)).fetchall()
    raw=Path(asset['file_path']).read_bytes()
    assert hashlib.sha256(raw).hexdigest()==result['evidence']['frame_sha256']==asset['sha256']
    assert len(logs)==1
    record=json.loads(asset['metadata_json'])
    assert record['page_no']==2 and record['video_ms']==12000
    assert record['point']=={'norm_x':.25,'norm_y':.5}
    assert len(calls)==1 and calls[0][3].startswith('data:image/jpeg;base64,')


def test_touch_provider_failure_is_not_retried_or_reported_as_success(setup):
    client,run,_,_,monkeypatch=setup
    calls=[]
    def failed(*args,**kwargs):
        calls.append(True)
        raise RuntimeError('private-provider-secret')
    monkeypatch.setattr(cloud_vision,'call_json',failed)
    response=client.post(f'/api/runs/{run}/interaction/touch',json={
        'confirm_paid':True,'current_page_no':1,'touch_point':{'norm_x':.25,'norm_y':.5}})
    assert response.status_code==502 and len(calls)==1
    assert 'private-provider-secret' not in response.text
    with db.get_connection() as c:
        assert c.execute("SELECT count(*) AS n FROM run_logs WHERE run_id=? AND event='touch_evidence_saved'",(run,)).fetchone()['n']==0


@pytest.mark.parametrize('box,confidence,uncertain,expected', [
    ([.1,.2,.4,.8],.9,False,[.1,.2,.4,.8]),
    ([.6,0,1,1],.9,False,None),
    ([.1,.2,.4,.8],.59,False,None),
    ([.1,.2,.4,.8],.9,True,None),
    (None,.9,False,None),
])
def test_touch_bounds_are_verified_returned_and_archived(setup,box,confidence,uncertain,expected):
    client,run,_,_,monkeypatch=setup
    monkeypatch.setattr(cloud_vision,'call_json',lambda *a,**kw:cloud_vision.TouchMeaning(
        target_name='黄瓜',explanation='绿色蔬菜',confidence=confidence,uncertain=uncertain,bounding_box=box))
    response=client.post(f'/api/runs/{run}/interaction/touch',json={
        'confirm_paid':True,'current_page_no':1,'touch_point':{'norm_x':.25,'norm_y':.5}})
    assert response.status_code==200
    result=response.json()
    assert result['bounding_box']==expected
    expected_status='uncertain' if uncertain or confidence<.6 else ('located' if expected else 'unavailable')
    assert result['localization_status']==expected_status
    with db.get_connection() as c:
        asset=c.execute('SELECT metadata_json FROM media_assets WHERE id=?',(result['evidence']['evidence_asset_id'],)).fetchone()
        log=c.execute("SELECT safe_metadata_json FROM run_logs WHERE run_id=? AND event='touch_evidence_saved'",(run,)).fetchone()
    assert json.loads(asset['metadata_json'])['bounding_box']==expected
    assert json.loads(log['safe_metadata_json'])['localization_status']==expected_status


def test_touch_invalid_model_box_is_failure_without_retry(setup):
    client,run,_,_,monkeypatch=setup
    calls=[]
    def invalid(*args,**kwargs):
        calls.append(True)
        return cloud_vision.TouchMeaning(target_name='黄瓜',explanation='green',confidence=.9,uncertain=False,bounding_box=[-1,0,1,1])
    monkeypatch.setattr(cloud_vision,'call_json',invalid)
    response=client.post(f'/api/runs/{run}/interaction/touch',json={
        'confirm_paid':True,'current_page_no':1,'touch_point':{'norm_x':.25,'norm_y':.5}})
    assert response.status_code==502 and len(calls)==1
    with db.get_connection() as c:
        assert c.execute("SELECT count(*) AS n FROM run_logs WHERE run_id=? AND event='touch_evidence_saved'",(run,)).fetchone()['n']==0
