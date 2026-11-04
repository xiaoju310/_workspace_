"""A 负责接口的最小成功/失败验收。"""
import hashlib
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import db
from app.main import app


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("APP_USER_TOKENS", '{"owner-local":"test-secret","other":"other-secret"}')
    database = tmp_path / "test.db"
    monkeypatch.setattr(db, "DATABASE_PATH", database)
    monkeypatch.setattr("app.main.DATA_ROOT", tmp_path / "data")
    with TestClient(app) as value:
        value.headers.update({"Authorization": "Bearer test-secret"})
        yield value


def create_confirmed_book(client: TestClient) -> str:
    book = client.post("/api/books", json={"title": "示例绘本", "authorization_ref": "local-test"})
    assert book.status_code == 201
    book_id = book.json()["id"]
    assert client.post(f"/api/books/{book_id}/classify").status_code == 200
    assert client.patch(f"/api/books/{book_id}/classification", json={"confirmed_type": "picture_book"}).status_code == 200
    png = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\x0dIHDR" + b"test-image"
    assert client.post(f"/api/books/{book_id}/pages?page_no=1", content=png, headers={"content-type": "image/png"}).status_code == 201
    return book_id


def test_book_page_hash_and_duplicate_rejection(client: TestClient) -> None:
    book_id = create_confirmed_book(client)
    payload = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\x0dIHDR" + b"another-image"
    response = client.post(f"/api/books/{book_id}/pages?page_no=2", content=payload, headers={"content-type": "image/png"})
    assert response.status_code == 201
    assert response.json()["page_no"] == 2
    assert response.json()["sha256"] == hashlib.sha256(payload).hexdigest()
    duplicate = client.post(f"/api/books/{book_id}/pages?page_no=2", content=payload, headers={"content-type": "image/png"})
    assert duplicate.status_code == 409
    invalid = client.post(f"/api/books/{book_id}/pages?page_no=3", content=b"x", headers={"content-type": "text/plain"})
    assert invalid.status_code == 415


def test_analysis_note_review_and_share_flow(client: TestClient) -> None:
    book_id = create_confirmed_book(client)
    job = client.post(f"/api/books/{book_id}/analyze", json={"analysis_profile": "picture_book"})
    assert job.status_code == 202
    assert client.get(f"/api/jobs/{job.json()['job_id']}").json()["status"] == "FAILED"
    assert client.post(f"/api/books/{book_id}/notes/generate", json={}).status_code == 409
    # 等 B 提供真实分析后才可调用生成笔记。这里仅在隔离测试库中放入已核对的分析状态。
    with db.get_connection() as connection:
        connection.execute("UPDATE books SET status='ANALYZED' WHERE id=?", (book_id,))
        connection.execute("INSERT INTO runs(id,book_id,status,config_json,model_manifest_json,created_at) VALUES(?,?,?,?,?,?)",
                           ("verified-run-" + book_id, book_id, "SUCCEEDED", "{}", "{}", "2026-01-01T00:00:00+00:00"))
    note_response = client.post(f"/api/books/{book_id}/notes/generate", json={})
    assert note_response.status_code == 201
    note_id = note_response.json()["id"]
    blocked = client.post(f"/api/notes/{note_id}/shares", json={"share_mode": "link"})
    assert blocked.status_code == 409
    assert client.post(f"/api/notes/{note_id}/review", json={"action": "approve"}).status_code == 409
    edited = client.patch(f"/api/notes/{note_id}", json={"content": {"summary": "人工校对摘要", "sources": [{"page_no": 1}], "is_placeholder": False}})
    assert edited.status_code == 200
    approved = client.post(f"/api/notes/{note_id}/review", json={"action": "approve"})
    assert approved.status_code == 200
    share = client.post(f"/api/notes/{note_id}/shares", json={"share_mode": "link"})
    assert share.status_code == 201
    token = share.json()["token"]
    assert token
    assert client.get(f"/api/shared-notes/{token}").status_code == 200
    assert client.get(f"/api/shared-notes/{token}").json()["id"] == note_id
    assert hashlib.sha256(token.encode()).hexdigest() != token
    assert client.delete(f"/api/notes/{note_id}/shares/{share.json()['id']}").status_code == 204
    assert client.get(f"/api/shared-notes/{token}").status_code == 404



