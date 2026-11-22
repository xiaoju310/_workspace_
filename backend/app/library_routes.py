"""Account-owned desktop drafts and original images; never starts an AI job.

SQLite stays on the server just like books/runs; MongoDB authenticates accounts.
Compare-and-swap revisions prevent an old device from overwriting a new device.
"""
import hashlib
import json
import re
import warnings
from datetime import datetime, timezone
from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import FileResponse
from PIL import Image, UnidentifiedImageError
from starlette.concurrency import run_in_threadpool
from .services import pdf_import
from .db import get_connection
from .security import actor_id, require_owner

router = APIRouter(prefix='/api/library', tags=['account-library'])


def record_id(value):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', value):
        raise HTTPException(422, '草稿编号无效')
    return value


async def limited_body(request, limit):
    data = bytearray()
    async for chunk in request.stream():
        if len(data) + len(chunk) > limit:
            raise HTTPException(413, '同步内容过大，请分批保存')
        data.extend(chunk)
    return bytes(data)


@router.post('/pdf/preview')
async def preview_pdf(request: Request, max_pages: int = 100, actor: str = Depends(actor_id)):
    if not 1 <= max_pages <= 100:
        raise HTTPException(422, '剩余页数需要在 1–100 之间')
    if request.headers.get('content-type', '').split(';')[0] != 'application/pdf':
        raise HTTPException(415, '请选择 PDF 文件')
    data = await limited_body(request, pdf_import.MAX_BYTES)
    return await run_in_threadpool(pdf_import.render_pdf, data, max_pages)


@router.post('/images')
async def upload_image(request: Request, actor: str = Depends(actor_id)):
    # Hash server-side too: school-network HTTP browsers may not expose crypto.subtle.
    data = await limited_body(request, 20 * 1024 * 1024)
    return store_image(hashlib.sha256(data).hexdigest(), data, actor)


@router.put('/images/{digest}')
async def save_image(digest: str, request: Request, actor: str = Depends(actor_id)):
    if not re.fullmatch('[a-f0-9]{64}', digest):
        raise HTTPException(422, '图片指纹无效')
    data = await limited_body(request, 20 * 1024 * 1024)
    return store_image(digest, data, actor)


def store_image(digest, data, actor):
    if hashlib.sha256(data).hexdigest() != digest:
        raise HTTPException(422, '图片指纹不匹配')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as image:
                if image.format not in ('JPEG', 'PNG') or image.width * image.height > 40_000_000:
                    raise ValueError()
                mime = Image.MIME[image.format]
                image.verify()
            with Image.open(BytesIO(data)) as image:
                image.load()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombWarning, Image.DecompressionBombError) as exc:
        raise HTTPException(422, '原图无法解码，只允许 JPG/PNG') from exc
    with get_connection() as c:
        c.execute('INSERT OR IGNORE INTO account_images VALUES(?,?,?,?)', (actor, digest, data, mime))
    return {'sha256': digest}


@router.get('/images/{digest}')
def get_image(digest: str, actor: str = Depends(actor_id)):
    with get_connection() as c:
        row = c.execute('SELECT content,mime_type FROM account_images WHERE owner_id=? AND sha256=?', (actor, digest)).fetchone()
    if row is None:
        raise HTTPException(404, '同步原图不存在')
    return Response(bytes(row['content']), media_type=row['mime_type'], headers={'Cache-Control': 'private, no-store'})


@router.get('/drafts')
def list_drafts(actor: str = Depends(actor_id)):
    with get_connection() as c:
        rows = c.execute("SELECT record_id,data_json,revision,updated_at FROM account_drafts WHERE owner_id=? AND record_id<>'workspace' AND data_json<>'null' ORDER BY updated_at DESC", (actor,)).fetchall()
    return [dict(id=r['record_id'], title=json.loads(r['data_json']).get('title') or '未命名图书',
                 pageCount=len(json.loads(r['data_json']).get('pages', [])), updatedAt=r['updated_at'], revision=r['revision']) for r in rows]


@router.get('/drafts/{key}')
def get_draft(key: str, actor: str = Depends(actor_id)):
    record_id(key)
    with get_connection() as c:
        row = c.execute('SELECT * FROM account_drafts WHERE owner_id=? AND record_id=?', (actor, key)).fetchone()
    return {'revision': row['revision'], 'data': json.loads(row['data_json']), 'updated_at': row['updated_at']} if row else {'revision': 0, 'data': None}


def check_images(data, actor, c):
    """Only this account's uploaded originals may be referenced by a snapshot."""
    if isinstance(data, dict):
        if 'cloud_asset' in data:
            digest = data['cloud_asset']
            if not isinstance(digest, str) or not c.execute('SELECT 1 FROM account_images WHERE owner_id=? AND sha256=?', (actor, digest)).fetchone():
                raise HTTPException(422, '请先同步全部书页原图')
        for value in data.values():
            check_images(value, actor, c)
    elif isinstance(data, list):
        for value in data:
            check_images(value, actor, c)


