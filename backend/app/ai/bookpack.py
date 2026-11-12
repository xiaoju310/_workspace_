from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field
from PIL import Image


class MotionSpec(BaseModel):
    level: Literal["L0", "L1", "L2", "L3"] = "L2"
    camera: Literal["push_in_slow", "pull_out_slow", "pan_lr_slow", "tilt_up_slow", "orbit_slight", "static"] = "static"
    subject: list[str] = Field(min_length=1, max_length=3)
    duration_s: float = Field(default=6, ge=5, le=7)
    prompt: str = Field(min_length=1)
    negative_prompt: str = "text, watermark, deformed face, extra limbs, fast motion"
    motion_strength: float = Field(default=0.35, ge=0, le=1)
    seed: int = Field(ge=0)


class AudioSpec(BaseModel):
    narration: str
    voice: str = "warm_female_01"
    duration_s: float = Field(ge=0)


class PageSource(BaseModel):
    type: Literal["provided_sample", "original", "synthetic"]
    book_id: str
    page: int = Field(ge=1)
    license: str


class BookPage(BaseModel):
    page_no: int = Field(ge=1, le=12)
    text: str = Field(max_length=40)
    scene: str
    characters: list[str] = Field(default_factory=list)
    motion: MotionSpec
    audio: AudioSpec
    source: PageSource


class BookManifest(BaseModel):
    book_id: str
    title: str
    age_range: Literal["3-6"] = "3-6"
    page_count: Literal[12] = 12
    canvas: tuple[int, int] = (1536, 2048)
    image_format: Literal["png"] = "png"
    pages: list[BookPage] = Field(min_length=1, max_length=12)
    status: Literal["draft", "candidate", "frozen"] = "draft"


def validate_bookpack(root: str | Path) -> BookManifest:
    root = Path(root)
    manifest = BookManifest.model_validate_json((root / "manifest.json").read_text(encoding="utf-8"))
    page_numbers = {p.page_no for p in manifest.pages}
    if page_numbers != set(range(1, len(manifest.pages) + 1)):
        raise ValueError("bookpack pages must be contiguous and start at 1")
    if manifest.status != "draft" and len(manifest.pages) != manifest.page_count:
        raise ValueError("candidate and frozen bookpacks require 12 pages")
    for page in manifest.pages:
        metadata = root / "pages" / f"{page.page_no:02d}.json"
        image = root / "pages" / f"{page.page_no:02d}.png"
        if not metadata.is_file() or not image.is_file():
            raise FileNotFoundError(f"missing page assets for page {page.page_no}")
        stored_page = BookPage.model_validate_json(metadata.read_text(encoding="utf-8"))
        if stored_page != page or page.source.book_id != manifest.book_id or page.source.page != page.page_no:
            raise ValueError(f"manifest and page metadata differ for page {page.page_no}")
        with Image.open(image) as art:
            art.verify()
    return manifest


def write_repro_manifest(bookpack: str | Path, output: str | Path, *, model_manifest: dict[str, str]) -> Path:
    root, output = Path(bookpack), Path(output)
    manifest = validate_bookpack(root)
    files = {}
    for path in sorted(root.rglob("*")):
        if path.is_file() and path.name != "manifest.json":
            files[str(path.relative_to(root)).replace("\\", "/")] = hashlib.sha256(path.read_bytes()).hexdigest()
    payload = {"book_id": manifest.book_id, "status": manifest.status, "cached": False,
               "model_manifest": model_manifest, "files_sha256": files,
               "reproduction": {"entrypoint": "python -m app.ai.cli validate-bookpack", "seed_policy": "page motion.seed"}}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return output
