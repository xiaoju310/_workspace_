"""Feature acceptance with isolated data; no paid provider calls."""
import io
import json
import subprocess
import uuid
import wave
from pathlib import Path
import pytest
from test_reading_workflow import setup, prepare, video_setup, url
from app import db, workflow_routes as flow
from app.services import local_speech, video_runtime, narration
from app.services.book_retrieval import retrieve
from app.services.core import sha256_file


def test_whole_book_retrieval_reaches_late_pages_and_passages():
    pages = [{'page_no': n, 'ocr_json': json.dumps({'text':'普通的一天'})} for n in range(1,81)]
    pages[68]['ocr_json'] = json.dumps({'text':'很长的开篇。'*1500+'小海豚住在珊瑚礁旁边。'})
    material, meta = retrieve(pages, [], '小海豚住在哪里？', 2)
    assert len(material) == 12
    assert 69 in meta['selected_page_nos'] and 2 in meta['selected_page_nos']
    assert '珊瑚礁' in next(p['text'] for p in material if p['page_no']==69)
    assert meta['total_pages']==80 and meta['coverage']=='retrieved_passages_not_exhaustive'


def test_explicit_page_references_and_visual_retrieval():
    pages = [{'page_no': n, 'ocr_json':'{}'} for n in range(1,60)]
    material, meta = retrieve(pages,[{'page_no':55,'summary':'红狐狸戴着蓝色围巾'}],'第48页与红狐狸的围巾',1)
    assert material[0]['page_no']==48
    assert 55 in meta['selected_page_nos'] and 1 in meta['selected_page_nos']


def test_qa_late_page_route_preserves_retrieval_provenance(setup):
    client, run, book, calls, monkeypatch = setup
    with db.get_connection() as c:
        original = dict(c.execute('SELECT * FROM pages WHERE book_id=? LIMIT 1',(book,)).fetchone())
        for n in range(3,61):
            values = dict(original, id=str(uuid.uuid4()), page_no=n,
                ocr_json=json.dumps({'text':'海豚住在珊瑚礁' if n==57 else '普通的一天'}))
            columns = ','.join(values)
            c.execute(f"INSERT INTO pages({columns}) VALUES({','.join('?' for _ in values)})",tuple(values.values()))
    def answer(instruction, data, schema, image=None):
        assert any(p['page_no']==57 for p in data['pages'])
        return schema(answer='珊瑚礁',page_nos=[57],confidence=.9,uncertain=False)
    monkeypatch.setattr(flow.cloud_vision,'call_json',answer)
    response=client.post(f'/api/runs/{run}/interaction/qa',json={'confirm_paid':True,'query_text':'海豚住在哪里','current_page_no':1})
    assert response.status_code==200
    result=response.json()
    assert result['evidence'][0]['page_no']==57 and result['retrieval']['total_pages']==60


def test_speech_auth_consent_mime_and_upload_limit(setup):
    client, _, _, calls, monkeypatch = setup
    monkeypatch.setattr(local_speech,'capabilities',lambda:{'asr_available':True,'narration_available':True,'voices':['test']})
    assert client.get('/api/speech/capabilities',headers={'Authorization':'Bearer invalid'}).status_code==401
    assert client.post('/api/speech/transcribe',content=b'x',headers={'Content-Type':'audio/wav'}).status_code==422
    assert client.post('/api/speech/transcribe',content=b'x',headers={'Content-Type':'text/plain','X-Local-Speech-Consent':'true'}).status_code==415
    assert client.post('/api/speech/transcribe',content=b'x'*(local_speech.MAX_BYTES+1),headers={'Content-Type':'audio/wav','X-Local-Speech-Consent':'true'}).status_code==413
    seen=[]
    def fake(raw, language='zh-CN'):
        seen.append((raw, language))
        return {'text':'乌龟','is_final':True,'provider':'windows_system_speech','audio_storage':'temporary_deleted'}
    monkeypatch.setattr(local_speech,'transcribe',fake)
    result=client.post('/api/speech/transcribe',content=b'audio',headers={'Content-Type':'audio/wav','X-Local-Speech-Consent':'true'}).json()
    assert seen==[(b'audio', 'zh-CN')] and result['text']=='乌龟' and not calls
    english=client.post('/api/speech/transcribe',content=b'audio',headers={'Content-Type':'audio/wav','X-Local-Speech-Consent':'true','X-Speech-Language':'en-US'})
    assert english.status_code==200 and seen[-1]==(b'audio', 'en-US')
    assert not calls


