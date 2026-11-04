"""纸书智伴 FastAPI 入口。"""
from __future__ import annotations

import json
import csv
from io import StringIO
import hashlib
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, Response

from .db import DATABASE_PATH, get_connection, initialize_database
from .security import actor_id, require_owner
from pydantic import BaseModel

from .schemas import (
    AnalyzeRequest, BookCreate, BookOut, ClassificationConfirm, ClassificationOut,
    ClassificationRequest, JobOut, NoteGenerateRequest, NoteOut, NotePatch, NoteReview,
    PageOut, ShareCreate, ShareOut,
)
from .services.core import (
    ALLOWED_IMAGE_TYPES, MAX_PAGE_BYTES, classify_title, json_text, now_iso,
    safe_book_path, sha256_bytes, sha256_file, token_pair,
)

app = FastAPI(title="纸书智伴 API", version="0.1.0")
DATA_ROOT = Path(os.getenv("DATA_ROOT", str(DATABASE_PATH.parent)))


def _row_or_404(connection: sqlite3.Connection, table: str, object_id: str, label: str = "对象") -> sqlite3.Row:
    allowed = {"books": "id", "reading_notes": "id", "runs": "id", "jobs": "id", "note_shares": "id"}
    if table not in allowed:
        raise ValueError("不允许查询此表")
    row = connection.execute(f"SELECT * FROM {table} WHERE {allowed[table]} = ?", (object_id,)).fetchone()
    if row is None:
        raise HTTPException(404, f"{label}不存在")
    return row


def _book_out(row: sqlite3.Row) -> BookOut:
    return BookOut(**dict(row))


