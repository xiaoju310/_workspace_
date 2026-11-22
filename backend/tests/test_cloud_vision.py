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


@pytest.mark.parametrize('box', [[0,0,1,1], [.1,.2,.4,.8], None])
def test_touch_box_schema_accepts_normalized_bounds(box):
    result=vision.TouchMeaning(target_name='黄瓜',explanation='green',confidence=.9,uncertain=False,bounding_box=box)
    assert result.bounding_box == (tuple(box) if box else None)


@pytest.mark.parametrize('box', [[], [0,0,1], [0,0,1,1,1], [-.1,0,1,1], [0,0,2,1], [0,0,float('nan'),1],
    [0,0,float('inf'),1], ['0',0,1,1], [False,0,1,1], [.8,0,.1,1], [0,.5,1,.5]])
def test_touch_box_schema_rejects_invalid_geometry(box):
    with pytest.raises(ValueError):
        vision.TouchMeaning(target_name='黄瓜',explanation='green',confidence=.9,uncertain=False,bounding_box=box)
