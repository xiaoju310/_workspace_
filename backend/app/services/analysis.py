from __future__ import annotations

"""B 分析模块与 A 后端之间的适配层。

B 的模型依赖很重，所以只在真正开始分析时加载。A 不伪造成功结果：
没有配置 provider、provider 失败或页面分析失败，任务都会留下明确的失败状态。
"""

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol


class AnalysisProviderError(RuntimeError):
    """可展示给任务记录的 provider 错误。"""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class AnalysisPageInput:
    page_no: int
    image_path: Path
    sha256: str
    # 由后端读取人工修订记录，不接受客户端直接指定可信来源。
    reviewed_text: str | None = None


@dataclass
class AnalysisResult:
    pages: list[dict[str, Any]]
    graph: dict[str, Any]
    note: dict[str, Any]
    model_manifest: dict[str, Any]


class AnalysisProvider(Protocol):
    name: str

    def analyze(
        self, book_id: str, book_type: str, pages: list[AnalysisPageInput]
    ) -> AnalysisResult: ...


def _backend_book_type(book_type: str) -> str:
    # A 的 API 对外叫 science，B 的模型类型叫 popular_science。
    return "popular_science" if book_type == "science" else book_type


class BLocalAnalysisProvider:
    """调用 B 已提交的 PaddleOCR + SmolVLM pipeline。

    只有配置 AI_PROVIDER=b_local 和 AI_VLM_MODEL_PATH 时才会启用；
    PaddleOCR/transformers 未安装时返回可定位的 PROVIDER_ERROR。
    """

    name = "b_local_paddle_smolvlm"

    def __init__(self) -> None:
        model_path = os.getenv("AI_VLM_MODEL_PATH", "").strip()
        if not model_path:
            raise AnalysisProviderError(
                "PROVIDER_NOT_CONFIGURED",
                "已选择 B 本地 provider，但未配置 AI_VLM_MODEL_PATH",
            )
        try:
            from ..ai.pipeline import analyze_page, build_book_graph
            from ..ai.providers import PaddleOCRProvider, SmolVLMProvider
        except Exception as exc:  # optional heavy dependencies
            raise AnalysisProviderError(
                "PROVIDER_ERROR", f"B 分析依赖加载失败：{type(exc).__name__}"
            ) from exc
        self._analyze_page = analyze_page
        self._build_book_graph = build_book_graph
        try:
            self._ocr = PaddleOCRProvider(lang=os.getenv("AI_OCR_LANG", "ch"))
            self._vision = SmolVLMProvider(
                model_path, device=os.getenv("AI_VLM_DEVICE", "cpu")
            )
        except Exception as exc:
            raise AnalysisProviderError(
                "PROVIDER_ERROR", f"B 模型初始化失败：{type(exc).__name__}: {exc}"
            ) from exc

    def analyze(
        self, book_id: str, book_type: str, pages: list[AnalysisPageInput]
    ) -> AnalysisResult:
        if not pages:
            raise AnalysisProviderError("INVALID_INPUT", "没有可分析的图书页")
        kind = _backend_book_type(book_type)
        page_results = []
        try:
            for page in sorted(pages, key=lambda item: item.page_no):
                result = self._analyze_page(
                    book_id,
                    page.page_no,
                    page.image_path,
                    book_type=kind,
                    ocr=self._ocr,
                    vision=self._vision,
                )
                if result.status in {"failed", "mock"}:
                    raise AnalysisProviderError(
                        "PROVIDER_ERROR",
                        f"第 {page.page_no} 页分析失败：{result.error_code or 'UNKNOWN'}",
                    )
                page_results.append(result)
            graph = self._build_book_graph(book_id, page_results, kind)
        except AnalysisProviderError:
            raise
        except Exception as exc:
            raise AnalysisProviderError(
                "PROVIDER_ERROR", f"B 分析执行失败：{type(exc).__name__}: {exc}"
            ) from exc

        if graph.status in {"failed", "mock"}:
            raise AnalysisProviderError(
                "PROVIDER_ERROR", f"B 返回不可用结果：{graph.status}"
            )
        sources = [
            {"page_no": page.page_no, "location": f"page:{page.page_no}"}
            for page in page_results
        ]
        # 这只是 OCR 摘录，不是模型生成的书评；主人仍需人工改写、审核。
        summary = " ".join(page.text.strip() for page in page_results if page.text.strip())[:300]
        note = {
            "summary": summary,
            "book_type": book_type,
            "summary_method": "ocr_excerpt_needs_review",
            "entities": [item.model_dump(mode="json") for item in graph.entities],
            "events": [item.model_dump(mode="json") for item in graph.events],
            "sources": sources,
            "is_placeholder": not bool(summary and sources),
            "analysis_status": graph.status,
        }
        return AnalysisResult(
            pages=[page.model_dump(mode="json") for page in page_results],
            graph=graph.model_dump(mode="json"),
            note=note,
            model_manifest={
                "provider": self.name,
                "status": graph.status,
                **graph.model_manifest,
            },
        )


