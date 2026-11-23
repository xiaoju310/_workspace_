"""Paid requests are fakes; verify concurrency, durable progress and safe recovery."""
import io
import json
import threading
from PIL import Image
from app import db, workflow_routes as flow
from app.services import cloud_vision
from test_reading_workflow import setup, url


def add_pages(client, book):
    image = io.BytesIO()
    Image.new('RGB', (32, 32), 'blue').save(image, 'PNG')
    for n in (3, 4):
        assert client.post(f'/api/books/{book}/pages?page_no={n}', content=image.getvalue(),
                           headers={'Content-Type': 'image/png'}).status_code == 201


def test_two_workers_overlap_and_preserve_out_of_order_results(setup):
    client, run, book, calls, monkeypatch = setup
    add_pages(client, book)
    original = cloud_vision.call_json
    barrier = threading.Barrier(2)
    second_saved = threading.Event()
    lock = threading.Lock()
    active = peak = 0

    def model(instruction, data, schema, image=None, **options):
        nonlocal active, peak
        with lock:
            active += 1
            peak = max(peak, active)
        assert options['fast_mode'] is True
        assert options['expected_model'] == 'fixture-vision'
        barrier.wait(timeout=5)
        if data['page_no'] == 1:
            assert second_saved.wait(5)
        if data['page_no'] == 2:
            second_saved.set()
        with lock:
            active -= 1
        return original(instruction, data, schema, image)

    monkeypatch.setattr(cloud_vision, 'call_json', model)
    assert client.post(url(run, '/vision'), json={'page_nos': [1,2,3,4], 'confirm_paid': True}).status_code == 202
    state = client.get(url(run)).json()
    assert peak == 2
    assert [p['page_no'] for p in state['vision']] == [1,2,3,4]
    assert all(p['status'] == 'SUCCEEDED' and p['diagnostics']['elapsed_ms'] >= 0 for p in state['vision_progress'])
    assert state['tasks'][0]['status'] == 'SUCCEEDED' and len(calls) == 4
    client.post(url(run, '/vision'), json={'page_nos': [1,2,3,4], 'confirm_paid': True})
    assert len(calls) == 4


def test_timeout_stops_new_requests_resume_only_pending_and_never_recharges_success(setup):
    client, run, book, calls, monkeypatch = setup
    add_pages(client, book)
    original = cloud_vision.call_json
    def model(instruction, data, schema, image=None, **options):
        if data['page_no'] == 2:
            calls.append('timed out')
            raise cloud_vision.VisionError('TIMEOUT')
        return original(instruction, data, schema, image)
    monkeypatch.setattr(cloud_vision, 'call_json', model)
    body = {'page_nos': [1,2,3,4], 'concurrency': 1, 'fast_mode': False, 'confirm_paid': True}
    client.post(url(run, '/vision'), json=body)
    state = client.get(url(run)).json()
    assert [p['status'] for p in state['vision_progress']] == ['SUCCEEDED','UNCERTAIN','PENDING','PENDING']
    assert len(calls) == 2 and state['vision_resume_available']
    assert client.post(url(run, '/vision/resume'), json={}).status_code == 422
    assert client.post(url(run, '/vision/resume'), json={'confirm_paid': True},
                       headers={'Authorization':'Bearer other-secret'}).status_code == 404
    client.post(url(run, '/vision/resume'), json={'confirm_paid': True})
    state = client.get(url(run)).json()
    assert [p['page_no'] for p in state['vision']] == [1,3,4]
    assert len(calls) == 4 and not state['vision_resume_available']
    assert client.post(url(run, '/vision/resume'), json={'confirm_paid': True}).status_code == 409
    assert client.post(url(run, '/vision'), json=body).status_code == 202
    assert len(calls) == 4
    assert client.post(url(run, '/storyboard')).status_code == 409


