"""Mobile/tablet API. All records and uploaded media use a separate local MongoDB database.

The desktop FastAPI app, its SQLite data and its files are never opened here.
"""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
import uuid
import warnings
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any

import gridfs
from bson import ObjectId
from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Request
from fastapi.responses import Response
from PIL import Image, UnidentifiedImageError
from pymongo import ASCENDING
from pymongo.errors import DuplicateKeyError
from pydantic import BaseModel, Field

from app.accounts import accounts_db, initialize_accounts
from app.auth_routes import router as auth_router
from app.schemas import (AnalyzeRequest, BookCreate, ClassificationConfirm,
                         ClassificationRequest, NoteGenerateRequest, NotePatch,
                         NoteReview, ShareCreate)
from app.security import actor_id
from app.services.analysis import AnalysisPageInput, AnalysisProviderError, build_analysis_provider
from app.services.core import MAX_BOOK_PAGES, MAX_PAGE_BYTES, classify_title

app = FastAPI(title="开卷有灵移动端 MongoDB API")
app.include_router(auth_router)


def db():
    return accounts_db()


def files():
    return gridfs.GridFS(db())


def now():
    return datetime.now(timezone.utc).isoformat()


def ident():
    return str(uuid.uuid4())


def owned(collection: str, key: str, actor: str):
    doc = db()[collection].find_one({"_id": key, "owner_id": actor})
    if doc is None:
        raise HTTPException(404, "对象不存在或无权访问")
    return doc


def public(doc):
    return {("id" if k == "_id" else k): v for k, v in doc.items() if k != "file_id"}


def run_owned(run_id: str, actor: str):
    run = db().runs.find_one({"_id": run_id})
    if not run:
        raise HTTPException(404, "任务不存在")
    owned("books", run["book_id"], actor)
    return run


@app.on_event("startup")
def startup():
    # Fail closed: no silent SQLite fallback when the local MongoDB is unavailable.
    initialize_accounts()
    for collection, keys in {
        "books": [("owner_id", ASCENDING)], "pages": [("book_id", ASCENDING), ("page_no", ASCENDING)],
        "runs": [("book_id", ASCENDING)], "jobs": [("run_id", ASCENDING)],
        "notes": [("book_id", ASCENDING)], "shares": [("note_id", ASCENDING)],
        "segments": [("run_id", ASCENDING)], "assets": [("run_id", ASCENDING)],
        "interactions": [("run_id", ASCENDING)], "workspace": [("owner_id", ASCENDING)],
    }.items():
        db()[collection].create_index(keys, unique=collection == "pages")


@app.get("/health")
def health():
    db().command("ping")
    return {"status": "ok", "service": "paper-companion-mobile-mongodb-api", "version": "1"}


@app.post("/api/books", status_code=201)
def create_book(body: BookCreate, actor: str = Depends(actor_id)):
    stamp = now()
    book = {"_id": ident(), "title": body.title, "authorization_ref": body.authorization_ref,
            "owner_id": actor, "status": "IMPORTED", "created_at": stamp, "updated_at": stamp}
    db().books.insert_one(book)
    return public(book)


@app.get("/api/books/{book_id}")
def get_book(book_id: str, actor: str = Depends(actor_id)):
    return public(owned("books", book_id, actor))


@app.post("/api/ocr/recognize")
async def recognize_page_ocr(request: Request, actor: str = Depends(actor_id)):
    """Recognize original text for a user's editable draft; never save or confirm it."""
    from app.services.ocr import InvalidOcrImage, OcrUnavailable, recognize_image
    mime = request.headers.get("content-type", "").split(";", 1)[0].strip()
    if mime not in {"image/jpeg", "image/png"}:
        raise HTTPException(415, "仅支持 JPG / PNG")
    data = bytearray()
    async for chunk in request.stream():
        if len(data) + len(chunk) > MAX_PAGE_BYTES:
            raise HTTPException(413, "单页图片过大")
        data.extend(chunk)
    try:
        from fastapi.concurrency import run_in_threadpool
        return await run_in_threadpool(recognize_image, bytes(data), mime)
    except InvalidOcrImage as exc:
        raise HTTPException(415, str(exc)) from exc
    except OcrUnavailable as exc:
        raise HTTPException(503, str(exc)) from exc


