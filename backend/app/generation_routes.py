"""Read-only generation receipts. Task records are not a provider invoice."""
from __future__ import annotations
import json
from fastapi import APIRouter, Depends, HTTPException
from .db import get_connection
from .security import actor_id, require_owner

router = APIRouter(prefix='/api/books', tags=['generation-records'])

@router.get('/{book_id}/generation-records')
def generation_records(book_id: str, actor: str = Depends(actor_id)):
    with get_connection() as c:
        book = c.execute('SELECT owner_id FROM books WHERE id=?', (book_id,)).fetchone()
        if book is None:
            raise HTTPException(404, '图书不存在')
        require_owner(book['owner_id'], actor)
        runs = c.execute('SELECT id,created_at FROM runs WHERE book_id=? ORDER BY created_at DESC,rowid DESC', (book_id,)).fetchall()
        records = []
        for run in runs:
            for job in c.execute('SELECT * FROM jobs WHERE run_id=? ORDER BY created_at,rowid', (run['id'],)):
                stage = job['stage']
                pages, submitted, downloaded, uncertain, completed = [], None, None, None, None
                narration = False
                if stage in {'vision', 'book_video'}:
                    task = c.execute('SELECT stage,request_json FROM workflow_tasks WHERE run_id=? AND job_id=?', (run['id'], job['id'])).fetchone()
                    if not task:
                        continue
                    request = json.loads(task['request_json'])
                    pages = request.get('page_nos', []) if stage == 'vision' else [s['page_no'] for s in request.get('story', {}).get('shots', [])]
                    narration = bool(request.get('narration'))
                    if stage == 'book_video':
                        clips = c.execute('SELECT * FROM workflow_clips WHERE run_id=?', (run['id'],)).fetchall()
                        submitted = sum(bool(x['task_id']) for x in clips)
                        downloaded = sum(bool(x['file_path']) for x in clips)
                        uncertain = sum(bool(x['submission_started']) and not x['task_id'] for x in clips)
                    else:
                        completed = c.execute("SELECT COUNT(*) FROM run_logs WHERE run_id=? AND event='vision_page_completed' AND (json_extract(safe_metadata_json,'$.job_id')=? OR (json_extract(safe_metadata_json,'$.job_id') IS NULL AND ?='vision'))", (run['id'], job['id'], task['stage'])).fetchone()[0]
                elif stage == 'video':
                    video = c.execute('SELECT * FROM video_generations WHERE job_id=?', (job['id'],)).fetchone()
                    if not video:
                        continue
                    pages = [video['page_no']]
                    submitted, downloaded = int(bool(video['task_id'])), int(bool(video['asset_id']))
                    uncertain = int(bool(video['submission_started']) and not video['task_id'])
                else:
                    # Legacy analysis has no per-provider request ledger; don't infer calls from attempts.
                    pages = [p[0] for p in c.execute('SELECT page_no FROM pages WHERE book_id=? ORDER BY page_no', (book_id,))]
                records.append({'job_id': job['id'], 'run_id': run['id'], 'stage': stage, 'status': job['status'],
                    'page_nos': pages, 'page_scope': 'submitted' if stage in {'vision','book_video','video'} else 'current_book',
                    'narration': narration, 'created_at': job['created_at'], 'error_code': job['error_code'],
                    'submitted_count': submitted, 'downloaded_count': downloaded, 'uncertain_count': uncertain,
                    'completed_vision_calls': completed, 'amount': None})
    return {'book_id': book_id, 'records': records, 'amount': None,
        'billing_note': '尚无供应商账单，金额未知。任务数、已记录调用与视频提交数均不是扣费次数；失败或结果不明的请求也可能收费。记录仅覆盖本书生成流程，不含问答、认物等交互费用。'}