def test_speech_failure_reports_safe_error(setup):
    client,_,_,_,monkeypatch=setup
    def failed(raw, language='zh-CN'):raise local_speech.SpeechError('本机语音组件忙',429)
    monkeypatch.setattr(local_speech,'transcribe',failed)
    result=client.post('/api/speech/transcribe',content=b'audio',headers={'Content-Type':'audio/wav','X-Local-Speech-Consent':'true'})
    assert result.status_code==429 and '本机' in result.json()['detail']


def test_narration_preflight_and_immutable_resume_snapshot(setup):
    client,run,provider=video_setup(setup)
    monkeypatch=setup[-1]
    monkeypatch.setattr(narration,'capabilities',lambda:{'narration_available':False})
    assert client.post(url(run,'/video'),json={'confirm_paid':True,'narration':True,'narration_online_consent':True}).status_code==503
    assert not provider.posts
    monkeypatch.setattr(narration,'capabilities',lambda:{'narration_available':True,'voices':[narration.VOICE], 'narration_provider':narration.PROVIDER})
    spoken=[]
    def synthesize(text,output,voice,provider):
        spoken.append((text,voice));output.write_bytes(b'fixture-wav');return 1
    monkeypatch.setattr(narration,'synthesize',synthesize)
    def compose(paths,output,narration):
        assert len(narration)==2 and all(p.read_bytes()==b'fixture-wav' for p in narration)
        output.write_bytes(b'with-audio');return [2000,2500]
    monkeypatch.setattr(video_runtime,'concatenate',compose)
    provider.interrupt=True
    client.post(url(run,'/video'),json={'confirm_paid':True,'narration':True,'narration_online_consent':True})
    assert len(provider.posts)==1
    provider.interrupt=False
    client.post(url(run,'/video/resume'),json={'confirm_paid':True,'narration':False})
    state=client.get(url(run)).json()
    assert len(provider.posts)==2 and state['asset_id'] and len(spoken)==4
    with db.get_connection() as c:
        asset=c.execute('SELECT * FROM media_assets WHERE id=?',(state['asset_id'],)).fetchone()
        request=json.loads(c.execute("SELECT request_json FROM workflow_tasks WHERE run_id=? AND stage='book_video'",(run,)).fetchone()[0])
    assert request['narration'] and json.loads(asset['metadata_json'])['narration']
    assert request['narration_provider'] == narration.PROVIDER
    assert request['narration_voice'] == narration.VOICE
    assert not list(Path(asset['file_path']).parent.glob('narration-*.wav'))


def test_local_narration_failure_never_submits_paid_clip(setup):
    client,run,provider=video_setup(setup)
    monkeypatch=setup[-1]
    monkeypatch.setattr(narration,'capabilities',lambda:{'narration_available':True,'voices':[narration.VOICE], 'narration_provider':narration.PROVIDER})
    def failed(text,output,voice,provider):
        output.write_bytes(b'partial')
        raise local_speech.SpeechError('unavailable')
    monkeypatch.setattr(narration,'synthesize',failed)
    client.post(url(run,'/video'),json={'confirm_paid':True,'narration':True,'narration_online_consent':True})
    state=client.get(url(run)).json()
    assert not provider.posts
    assert next(t for t in state['tasks'] if t['stage']=='book_video')['error_code']=='LOCAL_NARRATION_UNAVAILABLE'
    from app import main
    assert not list((main.DATA_ROOT/'runs'/run).glob('narration-*.wav'))


def test_touch_server_frame_archives_owned_verified_evidence(setup):
    client,run,provider=video_setup(setup)
    monkeypatch=setup[-1]
    client.post(url(run,'/video'),json={'confirm_paid':True})
    asset_id=client.get(url(run)).json()['asset_id']
    with db.get_connection() as c:
        asset=dict(c.execute('SELECT * FROM media_assets WHERE id=?',(asset_id,)).fetchone())
        page=dict(c.execute('SELECT * FROM pages LIMIT 1').fetchone())
    raw=Path(page['image_path']).read_bytes()
    monkeypatch.setattr(video_runtime,'extract_frame',lambda path,at:raw)
    original_model = flow.cloud_vision.call_json
    def located_model(instruction, data, schema, image=None):
        result = original_model(instruction, data, schema, image)
        if schema is flow.cloud_vision.TouchMeaning:
            return result.model_copy(update={'bounding_box': (.1, .2, .4, .8)})
        return result
    monkeypatch.setattr(flow.cloud_vision, 'call_json', located_model)
    endpoint=f'/api/runs/{run}/interaction/touch'
    payload={'confirm_paid':True,'frame_kind':'video','asset_id':asset_id,'asset_sha256':asset['sha256'],'video_ms':1500,'current_page_no':1,'touch_point':{'norm_x':.2,'norm_y':.3}}
    count=len(setup[3])
    for overrides,code in [({'asset_id':'foreign'},404),({'asset_sha256':'0'*64},409),({'video_ms':3000},422)]:
        assert client.post(endpoint,json=payload|overrides).status_code==code
    assert len(setup[3])==count
    result=client.post(endpoint,json=payload).json()
    assert result['frame_source']=='server_video_frame'
    assert result['bounding_box']==[.1,.2,.4,.8] and result['localization_status']=='located'
    assert result['evidence']['page_no']==2 # Server timeline overrides stale browser page.
    saved=result['evidence']['evidence_asset_id']
    download=f'/api/runs/{run}/assets/{saved}/content'
    assert client.get(download).content==raw
    assert client.get(download,headers={'Authorization':'Bearer other-secret'}).status_code==404
    events=client.get(url(run)).json()['events']
    record=json.loads(next(e['safe_metadata_json'] for e in events if e['event']=='touch_evidence_saved'))
    assert record['source_asset_sha256']==asset['sha256'] and record['video_ms']==1500
    assert record['bounding_box']==result['bounding_box'] and record['localization_status']=='located'


