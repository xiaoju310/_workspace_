from __future__ import annotations

import os
from pathlib import Path
from time import perf_counter


class PaddleOCRProvider:
    """CPU PaddleOCR adapter. Model initialization may download official weights."""

    version = "paddleocr/3.7.0:PP-OCRv6_medium_det+PP-OCRv6_medium_rec"

    def __init__(self, *, lang: str = "en") -> None:
        os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
        os.environ.setdefault("FLAGS_use_mkldnn", "0")
        from paddleocr import PaddleOCR

        self._engine = PaddleOCR(
            lang=lang,
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
            device="cpu",
            enable_mkldnn=False,
        )
        self.last_elapsed_s: float | None = None

    def recognize(self, image_path: Path, page_no: int) -> tuple[str, list[dict], float]:
        start = perf_counter()
        results = list(self._engine.predict(str(image_path)))
        self.last_elapsed_s = perf_counter() - start
        if not results:
            return "", [], 0.0
        data = results[0].json["res"]
        texts = data.get("rec_texts", [])
        scores = data.get("rec_scores", [])
        boxes = data.get("rec_boxes", [])
        lines = [
            {"text": str(text), "box": [int(x) for x in box], "confidence": float(score),
             "page_no": page_no}
            for text, box, score in zip(texts, boxes, scores, strict=True)
        ]
        return "\n".join(texts), lines, sum(scores) / len(scores) if scores else 0.0
