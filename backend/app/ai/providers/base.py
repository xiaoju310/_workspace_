from __future__ import annotations
from pathlib import Path
from typing import Protocol
from ..models import SourceRef

class OCRProvider(Protocol):
    version: str
    def recognize(self, image_path: Path, page_no: int) -> tuple[str, list[dict], float]: ...

class VisionProvider(Protocol):
    version: str
    def understand(self, image_path: Path, page_no: int, text: str) -> tuple[list[dict], list[dict], float]: ...

class MockOCRProvider:
    version = "mock-ocr/1.0"
    def recognize(self, image_path: Path, page_no: int):
        return "", [], 0.0

class MockVisionProvider:
    version = "mock-vlm/1.0"
    def understand(self, image_path: Path, page_no: int, text: str):
        return [], [], 0.0