def test_auth_and_cross_book_isolation(client: TestClient) -> None:
    book_id = create_confirmed_book(client)
    response = client.get(f"/api/books/{book_id}", headers={"authorization": "Bearer other-secret"})
    assert response.status_code == 404
    assert client.post("/api/books", json={"title": "x", "authorization_ref": "test"}, headers={"authorization": ""}).status_code == 401
    assert client.get(f"/api/books/{book_id}/pages", headers={"authorization": "Bearer other-secret"}).status_code == 404


def test_retry_and_metrics_do_not_claim_real_analysis(client: TestClient) -> None:
    book_id = create_confirmed_book(client)
    job = client.post(f"/api/books/{book_id}/analyze", json={}).json()
    run_id = job["run_id"]
    assert client.get(f"/api/runs/{run_id}").json()["status"] == "FAILED"
    assert client.get(f"/api/runs/{run_id}/metrics").json()["official_adapter"] is False
    assert client.get(f"/api/runs/{run_id}/history").json()["jobs"][0]["error_code"] == "PROVIDER_NOT_CONFIGURED"
    assert client.get(f"/api/runs/{run_id}/progress").json()["status"] == "FAILED"
    assert client.get(f"/api/books/{book_id}/runs").json()[0]["id"] == run_id
    assert client.post(f"/api/jobs/{job['job_id']}/retry").status_code == 202
    assert client.post(f"/api/jobs/{job['job_id']}/retry").status_code == 202
    assert client.post(f"/api/jobs/{job['job_id']}/retry").status_code == 409


def test_share_expiry_and_cross_user_rejection(client: TestClient) -> None:
    book_id = create_confirmed_book(client)
    with db.get_connection() as connection:
        connection.execute("UPDATE books SET status='ANALYZED' WHERE id=?", (book_id,))
        connection.execute("INSERT INTO runs(id,book_id,status,config_json,model_manifest_json,created_at) VALUES(?,?,?,?,?,?)",
                           ("verified-run-" + book_id, book_id, "SUCCEEDED", "{}", "{}", "2026-01-01T00:00:00+00:00"))
    note_id = client.post(f"/api/books/{book_id}/notes/generate", json={}).json()["id"]
    assert client.get(f"/api/notes/{note_id}", headers={"authorization": "Bearer other-secret"}).status_code == 404
    assert client.post(f"/api/notes/{note_id}/review", json={"action": "approve"}).status_code == 409
    assert client.patch(f"/api/notes/{note_id}", json={"content": {"summary": "checked", "sources": [{"page_no": 1}], "is_placeholder": False}}, headers={"authorization": "Bearer other-secret"}).status_code == 404
    assert client.patch(f"/api/notes/{note_id}", json={"content": {"summary": "checked", "sources": [{"page_no": 1}], "is_placeholder": False}}).status_code == 200
    assert client.post(f"/api/notes/{note_id}/review", json={"action": "approve"}).status_code == 200
    assert client.post(f"/api/notes/{note_id}/shares", json={"share_mode": "link", "expires_at": "2000-01-01T00:00:00Z"}).status_code == 422
    assert client.post(f"/api/notes/{note_id}/shares", json={"share_mode": "link"}, headers={"authorization": "Bearer other-secret"}).status_code == 404



def test_manual_page_revision_and_asset_scope(client: TestClient, tmp_path: Path) -> None:
    book_id = create_confirmed_book(client)
    payload = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\x0dIHDR" + b"test-image"
    assert client.patch(f"/api/books/{book_id}/pages/1/revision", json={}).status_code == 422
    revised = client.patch(f"/api/books/{book_id}/pages/1/revision", json={"ocr": {"text": "manual"}})
    assert revised.status_code == 200
    assert revised.json()["source"] == "manual_review"
    assert client.get(f"/api/books/{book_id}/pages/1/revisions").json()[0]["revision"] == 1
    job = client.post(f"/api/books/{book_id}/analyze", json={}).json()
    run_id = job["run_id"]
    assert client.post(f"/api/runs/{run_id}/assets", json={"asset_type": "video", "file_path": str(tmp_path / "outside.mp4"), "mime_type": "video/mp4"}).status_code == 422
    assert client.get(f"/api/runs/{run_id}/assets").json() == []


def test_restart_marks_running_job_interrupted(client: TestClient) -> None:
    book_id = create_confirmed_book(client)
    job = client.post(f"/api/books/{book_id}/analyze", json={}).json()
    with db.get_connection() as connection:
        connection.execute("UPDATE jobs SET status='RUNNING' WHERE id=?", (job["job_id"],))
        connection.execute("UPDATE runs SET status='RUNNING' WHERE id=?", (job["run_id"],))
    db.initialize_database()
    assert client.get(f"/api/jobs/{job['job_id']}").json()["status"] == "FAILED"
    assert client.get(f"/api/runs/{job['run_id']}").json()["status"] == "FAILED"



