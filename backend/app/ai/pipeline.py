from __future__ import annotations
from pathlib import Path
from PIL import Image, UnidentifiedImageError

from .models import BookGraph, Entity, Event, PageAnalysis, SourceRef
from .providers import MockOCRProvider, MockVisionProvider, OCRProvider, VisionProvider

BOOK_TYPES = {"picture_book", "novel", "textbook", "popular_science"}


def analyze_page(
    book_id: str,
    page_no: int,
    image_path: str | Path,
    *,
    book_type: str = "picture_book",
    ocr: OCRProvider | None = None,
    vision: VisionProvider | None = None,
) -> PageAnalysis:
    if not book_id or page_no < 1:
        raise ValueError("book_id and positive page_no are required")
    ocr = ocr or MockOCRProvider()
    vision = vision or MockVisionProvider()
    source = SourceRef(page_no=page_no, location=f"page:{page_no}")
    kind = book_type if book_type in BOOK_TYPES else "unknown"
    common = dict(book_id=book_id, page_no=page_no, book_type=kind,
                  type_confidence=1.0 if kind != "unknown" else 0.0,
                  model_version=f"{ocr.version}+{vision.version}",
                  ocr_version=ocr.version, vision_version=vision.version, source=source)
    path = Path(image_path)
    try:
        if not path.is_file():
            raise FileNotFoundError(path)
        with Image.open(path) as image:
            if image.format not in {"PNG", "JPEG"}:
                raise ValueError("only PNG and JPEG page images are supported")
            image.verify()
        text, boxes, text_conf = ocr.recognize(path, page_no)
        raw_entities, raw_events, vision_conf = vision.understand(path, page_no, text)
        entities = [Entity(name=str(x["name"]), kind=x.get("kind", "unknown"),
                           confidence=float(x.get("confidence", vision_conf)), source=source)
                    for x in raw_entities]
        events = [Event(description=str(x["description"]),
                        confidence=float(x.get("confidence", vision_conf)), source=source)
                  for x in raw_events]
        is_mock = ocr.version.startswith("mock-") or vision.version.startswith("mock-")
        status = "mock" if is_mock else ("ok" if text_conf > 0 and vision_conf > 0 else "low_confidence")
        return PageAnalysis(**common, text=text, text_confidence=text_conf, boxes=boxes,
                            entities=entities, events=events, status=status)
    except (OSError, RuntimeError, ValueError, KeyError, TypeError, UnidentifiedImageError) as exc:
        return PageAnalysis(**common, text="", text_confidence=0, status="failed",
                            error_code=type(exc).__name__.upper())


def build_book_graph(book_id: str, pages: list[PageAnalysis], book_type: str | None = None) -> BookGraph:
    if any(p.book_id != book_id for p in pages):
        raise ValueError("all pages must belong to the requested book")
    if len({p.page_no for p in pages}) != len(pages):
        raise ValueError("page numbers must be unique")
    ordered = sorted(pages, key=lambda p: p.page_no)
    entities = [e for p in ordered for e in p.entities]
    events = [e for p in ordered for e in p.events]
    kind = book_type or (ordered[0].book_type if ordered else "unknown")
    status = "failed" if not ordered or any(p.status == "failed" for p in ordered) else (
        "mock" if any(p.status == "mock" for p in ordered) else (
            "low_confidence" if any(p.status == "low_confidence" for p in ordered) else "ok"))
    return BookGraph(book_id=book_id, book_type=kind, pages=ordered,
                     entities=entities, events=events,
                     model_manifest={"ocr": ordered[0].ocr_version if ordered else "unavailable",
                                     "vlm": ordered[0].vision_version if ordered else "unavailable"},
                     status=status)