@app.post("/api/books/{book_id}/pages", status_code=201)
async def upload_page(book_id: str, page_no: int, request: Request, actor: str = Depends(actor_id)):
    owned("books", book_id, actor)
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip()
    if page_no < 1 or page_no > MAX_BOOK_PAGES:
        raise HTTPException(422, "页码超出范围")
    if content_type not in {"image/jpeg", "image/png"}:
        raise HTTPException(415, "仅支持 JPG / PNG")
    data = bytearray()
    async for chunk in request.stream():
        if len(data) + len(chunk) > MAX_PAGE_BYTES:
            raise HTTPException(413, "图片过大")
        data.extend(chunk)
    if not data:
        raise HTTPException(400, "不能上传空图片")
    if content_type == "image/png" and not (data.startswith(b"\x89PNG\r\n\x1a\n") and len(data) >= 24 and data[12:16] == b"IHDR"):
        raise HTTPException(415, "PNG 文件头不正确")
    if content_type == "image/jpeg" and not (len(data) >= 20 and data.startswith(b"\xff\xd8\xff") and data.endswith(b"\xff\xd9")):
        raise HTTPException(415, "JPG 文件头不正确")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as image:
                if image.format != {"image/jpeg": "JPEG", "image/png": "PNG"}[content_type] or image.width * image.height > 40_000_000:
                    raise ValueError("格式不匹配或像素过多")
                image.verify()
            with Image.open(BytesIO(data)) as image:
                image.load()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombWarning, Image.DecompressionBombError) as exc:
        raise HTTPException(415, "图片无法完整解码") from exc
    if db().pages.find_one({"book_id": book_id, "page_no": page_no}):
        raise HTTPException(409, "该页已存在")
    file_id = files().put(bytes(data), content_type=content_type, filename=f"{book_id}/{page_no}")
    page = {"_id": ident(), "book_id": book_id, "page_no": page_no, "file_id": file_id,
            "image_path": f"/api/books/{book_id}/pages/{page_no}/content", "sha256": hashlib.sha256(data).hexdigest(),
            "mime_type": content_type, "size_bytes": len(data), "revision": 0, "created_at": now()}
    try:
        db().pages.insert_one(page)
    except DuplicateKeyError as exc:
        files().delete(file_id)
        raise HTTPException(409, "该页已存在") from exc
    return public(page)


@app.get("/api/books/{book_id}/pages")
def list_pages(book_id: str, actor: str = Depends(actor_id)):
    owned("books", book_id, actor)
    return [public(p) for p in db().pages.find({"book_id": book_id}).sort("page_no", ASCENDING)]


@app.get("/api/books/{book_id}/pages/{page_no}/content")
def page_content(book_id: str, page_no: int, actor: str = Depends(actor_id)):
    owned("books", book_id, actor)
    page = db().pages.find_one({"book_id": book_id, "page_no": page_no})
    if not page:
        raise HTTPException(404, "书页不存在")
    try:
        blob = files().get(page["file_id"])
    except gridfs.NoFile as exc:
        raise HTTPException(404, "图片不存在") from exc
    return Response(blob.read(), media_type=page["mime_type"])


@app.post("/api/books/{book_id}/classify")
def classify(book_id: str, body: ClassificationRequest = ClassificationRequest(), actor: str = Depends(actor_id)):
    book = owned("books", book_id, actor)
    previous = book.get("classification")
    if previous and not body.force_reclassify:
        return previous
    predicted, confidence, reasons = classify_title(book["title"])
    if body.requested_type:
        predicted, confidence, reasons = body.requested_type, 1.0, ["主人指定类型"]
    item = {"book_id": book_id, "predicted_type": predicted, "confidence": confidence, "reasons": reasons,
            "confirmed_type": None, "confirmed_by": None, "status": "CLASSIFIED"}
    db().books.update_one({"_id": book_id}, {"$set": {"classification": item, "status": "CLASSIFIED", "updated_at": now()}})
    return item


