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


def build_analysis_provider() -> AnalysisProvider:
    """根据环境变量选择 provider；默认不假装有 AI。"""
    provider = os.getenv("AI_PROVIDER", "").strip().lower()
    if provider in {"b_local", "b", "paddle_smolvlm"}:
        return BLocalAnalysisProvider()
    raise AnalysisProviderError(
        "PROVIDER_NOT_CONFIGURED",
        "尚未配置真实分析 provider；请设置 AI_PROVIDER=b_local",
    )
