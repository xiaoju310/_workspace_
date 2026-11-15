from __future__ import annotations
from typing import Any, Literal
from pydantic import BaseModel, Field, model_validator

Status = Literal["ok", "low_confidence", "mock", "failed"]

class SourceRef(BaseModel):
    page_no: int | None = None
    chapter: str | None = None
    location: str | None = None

    @model_validator(mode="after")
    def require_location(self):
        if self.page_no is None and not self.chapter and not self.location:
            raise ValueError("a page, chapter, or location is required")
        return self

class Entity(BaseModel):
    name: str
    kind: Literal["character", "scene", "object", "concept", "unknown"]
    confidence: float = Field(ge=0, le=1)
    source: SourceRef

class Event(BaseModel):
    description: str
    confidence: float = Field(ge=0, le=1)
    source: SourceRef

class PageAnalysis(BaseModel):
    book_id: str
    page_no: int = Field(ge=1)
    book_type: Literal["picture_book", "novel", "textbook", "popular_science", "unknown"]
    type_confidence: float = Field(ge=0, le=1)
    text: str
    text_confidence: float = Field(ge=0, le=1)
    boxes: list[dict[str, Any]] = Field(default_factory=list)
    entities: list[Entity] = Field(default_factory=list)
    events: list[Event] = Field(default_factory=list)
    model_version: str
    ocr_version: str
    vision_version: str
    status: Status
    source: SourceRef
    error_code: str | None = None

class BookGraph(BaseModel):
    book_id: str
    book_type: str
    pages: list[PageAnalysis]
    entities: list[Entity]
    events: list[Event]
    model_manifest: dict[str, str]
    status: Status
