"""文字整理不假装图文分析；用隔离数据库验收笔记生命周期。"""
import json
from pathlib import Path

import pytest
from app import db
from app.services.analysis import (
    AnalysisPageInput, AnalysisProviderError, LocalTextAnalysisProvider, build_analysis_provider,
)
from test_api import client, create_confirmed_book


def test_reviewed_text_never_invokes_ocr_or_cloud(monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("校对文字不应请求模型")
    monkeypatch.setattr("app.services.ocr.recognize_image", forbidden)
    result = LocalTextAnalysisProvider().analyze("book", "picture_book", [
        AnalysisPageInput(2, Path("not-needed.png"), "hash", "兔子睡着了。"),
        AnalysisPageInput(1, Path("not-needed.png"), "hash", "乌龟坚持前进。"),
    ])
    assert [page["page_no"] for page in result.pages] == [1, 2]
    assert result.note["summary"] == "乌龟坚持前进。 兔子睡着了。"
    assert result.note["review_required"] is True
    assert result.graph["entities"] == [] and result.graph["events"] == []
    assert result.model_manifest["semantic_analysis"] is False
    assert result.model_manifest["media"] == "not_generated"
    assert result.model_manifest["status"] == "low_confidence"


def test_missing_review_uses_local_ocr(tmp_path, monkeypatch):
    page = tmp_path / "page.png"
    page.write_bytes(b"fixture")
    def recognize(data, mime):
        assert data == b"fixture" and mime == "image/png"
        return {"text": "识别原文", "confidence": .9, "provider": "rapidocr_local"}
    monkeypatch.setattr("app.services.ocr.recognize_image", recognize)
    result = LocalTextAnalysisProvider().analyze("book", "science", [AnalysisPageInput(1, page, "h")])
    assert result.pages[0]["text"] == "识别原文"
    assert result.pages[0]["ocr_version"] == "rapidocr_local"
    assert result.note["sources"] == [{"page_no": 1, "location": "page:1"}]


def test_empty_review_is_not_replaced_by_model(monkeypatch):
    monkeypatch.setattr("app.services.ocr.recognize_image", lambda *a: pytest.fail("不得替换人工空白"))
    with pytest.raises(AnalysisProviderError) as error:
        LocalTextAnalysisProvider().analyze("b", "other", [AnalysisPageInput(1, Path("x"), "h", " ")])
    assert error.value.code == "TEXT_REQUIRED"


def test_no_pages_fails():
    with pytest.raises(AnalysisProviderError):
        LocalTextAnalysisProvider().analyze("b", "other", [])


def test_provider_requires_explicit_selection(monkeypatch):
    monkeypatch.delenv("AI_PROVIDER", raising=False)
    with pytest.raises(AnalysisProviderError):
        build_analysis_provider()
    monkeypatch.setenv("AI_PROVIDER", "text_local")
    assert isinstance(build_analysis_provider(), LocalTextAnalysisProvider)
    monkeypatch.setenv("AI_PROVIDER", "typo")
    with pytest.raises(AnalysisProviderError):
        build_analysis_provider()


def test_ocr_failure_has_actionable_error(tmp_path, monkeypatch):
    from app.services.ocr import OcrUnavailable
    page = tmp_path / "page.png"
    page.write_bytes(b"fixture")
    def broken(*args):
        raise OcrUnavailable("unavailable")
    monkeypatch.setattr("app.services.ocr.recognize_image", broken)
    with pytest.raises(AnalysisProviderError) as error:
        LocalTextAnalysisProvider().analyze("b", "other", [AnalysisPageInput(1, page, "h")])
    assert error.value.code == "OCR_UNAVAILABLE"


def test_text_flow_note_review_and_share(client, monkeypatch):
    book_id = create_confirmed_book(client)
    text = "乌龟一步一步向前，最后到达终点。"
    revised = client.patch(f"/api/books/{book_id}/pages/1/revision", json={"ocr": {"text": text}})
    assert revised.status_code == 200
    monkeypatch.setenv("AI_PROVIDER", "text_local")
    def forbidden(*args):
        pytest.fail("已校对页不应再次 OCR")
    monkeypatch.setattr("app.services.ocr.recognize_image", forbidden)
    started = client.post(f"/api/books/{book_id}/analyze", json={}).json()
    assert client.get(f"/api/jobs/{started['job_id']}").json()["status"] == "SUCCEEDED"
    run = client.get(f"/api/runs/{started['run_id']}").json()
    assert run["model_manifest"]["analysis_mode"] == "text_only"
    assert run["config"]["analysis_result"]["pages"][0]["text"] == text
    assert client.get(f"/api/runs/{started['run_id']}/assets").json() == []
    with db.get_connection() as connection:
        saved = connection.execute("SELECT revision,ocr_json FROM pages WHERE book_id=?", (book_id,)).fetchone()
        assert saved["revision"] == 1
        assert json.loads(saved["ocr_json"])["text"] == text
    note = client.post(f"/api/books/{book_id}/notes/generate", json={})
    assert note.status_code == 201
    note_id = note.json()["id"]
    assert note.json()["status"] == "DRAFT"
    assert note.json()["content"]["summary"] == text
    assert note.json()["content"]["analysis_mode"] == "text_only"
    assert client.post(f"/api/notes/{note_id}/shares", json={"share_mode": "link"}).status_code == 409
    assert client.post(f"/api/notes/{note_id}/review", json={"action": "approve"}).status_code == 200
    share = client.post(f"/api/notes/{note_id}/shares", json={"share_mode": "link"})
    assert share.status_code == 201
    assert client.get(f"/api/shared-notes/{share.json()['token']}", headers={"Authorization": ""}).status_code == 200


def test_empty_ocr_never_finishes_or_creates_notes(client, monkeypatch):
    book_id = create_confirmed_book(client)
    monkeypatch.setenv("AI_PROVIDER", "text_local")
    monkeypatch.setattr("app.services.ocr.recognize_image", lambda *a: {"text": "", "confidence": 0, "provider": "rapidocr_local"})
    started = client.post(f"/api/books/{book_id}/analyze", json={}).json()
    job = client.get(f"/api/jobs/{started['job_id']}").json()
    assert job["status"] == "FAILED"
    assert client.get(f"/api/runs/{started['run_id']}/jobs").json()[0]["error_code"] == "TEXT_REQUIRED"
    assert client.post(f"/api/books/{book_id}/notes/generate", json={}).status_code == 409