@app.patch("/api/books/{book_id}/classification")
def confirm(book_id: str, body: ClassificationConfirm, actor: str = Depends(actor_id)):
    book = owned("books", book_id, actor)
    if not book.get("classification"):
        raise HTTPException(409, "请先自动分类")
    item = {**book["classification"], "confirmed_type": body.confirmed_type, "confirmed_by": actor, "status": "CONFIRMED"}
    db().books.update_one({"_id": book_id}, {"$set": {"classification": item, "status": "CONFIRMED", "updated_at": now()}})
    return item


class Revision(BaseModel):
    ocr: dict[str, Any] | None = None
    vision: dict[str, Any] | None = None


@app.patch("/api/books/{book_id}/pages/{page_no}/revision")
def revise_page(book_id: str, page_no: int, body: Revision, actor: str = Depends(actor_id)):
    owned("books", book_id, actor)
    page = db().pages.find_one({"book_id": book_id, "page_no": page_no})
    if not page:
        raise HTTPException(404, "书页不存在")
    if body.ocr is None and body.vision is None:
        raise HTTPException(422, "至少提供一项校对")
    revision = page["revision"] + 1
    item = {"book_id": book_id, "page_no": page_no, "revision": revision,
            "ocr": body.ocr if body.ocr is not None else page.get("ocr"),
            "vision": body.vision if body.vision is not None else page.get("vision"),
            "source": "manual", "created_at": now()}
    updated = db().pages.update_one({"_id": page["_id"], "revision": page["revision"]}, {"$set": {"revision": revision, "ocr": item["ocr"], "vision": item["vision"]}})
    if not updated.modified_count:
        raise HTTPException(409, "书页已有新版本，请刷新后重试")
    db().revisions.insert_one({"_id": ident(), **item})
    return item


@app.get("/api/books/{book_id}/pages/{page_no}/revisions")
def revisions(book_id: str, page_no: int, actor: str = Depends(actor_id)):
    owned("books", book_id, actor)
    return [public(x) for x in db().revisions.find({"book_id": book_id, "page_no": page_no})]


@app.post("/api/books/{book_id}/analyze", status_code=202)
def analyze(book_id: str, body: AnalyzeRequest, background_tasks: BackgroundTasks, actor: str = Depends(actor_id)):
    book = owned("books", book_id, actor)
    if book["status"] not in {"CONFIRMED", "ANALYZED"}:
        raise HTTPException(409, "请先确认图书类型")
    pages = list(db().pages.find({"book_id": book_id}).sort("page_no", ASCENDING))
    if not pages:
        raise HTTPException(409, "请先上传书页")
    run_id, job_id, stamp = ident(), ident(), now()
    db().runs.insert_one({"_id": run_id, "book_id": book_id, "owner_id": actor, "status": "QUEUED", "config": {"analysis_profile": body.analysis_profile, "input_hashes": [p["sha256"] for p in pages]}, "model_manifest": {}, "created_at": stamp, "finished_at": None})
    db().jobs.insert_one({"_id": job_id, "run_id": run_id, "owner_id": actor, "stage": "analyze", "status": "QUEUED", "attempts": 0, "max_attempts": 3, "error_code": None, "error_message": None, "created_at": stamp})
    background_tasks.add_task(run_analysis, job_id)
    return {"job_id": job_id, "run_id": run_id, "status": "QUEUED", "stage": "analyze", "attempts": 0}


