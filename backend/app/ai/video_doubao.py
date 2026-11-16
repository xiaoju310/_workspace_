from __future__ import annotations

"""Volcengine Ark Seedream -> Seedance adapter for B's media pipeline.

Only explicit CLI invocations submit paid generation requests. Credentials are read
at call time and never serialized into a result file.
"""

import base64
import binascii
import hashlib
import io
import os
import re
import time
from pathlib import Path
from urllib.parse import urlsplit

import requests
from PIL import Image
from pydantic import BaseModel

from .video import VideoResult

BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"
MAX_IMAGE_BYTES = 20 * 1024 * 1024
MAX_VIDEO_BYTES = 200 * 1024 * 1024


class ImageResult(BaseModel):
    page_no: int
    path: str | None = None
    model_version: str
    prompt_hash: str
    status: str
    error_code: str | None = None
    error_message: str | None = None
    source_ref: str | None = None
    generation_config: dict | None = None


def _hash(prompt: str) -> str:
    return hashlib.sha256(prompt.encode("utf-8")).hexdigest()


def _safe_url(url: str) -> bool:
    parsed = urlsplit(url)
    host = (parsed.hostname or "").lower()
    return (parsed.scheme == "https" and parsed.port in (None, 443)
            and not parsed.username and not parsed.password
            and any(host.endswith("." + suffix) for suffix in ("volces.com", "volcengine.com")))


# Expose only short, machine-readable provider codes; never echo response messages.
_SAFE_ARK_CODE = re.compile(r"[A-Z][A-Za-z]{2,47}\Z")


class ArkAPIError(RuntimeError):
    def __init__(self, status: int, provider_code: str | None = None) -> None:
        self.status = status
        self.provider_code = provider_code
        super().__init__(f"Ark HTTP {status}" + (f" ({provider_code})" if provider_code else ""))


