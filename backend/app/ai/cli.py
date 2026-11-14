from __future__ import annotations

import argparse
import json
from pathlib import Path

from . import analyze_page, build_book_graph, draft_story
from .analyzers import analyze_text
from .video import AnimateDiffProvider, UnavailableVideoProvider
from .video_ltx import LTXVideoProvider
from .video_doubao import DoubaoProvider
from .bookpack import validate_bookpack, write_repro_manifest
from .qc_video import qc_video


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
    video_run = sub.add_parser("video-generate", help="Generate a short local T2V test clip with AnimateDiff-Lightning")
    video_run.add_argument("--page-no", type=int, required=True)
    video_run.add_argument("--prompt", required=True)
    video_run.add_argument("--model-path", type=Path, required=True)
    video_run.add_argument("--motion-checkpoint", type=Path, required=True)
    video_run.add_argument("--out", type=Path, required=True)
    ltx = sub.add_parser("video-i2v", help="Generate one local LTX I2V clip from a page image")
    ltx.add_argument("--page-no", type=int, required=True)
    ltx.add_argument("--image", type=Path, required=True)
    ltx.add_argument("--prompt", required=True)
    ltx.add_argument("--checkpoint", type=Path, required=True)
    ltx.add_argument("--embeddings", type=Path, required=True)
    ltx.add_argument("--runner", type=Path, required=True)
    ltx.add_argument("--python", default="python", help="Python executable containing CUDA video dependencies")
    ltx.add_argument("--out", type=Path, required=True)
    doubao = sub.add_parser("doubao-media", help="Generate a Seedream image and a real Seedance video (paid Ark API)")
    doubao.add_argument("--page-no", type=int, required=True)
    doubao.add_argument("--image-prompt", required=True)
    doubao.add_argument("--video-prompt", required=True)
    doubao.add_argument("--out", type=Path, required=True, help="Output MP4; image uses the same stem with .png")
    doubao.add_argument("--image-model", help="Ark image model ID (or DOUBAO_IMAGE_MODEL)")
    doubao.add_argument("--video-model", help="Ark video model ID (or DOUBAO_VIDEO_MODEL)")
    doubao.add_argument("--reference", type=Path, help="Optional reference picture for image generation")
    doubao.add_argument("--duration", type=int, default=5)
    image_only = sub.add_parser("doubao-image", help="Generate only one Seedream image (paid Ark API; no video request)")
    image_only.add_argument("--page-no", type=int, required=True)
    image_only.add_argument("--image-prompt", required=True)
    image_only.add_argument("--out", type=Path, required=True, help="Output PNG")
    image_only.add_argument("--image-model", help="Ark image model ID (or DOUBAO_IMAGE_MODEL)")
    image_only.add_argument("--reference", type=Path, help="Optional reference picture")
    video_only = sub.add_parser("doubao-video", help="Animate an existing picture with Seedance (paid Ark API; no image request)")
    video_only.add_argument("--page-no", type=int, required=True)
    video_only.add_argument("--image", type=Path, required=True)
    video_only.add_argument("--video-prompt", required=True)
    video_only.add_argument("--out", type=Path, required=True, help="Output MP4")
    video_only.add_argument("--video-model", help="Ark video model ID (or DOUBAO_VIDEO_MODEL)")
    video_only.add_argument("--duration", type=int, default=5)
    bookpack = sub.add_parser("validate-bookpack", help="Validate a v2 bookpack and optionally write repro manifest")
    bookpack.add_argument("--root", type=Path, required=True)
    bookpack.add_argument("--repro-out", type=Path)
    qc = sub.add_parser("qc-video", help="Run lightweight media checks and write JSON")
    qc.add_argument("--video", type=Path, required=True)
    qc.add_argument("--expected-duration", type=float)
    qc.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)
    if args.command == "doubao-image":
        if args.out.suffix.lower() != ".png":
            parser.error("--out must end in .png")
        provider = DoubaoProvider(image_model=args.image_model)
        image_result = provider.generate_image(args.page_no, args.image_prompt, args.out, args.reference)
        manifest = {"image": image_result.model_dump(), "video": None}
        result_path = args.out.with_suffix(".generation.json")
        result_path.parent.mkdir(parents=True, exist_ok=True)
        result_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(result_path)
        return 0 if image_result.status == "ok" else 1
    if args.command == "doubao-video":
        if args.out.suffix.lower() != ".mp4":
            parser.error("--out must end in .mp4")
        if not args.image.is_file():
            parser.error("--image does not exist")
        result_path = args.out.with_suffix(".generation.json")
        if args.out.exists() or result_path.exists():
            parser.error("output or manifest already exists; refusing another paid request")
        provider = DoubaoProvider(video_model=args.video_model, duration=args.duration)
        video_result = provider.generate(args.page_no, args.image, args.video_prompt, args.out)
        manifest = {"image": {"path": str(args.image), "status": "reused"}, "video": video_result.model_dump()}
        result_path.parent.mkdir(parents=True, exist_ok=True)
        result_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(result_path)
        return 0 if video_result.status == "ok" else 1
    if args.command == "doubao-media":
        if args.out.suffix.lower() != ".mp4":
            parser.error("--out must end in .mp4")
        provider = DoubaoProvider(args.image_model, args.video_model, duration=args.duration)
        image_path = args.out.with_suffix(".png")
        image_result = provider.generate_image(args.page_no, args.image_prompt, image_path, args.reference)
        manifest = {"image": image_result.model_dump(), "video": None}
        if image_result.status == "ok":
            video_result = provider.generate(args.page_no, image_path, args.video_prompt, args.out)
            manifest["video"] = video_result.model_dump()
        result_path = args.out.with_suffix(".generation.json")
        result_path.parent.mkdir(parents=True, exist_ok=True)
        result_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(result_path)
        return 0 if manifest["video"] and manifest["video"]["status"] == "ok" else 1
    if args.command == "validate-bookpack":
        manifest = validate_bookpack(args.root)
        payload = {"status": "ok", "book_id": manifest.book_id, "page_count": len(manifest.pages)}
        if args.repro_out:
            payload["repro_manifest"] = str(write_repro_manifest(args.root, args.repro_out, model_manifest={"schema": "bookpack-v1"}))
        print(json.dumps(payload, ensure_ascii=False))
        return 0
    if args.command == "qc-video":
        payload = qc_video(args.video, expected_duration_s=args.expected_duration)
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(args.out)
        return 0 if payload["status"] == "ok" else 1
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
    elif args.command == "video-generate":
        provider = AnimateDiffProvider(args.model_path, args.motion_checkpoint)
        video_result = provider.generate(args.page_no, None, args.prompt, args.out)
        payload = video_result.model_dump()
        result_path = args.out.with_suffix(".generation.json")
        result_path.parent.mkdir(parents=True, exist_ok=True)
        result_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(result_path)
        return 0 if video_result.status == "ok" else 1
    elif args.command == "video-i2v":
        provider = LTXVideoProvider(args.checkpoint, args.embeddings, args.runner, python=args.python)
        video_result = provider.generate(args.page_no, args.image, args.prompt, args.out)
        result_path = args.out.with_suffix(".generation.json")
        result_path.parent.mkdir(parents=True, exist_ok=True)
        result_path.write_text(video_result.model_dump_json(indent=2) + "\n", encoding="utf-8")
        print(result_path)
        return 0 if video_result.status == "ok" else 1
    else:
        payload = UnavailableVideoProvider().generate(args.page_no, None, args.prompt, args.out).model_dump()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(args.out)
    return 0 if payload.get("status") != "failed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