def run_analysis(job_id: str):
    job = db().jobs.find_one({"_id": job_id})
    if not job:
        return
    run = db().runs.find_one({"_id": job["run_id"]})
    book = db().books.find_one({"_id": run["book_id"]})
    pages = list(db().pages.find({"book_id": book["_id"]}).sort("page_no", ASCENDING))
    db().jobs.update_one({"_id": job_id}, {"$set": {"status": "RUNNING", "started_at": now(), "error_code": None, "error_message": None}, "$inc": {"attempts": 1}})
    db().runs.update_one({"_id": run["_id"]}, {"$set": {"status": "RUNNING"}})
    try:
        with tempfile.TemporaryDirectory(prefix="paper-mobile-analysis-") as tmp:
            inputs = []
            for page in pages:
                suffix = ".png" if page["mime_type"] == "image/png" else ".jpg"
                path = Path(tmp) / f"{page['page_no']}{suffix}"
                path.write_bytes(files().get(page["file_id"]).read())
                inputs.append(AnalysisPageInput(page_no=page["page_no"], image_path=path, sha256=page["sha256"]))
            result = build_analysis_provider().analyze(book["_id"], book["classification"].get("confirmed_type") or book["classification"]["predicted_type"], inputs)
        if not result.pages or {p["page_no"] for p in result.pages} != {p["page_no"] for p in pages}:
            raise AnalysisProviderError("PROVIDER_ERROR", "模型返回的页码不完整")
        config = {**run["config"], "analysis_result": {"pages": result.pages, "graph": result.graph, "note": result.note}}
        db().runs.update_one({"_id": run["_id"]}, {"$set": {"status": "SUCCEEDED", "config": config, "model_manifest": result.model_manifest, "finished_at": now()}})
        db().jobs.update_one({"_id": job_id}, {"$set": {"status": "SUCCEEDED", "ended_at": now()}})
        db().books.update_one({"_id": book["_id"]}, {"$set": {"status": "ANALYZED", "updated_at": now()}})
    except Exception as exc:
        code = exc.code if isinstance(exc, AnalysisProviderError) else "PROVIDER_ERROR"
        db().jobs.update_one({"_id": job_id}, {"$set": {"status": "FAILED", "error_code": code, "error_message": str(exc)[:1000], "ended_at": now()}})
        db().runs.update_one({"_id": run["_id"]}, {"$set": {"status": "FAILED", "finished_at": now()}})


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str, actor: str = Depends(actor_id)):
    job = db().jobs.find_one({"_id": job_id, "owner_id": actor})
    if not job:
        raise HTTPException(404, "任务不存在")
    return {"job_id": job_id, "run_id": job["run_id"], "status": job["status"], "stage": job["stage"], "attempts": job["attempts"]}


@app.post("/api/jobs/{job_id}/retry", status_code=202)
def retry(job_id: str, tasks: BackgroundTasks, actor: str = Depends(actor_id)):
    job = db().jobs.find_one({"_id": job_id, "owner_id": actor})
    if not job:
        raise HTTPException(404, "任务不存在")
    if job["status"] != "FAILED" or job["attempts"] >= 3:
        raise HTTPException(409, "不能重试该任务")
    db().jobs.update_one({"_id": job_id}, {"$set": {"status": "RETRYING"}})
    tasks.add_task(run_analysis, job_id)
    return {"job_id": job_id, "run_id": job["run_id"], "status": "RETRYING", "stage": "analyze", "attempts": job["attempts"]}


@app.get("/api/books/{book_id}/runs")
def book_runs(book_id: str, actor: str = Depends(actor_id)):
    owned("books", book_id, actor)
    return [public(x) for x in db().runs.find({"book_id": book_id})]


@app.get("/api/runs/{run_id}")
def get_run(run_id: str, actor: str = Depends(actor_id)):
    return public(run_owned(run_id, actor))


@app.get("/api/runs/{run_id}/jobs")
def run_jobs(run_id: str, actor: str = Depends(actor_id)):
    run_owned(run_id, actor)
    return [public(x) for x in db().jobs.find({"run_id": run_id})]


@app.get("/api/runs/{run_id}/progress")
def progress(run_id: str, actor: str = Depends(actor_id)):
    run = run_owned(run_id, actor)
    jobs = run_jobs(run_id, actor)
    return {"run_id": run_id, "status": run["status"], "stages": [{k: j.get(k) for k in ("stage", "status", "attempts", "error_code")} for j in jobs]}


@app.get("/api/runs/{run_id}/history")
def history(run_id: str, actor: str = Depends(actor_id)):
    run_owned(run_id, actor)
    return {"run_id": run_id, "jobs": run_jobs(run_id, actor), "segments": segments(run_id, actor), "interactions": interactions(run_id, actor)}