class DoubaoProvider:
    """One provider: T2I via Seedream, I2V via Seedance; no local model needed."""

    license_ref = "Volcengine Ark commercial model terms"

    def __init__(self, image_model: str | None = None, video_model: str | None = None,
                 *, api_key: str | None = None, session: requests.Session | None = None,
                 poll_interval: float = 5, max_wait: float = 600, duration: int = 5,
                 base_url: str = BASE_URL) -> None:
        # Explicit model IDs avoid accidentally billing an unintended endpoint.
        self.image_model = image_model or os.getenv("DOUBAO_IMAGE_MODEL", "")
        self.video_model = video_model or os.getenv("DOUBAO_VIDEO_MODEL", "")
        self._api_key = api_key if api_key is not None else os.getenv("ARK_API_KEY", "")
        if base_url != BASE_URL:  # Never send bearer tokens to an arbitrary URL.
            raise ValueError("Only the official cn-beijing Ark API endpoint is supported")
        if poll_interval <= 0 or max_wait <= 0 or not 2 <= duration <= 12:
            raise ValueError("Invalid polling or duration configuration")
        self.session = session or requests.Session()
        self.poll_interval = poll_interval
        self.max_wait = max_wait
        self.duration = duration
        self.version = self.video_model or "unconfigured"

    def _headers(self) -> dict[str, str]:
        if not self._api_key:
            raise ValueError("ARK_API_KEY is not configured")
        return {"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"}

    def _json(self, method: str, path: str, payload: dict | None = None) -> dict:
        response = self.session.request(method, BASE_URL + path, headers=self._headers(),
                                        json=payload, timeout=(10, 120), allow_redirects=False)
        # Do not include response bodies or signed URLs in logs/errors.
        if response.status_code >= 400 or response.status_code in (301, 302, 303, 307, 308):
            # Surface only a known-safe error code; the provider message can contain account IDs.
            try:
                body = response.json()
                error = body.get("error") if isinstance(body, dict) else None
                code = error.get("code") if isinstance(error, dict) else None
            except (ValueError, AttributeError, TypeError):
                code = None
            if not isinstance(code, str) or not _SAFE_ARK_CODE.fullmatch(code):
                code = None
            raise ArkAPIError(response.status_code, code)
        result = response.json()
        if not isinstance(result, dict):
            raise ValueError("Ark response is not an object")
        return result

    @staticmethod
    def _image_data(path: Path) -> str:
        if not path.is_file() or path.stat().st_size > MAX_IMAGE_BYTES:
            raise ValueError("Image missing or too large")
        with Image.open(path) as img:
            if img.format not in ("PNG", "JPEG"):
                raise ValueError("Only PNG/JPEG images are supported")
            fmt = img.format.lower()
            img.verify()
        return f"data:image/{fmt};base64,{base64.b64encode(path.read_bytes()).decode('ascii')}"

    @staticmethod
    def _save_image(encoded: str, output: Path) -> None:
        if len(encoded) > MAX_IMAGE_BYTES * 4 // 3 + 8:
            raise ValueError("Generated image too large")
        try:
            raw = base64.b64decode(encoded, validate=True)
        except binascii.Error as exc:
            raise ValueError("Invalid image base64") from exc
        if not raw or len(raw) > MAX_IMAGE_BYTES:
            raise ValueError("Generated image missing or too large")
        with Image.open(io.BytesIO(raw)) as img:
            if img.format not in ("PNG", "JPEG"):
                raise ValueError("Unsupported generated image format")
            img.verify()
        output.parent.mkdir(parents=True, exist_ok=True)
        temp = output.with_name(output.name + ".part")
        try:
            # Seedream 4.x returns JPEG; normalize to the CLI's .png extension.
            with Image.open(io.BytesIO(raw)) as img:
                img.convert("RGB").save(temp, format="PNG")
            temp.replace(output)
        finally:
            temp.unlink(missing_ok=True)

    def generate_image(self, page_no: int, prompt: str, output_path: Path,
                       reference: Path | None = None) -> ImageResult:
        config = {"size": "2K", "response_format": "b64_json"}
        try:
            if not self.image_model:
                raise ValueError("DOUBAO_IMAGE_MODEL is not configured")
            payload = {"model": self.image_model, "prompt": prompt, **config}
            if reference is not None:
                payload["image"] = self._image_data(reference)
            data = self._json("POST", "/images/generations", payload)["data"][0]
            self._save_image(data["b64_json"], output_path)
            return ImageResult(page_no=page_no, path=str(output_path), model_version=self.image_model,
                               prompt_hash=_hash(prompt), status="ok", source_ref=str(reference) if reference else None,
                               generation_config=config)
        except (ValueError, KeyError, IndexError, TypeError, RuntimeError, requests.RequestException, OSError) as exc:
            return ImageResult(page_no=page_no, model_version=self.image_model or "unconfigured",
                               prompt_hash=_hash(prompt), status="failed",
                               error_code=exc.provider_code or f"HTTP_{exc.status}" if isinstance(exc, ArkAPIError) else type(exc).__name__.upper(),
                               error_message=str(exc)[:150] if isinstance(exc, (ValueError, RuntimeError)) else "Image generation failed",
                               source_ref=str(reference) if reference else None, generation_config=config)

    def _download_video(self, url: str, output: Path) -> None:
        if not _safe_url(url):
            raise ValueError("Untrusted video download URL")
        # No bearer token on signed media downloads. Redirects are deliberately disabled.
        response = self.session.get(url, stream=True, timeout=(10, 120), allow_redirects=False)
        try:
            if response.status_code != 200:
                raise RuntimeError(f"Video download HTTP {response.status_code}")
            if response.headers.get("Content-Length", "0").isdigit() and int(response.headers.get("Content-Length", "0")) > MAX_VIDEO_BYTES:
                raise ValueError("Generated video too large")
            output.parent.mkdir(parents=True, exist_ok=True)
            temp = output.with_name(output.name + ".part")
            try:
                total = 0
                with temp.open("wb") as target:
                    for block in response.iter_content(chunk_size=65536):
                        total += len(block)
                        if total > MAX_VIDEO_BYTES:
                            raise ValueError("Generated video too large")
                        target.write(block)
                if not total:
                    raise ValueError("Generated video empty")
                temp.replace(output)
            finally:
                temp.unlink(missing_ok=True)
        finally:
            response.close()

    def generate(self, page_no: int, image_path: Path | None, prompt: str,
                 output_path: Path) -> VideoResult:
        started = time.monotonic()
        mode = "i2v" if image_path else "t2v"
        config = {"duration": self.duration, "resolution": "720p", "provider": "volcengine-ark"}
        try:
            if not self.video_model:
                raise ValueError("DOUBAO_VIDEO_MODEL is not configured")
            content = [{"type": "text", "text": prompt}]
            if image_path is not None:
                content.append({"type": "image_url", "image_url": {"url": self._image_data(image_path)},
                                "role": "first_frame"})
            payload = {"model": self.video_model, "content": content,
                       "resolution": "720p", "duration": self.duration, "watermark": True}
            if image_path is None:
                payload["ratio"] = "16:9"
            task_id = self._json("POST", "/contents/generations/tasks", payload)["id"]
            if not isinstance(task_id, str) or not task_id.startswith("cgt-") or not task_id.isascii() or not task_id.replace("-", "").isalnum():
                raise ValueError("Invalid Ark task ID")
            config["task_id"] = task_id  # Allows retrieval after timeout without exposing signed URLs.
            deadline = time.monotonic() + self.max_wait
            while True:
                result = self._json("GET", f"/contents/generations/tasks/{task_id}")
                status = result.get("status")
                if status == "succeeded":
                    url = result.get("content", {}).get("video_url")
                    if not isinstance(url, str):
                        raise ValueError("Ark video URL missing")
                    self._download_video(url, output_path)
                    config["output_sha256"] = hashlib.sha256(output_path.read_bytes()).hexdigest()
                    return VideoResult(page_no=page_no, path=str(output_path), generation_mode=mode,
                                       model_version=self.video_model, prompt_hash=_hash(prompt),
                                       elapsed_s=time.monotonic() - started, status="ok",
                                       source_ref=str(image_path) if image_path else None,
                                       license_ref=self.license_ref, generation_config=config)
                if status in ("failed", "cancelled", "expired"):
                    raise RuntimeError(f"Ark task {status}; task ID saved")
                if status not in ("queued", "running"):
                    raise ValueError("Unknown Ark task status")
                if time.monotonic() >= deadline:
                    raise TimeoutError("Ark task still running; task ID saved for later query")
                time.sleep(min(self.poll_interval, max(0, deadline - time.monotonic())))
        except (ValueError, KeyError, TypeError, RuntimeError, TimeoutError, requests.RequestException, OSError) as exc:
            return VideoResult(page_no=page_no, generation_mode=mode,
                               model_version=self.video_model or "unconfigured", prompt_hash=_hash(prompt),
                               elapsed_s=time.monotonic() - started, status="failed",
                               error_code=type(exc).__name__.upper(),
                               error_message=str(exc)[:150] if isinstance(exc, (ValueError, RuntimeError, TimeoutError)) else "Video generation failed",
                               source_ref=str(image_path) if image_path else None,
                               license_ref=self.license_ref, generation_config=config)