def test_invited_user_can_only_view_their_approved_note(client: TestClient) -> None:
    book_id = create_confirmed_book(client)
    with db.get_connection() as connection:
        connection.execute("UPDATE books SET status='ANALYZED' WHERE id=?", (book_id,))
        connection.execute("INSERT INTO runs(id,book_id,status,config_json,model_manifest_json,created_at) VALUES(?,?,?,?,?,?)",
                           ("verified-run-" + book_id, book_id, "SUCCEEDED", "{}", "{}", "2026-01-01T00:00:00+00:00"))
    note_id = client.post(f"/api/books/{book_id}/notes/generate", json={}).json()["id"]
    client.patch(f"/api/notes/{note_id}", json={"content": {"summary": "checked", "sources": [{"page_no": 1}], "is_placeholder": False}})
    client.post(f"/api/notes/{note_id}/review", json={"action": "approve"})
    share = client.post(f"/api/notes/{note_id}/shares", json={"share_mode": "invite_only", "shared_user_id": "other"}).json()
    assert share["token"] is None
    view_url = f"/api/notes/{note_id}/shares/{share['id']}/view"
    assert client.get(view_url).status_code == 404
    assert client.get(view_url, headers={"authorization": "Bearer other-secret"}).status_code == 200
    assert client.get(f"/api/notes/{note_id}", headers={"authorization": "Bearer other-secret"}).status_code == 404
    assert client.delete(f"/api/notes/{note_id}/shares/{share['id']}").status_code == 204
    assert client.get(view_url, headers={"authorization": "Bearer other-secret"}).status_code == 404


def test_asset_download_and_timeline_isolation(client: TestClient, tmp_path: Path) -> None:
    first = create_confirmed_book(client)
    second = create_confirmed_book(client)
    run_a = client.post(f"/api/books/{first}/analyze", json={}).json()["run_id"]
    run_b = client.post(f"/api/books/{second}/analyze", json={}).json()["run_id"]
    root = tmp_path / "data" / "runs" / run_a
    root.mkdir(parents=True)
    asset_path = root / "test.mp4"
    asset_path.write_bytes(b"test video only")
    registration = client.post(f"/api/runs/{run_a}/assets", json={"asset_type": "video", "file_path": str(asset_path), "mime_type": "video/mp4"})
    assert registration.status_code == 201
    asset_id = registration.json()["id"]
    assert client.get(f"/api/runs/{run_a}/assets/{asset_id}/content").content == b"test video only"
    assert client.get(f"/api/runs/{run_a}/assets/{asset_id}/content", headers={"authorization": "Bearer other-secret"}).status_code == 404
    assert client.get(f"/api/runs/{run_b}/assets/{asset_id}/content").status_code == 404
    assert client.post(f"/api/runs/{run_b}/assets", json={"asset_type": "video", "file_path": str(asset_path), "mime_type": "video/mp4"}).status_code == 422
    asset_path.write_bytes(b"changed")
    assert client.get(f"/api/runs/{run_a}/assets/{asset_id}/content").status_code == 409
    valid = {"page_no": 1, "start_ms": 0, "end_ms": 1000, "source": {"producer": "manual-test"}}
    assert client.post(f"/api/runs/{run_a}/segments", json=valid).status_code == 201
    assert len(client.get(f"/api/runs/{run_a}/segments").json()) == 1
    assert client.post(f"/api/runs/{run_a}/segments", json={**valid, "page_no": 99}).status_code == 422
    assert client.post(f"/api/runs/{run_a}/segments", json={**valid, "end_ms": 0}).status_code == 422
    assert client.post(f"/api/runs/{run_a}/segments", json={**valid, "source": {}}).status_code == 422
    assert client.get(f"/api/runs/{run_a}/segments", headers={"authorization": "Bearer other-secret"}).status_code == 404
    interaction = {"interaction_type": "touch", "input": {"x": 1}, "output": {"producer": "C-manual", "answer": "示例"}, "latency_ms": 42}
    assert client.post(f"/api/runs/{run_a}/interactions", json=interaction).status_code == 201
    assert len(client.get(f"/api/runs/{run_a}/interactions").json()) == 1
    assert client.post(f"/api/runs/{run_a}/interactions", json={**interaction, "output": {}}).status_code == 422
    assert client.get(f"/api/runs/{run_a}/interactions", headers={"authorization": "Bearer other-secret"}).status_code == 404


