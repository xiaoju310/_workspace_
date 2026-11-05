"""核心业务服务：文件安全、任务状态和分享令牌。"""
from __future__ import annotations
import hashlib
import json
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ALLOWED_IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png"}
MAX_PAGE_BYTES = 10 * 1024 * 1024


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def parse_datetime(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None

def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def json_text(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))

def sha256_file(path: Path) -> str:
    """分块哈希产物，避免把大视频一次性读进内存。"""
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()

def token_pair() -> tuple[str, str]:
    token = secrets.token_urlsafe(32)
    return token, hashlib.sha256(token.encode()).hexdigest()

def safe_book_path(root: Path, book_id: str, page_no: int, suffix: str) -> Path:
    """只生成受控路径，避免把用户输入直接当作文件名。"""
    target = (root / "books" / book_id / f"page-{page_no:04d}{suffix}").resolve()
    root_resolved = root.resolve()
    if root_resolved not in target.parents:
        raise ValueError("文件路径越界")
    target.parent.mkdir(parents=True, exist_ok=True)
    return target

def classify_title(title: str) -> tuple[str, float, list[str]]:
    text = title.lower()
    rules = [
        ("textbook", ("教材", "课本", "高等数学", "英语"), 0.82, "标题包含教材关键词"),
        ("science", ("科学", "百科", "宇宙", "自然"), 0.78, "标题包含科普关键词"),
        ("picture_book", ("绘本", "童话", "小熊", "故事"), 0.75, "标题包含绘本/故事关键词"),
        ("novel", ("小说", "三国", "红楼", "the "), 0.70, "标题包含小说关键词"),
    ]
    for kind, words, score, reason in rules:
        if any(word in text for word in words):
            return kind, score, [reason]
    return "other", 0.30, ["标题规则无法稳定判断，请主人确认类型"]
