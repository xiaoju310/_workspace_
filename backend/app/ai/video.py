from __future__ import annotations
import hashlib
import time
from pathlib import Path
from typing import Protocol
from pydantic import BaseModel

class VideoResult(BaseModel):
    page_no: int
    path: str | None = None
    generation_mode: str
    model_version: str
    prompt_hash: str
    elapsed_s: float | None = None
    peak_vram_mb: int | None = None
    status: str
    error_code: str | None = None
    error_message: str | None = None
    source_ref: str | None = None
    license_ref: str | None = None
    generation_config: dict | None = None

class VideoProvider(Protocol):
    version: str
    license_ref: str
    def generate(self, page_no: int, image_path: Path | None, prompt: str, output_path: Path) -> VideoResult: ...

class UnavailableVideoProvider:
    version = "unavailable/1.0"
    license_ref = "none"
    def generate(self, page_no: int, image_path: Path | None, prompt: str, output_path: Path) -> VideoResult:
        import hashlib
        return VideoResult(page_no=page_no, generation_mode="none", model_version=self.version, prompt_hash=hashlib.sha256(prompt.encode()).hexdigest(), status="failed", error_code="VIDEO_PROVIDER_UNAVAILABLE", source_ref=str(image_path) if image_path else None, license_ref=self.license_ref)


class AnimateDiffProvider:
    """Optional lightweight text-to-video provider using AnimateDiff + SD 1.5.

    Weights are downloaded outside the repository. The provider refuses to run
    without CUDA and keeps failures explicit for the competition evidence log.
    """

    version = "ByteDance/AnimateDiff-Lightning:027c893e+runwayml/stable-diffusion-v1-5:451f4fe1"
    license_ref = "CreativeML Open RAIL-M (both model cards)"
    generation_config = {"width": 512, "height": 512, "frames": 8, "fps": 8,
                         "inference_steps": 4, "guidance_scale": 1.0}

    def __init__(self, model_path: str | Path, motion_checkpoint: str | Path, device: str = "cuda") -> None:
        self.model_path = Path(model_path)
        self.motion_checkpoint = Path(motion_checkpoint)
        self.device = device

    def generate(self, page_no: int, image_path: Path | None, prompt: str, output_path: Path) -> VideoResult:
        started = time.perf_counter()
        prompt_hash = hashlib.sha256(prompt.encode()).hexdigest()
        try:
            if image_path is not None:
                raise ValueError("This provider supports text-to-video only; image input requires a separate I2V provider")
            if not self.motion_checkpoint.is_file() or not (self.model_path / "model_index.json").is_file():
                raise FileNotFoundError("Local video model weights are missing")
            import torch
            if self.device.startswith("cuda") and not torch.cuda.is_available():
                raise RuntimeError("CUDA is unavailable; install a CUDA PyTorch build or use an approved cloud GPU")
            if torch.cuda.is_available():
                torch.cuda.reset_peak_memory_stats()
            from diffusers import AnimateDiffPipeline, MotionAdapter, EulerDiscreteScheduler
            from diffusers.utils import export_to_video
            from safetensors.torch import load_file
            adapter = MotionAdapter()
            adapter.load_state_dict(load_file(str(self.motion_checkpoint), device="cpu"))
            pipe = AnimateDiffPipeline.from_pretrained(self.model_path, motion_adapter=adapter, torch_dtype=torch.float16,
                                                        variant="fp16", local_files_only=True)
            pipe.scheduler = EulerDiscreteScheduler.from_config(pipe.scheduler.config, timestep_spacing="trailing", beta_schedule="linear")
            pipe.vae.enable_slicing()
            pipe.enable_model_cpu_offload()
            result = pipe(prompt=prompt, num_frames=8, height=512, width=512, num_inference_steps=4,
                          guidance_scale=1.0, generator=torch.Generator(device="cpu").manual_seed(page_no))
            output_path.parent.mkdir(parents=True, exist_ok=True)
            export_to_video(result.frames[0], str(output_path), fps=8)
            peak = int(torch.cuda.max_memory_allocated() / 1024**2) if torch.cuda.is_available() else None
            return VideoResult(page_no=page_no, path=str(output_path), generation_mode="t2v", model_version=self.version,
                               prompt_hash=prompt_hash, elapsed_s=time.perf_counter()-started, peak_vram_mb=peak,
                               status="ok", source_ref=str(image_path) if image_path else None, license_ref=self.license_ref,
                               generation_config=self.generation_config)
        except Exception as exc:
            return VideoResult(page_no=page_no, generation_mode="t2v", model_version=self.version, prompt_hash=prompt_hash,
                               elapsed_s=time.perf_counter()-started, status="failed", error_code=type(exc).__name__.upper(),
                               error_message=str(exc)[:500],
                               source_ref=str(image_path) if image_path else None, license_ref=self.license_ref,
                               generation_config=self.generation_config)
