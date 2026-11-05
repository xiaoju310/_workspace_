"""Download pinned T2V weights into a directory outside Git."""

from __future__ import annotations

import argparse
from pathlib import Path

from huggingface_hub import hf_hub_download, snapshot_download


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-dir", type=Path, required=True)
    args = parser.parse_args()
    root = args.cache_dir.resolve()
    root.mkdir(parents=True, exist_ok=True)
    sd15 = root / "sd15"
    motion = root / "animatediff-lightning"
    snapshot_download(
        "runwayml/stable-diffusion-v1-5",
        revision="451f4fe16113bff5a5d2269ed5ad43b0592e9a14",
        local_dir=sd15,
        allow_patterns=["*.json", "*.txt", "*.fp16.safetensors"],
    )
    checkpoint = hf_hub_download(
        "ByteDance/AnimateDiff-Lightning",
        "animatediff_lightning_4step_diffusers.safetensors",
        revision="027c893eec01df7330f5d4b733bc9485ee02e8b2",
        local_dir=motion,
    )
    print(f"model_path={sd15}")
    print(f"motion_checkpoint={checkpoint}")


if __name__ == "__main__":
    main()
