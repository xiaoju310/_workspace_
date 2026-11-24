import base64
import io
import json
import pytest
from PIL import Image
from app.services import cloud_vision as vision
from app.ai import doubao_settings as settings


def test_adapter_sends_schema_and_no_retry_or_redirect(monkeypatch):
    calls=[]
    monkeypatch.setattr(vision,'vision_settings',lambda:('test-key','test-vision-model'))
    class Response:
        status_code=200
        content=b'valid'
        def json(self):return {'choices':[{'message':{'content':'```json\n'+json.dumps({'target_name':'owl','explanation':'visible','confidence':.8,'uncertain':False})+'\n```'}}]}
    def post(*args,**kwargs):calls.append((args,kwargs));return Response()
    monkeypatch.setattr(vision.requests,'post',post)
    result=vision.call_json('identify',{'point':{'norm_x':.1,'norm_y':.2}},vision.TouchMeaning,'data:image/jpeg;base64,test')
    assert result.target_name=='owl' and len(calls)==1
    payload=calls[0][1]
    assert payload['allow_redirects'] is False
    assert payload['json']['model']=='test-vision-model'
    assert payload['json']['messages'][1]['content'][1]['type']=='image_url'
    assert 'test-key' not in json.dumps(payload['json'])
    Response.status_code=302
    with pytest.raises(ValueError):vision.call_json('identify',{},vision.TouchMeaning)
    assert len(calls)==2
    Response.status_code=200
    Response.json=lambda self:{'choices':[{'message':{'content':'{"answer":"wrong schema"}'}}]}
    with pytest.raises(ValueError):vision.call_json('identify',{},vision.TouchMeaning)
    assert len(calls)==3


def test_image_complete_decode_resize_and_strip_metadata():
    image=Image.new('RGB',(2200,100),'red'); buf=io.BytesIO(); image.save(buf,'PNG')
    encoded=vision.image_data(buf.getvalue()).split(',',1)[1]
    with Image.open(io.BytesIO(base64.b64decode(encoded))) as output:
        assert output.width==1600 and output.format=='JPEG' and not output.getexif()
    for raw in [b'',b'bad',b'\x89PNG\r\n\x1a\n']:
        with pytest.raises(Exception):vision.image_data(raw)


def test_vision_model_is_separate_and_preserves_video_config(monkeypatch,tmp_path):
    monkeypatch.setenv('LOCALAPPDATA',str(tmp_path))
    monkeypatch.setenv('ARK_API_KEY','test-key')
    monkeypatch.setenv('DOUBAO_VIDEO_MODEL','test-video-model')
    monkeypatch.delenv('DOUBAO_VISION_MODEL',raising=False)
    folder=tmp_path/'PaperCompanion'/'Doubao';folder.mkdir(parents=True)
    config=folder/'models.json'; config.write_text(json.dumps({'video_model':'test-video-model'}),encoding='utf-8')
    assert settings.vision_settings()==('test-key','')
    config.write_text(json.dumps({'video_model':'test-video-model','vision_model':'test-vision-model'}),encoding='utf-8')
    if settings.os.name=='nt':assert settings.vision_settings()==('test-key','test-vision-model')
    monkeypatch.setenv('DOUBAO_VISION_MODEL','env-vision')
    assert settings.vision_settings()==('test-key','env-vision')
    assert json.loads(config.read_text())['video_model']=='test-video-model'


def test_fast_mode_is_opt_in_and_diagnostics_do_not_expose_provider_body(monkeypatch):
    monkeypatch.setattr(vision,'vision_settings',lambda:('secret','fixture'))
    calls=[]
    class Response:
        status_code=200
        content=b'ok'
        headers={'X-Request-Id':'req-123'}
        def json(self):
            return {'usage':{'prompt_tokens':100,'completion_tokens':20,'total_tokens':120,'private':'secret'},
                    'choices':[{'finish_reason':'stop','message':{'content':json.dumps({'summary':'走路','scene':'森林','entities':[],'events':['走路'],'uncertain':False})}}]}
    def post(*a,**kw):calls.append(kw);return Response()
    monkeypatch.setattr(vision.requests,'post',post)
    diagnostic={}
    vision.call_json('test',{},vision.PageMeaning,fast_mode=True,diagnostics=diagnostic,expected_model='fixture')
    assert calls[0]['json']['thinking']=={'type':'disabled'}
    assert diagnostic=={'http_status':200,'request_id':'req-123','usage':{'prompt_tokens':100,'completion_tokens':20,'total_tokens':120}}
    vision.call_json('test',{},vision.PageMeaning)
    assert 'thinking' not in calls[1]['json']
    with pytest.raises(vision.VisionError,match='MODEL_CHANGED'):
        vision.call_json('test',{},vision.PageMeaning,expected_model='changed')
    assert len(calls)==2


@pytest.mark.parametrize('failure,expected', [('timeout','TIMEOUT'),('network','NETWORK'),('limit','RATE_LIMIT'),
    ('http','HTTP_ERROR'),('json','INVALID_OUTPUT'),('length','OUTPUT_TRUNCATED')])
def test_safe_failure_categories_and_no_automatic_retry(monkeypatch,failure,expected):
    monkeypatch.setattr(vision,'vision_settings',lambda:('secret','fixture'))
    calls=[]
    class Response:
        status_code=429 if failure=='limit' else 500 if failure=='http' else 200
        content=b'sensitive provider body'
        headers={'X-Request-Id':'https://private/?secret=key'}
        def json(self):
            if failure=='json':raise ValueError('private secret')
            return {'choices':[{'finish_reason':'length','message':{'content':'truncated'}}]}
    def post(*a,**kw):
        calls.append(kw)
        if failure=='timeout':raise vision.requests.ReadTimeout('private secret')
        if failure=='network':raise vision.requests.ConnectionError('private secret')
        return Response()
    monkeypatch.setattr(vision.requests,'post',post)
    diagnostic={}
    with pytest.raises(vision.VisionError) as error:
        vision.call_json('test',{},vision.PageMeaning,diagnostics=diagnostic)
    assert str(error.value)==expected and len(calls)==1
    assert 'secret' not in json.dumps(diagnostic)


@pytest.mark.parametrize('box', [[0,0,1,1], [.1,.2,.4,.8], None])
def test_touch_box_schema_accepts_normalized_bounds(box):
    result=vision.TouchMeaning(target_name='黄瓜',explanation='green',confidence=.9,uncertain=False,bounding_box=box)
    assert result.bounding_box == (tuple(box) if box else None)


@pytest.mark.parametrize('box', [[], [0,0,1], [0,0,1,1,1], [-.1,0,1,1], [0,0,2,1], [0,0,float('nan'),1],
    [0,0,float('inf'),1], ['0',0,1,1], [False,0,1,1], [.8,0,.1,1], [0,.5,1,.5]])
def test_touch_box_schema_rejects_invalid_geometry(box):
    with pytest.raises(ValueError):
        vision.TouchMeaning(target_name='黄瓜',explanation='green',confidence=.9,uncertain=False,bounding_box=box)