def test_inflight_success_is_saved_when_peer_fails(setup):
    client, run, _, calls, monkeypatch = setup
    original = cloud_vision.call_json
    barrier = threading.Barrier(2)
    def model(instruction, data, schema, image=None, **options):
        barrier.wait(timeout=5)
        if data['page_no'] == 1:
            raise cloud_vision.VisionError('RATE_LIMIT')
        return original(instruction, data, schema, image)
    monkeypatch.setattr(cloud_vision, 'call_json', model)
    client.post(url(run, '/vision'), json={'page_nos':[1,2], 'confirm_paid':True})
    state = client.get(url(run)).json()
    assert state['tasks'][0]['status'] == 'FAILED'
    assert [p['page_no'] for p in state['vision']] == [2]
    assert [p['status'] for p in state['vision_progress']] == ['UNCERTAIN','SUCCEEDED']


def test_local_failure_can_resume_to_completion_and_make_story(setup):
    client, run, _, calls, monkeypatch = setup
    original = flow.validated_page
    def damaged(page):
        # The POST preflight is valid; fail during the worker before submission.
        if threading.current_thread().name.startswith('ThreadPoolExecutor'):
            raise ValueError('private path must never leak')
        return original(page)
    monkeypatch.setattr(flow, 'validated_page', damaged)
    body = {'page_nos':[1,2], 'confirm_paid':True, 'concurrency':1}
    client.post(url(run, '/vision'), json=body)
    state = client.get(url(run)).json()
    assert not calls and state['vision_resume_available']
    assert all(p['status'] == 'PENDING' for p in state['vision_progress'])
    assert 'private path' not in json.dumps(state)
    monkeypatch.setattr(flow, 'validated_page', original)
    client.post(url(run, '/vision/resume'), json={'confirm_paid':True})
    assert client.get(url(run)).json()['tasks'][0]['status'] == 'SUCCEEDED'
    assert client.post(url(run, '/storyboard')).status_code == 200
    assert len(calls) == 2


def test_legacy_serial_failure_recovers_only_pages_after_ambiguous_page(setup):
    client, run, book, calls, _ = setup
    add_pages(client, book)
    client.post(url(run, '/vision'), json={'page_nos':[1], 'confirm_paid':True})
    with db.get_connection() as c:
        c.execute('DELETE FROM vision_pages WHERE run_id=?', (run,))
        task = c.execute('SELECT * FROM workflow_tasks WHERE run_id=?', (run,)).fetchone()
        request = json.loads(task['request_json'])
        request.update(page_nos=[1,2,3,4])
        request.pop('ledger_version')
        request.pop('concurrency')
        request.pop('fast_mode')
        c.execute('UPDATE workflow_tasks SET request_json=? WHERE run_id=?', (json.dumps(request),run))
        c.execute("UPDATE jobs SET status='FAILED' WHERE id=?", (task['job_id'],))
    state = client.get(url(run)).json()
    assert [(p['page_no'],p['status']) for p in state['vision_progress']] == [(1,'SUCCEEDED'),(2,'UNCERTAIN'),(3,'PENDING'),(4,'PENDING')]
    client.post(url(run, '/vision/resume'), json={'confirm_paid':True})
    assert [p['page_no'] for p in client.get(url(run)).json()['vision']] == [1,3,4]
    assert len(calls) == 3


def test_resume_refuses_changed_source_and_restart_marks_submitting_uncertain(setup):
    client, run, book, calls, monkeypatch = setup
    monkeypatch.setattr(flow, 'run_vision', lambda *a: None)
    client.post(url(run, '/vision'), json={'page_nos':[1,2], 'confirm_paid':True})
    with db.get_connection() as c:
        c.execute("UPDATE vision_pages SET status='SUBMITTING' WHERE run_id=? AND page_no=1", (run,))
    db.initialize_database()
    state = client.get(url(run)).json()
    assert [p['status'] for p in state['vision_progress']] == ['UNCERTAIN','PENDING']
    assert client.post(url(run, '/vision/resume'), json={'confirm_paid':True}).status_code == 202
    state = client.get(url(run)).json()
    assert [p['status'] for p in state['vision_progress']] == ['UNCERTAIN','PENDING']
    db.initialize_database()
    client.patch(f'/api/books/{book}/pages/2/revision', json={'ocr':{'text':'changed'}})
    assert client.post(url(run, '/vision/resume'), json={'confirm_paid':True}).status_code == 409
    assert not calls


