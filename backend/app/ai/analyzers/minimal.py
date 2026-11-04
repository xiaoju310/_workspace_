from __future__ import annotations
import re
from pydantic import BaseModel, Field
from ..models import SourceRef

class BookTypeResult(BaseModel):
    book_type: str
    confidence: float = Field(ge=0, le=1)
    reasons: list[str]
    status: str

class NoteDraft(BaseModel):
    summary: str
    sources: list[SourceRef]
    status: str = "private_draft"
    review_required: bool = True

class StructuredAnalysis(BaseModel):
    book_id: str | None = None
    book_type: str
    chapters: list[str]
    characters: list[str]
    concepts: list[str]
    events: list[str]
    note: NoteDraft
    confidence: float = Field(ge=0, le=1)
    video_strategy: str
    model_version: str = "deterministic-prototype/1"
    status: str


def _extract_items(lines: list[str], label: str) -> list[str]:
    pattern = re.compile(rf"^{label}[：:]\s*(.+)$")
    return [match.group(1).strip() for line in lines if (match := pattern.match(line))]

def classify_book(text: str, *, has_images: bool = False) -> BookTypeResult:
    t = text.lower()
    scores = {
        "picture_book": (2 if has_images else 0) + sum(w in t for w in ("从前", "小熊", "小兔", "绘本")),
        "novel": sum(w in t for w in ("第一章", "第1章", "小说", "人物")),
        "textbook": sum(w in t for w in ("学习目标", "练习", "知识点", "课后习题")),
        "popular_science": sum(w in t for w in ("科学", "实验", "原理", "为什么")),
    }
    kind, score = max(scores.items(), key=lambda item: item[1])
    if score == 0:
        return BookTypeResult(book_type="unknown", confidence=0.0, reasons=["无足够类型特征"], status="low_confidence")
    return BookTypeResult(book_type=kind, confidence=min(0.8, 0.4 + score * 0.1), reasons=[f"匹配 {score} 个类型特征"], status="low_confidence")

VIDEO_STRATEGY = {
    "picture_book": "page_i2v",
    "novel": "chapter_scene_t2v",
    "textbook": "concept_explanation",
    "popular_science": "process_visualization",
    "unknown": "human_review",
}


def analyze_text(text: str, *, book_id: str | None = None, page_no: int | None = None,
                 chapter: str | None = None, book_type: str | None = None,
                 has_images: bool = False) -> StructuredAnalysis:
    detected = classify_book(text, has_images=has_images)
    kind = book_type or detected.book_type
    source = SourceRef(page_no=page_no, chapter=chapter,
                       location=f"page:{page_no}" if page_no is not None else (f"chapter:{chapter}" if chapter else None)) if page_no is not None or chapter else None
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    chapters = [line for line in lines if re.match(r"^(第[一二三四五六七八九十百千万\d]+[章节]|Chapter\s+\d+)", line, re.I)]
    characters = _extract_items(lines, "人物")
    concepts = _extract_items(lines, "概念")
    events = _extract_items(lines, "事件")
    # Explicit labels form a small deterministic prototype, not semantic extraction.
    note_status = "private_draft" if source else "low_confidence"
    note = NoteDraft(summary=" ".join(lines[:2])[:300], sources=[source] if source else [], status=note_status)
    return StructuredAnalysis(book_id=book_id, book_type=kind, chapters=chapters, characters=characters,
                              concepts=concepts, events=events, note=note,
                              confidence=detected.confidence if kind == detected.book_type else 0.0,
                              video_strategy=VIDEO_STRATEGY[kind],
                              status="low_confidence")
