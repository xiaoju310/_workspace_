"""Local, optional CPU OCR used only for editable pre-review drafts."""
from __future__ import annotations

from io import BytesIO
from threading import Lock
import warnings

from PIL import Image, ImageOps, UnidentifiedImageError

from .core import MAX_PAGE_BYTES

_lock = Lock()
_engine = None


class OcrUnavailable(Exception):
    pass


class InvalidOcrImage(Exception):
    pass


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
                _engine = RapidOCR()
            except Exception as exc:
                raise OcrUnavailable("自动识别组件未安装；请安装 backend/requirements-ocr.txt 后重启服务") from exc
        try:
            result = _engine(ocr_image)
        except Exception as exc:
            raise OcrUnavailable(f"自动识别失败：{type(exc).__name__}") from exc
        finally:
            ocr_image.close()
    texts = result.txts if result.txts is not None else ()
    scores = result.scores if result.scores is not None else ()
    return {"text": "\n".join(str(text) for text in texts)[:12000],
            "confidence": float(sum(scores) / len(scores)) if len(scores) else 0.0,
            "provider": "rapidocr_local", "source": "automatic_ocr_unreviewed"}