@app.post("/api/books/{book_id}/notes/generate", status_code=201)
def generate_note(book_id: str, body: NoteGenerateRequest, actor: str = Depends(actor_id)):
    book = owned("books", book_id, actor)
    run = db().runs.find_one({"book_id": book_id, "status": "SUCCEEDED"}, sort=[("finished_at", -1)])
    if book["status"] != "ANALYZED" or not run:
        raise HTTPException(409, "请先完成真实分析")
    generated = run["config"].get("analysis_result", {}).get("note", {})
    content = {**generated, "template": body.note_template, "analysis_run_id": run["_id"]}
    content["is_placeholder"] = not (isinstance(content.get("summary"), str) and content["summary"].strip() and content.get("sources"))
    stamp = now()
    note = {"_id": ident(), "book_id": book_id, "owner_id": actor, "content": content, "status": "DRAFT", "version": 1, "created_at": stamp, "updated_at": stamp}
    db().notes.insert_one(note)
    return public(note)


@app.get("/api/notes/{note_id}")
def get_note(note_id: str, actor: str = Depends(actor_id)):
    return public(owned("notes", note_id, actor))


@app.patch("/api/notes/{note_id}")
def update_note(note_id: str, body: NotePatch, actor: str = Depends(actor_id)):
    note = owned("notes", note_id, actor)
    if note["status"] not in {"DRAFT", "REVIEWING"}:
        raise HTTPException(409, "已审核笔记不能直接修改")
    content = {**body.content, "is_placeholder": not (isinstance(body.content.get("summary"), str) and body.content["summary"].strip() and body.content.get("sources"))}
    stamp = now()
    db().notes.update_one({"_id": note_id}, {"$set": {"content": content, "updated_at": stamp}, "$inc": {"version": 1}})
    db().note_revisions.insert_one({"_id": ident(), "note_id": note_id, "editor_id": actor, "content": content, "version": note["version"] + 1, "created_at": stamp})
    return get_note(note_id, actor)


@app.post("/api/notes/{note_id}/review")
def review_note(note_id: str, body: NoteReview, actor: str = Depends(actor_id)):
    note = owned("notes", note_id, actor)
    if note["status"] not in {"DRAFT", "REVIEWING"}:
        raise HTTPException(409, "不能重复审核")
    pages = {p["page_no"] for p in db().pages.find({"book_id": note["book_id"]}, {"page_no": 1})}
    sources = note["content"].get("sources")
    if body.action == "approve" and (note["content"].get("is_placeholder") or not isinstance(sources, list) or not sources or not all(isinstance(s, dict) and s.get("page_no") in pages for s in sources)):
        raise HTTPException(409, "笔记缺少有效来源，不能审核")
    db().notes.update_one({"_id": note_id}, {"$set": {"status": "PRIVATE" if body.action == "approve" else "REVIEWING", "updated_at": now()}})
    return get_note(note_id, actor)


@app.post("/api/notes/{note_id}/shares", status_code=201)
def create_share(note_id: str, body: ShareCreate, actor: str = Depends(actor_id)):
    note = owned("notes", note_id, actor)
    if note["status"] not in {"PRIVATE", "SHARED"}:
        raise HTTPException(409, "笔记尚未审核")
    if body.share_mode == "invite_only" and not body.shared_user_id:
        raise HTTPException(422, "请指定用户")
    if body.expires_at and body.expires_at.astimezone(timezone.utc) <= datetime.now(timezone.utc):
        raise HTTPException(422, "过期时间必须在未来")
    token = uuid.uuid4().hex if body.share_mode == "link" else None
    share = {"_id": ident(), "note_id": note_id, "owner_id": actor, "share_mode": body.share_mode,
             "shared_user_id": body.shared_user_id, "token_hash": hashlib.sha256(token.encode()).hexdigest() if token else None,
             "expires_at": body.expires_at.isoformat() if body.expires_at else None, "revoked_at": None, "created_at": now()}
    db().shares.insert_one(share)
    db().notes.update_one({"_id": note_id}, {"$set": {"status": "SHARED", "updated_at": now()}})
    return {"id": share["_id"], "share_mode": body.share_mode, "shared_user_id": body.shared_user_id, "expires_at": share["expires_at"], "status": "active", "token": token}