def test_reuse_matching_saved_page_clears_failed_batch_without_paid_call(setup):
    client, run, book, calls, monkeypatch = setup
    donor = 'donor-run'
    with db.get_connection() as c:
        c.execute('INSERT INTO runs(id,book_id,status,config_json,model_manifest_json,created_at) VALUES(?,?,?,?,?,?)',
                  (donor,book,'SUCCEEDED','{}','{}','2026-11-16'))
    assert client.post(url(donor, '/vision'), json={'page_nos':[1,2], 'confirm_paid':True}).status_code == 202
    original = cloud_vision.call_json
    def fail_second(instruction, data, schema, image=None, **options):
        if data['page_no'] == 2:
            raise cloud_vision.VisionError('TIMEOUT')
        return original(instruction, data, schema, image)
    monkeypatch.setattr(cloud_vision, 'call_json', fail_second)
    assert client.post(url(run, '/vision'), json={'page_nos':[1,2], 'concurrency':1, 'confirm_paid':True}).status_code == 202
    state = client.get(url(run)).json()
    assert state['reusable_vision_page_nos'] == [2]
    assert state['tasks'][0]['status'] == 'FAILED'
    paid_before = len(calls)
    assert client.post(url(run, '/vision/reuse'), headers={'Authorization':'Bearer other-secret'}).status_code == 404
    reused = client.post(url(run, '/vision/reuse'))
    assert reused.status_code == 200 and reused.json()['reused_page_nos'] == [2]
    state = client.get(url(run)).json()
    assert len(calls) == paid_before
    assert [p['page_no'] for p in state['vision']] == [1,2]
    assert state['tasks'][0]['status'] == 'SUCCEEDED'
    assert state['reusable_vision_page_nos'] == []
    assert state['vision_progress'][1]['diagnostics']['reused_from_run_id'] == donor
    assert client.post(url(run, '/storyboard')).status_code == 200
    assert client.post(url(run, '/vision/reuse')).status_code == 409


def test_uncertain_retry_requires_explicit_paid_consent_and_excludes_saved_pages(setup):
    client, run, _, calls, monkeypatch = setup
    original = cloud_vision.call_json
    def fail_second(instruction, data, schema, image=None, **options):
        if data['page_no'] == 2:
            raise cloud_vision.VisionError('TIMEOUT')
        return original(instruction, data, schema, image)
    monkeypatch.setattr(cloud_vision, 'call_json', fail_second)
    assert client.post(url(run, '/vision'), json={'page_nos':[1,2], 'concurrency':1, 'confirm_paid':True}).status_code == 202
    monkeypatch.setattr(cloud_vision, 'call_json', original)
    assert client.get(url(run)).json()['reusable_vision_page_nos'] == []
    assert client.post(url(run, '/vision/retry'), json={'page_nos':[2]}).status_code == 422
    assert client.post(url(run, '/vision/retry'), json={'page_nos':[1], 'confirm_paid':True}).status_code == 409
    assert client.post(url(run, '/vision/retry'), json={'page_nos':[2], 'confirm_paid':True},
                       headers={'Authorization':'Bearer other-secret'}).status_code == 404
    assert client.post(url(run, '/vision/retry'), json={'page_nos':[2], 'confirm_paid':True}).status_code == 202
    state = client.get(url(run)).json()
    assert [p['page_no'] for p in state['vision']] == [1,2]
    assert all(p['status'] == 'SUCCEEDED' for p in state['vision_progress'])
    assert len(calls) == 2
    assert client.post(url(run, '/storyboard')).status_code == 200
