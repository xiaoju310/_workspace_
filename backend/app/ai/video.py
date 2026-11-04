from __future__ import annotations
from pathlib import Path
from typing import Protocol
from pydantic import BaseModel, Field

class VideoResult(BaseModel):
    page_no: int
    path: str | None = None
    generation_mode: str
    model_version: str
    prompt_hash: str
    elapsed_s: float | None = None
    peak_vram_mb: int | None = None
    status: str
    error_code: str | None = None
    source_ref: str | None = None
    license_ref: str | None = None

class VideoProvider(Protocol):
    version: str
    license_ref: str
    def generate(self, page_no: int, image_path: Path | None, prompt: str, output_path: Path) -> VideoResult: ...

class UnavailableVideoProvider:
    version = "unavailable/1.0"
    license_ref = "none"
    def generate(self, page_no: int, image_path: Path | None, prompt: str, output_path: Path) -> VideoResult:
        import hashlib
        return VideoResult(page_no=page_no, generation_mode="none", model_version=self.version, prompt_hash=hashlib.sha256(prompt.encode()).hexdigest(), status="failed", error_code="VIDEO_PROVIDER_UNAVAILABLE", source_ref=str(image_path) if image_path else None, license_ref=self.license_ref)
