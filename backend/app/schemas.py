"""API 输入输出模型。字段尽量保持简单，方便大一新生联调。"""
from datetime import datetime
from typing import Any, Literal
from pydantic import BaseModel, Field

BookType = Literal["picture_book", "novel", "textbook", "science", "other"]

class BookCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    authorization_ref: str = Field(min_length=1, max_length=500)

class BookOut(BaseModel):
    id: str
    title: str
    authorization_ref: str
    owner_id: str
    status: str
    created_at: datetime
    updated_at: datetime

class PageOut(BaseModel):
    id: str
    book_id: str
    page_no: int
    sha256: str
    mime_type: str
    size_bytes: int
    image_path: str
    created_at: datetime

class ClassificationRequest(BaseModel):
    requested_type: BookType | None = None
    force_reclassify: bool = False

class ClassificationConfirm(BaseModel):
    confirmed_type: BookType

class ClassificationOut(BaseModel):
    book_id: str
    predicted_type: BookType
    confidence: float
    reasons: list[str]
    confirmed_type: str | None
    confirmed_by: str | None
    status: str

class AnalyzeRequest(BaseModel):
    analysis_profile: str = Field(default="default", min_length=1, max_length=100)

class JobOut(BaseModel):
    job_id: str
    run_id: str
    status: str
    stage: str
    attempts: int

class NoteGenerateRequest(BaseModel):
    note_template: str = Field(default="standard", min_length=1, max_length=100)

class NotePatch(BaseModel):
    content: dict[str, Any]

class NoteReview(BaseModel):
    action: Literal["approve", "revise"]

class ShareCreate(BaseModel):
    share_mode: Literal["invite_only", "link"]
    shared_user_id: str | None = None
    expires_at: datetime | None = None

class NoteOut(BaseModel):
    id: str
    book_id: str
    owner_id: str
    content: dict[str, Any]
    status: str
    version: int
    created_at: datetime
    updated_at: datetime

class ShareOut(BaseModel):
    id: str
    share_mode: str
    shared_user_id: str | None
    expires_at: datetime | None
    status: str
    token: str | None = None
