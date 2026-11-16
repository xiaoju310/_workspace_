"""Import an existing successful B generation into A's owner-protected run.

This command never invokes a generation model. It validates files and manifests before
copying; registering assets is still not a claim that media passed human review.
"""
from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path
from urllib.parse import urlsplit

import requests
from PIL import Image


def _file_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _request(client, method: str, url: str, **kwargs):
    response = getattr(client, method)(url, **kwargs)
    response.raise_for_status()
    return response.json()


def import_generation(manifest_path: Path, run_id: str, data_root: Path, client) -> list[dict]:
    """Verify ownership/page via API, then copy & register each successful output.

    client is an authenticated requests.Session (or a test transport). Do not pass
    arbitrary manifest paths to the server; only files beside this manifest qualify.
    """
    manifest_path = manifest_path.resolve(strict=True)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict):
        raise ValueError("生成清单必须是对象")
    run = _request(client, "get", f"/api/runs/{run_id}")
    if run.get("id") != run_id:
        raise ValueError("运行 ID 与后端返回不一致")
    pages = _request(client, "get", f"/api/books/{run['book_id']}/pages")
    valid_pages = {item["page_no"] for item in pages}
    candidates = []
    for key, mime, ext in (("image", "image/png", ".png"),
                           ("video", "video/mp4", ".mp4")):
        record = manifest.get(key)
        if record is None:
            continue
        if not isinstance(record, dict):
            raise ValueError(f"{key} 生成记录格式不正确")
        if key == "image" and record.get("status") == "reused":
            continue  # Reused input is not a newly generated image.
        if record.get("status") != "ok":
            # A successful picture is still useful when a later paid video
            # request failed; never register the failed output itself.
            continue
        page_no = record.get("page_no")
        if type(page_no) is not int or page_no not in valid_pages:
            raise ValueError(f"{key} 页码不属于此书")
        if not isinstance(record.get("model_version"), str) or not record["model_version"].strip():
            raise ValueError(f"{key} 缺少生成模型来源")
        raw = record.get("path")
        if not isinstance(raw, str) or not raw:
            raise ValueError(f"{key} 缺少产物路径")
        # CLI may save a path relative to the invoking directory (e.g. outputs/a.png)
        # rather than to the manifest directory. Accept either only if the resolved
        # file is still beside the manifest, never a file from another directory.
        supplied = Path(raw)
        source = supplied.resolve() if supplied.is_file() else (manifest_path.parent / supplied).resolve()
        if source.parent != manifest_path.parent or not source.is_file() or source.suffix.lower() != ext:
            raise ValueError(f"{key} 必须位于生成清单旁，且扩展名为 {ext}")
        if key == "image":
            with Image.open(source) as image:
                if image.format != "PNG":
                    raise ValueError("插画不是 PNG")
                image.verify()
            with Image.open(source) as image:
                image.load()
        else:
            with source.open("rb") as stream:
                head = stream.read(12)
            if len(head) < 12 or head[4:8] != b"ftyp":
                raise ValueError("视频不是 MP4 容器；需要人工及 ffprobe 复核")
        candidates.append((key, source, page_no, mime, _file_digest(source), record["model_version"]))
    if not candidates:
        raise ValueError("清单没有可登记的成功产物")
    root = (data_root / "runs" / run_id).resolve()
    root.mkdir(parents=True, exist_ok=True)
    registered = []
    for key, source, page_no, mime, digest, producer in candidates:
        dest = root / f"{page_no}-{digest[:16]}{source.suffix.lower()}"
        # Never replace an existing asset or silently register it twice.
        try:
            with source.open("rb") as input_file, dest.open("xb") as output_file:
                shutil.copyfileobj(input_file, output_file)
        except FileExistsError as exc:
            raise ValueError(f"产物已导入：{dest}；请先检查运行产物列表，避免重复登记") from exc
        try:
            if _file_digest(dest) != digest:
                raise ValueError("复制后校验和不一致")
            metadata = {"producer": producer, "page_no": page_no, "generation_manifest_sha256": _file_digest(manifest_path)}
            response = _request(client, "post", f"/api/runs/{run_id}/assets", json={
                "asset_type": key, "file_path": str(dest), "mime_type": mime, "metadata": metadata,
            })
            registered.append(response)
        except Exception:
            # The server may have registered the file before a network timeout. Keep
            # it rather than leaving a registered DB row pointing to a deleted path.
            raise
    return registered


def run_import(manifest: Path, run_id: str, api_url: str, data_root: Path, token: str) -> list[dict]:
    parsed = urlsplit(api_url)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "::1"} or parsed.username or parsed.password:
        raise ValueError("只允许本机 HTTP 后端；路径与 DATA_ROOT 必须在同一台电脑上")
    if not token:
        raise ValueError("先设置 APP_API_TOKEN 环境变量（图书主人令牌）")
    with requests.Session() as client:
        client.headers.update({"Authorization": f"Bearer {token}"})
        client.get = _prefix(client.get, api_url)
        client.post = _prefix(client.post, api_url)
        return import_generation(manifest, run_id, data_root, client)


def _prefix(method, base):
    return lambda path, **kwargs: method(base.rstrip("/") + path, timeout=30, **kwargs)
