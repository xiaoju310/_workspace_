"""Reproducible local OCR stress checks; synthetic images are NOT real photos.
Run from repository root: backend\\.venv\\Scripts\\python.exe scripts\\evaluate-ocr.py
Outputs stay under ignored test-results/; no account, book or database is modified.
"""
from __future__ import annotations

import argparse
from io import BytesIO
import json
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from PIL import Image, ImageFilter  # noqa: E402
from app.services.ocr import recognize_image  # noqa: E402

REFERENCES = [
    "小乌龟和小兔子，谁能先到达终点呢？",
    "兔子说：“我跑得最快！”乌龟说：“我们比一比吧。”",
    "比赛开始！兔子一下跑远了。乌龟一步一步向前走。",
    "兔子想：“乌龟还远着呢。”他在树下睡着了。",
    "乌龟没有停下。一步，又一步，他走过了兔子。",
    "乌龟先到了终点！兔子说：“坚持真了不起。”",
]
VARIANTS = {
    "baseline": "清晰原图",
    "tilt": "模拟倾斜 5 度（扩展画布，不裁剪）",
    "glare": "模拟正文区域反光（局部白色半透明覆盖）",
    "small_blur": "模拟小字与模糊（缩至原尺寸 35%，高斯模糊 0.6）",
    "curve": "模拟弯曲（逐列纵向位移，最大 24 像素）",
}


def transform(image: Image.Image, variant: str) -> Image.Image:
    if variant == "baseline":
        return image.copy()
    if variant == "tilt":
        return image.rotate(5, Image.Resampling.BICUBIC, expand=True, fillcolor="#faf6ea")
    if variant == "small_blur":
        return image.resize((round(image.width * .35), round(image.height * .35)), Image.Resampling.LANCZOS).filter(ImageFilter.GaussianBlur(.6))
    if variant == "glare":
        # A translucent reflection crosses the caption, not just the artwork.
        mask = Image.new("L", image.size, 0)
        from PIL import ImageDraw
        draw = ImageDraw.Draw(mask)
        draw.ellipse((image.width * .25, image.height * .68, image.width * 1.1, image.height * .96), fill=195)
        mask = mask.filter(ImageFilter.GaussianBlur(35))
        return Image.composite(Image.new("RGB", image.size, "white"), image, mask)
    if variant == "curve":
        import math
        result = Image.new("RGB", (image.width, image.height + 24), "#faf6ea")
        for x in range(image.width):
            offset = round(24 * math.sin(math.pi * x / image.width))
            result.paste(image.crop((x, 0, x + 1, image.height)), (x, offset))
        return result
    raise ValueError(variant)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=ROOT / "test-results" / "ocr-samples")
    parser.add_argument("--output", type=Path, default=ROOT / "test-results" / "ocr-evaluation")
    parser.add_argument("--variants", nargs="+", choices=list(VARIANTS), default=list(VARIANTS))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    pages = sorted(args.input.glob("*.png"))
    if len(pages) != len(REFERENCES):
        raise SystemExit("Expected six sample PNGs; run scripts/generate-ocr-samples.py first or pass --input <directory>")
    rows = []
    report = ["# 自动 OCR 本机模拟压力测试", "",
              "这是原创测试图的模拟变换，不是真实纸书拍照验收，也不代表所有图书的准确率。",
              "对照正文、识别全文和模型参考分分别列出；参考分不是文字准确率。", ""]
    for variant in args.variants:
        report += [f"## {VARIANTS[variant]}", ""]
        for index, path in enumerate(pages):
            with Image.open(path) as source:
                image = transform(source.convert("RGB"), variant)
            image_path = args.output / f"{variant}-{index + 1:02}.png"
            image.save(image_path)
            buffer = BytesIO()
            image.save(buffer, format="PNG")
            start = time.monotonic()
            result = recognize_image(buffer.getvalue(), "image/png")
            row = dict(variant=variant, page=index + 1, seconds=round(time.monotonic() - start, 2),
                       reference=REFERENCES[index], image=str(image_path.resolve()), **result)
            rows.append(row)
            # Write incrementally so an interrupted run still keeps completed pages.
            (args.output / "results.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
            report += [f"### 第 {index + 1} 页", f"- 对照正文：{REFERENCES[index]}",
                       f"- 模型参考分：{result['confidence']:.4f}（非准确率）；耗时 {row['seconds']} 秒", "", "```text", result["text"], "```", ""]
            print(f"{variant} page={index + 1} seconds={row['seconds']}", flush=True)
    (args.output / "report.md").write_text("\n".join(report), encoding="utf-8")
    print(f"Report: {args.output / 'report.md'}")


if __name__ == "__main__":
    main()
