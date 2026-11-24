import io
import base64
import json
from pathlib import Path
import pytest
from PIL import Image
from test_reading_workflow import setup
from app.services import local_vision, cloud_vision


def body(**kw):
    return dict(current_page_no=1, frame_kind='page', confirm_local=True,
        touch_point={'norm_x':.5,'norm_y':.5}, **kw)


def test_local_consent_owner_and_persistence_without_cloud(setup):
    client, run, book, calls, mp = setup
    seen=[]
    def model(image, point):
        seen.append((image, point))
        return cloud_vision.TouchMeaning(target_name='乌龟',explanation='这是一只小乌龟。',confidence=.8,uncertain=False,bounding_box=(.2,.2,.8,.8))
    mp.setattr(local_vision,'recognize_touch', model)
    path=f'/api/runs/{run}/interaction/local-touch'
    assert client.post(path,json={**body(),'confirm_local':False}).status_code==422
    assert not seen and not calls
    client.headers['Authorization']='Bearer other-secret'
    assert client.post(path,json=body()).status_code==404
    assert not seen
    client.headers['Authorization']='Bearer test-secret'
    r=client.post(path,json=body())
    assert r.status_code==200, r.text
    data=r.json()
    assert data['recognition_provider']=='local_qwen' and data['target_name']=='乌龟'
    assert data['evidence']['frame_source']=='server_original_page'
    assert data['bounding_box']==[.2,.2,.8,.8]
    from app import db
    with db.get_connection() as c:
        saved=c.execute('SELECT metadata_json FROM media_assets WHERE id=?',(data['evidence']['evidence_asset_id'],)).fetchone()
    assert json.loads(saved['metadata_json'])['visual_preprocessor']==local_vision.PREPROCESSOR
    assert len(seen)==1 and not calls
    assert client.post(path,json={**body(),'touch_point':{'norm_x':2,'norm_y':.5}}).status_code==422


def test_local_failure_never_falls_back(setup):
    client,run,_,calls,mp=setup
    def error(*args): raise local_vision.LocalVisionError('本机未启动',503)
    mp.setattr(local_vision,'recognize_touch',error)
    r=client.post(f'/api/runs/{run}/interaction/local-touch',json=body(confirm_paid=True))
    assert r.status_code==503 and not calls


def test_local_capabilities_checks_owner(setup):
    client,run,_,calls,mp=setup
    mp.setattr(local_vision,'capabilities',lambda:{'available':True,'model':local_vision.MODEL})
    path=f'/api/runs/{run}/interaction/local-capabilities'
    assert client.get(path).json()['available']
    client.headers['Authorization']='Bearer other-secret'
    assert client.get(path).status_code==404
    assert not calls


def test_config_rejects_remote_and_cloud_models(tmp_path,monkeypatch):
    p=tmp_path/'config.json';monkeypatch.setenv('PAPER_LOCAL_VISION_CONFIG',str(p))
    for bad in [{'base_url':'https://remote.invalid'}, {'model':'qwen3-vl:cloud'}, {'enabled':False}, {'executable':42}, {'models_path':[]}]:
        p.write_text(json.dumps({'enabled':True,**bad}))
        assert not local_vision.settings()
    p.write_text('{bad')
    assert not local_vision.settings()


def test_adapter_structured_result_and_lock(tmp_path,monkeypatch):
    monkeypatch.setattr(local_vision,'settings',lambda:{'enabled':True})
    seen=[]
    def request(path,payload=None,timeout=3):
        seen.append(payload)
        return {'message':{'content':json.dumps({'target_name':'苹果','explanation':'这是红苹果。','confidence':.9,'uncertain':False,'bounding_box':None})}}
    monkeypatch.setattr(local_vision,'_request',request)
    buf=io.BytesIO();Image.new('RGB',(50,50),'red').save(buf,'PNG')
    image=cloud_vision.image_data(buf.getvalue())
    assert local_vision.recognize_touch(image,{'norm_x':.5,'norm_y':.5}).target_name=='苹果'
    assert seen[0]['model']==local_vision.MODEL and seen[0]['stream'] is False
    assert seen[0]['messages'][1]['images']
    assert local_vision._GATE.acquire(False)
    try:
        with pytest.raises(local_vision.LocalVisionError) as error:
            local_vision.recognize_touch(image,{'norm_x':.5,'norm_y':.5})
        assert error.value.status==429
    finally: local_vision._GATE.release()
    monkeypatch.setattr(local_vision,'_request',lambda *a,**k:{'message':{'content':'not JSON'}})
    with pytest.raises(local_vision.LocalVisionError):local_vision.recognize_touch(image,{'norm_x':.5,'norm_y':.5})
    assert local_vision._GATE.acquire(False)
    local_vision._GATE.release()


def test_request_ignores_proxy_rejects_redirect(monkeypatch):
    seen={}
    class Response:
        status_code=302
        def __enter__(self):return self
        def __exit__(self,*args):pass
    class Session:
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def request(self,method,url,**kwargs):
            seen.update(url=url,trust_env=self.trust_env,**kwargs)
            return Response()
    monkeypatch.setattr(local_vision.requests,'Session',Session)
    with pytest.raises(local_vision.LocalVisionError):local_vision._request('/api/tags')
    assert seen['url']=='http://127.0.0.1:11434/api/tags'
    assert not seen['trust_env'] and not seen['allow_redirects']