class LocalTextAnalysisProvider:
    """低内存文字整理：人工校对优先，缺少校对时才运行本地 OCR。

    不加载视觉大模型、不请求云端，不声称理解插画、推断人物或生成视频。
    low_confidence 表示语义能力受限，不是 OCR 的识别分数。
    """

    name = "local_text_excerpt"

    def analyze(
        self, book_id: str, book_type: str, pages: list[AnalysisPageInput]
    ) -> AnalysisResult:
        if not pages:
            raise AnalysisProviderError("INVALID_INPUT", "没有可整理的图书页")
        from .ocr import InvalidOcrImage, OcrUnavailable, recognize_image

        results = []
        for page in sorted(pages, key=lambda item: item.page_no):
            source = {"page_no": page.page_no, "location": f"page:{page.page_no}"}
            if page.reviewed_text is not None:
                text = page.reviewed_text.strip()
                ocr_version = "owner_reviewed_text"
                confidence = 0.0  # 人工校对不是模型预测，不伪造模型分数。
            else:
                try:
                    mime = "image/png" if page.image_path.suffix.lower() == ".png" else "image/jpeg"
                    recognized = recognize_image(page.image_path.read_bytes(), mime)
                except (OSError, InvalidOcrImage, OcrUnavailable) as exc:
                    raise AnalysisProviderError(
                        "OCR_UNAVAILABLE", f"第 {page.page_no} 页识别不可用，请先校对并保存文字后重试"
                    ) from exc
                text = recognized["text"].strip()
                confidence = recognized["confidence"]
                ocr_version = recognized["provider"]
            if not text:
                raise AnalysisProviderError(
                    "TEXT_REQUIRED", f"第 {page.page_no} 页没有可用文字；请返回书页校对补充文字。纯插画暂不支持文字整理。"
                )
            results.append({
                "book_id": book_id, "page_no": page.page_no,
                "book_type": _backend_book_type(book_type), "type_confidence": 0.0,
                "text": text, "text_confidence": confidence, "boxes": [],
                "entities": [], "events": [], "model_version": "text-excerpt/1",
                "ocr_version": ocr_version, "vision_version": "not_used",
                "status": "low_confidence", "source": source, "error_code": None,
            })
        sources = [item["source"] for item in results]
        manifest = {
            "provider": self.name, "status": "low_confidence", "analysis_mode": "text_only",
            "method": "extractive_excerpt", "vision": "not_used", "media": "not_generated",
            "semantic_analysis": False,
            "limitations": ["仅整理书页文字与来源，不理解插画", "摘录不是自动书评，须主人复核", "不生成插画、视频或配音"],
        }
        return AnalysisResult(
            pages=results,
            graph={"book_id": book_id, "book_type": book_type, "pages": results,
                   "entities": [], "events": [], "status": "low_confidence",
                   "analysis_mode": "text_only"},
            note={"summary": " ".join(item["text"] for item in results)[:300],
                  "summary_method": "text_excerpt_needs_review", "book_type": book_type,
                  "sources": sources, "entities": [], "events": [],
                  "is_placeholder": False, "analysis_status": "low_confidence",
                  "analysis_mode": "text_only", "review_required": True,
                  "limitations": manifest["limitations"]},
            model_manifest=manifest,
        )


def build_analysis_provider() -> AnalysisProvider:
    """根据环境变量选择 provider；默认不假装有 AI。"""
    provider = os.getenv("AI_PROVIDER", "").strip().lower()
    if provider == "text_local":
        return LocalTextAnalysisProvider()
    if provider in {"b_local", "b", "paddle_smolvlm"}:
        return BLocalAnalysisProvider()
    raise AnalysisProviderError(
        "PROVIDER_NOT_CONFIGURED",
        "尚未配置分析方式；低内存文字整理可设置 AI_PROVIDER=text_local；图文语义分析需配置 b_local 及模型",
    )