def test_real_audio_video_composition_and_frame(tmp_path):
    executable=video_runtime.ffmpeg_path()
    if not executable:pytest.skip('FFmpeg not installed')
    clip=tmp_path/'clip.mp4'
    subprocess.run([executable,'-v','error','-nostdin','-y','-f','lavfi','-i','color=c=green:s=160x120:r=24:d=0.5','-c:v','libx264',str(clip)],capture_output=True,check=True)
    audio=tmp_path/'voice.wav'
    with wave.open(str(audio),'wb') as wav:
        wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(16000);wav.writeframes(b'\0\0'*24000)
    out=tmp_path/'book.mp4'
    durations=video_runtime.concatenate([clip],out,narration=[audio])
    assert 1750<=sum(durations)<=1800 and abs(video_runtime.duration_ms(out)-sum(durations))<80
    decode=subprocess.run([executable,'-v','error','-nostdin','-i',str(out),'-map','0:a:0','-f','null','-'],capture_output=True)
    assert decode.returncode==0
    assert video_runtime.extract_frame(out,100).startswith(b'\xff\xd8')


def test_speech_timeout_and_no_secret_exception_leak(tmp_path,monkeypatch):
    def timeout(*args,**kwargs):raise subprocess.TimeoutExpired('speech',1)
    monkeypatch.setattr(subprocess,'run',timeout)
    if __import__('os').name!='nt':pytest.skip('Windows invocation')
    with pytest.raises(local_speech.SpeechError) as error:
        local_speech._invoke({'operation':'capabilities'},tmp_path)
    assert error.value.status==504


@pytest.mark.parametrize('failure',['decode','duration','recognize','success'])
def test_asr_temporary_files_deleted_and_gate_released(tmp_path,monkeypatch,failure):
    directories=[]
    monkeypatch.setattr(local_speech,'capabilities',lambda:{'asr_available':True})
    def decode(command,**kwargs):
        target=Path(command[-1]);directories.append(target.parent)
        if failure=='decode':return subprocess.CompletedProcess(command,1)
        with wave.open(str(target),'wb') as wav:
            wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(16000)
            wav.writeframes(b'\0\0'*(21*16000 if failure=='duration' else 16000))
        return subprocess.CompletedProcess(command,0)
    def invoke(request,directory):
        if failure=='recognize':raise local_speech.SpeechError('failed')
        return {'items':[{'text':'乌龟','confidence':.9}]}
    monkeypatch.setattr(local_speech.subprocess,'run',decode)
    monkeypatch.setattr(local_speech,'_invoke',invoke)
    raw=b'RIFF'+b'\0'*4+b'WAVE'+b'content'
    if failure=='success':assert local_speech.transcribe(raw)['text']=='乌龟'
    else:
        with pytest.raises(local_speech.SpeechError):local_speech.transcribe(raw)
    assert directories and all(not path.exists() for path in directories)
    assert local_speech._GATE.acquire(blocking=False)
    local_speech._GATE.release()


def test_asr_rejects_playlist_before_launching_tools(monkeypatch):
    calls=[]
    monkeypatch.setattr(local_speech.subprocess,'run',lambda *a,**k:calls.append(a))
    with pytest.raises(local_speech.SpeechError) as error:
        local_speech.transcribe(b'#EXTM3U\nhttp://internal/audio')
    assert error.value.status==422 and not calls


def test_speech_rejects_unsupported_language_without_processing(monkeypatch):
    def unexpected():
        raise AssertionError('Unsupported language must not invoke speech capabilities')
    monkeypatch.setattr(local_speech, 'capabilities', unexpected)
    with pytest.raises(local_speech.SpeechError) as error:
        local_speech.transcribe(b'RIFF0000WAVE', 'fr-FR')
    assert error.value.status == 422