def test_note_cannot_approve_fake_placeholder_without_summary(client: TestClient) -> None:
    book_id = create_confirmed_book(client)
    with db.get_connection() as connection:
        connection.execute("UPDATE books SET status='ANALYZED' WHERE id=?", (book_id,))
        connection.execute("INSERT INTO runs(id,book_id,status,config_json,model_manifest_json,created_at) VALUES(?,?,?,?,?,?)",
                           ("verified-run-" + book_id, book_id, "SUCCEEDED", "{}", "{}", "2026-01-01T00:00:00+00:00"))
    note_id = client.post(f"/api/books/{book_id}/notes/generate", json={}).json()["id"]
    patched = client.patch(f"/api/notes/{note_id}", json={"content": {"summary": "", "sources": [{"page_no": 1}], "is_placeholder": False}})
    assert patched.json()["content"]["is_placeholder"] is True
    assert client.post(f"/api/notes/{note_id}/review", json={"action": "approve"}).status_code == 409


def test_run_logs_restrict_private_text_and_restart_queue(client: TestClient) -> None:
    book_id = create_confirmed_book(client)
    job = client.post(f"/api/books/{book_id}/analyze", json={}).json()
    run_id = job["run_id"]
    accepted = {"level": "INFO", "event": "integration_check", "safe_metadata": {"elapsed_ms": 42}}
    assert client.post(f"/api/runs/{run_id}/logs", json=accepted).status_code == 201
    assert client.get(f"/api/runs/{run_id}/logs").json()[0]["safe_metadata"] == {"elapsed_ms": 42}
    assert client.post(f"/api/runs/{run_id}/logs", json={**accepted, "safe_metadata": {"prompt": "secret"}}).status_code == 422
    assert client.post(f"/api/runs/{run_id}/logs", json={**accepted, "safe_metadata": {"error_code": "my-secret-token"}}).status_code == 422
    assert client.get(f"/api/runs/{run_id}/logs", headers={"authorization": "Bearer other-secret"}).status_code == 404
    with db.get_connection() as connection:
        connection.execute("UPDATE jobs SET status='QUEUED' WHERE id=?", (job["job_id"],))
        connection.execute("UPDATE runs SET status='QUEUED' WHERE id=?", (run_id,))
    db.initialize_database()
    assert client.get(f"/api/jobs/{job['job_id']}").json()["status"] == "FAILED"


def test_metrics_export_is_private_and_local_only(client: TestClient) -> None:
    book_id = create_confirmed_book(client)
    run_id = client.post(f"/api/books/{book_id}/analyze", json={}).json()["run_id"]
    exported = client.get(f"/api/runs/{run_id}/metrics.csv")
    assert exported.status_code == 200
    assert "official_adapter" in exported.text and "False" in exported.text
    assert client.get(f"/api/runs/{run_id}/metrics.csv", headers={"authorization": "Bearer other-secret"}).status_code == 404


def test_run_fingerprint_and_classification_freeze(client: TestClient) -> None:
    book_id = create_confirmed_book(client)
    job = client.post(f"/api/books/{book_id}/analyze", json={"analysis_profile": "picture_book"}).json()
    run = client.get(f"/api/runs/{job['run_id']}").json()
    assert len(run["config"]["input_hash"]) == 64
    assert len(run["config"]["input_hashes"]) == 1
    assert run["model_manifest"]["status"] == "not_configured"
    with db.get_connection() as connection:
        connection.execute("UPDATE books SET status='ANALYZED' WHERE id=?", (book_id,))
    assert client.post(f"/api/books/{book_id}/classify", json={"force_reclassify": True}).status_code == 409


def test_page_upload_rejects_invalid_signature_and_foreign_book(client: TestClient) -> None:
    book_id = create_confirmed_book(client)
    fake = client.post(f"/api/books/{book_id}/pages?page_no=2", content=b"not a png", headers={"content-type": "image/png"})
    assert fake.status_code == 415
    other = client.post(f"/api/books/{book_id}/pages?page_no=2", content=b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\x0dIHDR" + b"test-image",
                        headers={"content-type": "image/png", "authorization": "Bearer other-secret"})
    assert other.status_code == 404