@app.get("/api/notes/{note_id}/shares")
def shares(note_id: str, actor: str = Depends(actor_id)):
    owned("notes", note_id, actor)
    return [{"id": s["_id"], "share_mode": s["share_mode"], "shared_user_id": s["shared_user_id"], "expires_at": s["expires_at"], "status": "revoked" if s["revoked_at"] else "active"} for s in db().shares.find({"note_id": note_id})]


@app.delete("/api/notes/{note_id}/shares/{share_id}", status_code=204)
def revoke(note_id: str, share_id: str, actor: str = Depends(actor_id)):
    owned("notes", note_id, actor)
    share = db().shares.find_one({"_id": share_id, "note_id": note_id})
    if not share:
        raise HTTPException(404, "分享不存在")
    db().shares.update_one({"_id": share_id}, {"$set": {"revoked_at": now()}})
    if not db().shares.find_one({"note_id": note_id, "revoked_at": None}):
        db().notes.update_one({"_id": note_id}, {"$set": {"status": "PRIVATE"}})


def valid_share(share):
    if not share or share["revoked_at"]:
        raise HTTPException(404, "分享不存在")
    if share["expires_at"] and datetime.fromisoformat(share["expires_at"]) <= datetime.now(timezone.utc):
        raise HTTPException(410, "分享已过期")
    note = db().notes.find_one({"_id": share["note_id"]})
    if not note or note["status"] != "SHARED":
        raise HTTPException(404, "分享不存在")
    return public(note)


@app.get("/api/shared-notes/{token}")
def shared_note(token: str):
    return valid_share(db().shares.find_one({"token_hash": hashlib.sha256(token.encode()).hexdigest(), "share_mode": "link"}))


@app.get("/api/notes/{note_id}/shares/{share_id}/view")
def invited_note(note_id: str, share_id: str, actor: str = Depends(actor_id)):
    return valid_share(db().shares.find_one({"_id": share_id, "note_id": note_id, "share_mode": "invite_only", "shared_user_id": actor}))


class AssetInput(BaseModel):
    asset_type: str
    file_path: str
    mime_type: str
    sha256: str | None = None
    duration_ms: int | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


@app.post("/api/runs/{run_id}/assets", status_code=201)
def register_asset(run_id: str, body: AssetInput, actor: str = Depends(actor_id)):
    run_owned(run_id, actor)
    # Producer can place outputs under an isolated mobile directory; never read desktop files.
    root = (Path(__file__).resolve().parents[1] / "data" / "runs" / run_id).resolve()
    path = Path(body.file_path).resolve()
    if root not in path.parents or not path.is_file():
        raise HTTPException(422, "产物须在移动版的运行目录中")
    allowed = {"video": {"video/mp4": ".mp4"}, "image": {"image/png": ".png", "image/jpeg": ".jpg"}, "audio": {"audio/mpeg": ".mp3"}, "subtitle": {"text/vtt": ".vtt"}}
    if body.asset_type not in allowed or body.mime_type not in allowed[body.asset_type] or path.suffix.lower() != allowed[body.asset_type][body.mime_type]:
        raise HTTPException(422, "产物类型不支持")
    if body.asset_type in {"video", "image"} and not body.metadata.get("producer"):
        raise HTTPException(422, "缺少生成来源")
    data = path.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if body.sha256 and digest != body.sha256:
        raise HTTPException(409, "产物哈希不一致")
    fid = files().put(data, content_type=body.mime_type)
    asset = {"_id": ident(), "run_id": run_id, "owner_id": actor, "asset_type": body.asset_type, "mime_type": body.mime_type,
             "sha256": digest, "duration_ms": body.duration_ms, "metadata": body.metadata, "file_id": fid, "created_at": now()}
    db().assets.insert_one(asset)
    # Never delete the original input as part of API registration.
    return {"id": asset["_id"], "run_id": run_id, "asset_type": body.asset_type, "sha256": digest, "status": "registered_only"}


@app.get("/api/runs/{run_id}/assets")
def assets(run_id: str, actor: str = Depends(actor_id)):
    run_owned(run_id, actor)
    return [public(x) for x in db().assets.find({"run_id": run_id})]


