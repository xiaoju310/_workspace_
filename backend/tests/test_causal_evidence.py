import json
import pytest
from app.services.causal_evidence import supported_cause
from app.services import cloud_vision
from test_reading_workflow import setup


@pytest.mark.parametrize('text,question,valid',[
    ('小禾拿起书。因为下雨，小鸟飞回家。','小禾为什么拿起书？',False),
    ('小禾拿起书。因为下雨，小鸟飞回家。','小鸟为什么飞回家？',True),
    ('小禾因为下雨，小鸟拿起书。','小禾为什么拿起书？',False),
    ('小禾为了学习生字，拿起书。','小禾为什么拿起书？',True),
    ('因为下雨，小禾拿起书。','小禾为什么拿起书？',True),
    ('小禾拿起书，因为要学习。','小禾为什么拿起书？',True),
    ('小禾拿起书，小鸟因为下雨，飞回家。','小禾为什么拿起书？',False),
    ('因为下雨，小鸟飞回家，小禾拿起书。','小禾为什么拿起书？',False),
    ('小禾看见小鸟拿起书，因为要学习。','小禾为什么拿起书？',False),
    ('因为下雨，小禾没有拿起书。','小禾为什么拿起书？',False),
    ('Xiaohe picks up a book. Birds fly home because it rains.','Why does Xiaohe picks up a book?',False),
    ('Birds do not fly home because it rains.','Why do birds fly home?',False),
    ('Xiaohe picked up a book. A bird flew home because it rained.','Why did Xiaohe pick up a book?',False),
    ('Birds fly home because it rains.','Why do birds fly home?',True),
])
def test_explicit_cause_binding(text,question,valid):
    assert bool(supported_cause(question,text)) is valid


@pytest.mark.parametrize('correct',[False,True])
def test_server_cannot_trust_model_confidence_or_answer(setup,correct):
    client,run,book,_,monkeypatch=setup
    text='小禾为了学习生字，拿起书。' if correct else '小禾拿起书。因为下雨，小鸟飞回家。'
    assert client.patch(f'/api/books/{book}/pages/1/revision',json={'ocr':{'text':text}}).status_code==200
    def model(*args,**kwargs):
        return cloud_vision.QAMeaning(answer='因为下雨，小禾拿起书。',page_nos=[1],confidence=.99,uncertain=False)
    monkeypatch.setattr(cloud_vision,'call_json',model)
    result=client.post(f'/api/runs/{run}/interaction/qa',json={'query_text':'小禾为什么拿起书？','session_id':'causal','confirm_paid':True}).json()
    assert result['status']==('success' if correct else 'no_evidence')
    assert '因为下雨，小禾拿起书' not in result['answer']
    if correct:
        assert '为了学习生字' in result['answer']
    else:
        assert result['evidence']==[] and result['confidence']==0
        from app import db
        with db.get_connection() as c:
            history=dict(c.execute('SELECT answer,page_nos_json FROM reading_dialogue WHERE run_id=?',(run,)).fetchone())
        assert history['answer']=='未找到可靠依据' and json.loads(history['page_nos_json'])==[]
