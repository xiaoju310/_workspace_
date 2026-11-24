"""Local, optional CPU OCR used only for editable pre-review drafts."""
from __future__ import annotations

from io import BytesIO
from threading import Lock
import warnings
import re

from PIL import Image, ImageOps, UnidentifiedImageError

from .core import MAX_PAGE_BYTES

_lock = Lock()
_engine = None


class OcrUnavailable(Exception):
    pass


class InvalidOcrImage(Exception):
    pass


def filter_watermark(text: str) -> str:
    """Exclude this book's competition notice from OCR text, never edit the image.

    Match specific notice clauses rather than generic words such as 大学 or 使用.
    Keep an index map so a notice sharing a detection box with body text does not
    cause the whole box (and the body text) to be discarded.
    """
    positions = [i for i, char in enumerate(text) if char.isalnum()]
    compact = ''.join(text[i] for i in positions)
    patterns = (
        r'仅供第[一二三四五六七八九十\d]{1,3}届北京市大学生人工智能创新大赛',
        r'纸书智伴赛[题款颗]?参赛使用请勿外传?',
    )
    spans = sorted((positions[m.start()], positions[m.end() - 1] + 1)
                   for pattern in patterns for m in re.finditer(pattern, compact))
    for start, end in reversed(spans):
        text = text[:start] + text[end:]
    if spans and not any(char.isalnum() for char in text):
        return ''
    return text.strip() if spans else text


def recognize_layout(engine, image):
    """Preserve detail and re-read long lines whose detection clipped punctuation."""
    result = engine(image)
    texts = list(result.txts) if result.txts is not None else []
    scores = list(result.scores) if result.scores is not None else []
    boxes = getattr(result, 'boxes', None)
    rows = []
    retries = 0
    for index, original in enumerate(texts):
        text = filter_watermark(str(original))
        if not text.strip():
            continue
        score = scores[index] if index < len(scores) else None
        box = boxes[index] if boxes is not None and index < len(boxes) else None
        bounds = None
        if box is not None:
            xs, ys = [float(p[0]) for p in box], [float(p[1]) for p in box]
            bounds = (min(xs), min(ys), max(xs), max(ys))
            x0, y0, x1, y1 = bounds
            # Re-read the actual pixels with extra right margin; do not guess endings.
            if (retries < 8 and len(text) >= 12 and text == str(original)
                    and text[-1] not in '。！？.!?：:；;”」』'
                    and abs(ys[1] - ys[0]) < max(3, (y1 - y0) * .2)):
                height = y1 - y0
                crop = image.crop((max(0, int(x0 - height * .25)), max(0, int(y0 - height * .05)),
                                   min(image.width, int(x1 + height * 1.1)), min(image.height, int(y1 + height * .05))))
                try:
                    reread = engine(crop, use_det=False, use_cls=False, use_rec=True)
                    retries += 1
                    if reread.txts is not None and len(reread.txts) == 1:
                        candidate = str(reread.txts[0])
                        # Only accept observed punctuation extensions; never replace words
                        # based solely on a model's self-reported confidence.
                        if (candidate.startswith(text) and 0 < len(candidate) - len(text) <= 4
                                and all(c in '。！？.!?，,、：:；;”」』' for c in candidate[len(text):])):
                            text = candidate
                finally:
                    crop.close()
                    # RapidOCR call flags persist between calls.
                    engine.update_params(use_det=True, use_cls=True, use_rec=True)
        rows.append((text, score, bounds))
    # Wide scanned spreads: read the left page before the right page. If a text
    # box crosses the gutter, retain the detector's order instead of guessing.
    if image.width >= image.height * 1.55 and rows and all(row[2] is not None for row in rows):
        middle = image.width / 2
        if all(not (row[2][0] < middle < row[2][2]) for row in rows):
            rows.sort(key=lambda row: (row[2][0] >= middle, row[2][1], row[2][0]))
    return rows


def recognize_image(data: bytes, mime: str) -> dict:
    """Validate and orient a local image, then recognize it without temporary files."""
    if mime not in {"image/jpeg", "image/png"}:
        raise InvalidOcrImage("仅支持 JPG / PNG")
    if not data or len(data) > MAX_PAGE_BYTES:
        raise InvalidOcrImage("图片为空或超过单页大小限制")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as image:
                if image.format != {"image/jpeg": "JPEG", "image/png": "PNG"}[mime] or image.width * image.height > 40_000_000:
                    raise InvalidOcrImage("图片格式不符或像素过多")
                image.verify()
            with Image.open(BytesIO(data)) as image:
                image.load()
                # Keep the camera orientation, and avoid relying on Windows TEMP permissions.
                ocr_image = ImageOps.exif_transpose(image).convert("RGB")
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombWarning, Image.DecompressionBombError) as exc:
        raise InvalidOcrImage("图片无法完整解码") from exc

    global _engine
    with _lock:
        if _engine is None:
            try:
                from rapidocr import RapidOCR
                _engine = RapidOCR(params={
                    'Global.max_side_len': 3200,
                    'Det.limit_side_len': 1600,
                    'Det.limit_type': 'max',
                })
            except Exception as exc:
                raise OcrUnavailable("自动识别组件未安装；请安装 backend/requirements-ocr.txt 后重启服务") from exc
        try:
            retained = recognize_layout(_engine, ocr_image)
        except Exception as exc:
            raise OcrUnavailable(f"自动识别失败：{type(exc).__name__}") from exc
        finally:
            ocr_image.close()
    retained_scores = [score for _, score, _ in retained if score is not None]
    return {"text": "\n".join(text for text, _, _ in retained)[:12000],
            "confidence": float(sum(retained_scores) / len(retained_scores)) if retained_scores else 0.0,
            "provider": "rapidocr_local", "source": "automatic_ocr_unreviewed"}