def test_uncertain_local_result_is_short_and_honest(monkeypatch):
    monkeypatch.setattr(local_vision,'settings',lambda:{'enabled':True})
    monkeypatch.setattr(local_vision,'_request',lambda *a,**k:{'message':{'content':json.dumps({
        'target_name':'不可靠名称','explanation':'冗长推测'*80,'confidence':.3,'uncertain':True,'bounding_box':None})}})
    buf=io.BytesIO();Image.new('RGB',(50,50),'red').save(buf,'PNG')
    result=local_vision.recognize_touch(cloud_vision.image_data(buf.getvalue()),{'norm_x':.5,'norm_y':.5})
    assert result.uncertain and not result.target_name and len(result.explanation)<80
    assert result.bounding_box is None


def test_touch_view_zooms_without_coloring_center():
    buf=io.BytesIO();Image.new('RGB',(1280,720),(200,30,30)).save(buf,'PNG')
    encoded=local_vision._touch_view(cloud_vision.image_data(buf.getvalue()),{'norm_x':.5,'norm_y':.5})
    with Image.open(io.BytesIO(base64.b64decode(encoded))) as view:
        assert view.size==(640,640)
        red,green,blue=view.getpixel((320,320))
        assert red>180 and green<50 and blue<50  # no marker covers the clicked pixel
        assert max(view.getpixel((335,320)))-min(view.getpixel((335,320)))<20


@pytest.mark.parametrize('x,y', [(0,0),(1,0),(0,1),(1,1),(0,.5),(1,.5),(.5,0),(.5,1)])
def test_touch_view_preserves_edge_click_not_crop_center(x,y):
    # Gradients make it possible to distinguish original-edge and shifted-center pixels.
    image=Image.new('RGB',(1280,720))
    for row in range(image.height):
        for col in range(image.width):image.putpixel((col,row),(round(col*255/1279),round(row*255/719),70))
    buf=io.BytesIO();image.save(buf,'PNG')
    encoded=local_vision._touch_view(cloud_vision.image_data(buf.getvalue()),{'norm_x':x,'norm_y':y})
    with Image.open(io.BytesIO(base64.b64decode(encoded))) as view:
        px=0 if x==0 else view.width-1 if x==1 else view.width//2
        py=0 if y==0 else view.height-1 if y==1 else view.height//2
        color=view.getpixel((px,py))
        assert abs(color[0]-round(x*255))<6 and abs(color[1]-round(y*255))<6


@pytest.mark.parametrize('point', [None,{}, {'norm_x':True,'norm_y':.5},
    {'norm_x':float('nan'),'norm_y':.5}, {'norm_x':float('inf'),'norm_y':.5},
    {'norm_x':-.1,'norm_y':.5},{'norm_x':1.1,'norm_y':.5}, {'norm_x':.5,'norm_y':'0.5'}])
def test_touch_view_rejects_bad_geometry_before_inference(point,monkeypatch):
    monkeypatch.setattr(local_vision,'settings',lambda:{'enabled':True})
    def no_call(*a,**k):pytest.fail('invalid point must not run inference')
    monkeypatch.setattr(local_vision,'_request',no_call)
    buf=io.BytesIO();Image.new('RGB',(50,50),'red').save(buf,'PNG')
    with pytest.raises(local_vision.LocalVisionError) as error:
        local_vision.recognize_touch(cloud_vision.image_data(buf.getvalue()),point)
    assert error.value.status==422
    assert local_vision._GATE.acquire(False)
    local_vision._GATE.release()


def test_touch_view_rejects_bad_image():
    for image in ['', 'data:image/jpeg;base64,not!base64', 'data:image/jpeg;base64,'+base64.b64encode(b'not an image').decode()]:
        with pytest.raises(local_vision.LocalVisionError) as error:
            local_vision._touch_view(image,{'norm_x':.5,'norm_y':.5})
        assert error.value.status==422


def test_crop_bounding_box_cannot_leak_as_full_frame(monkeypatch):
    monkeypatch.setattr(local_vision,'settings',lambda:{'enabled':True})
    seen=[]
    def request(path,payload=None,timeout=3):
        seen.append(payload)
        return {'message':{'content':json.dumps({'target_name':'苹果','explanation':'这是红苹果。',
            'confidence':.9,'uncertain':False,'bounding_box':[.2,.2,.8,.8]})}}
    monkeypatch.setattr(local_vision,'_request',request)
    buf=io.BytesIO();Image.new('RGB',(50,50),'red').save(buf,'PNG')
    result=local_vision.recognize_touch(cloud_vision.image_data(buf.getvalue()),{'norm_x':.5,'norm_y':.5})
    assert result.target_name=='苹果' and result.bounding_box is None
    assert len(seen)==1 and len(seen[0]['messages'][1]['images'])==1
    assert '/no_think' in seen[0]['messages'][1]['content']
