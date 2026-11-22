"""Conversation context regression: isolated database, model replaced by fixture, no paid calls."""
import json
import uuid

import pytest
from test_reading_workflow import setup
from app import db
from app.services import cloud_vision


def ask(client, run, text, session='session-a'):
    body = {'query_text': text, 'confirm_paid': True, 'current_page_no': 1}
    if session is not None:
        body['session_id'] = session
    result = client.post(f'/api/runs/{run}/interaction/qa', json=body)
    assert result.status_code == 200, result.text
    return result.json()


def test_followup_receives_prior_question_and_touch_in_order(setup):
    client, run, _, calls, _ = setup
    assert ask(client, run, 'Where is the turtle?')['status'] == 'success'
    assert calls[-1][1]['history'] == []
    touch = client.post(f'/api/runs/{run}/interaction/touch', json={
        'confirm_paid': True, 'session_id': 'session-a', 'current_page_no': 1,
        'touch_point': {'norm_x': .2, 'norm_y': .3}})
    assert touch.status_code == 200 and touch.json()['status'] == 'success'
    ask(client, run, 'What is it doing?')
    history = calls[-1][1]['history']
    assert [item['kind'] for item in history] == ['question', 'touch']
    assert history[0]['question'] == 'Where is the turtle?'
    assert '乌龟' in history[1]['answer']
    assert all(json.loads(item['page_nos_json']) == [1] for item in history)


def test_other_session_and_legacy_no_session_cannot_receive_history(setup):
    client, run, _, calls, _ = setup
    ask(client, run, 'private question')
    ask(client, run, 'fresh question', 'session-b')
    assert calls[-1][1]['history'] == []
    ask(client, run, 'legacy question', None)
    assert calls[-1][1]['history'] == []
    ask(client, run, 'followup')
    assert [h['question'] for h in calls[-1][1]['history']] == ['private question']


@pytest.mark.parametrize('new_book', [False, True])
def test_other_run_or_book_cannot_receive_history(setup, new_book):
    client, run, book, calls, _ = setup
    ask(client, run, 'old run question')
    if new_book:
        book = client.post('/api/books', json={'title': 'Other book', 'authorization_ref': 'fixture'}).json()['id']
    other = str(uuid.uuid4())
    with db.get_connection() as c:
        c.execute('INSERT INTO runs(id,book_id,status,config_json,model_manifest_json,created_at) VALUES(?,?,?,?,?,?)',
                  (other, book, 'SUCCEEDED', '{}', '{}', '2026-11-22'))
    ask(client, other, 'fresh question')
    assert calls[-1][1]['history'] == []
    ask(client, run, 'old run followup')
    assert [h['question'] for h in calls[-1][1]['history']] == ['old run question']


def test_other_owner_cannot_access_or_append_dialogue(setup):
    client, run, _, calls, _ = setup
    ask(client, run, 'private question')
    count = len(calls)
    response = client.post(f'/api/runs/{run}/interaction/qa', json={
        'query_text': 'unauthorized', 'confirm_paid': True, 'session_id': 'session-a'},
        headers={'Authorization': 'Bearer other-secret'})
    assert response.status_code == 404 and len(calls) == count
    ask(client, run, 'followup')
    assert [h['question'] for h in calls[-1][1]['history']] == ['private question']


def test_corrected_source_invalidates_old_context(setup):
    client, run, book, calls, _ = setup
    ask(client, run, 'before correction')
    response = client.patch(f'/api/books/{book}/pages/1/revision', json={'ocr': {'text': '校对后：兔子在奔跑'}})
    assert response.status_code == 200
    ask(client, run, 'after correction')
    assert calls[-1][1]['history'] == []
    ask(client, run, 'new followup')
    assert [h['question'] for h in calls[-1][1]['history']] == ['after correction']


def test_history_is_bounded_to_last_sixteen_in_chronological_order(setup):
    client, run, _, calls, _ = setup
    for index in range(18):
        ask(client, run, f'question-{index}')
    assert [h['question'] for h in calls[-1][1]['history']] == [f'question-{i}' for i in range(1, 17)]


def test_unverified_answer_never_becomes_confident_history(setup):
    client, run, _, calls, monkeypatch = setup
    def model(instruction, data, schema, image=None):
        calls.append((instruction, data, schema, image))
        return cloud_vision.QAMeaning(answer='unverified invented secret', page_nos=[999], confidence=.9, uncertain=False)
    monkeypatch.setattr(cloud_vision, 'call_json', model)
    assert ask(client, run, 'no evidence question')['status'] == 'no_evidence'
    ask(client, run, 'followup')
    history = calls[-1][1]['history']
    assert len(history) == 1 and history[0]['answer'] == '未找到可靠依据'
    assert json.loads(history[0]['page_nos_json']) == []
    assert 'unverified invented secret' not in json.dumps(history)
