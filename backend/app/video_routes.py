"""主人明确确认后才提交付费任务；任务号先落盘，恢复只查询、不重复付费。"""
from __future__ import annotations
import re
import time
import uuid
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field
from .db import get_connection
from .security import actor_id, require_owner
from .services.core import now_iso, json_text, sha256_file
from .ai.video_doubao import DoubaoProvider, ArkAPIError
from .ai.doubao_settings import video_settings

router = APIRouter(prefix="/api/runs", tags=["video"])

class VideoRequest(BaseModel):
    page_no: int = Field(ge=1, le=2000)
    prompt: str = Field(min_length=1, max_length=2000)
    duration: Literal[5] = 5
    confirm_paid: bool = False


def owned_run(c, run_id, actor):
    row = c.execute("SELECT r.*,b.owner_id FROM runs r JOIN books b ON b.id=r.book_id WHERE r.id=?", (run_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "运行不存在")
    require_owner(row["owner_id"], actor)
    return row


def snapshot(c, run_id):
    row = c.execute("SELECT v.*,j.status,j.error_code,j.error_message FROM video_generations v JOIN jobs j ON j.id=v.job_id WHERE v.run_id=?", (run_id,)).fetchone()
    if row is None:
        return {"status": "NOT_STARTED"}
    # 不返回凭据、文件路径、签名链接，前端也不直接访问豆包。
    return {k: row[k] for k in ("job_id", "page_no", "status", "asset_id", "error_code", "error_message")} | {
        "can_resume": bool(row["task_id"]) and row["status"] == "FAILED" and row["error_code"] != "PROVIDER_TERMINAL",
        "duration": 5,
    }


def validated_page(page):
    from . import main
    path = Path(page["image_path"]).resolve()
    root = (main.DATA_ROOT / "books" / page["book_id"]).resolve()
    if root not in path.parents or sha256_file(path) != page["sha256"]:
        raise ValueError("Page integrity changed")
    return DoubaoProvider._image_data(path)


def provider_for(model):
    key, _ = video_settings()
    return DoubaoProvider(video_model=model, api_key=key, max_wait=600, duration=5)


@router.get("/{run_id}/video")
def video_status(run_id: str, actor: str = Depends(actor_id)):
    with get_connection() as c:
        owned_run(c, run_id, actor)
        return snapshot(c, run_id)


@router.post("/{run_id}/video", status_code=202)
def start_video(run_id: str, payload: VideoRequest, tasks: BackgroundTasks, actor: str = Depends(actor_id)):
    if not payload.confirm_paid:
        raise HTTPException(422, "请先确认会向豆包发送所选书页，且视频生成可能收费")
    prompt = payload.prompt.strip()
    if not prompt:
        raise HTTPException(422, "请填写视频动作描述")
    with get_connection() as c:
        c.execute("BEGIN IMMEDIATE")
        run = owned_run(c, run_id, actor)
        existing = c.execute("SELECT 1 FROM video_generations WHERE run_id=?", (run_id,)).fetchone()
        if existing:
            return snapshot(c, run_id)  # 双击、超时重发均复用同一任务，绝不重新提交。
        if c.execute("SELECT 1 FROM workflow_tasks WHERE run_id=? AND stage='book_video'", (run_id,)).fetchone():
            raise HTTPException(409, "本次运行已有多页视频，请使用故事工坊查看进度，避免覆盖播放时间轴")
        if run["status"] != "SUCCEEDED":
            raise HTTPException(409, "请先完成书页分析")
        if c.execute("SELECT 1 FROM jobs j JOIN runs r ON r.id=j.run_id WHERE r.book_id=? AND j.status IN ('QUEUED','RUNNING','RETRYING')", (run["book_id"],)).fetchone():
            raise HTTPException(409, "本书还有任务正在处理，请稍后再试")
        page = c.execute("SELECT * FROM pages WHERE book_id=? AND page_no=?", (run["book_id"], payload.page_no)).fetchone()
        if page is None:
            raise HTTPException(404, "所选书页不存在")
        key, model = video_settings()
        if not key or not model:
            raise HTTPException(503, "服务器尚未配置豆包视频密钥或视频模型，请配置 ARK_API_KEY 和 DOUBAO_VIDEO_MODEL 后重启服务")
        # 提交前验证原图，避免损坏文件消耗付费请求。
        try:
            validated_page(page)
        except (OSError, ValueError):
            raise HTTPException(422, "所选书页文件不可用，请重新导入")
        job_id, now = str(uuid.uuid4()), now_iso()
        c.execute("INSERT INTO jobs(id,run_id,stage,status,max_attempts,created_at) VALUES(?,?,'video','QUEUED',1,?)", (job_id, run_id, now))
        c.execute("INSERT INTO video_generations(run_id,job_id,page_no,prompt,model,created_at) VALUES(?,?,?,?,?,?)", (run_id, job_id, payload.page_no, prompt, model, now))
        result = snapshot(c, run_id)
    tasks.add_task(run_video, run_id)
    return result


@router.post("/{run_id}/video/resume", status_code=202)
def resume_video(run_id: str, tasks: BackgroundTasks, actor: str = Depends(actor_id)):
    with get_connection() as c:
        c.execute("BEGIN IMMEDIATE")
        owned_run(c, run_id, actor)
        result = snapshot(c, run_id)
        if not result.get("can_resume"):
            raise HTTPException(409, "当前任务无法恢复；恢复仅适用于已有豆包任务号的中断任务")
        run = owned_run(c, run_id, actor)
        if c.execute("SELECT 1 FROM jobs j JOIN runs r ON r.id=j.run_id WHERE r.book_id=? AND j.status IN ('QUEUED','RUNNING','RETRYING')", (run["book_id"],)).fetchone():
            raise HTTPException(409, "本书还有任务正在处理，请稍后再恢复视频查询")
        c.execute("UPDATE jobs SET status='QUEUED',error_code=NULL,error_message=NULL WHERE id=?", (result["job_id"],))
        result = snapshot(c, run_id)
    tasks.add_task(run_video, run_id)
    return result


def run_video(run_id: str):
    # 后台工作不持有数据库连接等待网络，所有调用先持久化状态。
    with get_connection() as c:
        c.execute("BEGIN IMMEDIATE")  # 读取任务号与领取工作必须原子化，不能使用旧快照重提付费任务。
        row = c.execute("SELECT v.*,r.book_id FROM video_generations v JOIN runs r ON r.id=v.run_id WHERE v.run_id=?", (run_id,)).fetchone()
        if row is None:
            return
        v = dict(row)
        claimed = c.execute("UPDATE jobs SET status='RUNNING',attempts=attempts+1,started_at=?,ended_at=NULL WHERE id=? AND status='QUEUED'", (now_iso(), v["job_id"])).rowcount
        if not claimed:
            return
    try:
        provider = provider_for(v["model"])
        task_id = v["task_id"]
        if not task_id:
            if v["submission_started"]:
                fail(v["job_id"], "SUBMISSION_UNCERTAIN", "提交结果不明确，为避免重复扣费已停止。请到火山方舟控制台核对任务，不会自动重新提交。")
                return
            with get_connection() as c:
                page = c.execute("SELECT * FROM pages WHERE book_id=? AND page_no=?", (v["book_id"], v["page_no"])).fetchone()
            image = validated_page(page)
            with get_connection() as c:
                c.execute("UPDATE video_generations SET submission_started=1 WHERE run_id=?", (run_id,))
            data = provider._json("POST", "/contents/generations/tasks", {
                "model": v["model"], "content": [{"type": "text", "text": v["prompt"]},
                {"type": "image_url", "image_url": {"url": image}, "role": "first_frame"}],
                "duration": 5, "resolution": "720p", "watermark": True,
            })
            task_id = data.get("id")
            if not isinstance(task_id, str) or not re.fullmatch(r"cgt-[A-Za-z0-9-]+", task_id):
                raise ValueError("invalid task id")
            with get_connection() as c:
                c.execute("UPDATE video_generations SET task_id=? WHERE run_id=?", (task_id, run_id))
        deadline = time.monotonic() + provider.max_wait
        while True:
            result = provider._json("GET", f"/contents/generations/tasks/{task_id}")
            state = result.get("status")
            if state == "succeeded":
                url = (result.get("content") or {}).get("video_url")
                if not isinstance(url, str):
                    raise ValueError("missing video")
                from . import main
                root = (main.DATA_ROOT / "runs" / run_id).resolve()
                root.mkdir(parents=True, exist_ok=True)
                output = root / f"video-{v['job_id']}.mp4"
                provider._download_video(url, output)
                with output.open("rb") as f:
                    header = f.read(12)
                if len(header) < 12 or header[4:8] != b"ftyp":
                    raise ValueError("invalid mp4")
                asset_id, now = str(uuid.uuid4()), now_iso()
                with get_connection() as c:
                    c.execute("INSERT INTO media_assets(id,run_id,asset_type,file_path,mime_type,sha256,duration_ms,metadata_json,created_at) VALUES(?,?,'video',?,'video/mp4',?,5000,?,?)", (asset_id,run_id,str(output),sha256_file(output),json_text({"producer":"doubao_seedance","page_no":v["page_no"],"model":v["model"],"duration":5}),now))
                    c.execute("UPDATE video_generations SET asset_id=? WHERE run_id=?", (asset_id, run_id))
                    # 真实片段来源：点击视频时可回到对应书页，不伪造全书时间轴。
                    if not c.execute("SELECT 1 FROM segments WHERE run_id=?", (run_id,)).fetchone():
                        c.execute("INSERT INTO segments(id,run_id,page_no,start_ms,end_ms,caption,source_json,created_at) VALUES(?,?,?,0,5000,?,?,?)", (str(uuid.uuid4()),run_id,v["page_no"],"豆包生成的单页短片",json_text({"producer":"doubao_seedance","page_no":v["page_no"],"asset_id":asset_id}),now))
                    c.execute("UPDATE jobs SET status='SUCCEEDED',ended_at=?,error_code=NULL,error_message=NULL WHERE id=?", (now,v["job_id"]))
                return
            if state in ("failed", "cancelled", "canceled", "expired"):
                fail(v["job_id"], "PROVIDER_TERMINAL", "豆包返回任务失败、取消或过期，请到方舟控制台查看详情；不会自动重新付费。")
                return
            if state not in ("queued", "running"):
                raise ValueError("unknown task state")
            if time.monotonic() >= deadline:
                fail(v["job_id"], "VIDEO_TIMEOUT", "等待超时，已保留豆包任务号。可点击继续查询，不会重新提交付费任务。")
                return
            time.sleep(provider.poll_interval)
    except ArkAPIError as exc:
        fail(v["job_id"], exc.provider_code or f"ARK_HTTP_{exc.status}", str(exc) + "；请检查模型权限、余额或限流设置。")
    except Exception:
        # 不把可能含密钥或签名 URL 的第三方异常文本返回浏览器。
        with get_connection() as c:
            task = c.execute("SELECT task_id,submission_started FROM video_generations WHERE run_id=?", (run_id,)).fetchone()
        message = "视频处理或下载中断，可继续查询原任务，不会再次付费。" if task and task["task_id"] else "视频提交未完成，为避免重复扣费不自动重试，请在方舟控制台核对。"
        fail(v["job_id"], "VIDEO_INTERRUPTED", message)


def fail(job_id, code, message):
    with get_connection() as c:
        c.execute("UPDATE jobs SET status='FAILED',error_code=?,error_message=?,ended_at=? WHERE id=?", (code,message,now_iso(),job_id))