@router.put('/drafts/{key}')
async def save_draft(key: str, request: Request, actor: str = Depends(actor_id)):
    record_id(key)
    try:
        body = json.loads(await limited_body(request, 8 * 1024 * 1024))
    except (ValueError, RecursionError) as exc:
        raise HTTPException(422, '草稿格式无效') from exc
    if not isinstance(body, dict) or type(body.get('expected_revision')) is not int or not isinstance(body.get('data'), dict):
        raise HTTPException(422, '草稿缺少内容或版本号')
    data, expected = body['data'], body['expected_revision']
    if key == 'workspace':
        if any(not isinstance(data.get(k), list) for k in ('books','notes','grants','interactions')):
            raise HTTPException(422, '书架格式无效')
    elif not isinstance(data.get('pages'), list) or data.get('id') != key:
        raise HTTPException(422, '导入草稿格式无效')
    with get_connection() as c:
        c.execute('BEGIN IMMEDIATE')
        old = c.execute('SELECT revision FROM account_drafts WHERE owner_id=? AND record_id=?', (actor, key)).fetchone()
        revision = old['revision'] if old else 0
        if revision != expected:
            raise HTTPException(409, '其他设备已经更新了这份内容。当前设备的修改仍保存在本机；请先备份再重新读取服务器版本。')
        try:
            check_images(data, actor, c)
            encoded = json.dumps(data, ensure_ascii=False, allow_nan=False)
        except (ValueError, RecursionError) as exc:
            raise HTTPException(422, '草稿内容无效') from exc
        now = datetime.now(timezone.utc).isoformat()
        c.execute('INSERT INTO account_drafts VALUES(?,?,?,?,?) ON CONFLICT(owner_id,record_id) DO UPDATE SET data_json=excluded.data_json,revision=excluded.revision,updated_at=excluded.updated_at', (actor,key,encoded,revision+1,now))
    return {'revision': revision+1, 'updated_at': now}


@router.delete('/drafts/{key}', status_code=204)
def delete_draft(key: str, expected_revision: int, actor: str = Depends(actor_id)):
    record_id(key)
    if key == 'workspace':
        raise HTTPException(422, '不能从草稿入口删除整个书架')
    with get_connection() as c:
        c.execute('BEGIN IMMEDIATE')
        row = c.execute('SELECT revision FROM account_drafts WHERE owner_id=? AND record_id=?', (actor,key)).fetchone()
        if row and row['revision'] != expected_revision:
            raise HTTPException(409, '其他设备修改了草稿，请刷新后再删除')
        # Keep a revisioned tombstone so an offline device cannot recreate a deleted draft.
        if row:
            c.execute("UPDATE account_drafts SET data_json='null',revision=revision+1 WHERE owner_id=? AND record_id=?", (actor,key))
    return Response(status_code=204)


@router.get('/books')
def library_books(actor: str = Depends(actor_id)):
    """Recover pre-sync books as well, without leaking filesystem paths or share secrets."""
    with get_connection() as c:
        result = []
        for b in c.execute('SELECT * FROM books WHERE owner_id=? ORDER BY created_at DESC', (actor,)).fetchall():
            item = dict(b)
            pages = c.execute('SELECT id,page_no,ocr_json,revision FROM pages WHERE book_id=? ORDER BY page_no', (b['id'],)).fetchall()
            item['pages'] = [dict(p) for p in pages]
            classification = c.execute('SELECT * FROM book_classifications WHERE book_id=?', (b['id'],)).fetchone()
            item['classification'] = dict(classification) if classification else None
            run = c.execute('SELECT id,status FROM runs WHERE book_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1', (b['id'],)).fetchone()
            item['run'] = dict(run) if run else None
            item['notes'] = [dict(n) for n in c.execute('SELECT * FROM reading_notes WHERE book_id=? AND owner_id=? ORDER BY updated_at DESC', (b['id'],actor)).fetchall()]
            result.append(item)
    return result


@router.get('/books/{book_id}/pages/{page_no}/image')
def original_image(book_id: str, page_no: int, actor: str = Depends(actor_id)):
    with get_connection() as c:
        book = c.execute('SELECT owner_id FROM books WHERE id=?', (book_id,)).fetchone()
        if not book:
            raise HTTPException(404, '图书不存在')
        require_owner(book['owner_id'], actor)
        page = c.execute('SELECT image_path,mime_type FROM pages WHERE book_id=? AND page_no=?', (book_id,page_no)).fetchone()
    from pathlib import Path
    if not page or not Path(page['image_path']).is_file():
        raise HTTPException(404, '书页原图缺失')
    return FileResponse(page['image_path'], media_type=page['mime_type'], headers={'Cache-Control':'private, no-store'})