def _iso_or_none(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


def _note_out(row: sqlite3.Row) -> NoteOut:
    item = dict(row)
    item["content"] = json.loads(item["content_json"])
    del item["content_json"]
    return NoteOut(**item)


@app.on_event("startup")
def on_startup() -> None:
    initialize_database()


@app.get("/health", tags=["system"])
def health_check() -> dict[str, str]:
    return {"status": "ok", "service": "paper-companion-api", "version": "0.1.0"}


@app.post("/api/books", response_model=BookOut, status_code=201, tags=["books"])
def create_book(payload: BookCreate, actor: str = Depends(actor_id)) -> BookOut:
    book_id = str(uuid.uuid4())
    now = now_iso()
    with get_connection() as connection:
        connection.execute(
            "INSERT INTO books(id,title,authorization_ref,owner_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
            (book_id, payload.title, payload.authorization_ref, actor, "IMPORTED", now, now),
        )
    return BookOut(id=book_id, title=payload.title, authorization_ref=payload.authorization_ref,
                   owner_id=actor, status="IMPORTED", created_at=datetime.fromisoformat(now), updated_at=datetime.fromisoformat(now))


@app.get("/api/books/{book_id}", response_model=BookOut, tags=["books"])
def get_book(book_id: str, actor: str = Depends(actor_id)) -> BookOut:
    with get_connection() as connection:
        row = _row_or_404(connection, "books", book_id, "图书")
        require_owner(row["owner_id"], actor)
        return _book_out(row)


@app.post("/api/books/{book_id}/pages", response_model=PageOut, status_code=201, tags=["books"])
async def upload_page(book_id: str, page_no: int, request: Request, actor: str = Depends(actor_id)) -> PageOut:
    """接收原始图片字节，避免在离线环境强制依赖 multipart 解析包。

    客户端发送图片原始字节，并设置 Content-Type 为 image/jpeg 或 image/png。
    """
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip()
    if page_no < 1:
        raise HTTPException(422, "page_no 必须从 1 开始")
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(415, "只允许上传 JPG 或 PNG 图片")
    # 流式读取，超过上限立即拒绝，避免客户端用超大请求耗尽内存。
    chunks = bytearray()
    async for chunk in request.stream():
        chunks.extend(chunk)
        if len(chunks) > MAX_PAGE_BYTES:
            raise HTTPException(413, "单页图片不能超过 10MB")
    data = bytes(chunks)
    if len(data) > MAX_PAGE_BYTES:
        raise HTTPException(413, "单页图片不能超过 10MB")
    if not data:
        raise HTTPException(400, "不能上传空文件")
    # MIME 头可以伪造，必须检查真实文件头。
    if content_type == "image/png" and not (data.startswith(b"\x89PNG\r\n\x1a\n") and len(data) >= 24 and data[12:16] == b"IHDR"):
        raise HTTPException(415, "PNG 文件头不正确")
    if content_type == "image/jpeg" and not (len(data) >= 20 and data.startswith(b"\xff\xd8\xff") and data.endswith(b"\xff\xd9")):
        raise HTTPException(415, "JPG 文件头不正确")
    with get_connection() as connection:
        require_owner(_row_or_404(connection, "books", book_id, "图书")["owner_id"], actor)
        if connection.execute("SELECT 1 FROM pages WHERE book_id=? AND page_no=?", (book_id, page_no)).fetchone():
            raise HTTPException(409, "该图书的页码已经存在")
        suffix = ALLOWED_IMAGE_TYPES[content_type]
        path = safe_book_path(DATA_ROOT, book_id, page_no, suffix)
        page_id, digest, now = str(uuid.uuid4()), sha256_bytes(data), now_iso()
        try:
            # exclusive create 防止并发请求覆写已经存在的页。
            with path.open("xb") as handle:
                handle.write(data)
            connection.execute(
                "INSERT INTO pages(id,book_id,page_no,image_path,sha256,mime_type,size_bytes,created_at) VALUES(?,?,?,?,?,?,?,?)",
                (page_id, book_id, page_no, str(path), digest, content_type, len(data), now),
            )
        except FileExistsError:
            raise HTTPException(409, "该图书的页码文件已经存在")
        except Exception:
            path.unlink(missing_ok=True)
            raise
    return PageOut(id=page_id, book_id=book_id, page_no=page_no, image_path=str(path), sha256=digest,
                   mime_type=content_type, size_bytes=len(data), created_at=datetime.fromisoformat(now))


@app.get("/api/books/{book_id}/pages", response_model=list[PageOut], tags=["books"])
def list_pages(book_id: str, actor: str = Depends(actor_id)) -> list[PageOut]:
    with get_connection() as connection:
        require_owner(_row_or_404(connection, "books", book_id, "图书")["owner_id"], actor)
        return [PageOut(**dict(row)) for row in connection.execute("SELECT * FROM pages WHERE book_id=? ORDER BY page_no", (book_id,))]


@app.post("/api/books/{book_id}/classify", response_model=ClassificationOut, tags=["analysis"])
def classify_book(book_id: str, payload: ClassificationRequest = ClassificationRequest(), actor: str = Depends(actor_id)) -> ClassificationOut:
    with get_connection() as connection:
        book = _row_or_404(connection, "books", book_id, "图书")
        require_owner(book["owner_id"], actor)
        old = connection.execute("SELECT * FROM book_classifications WHERE book_id=?", (book_id,)).fetchone()
        if old and not payload.force_reclassify and not payload.requested_type:
            item = dict(old)
            return ClassificationOut(book_id=book_id, predicted_type=item["predicted_type"], confidence=item["confidence"], reasons=json.loads(item["reasons_json"]), confirmed_type=item["confirmed_type"], confirmed_by=item["confirmed_by"], status="CONFIRMED" if item["confirmed_type"] else "CLASSIFIED")
        if old and old["confirmed_type"] and book["status"] == "ANALYZED":
            raise HTTPException(409, "已分析图书不能重新分类；请创建新图书或显式重新分析")
        predicted, confidence, reasons = (payload.requested_type, 1.0, ["用户指定类型，非自动识别"]) if payload.requested_type else classify_title(book["title"])
        now = now_iso()
        connection.execute("""INSERT INTO book_classifications(book_id,predicted_type,confidence,reasons_json,created_at,updated_at)
            VALUES(?,?,?,?,?,?) ON CONFLICT(book_id) DO UPDATE SET predicted_type=excluded.predicted_type,confidence=excluded.confidence,reasons_json=excluded.reasons_json,updated_at=excluded.updated_at""", (book_id, predicted, confidence, json_text(reasons), now, now))
        connection.execute("UPDATE book_classifications SET confirmed_type=NULL, confirmed_by=NULL, confirmed_at=NULL WHERE book_id=?", (book_id,))
        connection.execute("UPDATE books SET status='CLASSIFIED', updated_at=? WHERE id=?", (now, book_id))
    return ClassificationOut(book_id=book_id, predicted_type=predicted, confidence=confidence, reasons=reasons, confirmed_type=None, confirmed_by=None, status="CLASSIFIED")


@app.patch("/api/books/{book_id}/classification", response_model=ClassificationOut, tags=["analysis"])
def confirm_classification(book_id: str, payload: ClassificationConfirm, actor: str = Depends(actor_id)) -> ClassificationOut:
    with get_connection() as connection:
        require_owner(_row_or_404(connection, "books", book_id, "图书")["owner_id"], actor)
        row = connection.execute("SELECT * FROM book_classifications WHERE book_id=?", (book_id,)).fetchone()
        if row is None:
            raise HTTPException(409, "请先执行自动分类")
        now = now_iso()
        connection.execute("UPDATE book_classifications SET confirmed_type=?, confirmed_by=?, confirmed_at=?, updated_at=? WHERE book_id=?", (payload.confirmed_type, actor, now, now, book_id))
        connection.execute("UPDATE books SET status='CONFIRMED', updated_at=? WHERE id=?", (now, book_id))
        row = connection.execute("SELECT * FROM book_classifications WHERE book_id=?", (book_id,)).fetchone()
    return ClassificationOut(book_id=book_id, predicted_type=row["predicted_type"], confidence=row["confidence"], reasons=json.loads(row["reasons_json"]), confirmed_type=row["confirmed_type"], confirmed_by=row["confirmed_by"], status="CONFIRMED")


def _make_job(connection: sqlite3.Connection, book_id: str, stage: str, config: dict[str, Any]) -> JobOut:
    run_id, job_id, now = str(uuid.uuid4()), str(uuid.uuid4()), now_iso()
    page_hashes = [row[0] for row in connection.execute("SELECT sha256 FROM pages WHERE book_id=? ORDER BY page_no", (book_id,))]
    config = {**config, "input_hashes": page_hashes, "input_hash": sha256_bytes("".join(page_hashes).encode()),
              "prompt_version": "not_configured"}
    connection.execute("INSERT INTO runs(id,book_id,status,config_json,model_manifest_json,created_at) VALUES(?,?,?,?,?,?)", (run_id, book_id, "QUEUED", json_text(config), json_text({"provider": None, "status": "not_configured"}), now))
    connection.execute("INSERT INTO jobs(id,run_id,stage,status,attempts,max_attempts,created_at) VALUES(?,?,?,?,?,?,?)", (job_id, run_id, stage, "QUEUED", 0, 3, now))
    return JobOut(job_id=job_id, run_id=run_id, status="QUEUED", stage=stage, attempts=0)


def _run_placeholder(job_id: str) -> None:
    """缺少 B 的分析 provider 时明确失败，不生成虚假的成功结果。"""
    with get_connection() as connection:
        job = connection.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
        if not job:
            return
        now = now_iso()
        connection.execute("UPDATE jobs SET status='RUNNING', attempts=attempts+1, started_at=? WHERE id=?", (now, job_id))
        connection.execute("UPDATE runs SET status='RUNNING' WHERE id=?", (job["run_id"],))
        connection.execute("UPDATE jobs SET status='FAILED', error_code='PROVIDER_NOT_CONFIGURED', error_message='尚未接入真实分析服务', ended_at=? WHERE id=?", (now_iso(), job_id))
        connection.execute("UPDATE runs SET status='FAILED', finished_at=? WHERE id=?", (now_iso(), job["run_id"]))


@app.post("/api/books/{book_id}/analyze", response_model=JobOut, status_code=202, tags=["analysis"])
def analyze_book(book_id: str, payload: AnalyzeRequest, background_tasks: BackgroundTasks, actor: str = Depends(actor_id)) -> JobOut:
    with get_connection() as connection:
        book = _row_or_404(connection, "books", book_id, "图书")
        require_owner(book["owner_id"], actor)
        if book["status"] not in {"CONFIRMED", "ANALYZED"}:
            raise HTTPException(409, "请先确认图书类型")
        if not connection.execute("SELECT 1 FROM pages WHERE book_id=?", (book_id,)).fetchone():
            raise HTTPException(409, "请先上传至少一页图书")
        result = _make_job(connection, book_id, "analyze", {"analysis_profile": payload.analysis_profile})
    background_tasks.add_task(_run_placeholder, result.job_id)
    return result


@app.get("/api/jobs/{job_id}", response_model=JobOut, tags=["jobs"])
def get_job(job_id: str, actor: str = Depends(actor_id)) -> JobOut:
    with get_connection() as connection:
        row = _row_or_404(connection, "jobs", job_id, "任务")
        book = connection.execute("SELECT b.* FROM books b JOIN runs r ON b.id=r.book_id WHERE r.id=?", (row["run_id"],)).fetchone()
        require_owner(book["owner_id"], actor)
        return JobOut(job_id=row["id"], run_id=row["run_id"], status=row["status"], stage=row["stage"], attempts=row["attempts"])


@app.post("/api/books/{book_id}/notes/generate", response_model=NoteOut, status_code=201, tags=["notes"])
def generate_note(book_id: str, payload: NoteGenerateRequest, actor: str = Depends(actor_id)) -> NoteOut:
    with get_connection() as connection:
        book = _row_or_404(connection, "books", book_id, "图书")
        require_owner(book["owner_id"], actor)
        analyzed = connection.execute("SELECT 1 FROM runs WHERE book_id=? AND status='SUCCEEDED' LIMIT 1", (book_id,)).fetchone()
        if book["status"] != "ANALYZED" or analyzed is None:
            raise HTTPException(409, "请先完成真实分析；不能根据空结果生成笔记")
        now = now_iso(); note_id = str(uuid.uuid4())
        content = {"template": payload.note_template, "summary": "待根据分析结果补充", "sources": [], "is_placeholder": True}
        connection.execute("INSERT INTO reading_notes(id,book_id,owner_id,content_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)", (note_id, book_id, actor, json_text(content), "DRAFT", now, now))
        row = connection.execute("SELECT * FROM reading_notes WHERE id=?", (note_id,)).fetchone()
    return _note_out(row)


@app.get("/api/notes/{note_id}", response_model=NoteOut, tags=["notes"])
def get_note(note_id: str, actor: str = Depends(actor_id)) -> NoteOut:
    with get_connection() as connection:
        row = _row_or_404(connection, "reading_notes", note_id, "笔记")
        require_owner(row["owner_id"], actor)
        return _note_out(row)


@app.patch("/api/notes/{note_id}", response_model=NoteOut, tags=["notes"])
def patch_note(note_id: str, payload: NotePatch, actor: str = Depends(actor_id)) -> NoteOut:
    with get_connection() as connection:
        row = _row_or_404(connection, "reading_notes", note_id, "笔记")
        require_owner(row["owner_id"], actor)
        if row["status"] not in {"DRAFT", "REVIEWING"}:
            raise HTTPException(409, "已审核笔记不能直接修改，请先创建新版本")
        # 人工编辑不能通过请求体伪造“非占位”；只要无真实来源仍保持占位标记。
        content = dict(payload.content)
        # 由服务端决定占位状态，不能信任客户端提供的 is_placeholder。
        content["is_placeholder"] = not (isinstance(content.get("summary"), str) and bool(content["summary"].strip()) and bool(content.get("sources")))

        now, version = now_iso(), row["version"] + 1
        connection.execute("UPDATE reading_notes SET content_json=?,version=?,updated_at=? WHERE id=?", (json_text(content), version, now, note_id))
        connection.execute("INSERT INTO note_revisions(id,note_id,editor_id,content_json,version,created_at) VALUES(?,?,?,?,?,?)", (str(uuid.uuid4()), note_id, actor, json_text(content), version, now))
        return _note_out(connection.execute("SELECT * FROM reading_notes WHERE id=?", (note_id,)).fetchone())


@app.post("/api/notes/{note_id}/review", response_model=NoteOut, tags=["notes"])
def review_note(note_id: str, payload: NoteReview, actor: str = Depends(actor_id)) -> NoteOut:
    with get_connection() as connection:
        row = _row_or_404(connection, "reading_notes", note_id, "笔记")
        require_owner(row["owner_id"], actor)
        if row["status"] not in {"DRAFT", "REVIEWING"}:
            raise HTTPException(409, "此状态不能重复审核")
        content = json.loads(row["content_json"])
        valid_pages = {item[0] for item in connection.execute("SELECT page_no FROM pages WHERE book_id=?", (row["book_id"],))}
        sources = content.get("sources", [])
        has_valid_sources = isinstance(sources, list) and bool(sources) and all(
            isinstance(source, dict) and source.get("page_no") in valid_pages for source in sources
        )
        if payload.action == "approve" and (content.get("is_placeholder") or not has_valid_sources):
            raise HTTPException(409, "占位笔记或缺少来源引用，不能审核通过")
        status = "PRIVATE" if payload.action == "approve" else "REVIEWING"
        now = now_iso()
        connection.execute("UPDATE reading_notes SET status=?,updated_at=? WHERE id=?", (status, now, note_id))
        return _note_out(connection.execute("SELECT * FROM reading_notes WHERE id=?", (note_id,)).fetchone())


@app.post("/api/notes/{note_id}/shares", response_model=ShareOut, status_code=201, tags=["sharing"])
def create_share(note_id: str, payload: ShareCreate, actor: str = Depends(actor_id)) -> ShareOut:
    with get_connection() as connection:
        note = _row_or_404(connection, "reading_notes", note_id, "笔记")
        require_owner(note["owner_id"], actor)
        if note["status"] not in {"PRIVATE", "SHARED"}:
            raise HTTPException(409, "笔记必须先经主人审核")
        if payload.expires_at and (payload.expires_at.tzinfo is None or payload.expires_at.astimezone(timezone.utc) <= datetime.now(timezone.utc)):
            raise HTTPException(422, "分享过期时间必须晚于当前时间")
        if payload.share_mode == "invite_only" and not payload.shared_user_id:
            raise HTTPException(422, "指定用户分享必须填写 shared_user_id")
        token, token_hash = token_pair() if payload.share_mode == "link" else (None, None)
        share_id, now = str(uuid.uuid4()), now_iso()
        connection.execute("INSERT INTO note_shares(id,note_id,owner_id,share_mode,shared_user_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?)", (share_id, note_id, note["owner_id"], payload.share_mode, payload.shared_user_id, token_hash, payload.expires_at.isoformat() if payload.expires_at else None, now))
        connection.execute("UPDATE reading_notes SET status='SHARED',updated_at=? WHERE id=?", (now, note_id))
    return ShareOut(id=share_id, share_mode=payload.share_mode, shared_user_id=payload.shared_user_id, expires_at=payload.expires_at, status="ACTIVE", token=token)


@app.delete("/api/notes/{note_id}/shares/{share_id}", status_code=204, tags=["sharing"])
def revoke_share(note_id: str, share_id: str, actor: str = Depends(actor_id)) -> None:
    with get_connection() as connection:
        require_owner(_row_or_404(connection, "reading_notes", note_id, "笔记")["owner_id"], actor)
        share = connection.execute("SELECT * FROM note_shares WHERE id=? AND note_id=?", (share_id, note_id)).fetchone()
        if share is None:
            raise HTTPException(404, "分享不存在")
        connection.execute("UPDATE note_shares SET revoked_at=? WHERE id=?", (now_iso(), share_id))
        # ISO 时间带时区偏移时不能按字符串顺序比较过期时间。
        active = connection.execute("SELECT expires_at FROM note_shares WHERE note_id=? AND revoked_at IS NULL", (note_id,)).fetchall()
        remaining = any(not item["expires_at"] or datetime.fromisoformat(item["expires_at"]).astimezone(timezone.utc) > datetime.now(timezone.utc) for item in active)
        if not remaining:
            connection.execute("UPDATE reading_notes SET status='PRIVATE',updated_at=? WHERE id=?", (now_iso(), note_id))


@app.get("/api/shared-notes/{token}", response_model=NoteOut, tags=["sharing"])
def get_shared_note(token: str) -> NoteOut:
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    with get_connection() as connection:
        share = connection.execute("SELECT * FROM note_shares WHERE token_hash=? AND share_mode='link'", (token_hash,)).fetchone()
        if share is None or share["revoked_at"]:
            raise HTTPException(404, "分享链接无效或已撤销")
        if share["expires_at"] and datetime.fromisoformat(share["expires_at"]).astimezone(timezone.utc) <= datetime.now(timezone.utc):
            raise HTTPException(410, "分享链接已过期")
        note = _row_or_404(connection, "reading_notes", share["note_id"], "笔记")
        if note["status"] not in {"PRIVATE", "SHARED"}:
            raise HTTPException(403, "笔记尚未审核")
        return _note_out(note)



@app.get("/api/books/{book_id}/runs", tags=["jobs"])
def list_book_runs(book_id: str, actor: str = Depends(actor_id)) -> list[dict[str, Any]]:
    with get_connection() as connection:
        require_owner(_row_or_404(connection, "books", book_id, "图书")["owner_id"], actor)
        rows = connection.execute("SELECT * FROM runs WHERE book_id=? ORDER BY created_at DESC", (book_id,))
        return [dict(row) for row in rows]


@app.get("/api/runs/{run_id}", tags=["jobs"])
def get_run(run_id: str, actor: str = Depends(actor_id)) -> dict[str, Any]:
    with get_connection() as connection:
        row = _row_or_404(connection, "runs", run_id, "运行")
        require_owner(_row_or_404(connection, "books", row["book_id"], "图书")["owner_id"], actor)
        result = dict(row)
        result["config"] = json.loads(result.pop("config_json"))
        result["model_manifest"] = json.loads(result.pop("model_manifest_json"))
        return result


@app.get("/api/runs/{run_id}/jobs", tags=["jobs"])
def list_run_jobs(run_id: str, actor: str = Depends(actor_id)) -> list[dict[str, Any]]:
    get_run(run_id, actor)
    with get_connection() as connection:
        return [dict(row) for row in connection.execute("SELECT * FROM jobs WHERE run_id=? ORDER BY created_at", (run_id,))]


@app.post("/api/jobs/{job_id}/retry", response_model=JobOut, status_code=202, tags=["jobs"])
def retry_job(job_id: str, background_tasks: BackgroundTasks, actor: str = Depends(actor_id)) -> JobOut:
    with get_connection() as connection:
        row = _row_or_404(connection, "jobs", job_id, "任务")
        get_run(row["run_id"], actor)
        if row["status"] != "FAILED":
            raise HTTPException(409, "只有失败任务可以重试")
        if row["attempts"] >= row["max_attempts"]:
            raise HTTPException(409, "已达到最多重试次数")
        connection.execute("UPDATE jobs SET status='RETRYING',error_code=NULL,error_message=NULL,ended_at=NULL WHERE id=?", (job_id,))
        connection.execute("UPDATE runs SET status='RETRYING',finished_at=NULL WHERE id=?", (row["run_id"],))
        result = JobOut(job_id=job_id, run_id=row["run_id"], stage=row["stage"], status="RETRYING", attempts=row["attempts"])
    background_tasks.add_task(_run_placeholder, job_id)
    return result


@app.get("/api/runs/{run_id}/metrics", tags=["jobs"])
def run_metrics(run_id: str, actor: str = Depends(actor_id)) -> dict[str, Any]:
    """本地指标，不是官方评测适配。"""
    run = get_run(run_id, actor)
    with get_connection() as connection:
        jobs = [dict(row) for row in connection.execute("SELECT * FROM jobs WHERE run_id=?", (run_id,))]
        pages = connection.execute("SELECT COUNT(*) FROM pages WHERE book_id=?", (run["book_id"],)).fetchone()[0]
        segments = connection.execute("SELECT COUNT(*) FROM segments WHERE run_id=?", (run_id,)).fetchone()[0]
    return {"run_id": run_id, "status": run["status"], "page_count": pages,
            "segment_count": segments, "job_count": len(jobs),
            "failed_jobs": sum(item["status"] == "FAILED" for item in jobs),
            "attempts": sum(item["attempts"] for item in jobs),
            "official_adapter": False}


@app.get("/api/runs/{run_id}/history", tags=["jobs"])
def run_history(run_id: str, actor: str = Depends(actor_id)) -> dict[str, Any]:
    get_run(run_id, actor)
    with get_connection() as connection:
        return {"run_id": run_id,
                "jobs": [dict(row) for row in connection.execute("SELECT * FROM jobs WHERE run_id=? ORDER BY created_at", (run_id,))],
                "segments": [dict(row) for row in connection.execute("SELECT * FROM segments WHERE run_id=? ORDER BY start_ms", (run_id,))],
                "interactions": [dict(row) for row in connection.execute("SELECT * FROM interactions WHERE run_id=? ORDER BY created_at", (run_id,))]}


@app.get("/api/runs/{run_id}/progress", tags=["jobs"])
def run_progress(run_id: str, actor: str = Depends(actor_id)) -> dict[str, Any]:
    run = get_run(run_id, actor)
    jobs = list_run_jobs(run_id, actor)
    return {"run_id": run_id, "status": run["status"],
            "stages": [{"stage": j["stage"], "status": j["status"], "attempts": j["attempts"], "error_code": j["error_code"]} for j in jobs]}


class PageRevisionInput(BaseModel):
    ocr: dict[str, Any] | None = None
    vision: dict[str, Any] | None = None


@app.patch("/api/books/{book_id}/pages/{page_no}/revision", tags=["books"])
def revise_page(book_id: str, page_no: int, payload: PageRevisionInput, actor: str = Depends(actor_id)) -> dict[str, Any]:
    """人工校对结果单独存历史；不能假称自动 OCR/VLM 已运行。"""
    if payload.ocr is None and payload.vision is None:
        raise HTTPException(422, "至少提供 OCR 或视觉校对结果")
    with get_connection() as connection:
        require_owner(_row_or_404(connection, "books", book_id, "图书")["owner_id"], actor)
        page = connection.execute("SELECT * FROM pages WHERE book_id=? AND page_no=?", (book_id, page_no)).fetchone()
        if page is None:
            raise HTTPException(404, "页面不存在")
        revision = page["revision"] + 1
        ocr_json = json_text(payload.ocr) if payload.ocr is not None else page["ocr_json"]
        vision_json = json_text(payload.vision) if payload.vision is not None else page["vision_json"]
        connection.execute("UPDATE pages SET ocr_json=?,vision_json=?,revision=? WHERE id=?", (ocr_json, vision_json, revision, page["id"]))
        connection.execute("INSERT INTO page_revisions(id,page_id,revision,editor_id,ocr_json,vision_json,created_at) VALUES(?,?,?,?,?,?,?)",
                           (str(uuid.uuid4()), page["id"], revision, actor, ocr_json, vision_json, now_iso()))
    return {"book_id": book_id, "page_no": page_no, "revision": revision,
            "ocr": json.loads(ocr_json) if ocr_json else None, "vision": json.loads(vision_json) if vision_json else None,
            "source": "manual_review"}


@app.get("/api/books/{book_id}/pages/{page_no}/revisions", tags=["books"])
def list_page_revisions(book_id: str, page_no: int, actor: str = Depends(actor_id)) -> list[dict[str, Any]]:
    with get_connection() as connection:
        require_owner(_row_or_404(connection, "books", book_id, "图书")["owner_id"], actor)
        page = connection.execute("SELECT id FROM pages WHERE book_id=? AND page_no=?", (book_id, page_no)).fetchone()
        if page is None:
            raise HTTPException(404, "页面不存在")
        return [dict(row) for row in connection.execute("SELECT * FROM page_revisions WHERE page_id=? ORDER BY revision", (page["id"],))]


class AssetInput(BaseModel):
    asset_type: str
    file_path: str
    mime_type: str
    duration_ms: int | None = None
    metadata: dict[str, Any] = {}


@app.post("/api/runs/{run_id}/assets", status_code=201, tags=["media"])
def register_asset(run_id: str, payload: AssetInput, actor: str = Depends(actor_id)) -> dict[str, Any]:
    """仅登记已存在的本地产物；不代替视频/TTS 真正生成。"""
    get_run(run_id, actor)
    # 运行产物必须放在专属目录，阻断跨用户/跨运行引用。
    root = (DATA_ROOT / "runs" / run_id).resolve()
    path = Path(payload.file_path).resolve()
    if root not in path.parents or not path.is_file():
        raise HTTPException(422, "产物必须是 data/runs/<run_id> 内已存在的文件")
    allowed_assets = {"video": {"video/mp4": ".mp4"}, "audio": {"audio/mpeg": ".mp3", "audio/wav": ".wav"}, "subtitle": {"text/vtt": ".vtt"}}
    if payload.asset_type not in allowed_assets or payload.mime_type not in allowed_assets[payload.asset_type]:
        raise HTTPException(422, "产物类型或 MIME 不支持")
    if path.suffix.lower() != allowed_assets[payload.asset_type][payload.mime_type]:
        raise HTTPException(422, "产物扩展名与类型不匹配")
    digest = sha256_file(path)
    asset_id = str(uuid.uuid4())
    with get_connection() as connection:
        connection.execute("INSERT INTO media_assets(id,run_id,asset_type,file_path,mime_type,sha256,duration_ms,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
                           (asset_id, run_id, payload.asset_type, str(path), payload.mime_type, digest, payload.duration_ms, json_text(payload.metadata), now_iso()))
    return {"id": asset_id, "run_id": run_id, "asset_type": payload.asset_type,
            "sha256": digest, "duration_ms": payload.duration_ms, "status": "registered_only"}


@app.get("/api/runs/{run_id}/assets", tags=["media"])
def list_assets(run_id: str, actor: str = Depends(actor_id)) -> list[dict[str, Any]]:
    get_run(run_id, actor)
    with get_connection() as connection:
        rows = connection.execute("SELECT id,run_id,asset_type,mime_type,sha256,duration_ms,metadata_json,created_at FROM media_assets WHERE run_id=?", (run_id,))
        return [dict(row) for row in rows]


@app.get("/api/runs/{run_id}/assets/{asset_id}/content", tags=["media"])
def download_asset(run_id: str, asset_id: str, actor: str = Depends(actor_id)) -> FileResponse:
    """只有主人可以读取已登记且完整性未变化的产物。"""
    get_run(run_id, actor)
    with get_connection() as connection:
        asset = connection.execute("SELECT * FROM media_assets WHERE id=? AND run_id=?", (asset_id, run_id)).fetchone()
    if asset is None:
        raise HTTPException(404, "产物不存在")
    path = Path(asset["file_path"]).resolve()
    root = (DATA_ROOT / "runs" / run_id).resolve()
    if root not in path.parents or not path.is_file():
        raise HTTPException(404, "产物文件不存在")
    if sha256_file(path) != asset["sha256"]:
        raise HTTPException(409, "产物校验失败")
    return FileResponse(path, media_type=asset["mime_type"], filename=path.name)

@app.get("/api/notes/{note_id}/shares", tags=["sharing"])
def list_note_shares(note_id: str, actor: str = Depends(actor_id)) -> list[dict[str, Any]]:
    with get_connection() as connection:
        require_owner(_row_or_404(connection, "reading_notes", note_id, "笔记")["owner_id"], actor)
        rows = connection.execute("SELECT id,share_mode,shared_user_id,expires_at,revoked_at,created_at FROM note_shares WHERE note_id=?", (note_id,))
        return [dict(row) for row in rows]


@app.get("/api/notes/{note_id}/shares/{share_id}/view", response_model=NoteOut, tags=["sharing"])
def view_invited_note(note_id: str, share_id: str, actor: str = Depends(actor_id)) -> NoteOut:
    """指定用户分享：登录身份必须与邀请目标一致。"""
    with get_connection() as connection:
        share = connection.execute("SELECT * FROM note_shares WHERE id=? AND note_id=? AND share_mode='invite_only'", (share_id, note_id)).fetchone()
        if share is None or share["shared_user_id"] != actor or share["revoked_at"]:
            raise HTTPException(404, "邀请不存在或已撤销")
        if share["expires_at"] and datetime.fromisoformat(share["expires_at"]).astimezone(timezone.utc) <= datetime.now(timezone.utc):
            raise HTTPException(410, "邀请已过期")
        note = _row_or_404(connection, "reading_notes", note_id, "笔记")
        if note["status"] not in {"PRIVATE", "SHARED"}:
            raise HTTPException(403, "笔记尚未审核")
        return _note_out(note)



class SegmentInput(BaseModel):
    page_no: int | None = None
    start_ms: int
    end_ms: int
    caption: str | None = None
    source: dict[str, Any]


@app.post("/api/runs/{run_id}/segments", status_code=201, tags=["media"])
def add_segment(run_id: str, payload: SegmentInput, actor: str = Depends(actor_id)) -> dict[str, Any]:
    """登记外部生成器提供的时间轴；必须有真实来源，不代表 A 已生成视频。"""
    run = get_run(run_id, actor)
    if payload.start_ms < 0 or payload.end_ms <= payload.start_ms:
        raise HTTPException(422, "时间轴区间必须为非负且结束时间大于开始时间")
    if not payload.source or not isinstance(payload.source.get("producer"), str) or not payload.source["producer"].strip():
        raise HTTPException(422, "必须提供非空 source.producer 用于追溯")
    with get_connection() as connection:
        if payload.page_no is not None and not connection.execute(
            "SELECT 1 FROM pages WHERE book_id=? AND page_no=?", (run["book_id"], payload.page_no)
        ).fetchone():
            raise HTTPException(422, "来源页码不属于该图书")
        segment_id = str(uuid.uuid4())
        connection.execute(
            "INSERT INTO segments(id,run_id,page_no,start_ms,end_ms,caption,source_json,created_at) VALUES(?,?,?,?,?,?,?,?)",
            (segment_id, run_id, payload.page_no, payload.start_ms, payload.end_ms, payload.caption, json_text(payload.source), now_iso()),
        )
    return {"id": segment_id, "run_id": run_id, "status": "registered_only"}


@app.get("/api/runs/{run_id}/segments", tags=["media"])
def list_segments(run_id: str, actor: str = Depends(actor_id)) -> list[dict[str, Any]]:
    get_run(run_id, actor)
    with get_connection() as connection:
        return [{**dict(row), "source": json.loads(row["source_json"])} for row in connection.execute(
            "SELECT * FROM segments WHERE run_id=? ORDER BY start_ms,id", (run_id,)
        )]


class InteractionInput(BaseModel):
    interaction_type: str
    input: dict[str, Any]
    output: dict[str, Any]
    latency_ms: int | None = None


@app.post("/api/runs/{run_id}/interactions", status_code=201, tags=["interactions"])
def add_interaction(run_id: str, payload: InteractionInput, actor: str = Depends(actor_id)) -> dict[str, Any]:
    """记录 C 模块上报的结果；空响应或缺少来源标记不得冒充真实 Agent。"""
    get_run(run_id, actor)
    if payload.interaction_type not in {"voice", "touch"} or (payload.latency_ms is not None and payload.latency_ms < 0):
        raise HTTPException(422, "交互类型或延迟无效")
    if not payload.output or not isinstance(payload.output.get("producer"), str) or not payload.output["producer"].strip():
        raise HTTPException(422, "必须提供 output.producer 和实际输出")
    item_id = str(uuid.uuid4())
    with get_connection() as connection:
        connection.execute("INSERT INTO interactions(id,run_id,interaction_type,input_json,output_json,latency_ms,created_at) VALUES(?,?,?,?,?,?,?)",
                           (item_id, run_id, payload.interaction_type, json_text(payload.input), json_text(payload.output), payload.latency_ms, now_iso()))
    return {"id": item_id, "run_id": run_id, "status": "recorded_only"}


@app.get("/api/runs/{run_id}/interactions", tags=["interactions"])
def list_interactions(run_id: str, actor: str = Depends(actor_id)) -> list[dict[str, Any]]:
    get_run(run_id, actor)
    with get_connection() as connection:
        return [{"id": row["id"], "run_id": run_id, "interaction_type": row["interaction_type"],
                 "input": json.loads(row["input_json"]), "output": json.loads(row["output_json"]),
                 "latency_ms": row["latency_ms"], "created_at": row["created_at"]}
                for row in connection.execute("SELECT * FROM interactions WHERE run_id=? ORDER BY created_at,id", (run_id,))]


class RunLogInput(BaseModel):
    level: str
    event: str
    safe_metadata: dict[str, str | int | float | bool | None] = {}


@app.post("/api/runs/{run_id}/logs", status_code=201, tags=["jobs"])
def add_run_log(run_id: str, payload: RunLogInput, actor: str = Depends(actor_id)) -> dict[str, Any]:
    """仅接收固定事件与标量指标，避免原书内容、prompt 或令牌落到日志。"""
    get_run(run_id, actor)
    allowed_events = {"upload_complete", "analysis_started", "analysis_failed", "analysis_succeeded",
                      "media_registered", "interaction_failed", "interaction_succeeded", "integration_check"}
    allowed_keys = {"page_no", "elapsed_ms", "error_code", "stage", "attempt"}
    if payload.level not in {"INFO", "WARN", "ERROR"} or payload.event not in allowed_events:
        raise HTTPException(422, "日志级别或事件不支持")
    if set(payload.safe_metadata) - allowed_keys:
        raise HTTPException(422, "日志包含不允许的字段")
    allowed_codes = {"PROVIDER_NOT_CONFIGURED", "INTERRUPTED", "TIMEOUT", "INVALID_INPUT", "PROVIDER_ERROR"}
    allowed_stages = {"upload", "analyze", "media", "interaction", "integration"}
    if any(not isinstance(payload.safe_metadata[key], int) or isinstance(payload.safe_metadata[key], bool) or payload.safe_metadata[key] < 0
           for key in ("page_no", "elapsed_ms", "attempt") if key in payload.safe_metadata):
        raise HTTPException(422, "数值指标必须是非负整数")
    if (("error_code" in payload.safe_metadata and payload.safe_metadata["error_code"] not in allowed_codes)
            or ("stage" in payload.safe_metadata and payload.safe_metadata["stage"] not in allowed_stages)):
        raise HTTPException(422, "日志只允许预定义错误码和阶段")
    log_id = str(uuid.uuid4())
    with get_connection() as connection:
        connection.execute("INSERT INTO run_logs(id,run_id,level,event,safe_metadata_json,created_at) VALUES(?,?,?,?,?,?)",
                           (log_id, run_id, payload.level, payload.event, json_text(payload.safe_metadata), now_iso()))
    return {"id": log_id, "run_id": run_id, "status": "recorded_only"}


@app.get("/api/runs/{run_id}/logs", tags=["jobs"])
def list_run_logs(run_id: str, actor: str = Depends(actor_id)) -> list[dict[str, Any]]:
    get_run(run_id, actor)
    with get_connection() as connection:
        return [{"id": row["id"], "run_id": run_id, "level": row["level"], "event": row["event"],
                 "safe_metadata": json.loads(row["safe_metadata_json"]), "created_at": row["created_at"]}
                for row in connection.execute("SELECT * FROM run_logs WHERE run_id=? ORDER BY created_at,id", (run_id,))]



@app.get("/api/runs/{run_id}/metrics.csv", tags=["jobs"])
def export_run_metrics(run_id: str, actor: str = Depends(actor_id)) -> Response:
    """导出本地自测数据；不是官方评测格式或成绩。"""
    metrics = run_metrics(run_id, actor)
    output = StringIO()
    writer = csv.DictWriter(output, fieldnames=list(metrics))
    writer.writeheader()
    writer.writerow(metrics)
    return Response(content=output.getvalue(), media_type="text/csv; charset=utf-8")
