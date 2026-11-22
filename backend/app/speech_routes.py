"""Authenticated, explicitly opted-in local speech fallback."""
from fastapi import APIRouter, Depends, HTTPException, Request
from starlette.concurrency import run_in_threadpool
from .security import actor_id
from .services import local_speech

router = APIRouter(prefix='/api/speech', tags=['local-speech'])

@router.get('/capabilities')
def capabilities(actor: str = Depends(actor_id)):
    return local_speech.capabilities()

@router.post('/transcribe')
async def transcribe(request: Request, actor: str = Depends(actor_id)):
    if request.headers.get('X-Local-Speech-Consent') != 'true':
        raise HTTPException(422, '请先同意将录音发送到当前服务器本地识别；不调用云端，处理后删除。')
    mime = request.headers.get('content-type', '').split(';')[0].lower()
    if mime not in {'audio/wav','audio/x-wav','audio/webm','audio/ogg','audio/mp4'}:
        raise HTTPException(415, '仅支持 WAV、WebM、Ogg 或 MP4 录音。')
    raw = bytearray()
    async for chunk in request.stream():
        if len(raw) + len(chunk) > local_speech.MAX_BYTES:
            raise HTTPException(413, '录音不能超过 4 MB。')
        raw.extend(chunk)
    try:
        return await run_in_threadpool(local_speech.transcribe, bytes(raw), request.headers.get('X-Speech-Language', 'zh-CN'))
    except local_speech.SpeechError as exc:
        raise HTTPException(exc.status, str(exc)) from None
