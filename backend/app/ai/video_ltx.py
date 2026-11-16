from __future__ import annotations

import hashlib
import json
import subprocess
import time
import uuid
from pathlib import Path

from .video import VideoResult


class LTXVideoProvider:
    """Local image-to-video adapter for the pinned LTX runner."""

    version = "Lightricks/LTX-Video:8984fa25007f376c1a299016d0957a37a2f797bb"
    license_ref = "LTXV Open Weights License 0.X"

    def __init__(self, checkpoint: str | Path, embeddings: str | Path,
                 runner: str | Path, *, python: str = "python", timeout_s: int = 600,
                 seed: int = 1, steps: int = 8) -> None:
        self.checkpoint = Path(checkpoint)
        self.embeddings = Path(embeddings)
        self.runner = Path(runner)
        self.python = python
        self.timeout_s = timeout_s
        self.generation_config = {"width": 256, "height": 256, "frames": 9,
                                  "fps": 8, "steps": steps, "seed": seed}

    def generate(self, page_no: int, image_path: Path | None, prompt: str,
                 output_path: Path) -> VideoResult:
        started = time.perf_counter()
        prompt_hash = hashlib.sha256(prompt.encode()).hexdigest()
        temp_output: Path | None = None
        try:
            if image_path is None or not image_path.is_file():
                raise FileNotFoundError("An existing page image is required")
            for required in (self.checkpoint, self.embeddings, self.runner):
                if not required.is_file():
                    raise FileNotFoundError(str(required))
            output_path.parent.mkdir(parents=True, exist_ok=True)
            temp_output = output_path.with_name(f".{output_path.stem}-{uuid.uuid4().hex}.mp4")
            command = [self.python, str(self.runner), "--checkpoint", str(self.checkpoint),
                       "--embeddings", str(self.embeddings), "--image", str(image_path),
                       "--out", str(temp_output), "--seed", str(self.generation_config["seed"]),
                       "--steps", str(self.generation_config["steps"])]
            proc = subprocess.run(command, capture_output=True, text=True,
                                  timeout=self.timeout_s, check=False)
            if proc.returncode != 0 or not temp_output.is_file() or temp_output.stat().st_size == 0:
                raise RuntimeError((proc.stderr or proc.stdout or "LTX runner failed")[-1000:])
            metadata = {}
            for line in reversed(proc.stdout.splitlines()):
                try:
                    parsed = json.loads(line)
                    if isinstance(parsed, dict) and "output" in parsed:
                        metadata = parsed
                        break
                except json.JSONDecodeError:
                    continue
            if metadata.get("prompt_sha256") != prompt_hash:
                raise ValueError("Prompt does not match the encoded embeddings")
            if metadata.get("image_sha256") != hashlib.sha256(image_path.read_bytes()).hexdigest():
                raise ValueError("Runner image hash does not match input")
            temp_output.replace(output_path)
            config = {**self.generation_config, **metadata,
                      "input_sha256": hashlib.sha256(image_path.read_bytes()).hexdigest(),
                      "output_sha256": hashlib.sha256(output_path.read_bytes()).hexdigest()}
            return VideoResult(page_no=page_no, path=str(output_path), generation_mode="i2v",
                               model_version=self.version, prompt_hash=prompt_hash,
                               elapsed_s=time.perf_counter() - started,
                               peak_vram_mb=metadata.get("peak_vram_mb"), status="ok",
                               source_ref=str(image_path), license_ref=self.license_ref,
                               generation_config=config)
        except Exception as exc:
            return VideoResult(page_no=page_no, generation_mode="i2v", model_version=self.version,
                               prompt_hash=prompt_hash, elapsed_s=time.perf_counter() - started,
                               status="failed", error_code=type(exc).__name__.upper(),
                               error_message=str(exc)[:1000], source_ref=str(image_path) if image_path else None,
                               license_ref=self.license_ref, generation_config=self.generation_config)
        finally:
            if temp_output is not None:
                temp_output.unlink(missing_ok=True)