@app.get("/api/runs/{run_id}/assets/{asset_id}/content")
def asset_content(run_id: str, asset_id: str, actor: str = Depends(actor_id)):
    run_owned(run_id, actor)
    item = db().assets.find_one({"_id": asset_id, "run_id": run_id})
    if not item:
        raise HTTPException(404, "产物不存在")
    try:
        data = files().get(item["file_id"]).read()
    except gridfs.NoFile as exc:
        raise HTTPException(404, "产物文件不存在") from exc
    if hashlib.sha256(data).hexdigest() != item["sha256"]:
        raise HTTPException(409, "产物校验失败")
    return Response(data, media_type=item["mime_type"])


class SegmentInput(BaseModel):
    page_no: int | None = None
    start_ms: int
    end_ms: int
    caption: str | None = None
    source: dict[str, Any]


@app.post("/api/runs/{run_id}/segments", status_code=201)
def add_segment(run_id: str, body: SegmentInput, actor: str = Depends(actor_id)):
    run = run_owned(run_id, actor)
    if body.start_ms < 0 or body.end_ms <= body.start_ms or not body.source.get("producer"):
        raise HTTPException(422, "时间轴或来源不正确")
    if body.page_no is not None and not db().pages.find_one({"book_id": run["book_id"], "page_no": body.page_no}):
        raise HTTPException(422, "来源页不存在")
    item = {"_id": ident(), "run_id": run_id, "page_no": body.page_no, "start_ms": body.start_ms, "end_ms": body.end_ms, "caption": body.caption, "source": body.source, "created_at": now()}
    db().segments.insert_one(item)
    return {"id": item["_id"], "run_id": run_id, "status": "registered_only"}


@app.get("/api/runs/{run_id}/segments")
def segments(run_id: str, actor: str = Depends(actor_id)):
    run_owned(run_id, actor)
    return [public(x) for x in db().segments.find({"run_id": run_id}).sort("start_ms", ASCENDING)]


class InteractionInput(BaseModel):
    interaction_type: str
    input: dict[str, Any]
    output: dict[str, Any]
    latency_ms: int


@app.post("/api/runs/{run_id}/interactions", status_code=201)
def record_interaction(run_id: str, body: InteractionInput, actor: str = Depends(actor_id)):
    run_owned(run_id, actor)
    if body.interaction_type not in {"voice", "touch"} or body.latency_ms < 0 or not body.output.get("producer"):
        raise HTTPException(422, "交互数据不正确")
    item = {"_id": ident(), "run_id": run_id, "interaction_type": body.interaction_type, "input": body.input, "output": body.output, "latency_ms": body.latency_ms, "created_at": now()}
    db().interactions.insert_one(item)
    return {"id": item["_id"], "run_id": run_id, "status": "recorded_only"}


@app.get("/api/runs/{run_id}/interactions")
def interactions(run_id: str, actor: str = Depends(actor_id)):
    run_owned(run_id, actor)
    return [public(x) for x in db().interactions.find({"run_id": run_id}).sort("created_at", ASCENDING)]


class WorkspaceInput(BaseModel):
    schema_version: int = 1
    state: dict[str, Any]


@app.get("/api/mobile/workspace")
def get_workspace(actor: str = Depends(actor_id)):
    doc = db().workspace.find_one({"_id": actor})
    return {"schema_version": 1, "revision": doc["revision"] if doc else 0, "state": doc["state"] if doc else None}


@app.put("/api/mobile/workspace")
def save_workspace(body: WorkspaceInput, actor: str = Depends(actor_id)):
    if body.schema_version != 1:
        raise HTTPException(422, "会话格式不支持")
    payload = json.dumps(body.state, ensure_ascii=False)
    if len(payload.encode("utf-8")) > 2_000_000:
        raise HTTPException(413, "会话过大")
    db().workspace.update_one({"_id": actor}, {"$set": {"owner_id": actor, "state": body.state, "updated_at": now()}, "$inc": {"revision": 1}}, upsert=True)
    return {"revision": db().workspace.find_one({"_id": actor})["revision"]}

