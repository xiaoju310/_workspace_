from __future__ import annotations

import argparse
import json
from pathlib import Path

from . import analyze_page, build_book_graph, draft_story
from .analyzers import analyze_text
from .video import UnavailableVideoProvider


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Local AI/video prototype; model results are marked mock")
    sub = parser.add_subparsers(dest="command", required=True)
    page = sub.add_parser("page", help="Create a page, BookGraph, and story JSON sample")
    page.add_argument("--book-id", required=True)
    page.add_argument("--page-no", type=int, required=True)
    page.add_argument("--image", type=Path, required=True)
    page.add_argument("--out", type=Path, required=True)
    ocr = sub.add_parser("ocr", help="Run real local PaddleOCR on an image")
    ocr.add_argument("--book-id", required=True)
    ocr.add_argument("--page-no", type=int, required=True)
    ocr.add_argument("--image", type=Path, required=True)
    ocr.add_argument("--lang", default="en")
    ocr.add_argument("--out", type=Path, required=True)
    reading = sub.add_parser("reading", help="Analyze a UTF-8 text excerpt")
    reading.add_argument("--book-id")
    reading.add_argument("--input", type=Path, required=True)
    reading.add_argument("--page-no", type=int)
    reading.add_argument("--chapter")
    reading.add_argument("--book-type", choices=["picture_book", "novel", "textbook", "popular_science"])
    reading.add_argument("--out", type=Path, required=True)
    video = sub.add_parser("video-check", help="Write an explicit unavailable video result")
    video.add_argument("--page-no", type=int, required=True)
    video.add_argument("--prompt", required=True)
    video.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)
    if args.command in {"page", "ocr"}:
        if not args.image.is_file():
            parser.error("image does not exist")
        if args.command == "ocr":
            from time import perf_counter
            from .providers import PaddleOCRProvider

            start = perf_counter()
            provider = PaddleOCRProvider(lang=args.lang)
            initialization_s = perf_counter() - start
            text, boxes, confidence = provider.recognize(args.image, args.page_no)
            payload = {
                "book_id": args.book_id, "page_no": args.page_no,
                "text": text, "boxes": boxes, "confidence": confidence,
                "model_version": provider.version, "status": "real" if text else "low_confidence",
                "source": {"page_no": args.page_no, "location": f"page:{args.page_no}"},
                "initialization_s": initialization_s,
                "inference_s": provider.last_elapsed_s,
                "input_path": str(args.image),
            }
        else:
            analysis = analyze_page(args.book_id, args.page_no, args.image)
            graph = build_book_graph(args.book_id, [analysis])
            payload = {"page": analysis.model_dump(), "book_graph": graph.model_dump(),
                       "story": draft_story(graph).model_dump()}
    elif args.command == "reading":
        if not args.input.is_file():
            parser.error("input does not exist")
        payload = analyze_text(args.input.read_text(encoding="utf-8"), book_id=args.book_id,
                               page_no=args.page_no,
                               chapter=args.chapter, book_type=args.book_type).model_dump()
    else:
        payload = UnavailableVideoProvider().generate(args.page_no, None, args.prompt, args.out).model_dump()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
