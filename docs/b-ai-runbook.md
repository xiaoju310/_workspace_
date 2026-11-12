# B: AI understanding and video module

## v2 bookpack and quality checks

The v2 plan adds a validated machine-readable bookpack contract in `app.ai.bookpack`.
Each page has `pages/NN.png` and matching `pages/NN.json`; the root `manifest.json`
contains the same page records, their source/license, motion instructions, audio
instructions, age range, and status. Drafts may contain fewer than 12 pages;
`candidate` and `frozen` require all 12. Validation checks contiguous page numbers,
matching metadata, source references, and decodable PNGs. It does not certify
image quality, copyright, or child safety.

```powershell
$env:PYTHONPATH = "$PWD\backend"
.venv\Scripts\python.exe -m app.ai.cli validate-bookpack --root assets\bookpack_pb001 --repro-out assets\repro_pb001\manifest.json
.venv\Scripts\python.exe -m app.ai.cli qc-video --video assets\film_pb001\pb001_p03_L2_v1.mp4 --expected-duration 6 --out assets\film_pb001\qc_p03.json
```

The repro manifest records SHA-256 for bookpack files and the supplied model
manifest. Add exact model versions, prompt hashes, license records, seed, and
failure logs before calling a run reproducible. `qc-video` checks duration,
frame rate, sampled brightness, SSIM, and optical flow. A green result is a
technical precheck only; identity, text fidelity, motion artifacts, and child
safety require visual review. Motion flow is measured between roughly two
sampled frames per second, so it is not directly comparable to the v2 plan's
per-frame 2–8 px threshold.

This branch provides the first runnable AI/video module for B's work. Real local PaddleOCR and SmolVLM were verified on one self-created test image. The optional AnimateDiff-Lightning provider is a local text-to-video experiment; see the experiment log for its measured status. I2V and TTS remain unavailable.

## Setup and checks (PowerShell)

```powershell
uv venv .venv
uv pip install --python .venv\Scripts\python.exe pydantic pillow opencv-python pytest
.venv\Scripts\python.exe -m pytest -q tests
```

The module path for direct calls is `backend`:

```powershell
$env:PYTHONPATH = "$PWD\backend"
.venv\Scripts\python.exe -c "from app.ai import analyze_page; print(analyze_page('demo',1,'synthetic.png').model_dump_json())"
```

`analyze_page` returns `mock` while its VLM provider is a mock, even when a real OCR provider is used. The separate `ocr` CLI command records the actual OCR result. `UnavailableVideoProvider` returns `VIDEO_PROVIDER_UNAVAILABLE`. `compose.concatenate_segments` only accepts `i2v` or `t2v` segments with `status=ok` and existing video files. See `docs/model-experiments.md` for environment findings and blocked work.

`concatenate_segments` retains an existing input audio stream and encodes it as AAC. It does not create narration or subtitles: silent inputs remain silent. The final voiceover, subtitle, and timing pipeline is still pending. Media tests require both `ffmpeg` and `ffprobe` on `PATH`; when either is unavailable, pytest skips the media integration tests. Check with `ffmpeg -version` and `ffprobe -version` before a full local run.

## Optional local text-to-video experiment (8 GB GPU)

The provider uses ByteDance AnimateDiff-Lightning 4-step with Stable Diffusion 1.5 at 512×512, 8 frames, 8 fps, and CPU offload. It is **T2V only** and does not animate an input book page. Its one-second clip is a feasibility test, not a complete competition video. The local test used 3,061 MiB peak allocated GPU memory. Keep all weights and generated MP4 files outside Git. The model cards list CreativeML Open RAIL-M; review the permitted use and attribution before any public presentation.

Create a separate environment if OCR/VLM dependencies must remain unchanged. Install the optional Python packages, then replace CPU PyTorch with the official CUDA wheel appropriate for the local driver. On this machine, CUDA 12.8 is the selected wheel index:

```powershell
uv pip install --python .venv\Scripts\python.exe -e ".[video]"
uv pip install --python .venv\Scripts\python.exe --index-url https://download.pytorch.org/whl/cu128 torch==2.7.1 torchvision==0.22.1
.venv\Scripts\python.exe -c "import torch; print(torch.__version__, torch.cuda.is_available())"
```

Download the pinned weights to a local folder outside the repository. The four `.fp16.safetensors` files for SD 1.5 and the Lightning checkpoint are needed; `model_index.json`, component configs, tokenizer and scheduler files are also needed. Use `scripts/download_video_models.py --cache-dir D:\models` for the revisions listed in `model-experiments.md`. Then run:

```powershell
$env:PYTHONPATH = "$PWD\backend"
.venv\Scripts\python.exe -m app.ai.cli video-generate --page-no 1 --prompt "a blue butterfly flying over flowers" --model-path D:\models\sd15 --motion-checkpoint D:\models\animatediff-lightning\animatediff_lightning_4step_diffusers.safetensors --out data\synthetic\butterfly.mp4
ffprobe -v error -show_entries stream=codec_type,width,height -show_entries format=duration -of json data\synthetic\butterfly.mp4
```

The CLI writes `data\synthetic\butterfly.generation.json` with `status`, model version, prompt hash, elapsed time, and peak allocated GPU memory. A nonzero exit code and `status=failed` mean no video was generated; inspect `error_code` and `error_message`. Inspect extracted frames before presenting any successful file: the 256×256 run was technically successful but visually unusable.

For real local image understanding, install the optional `vlm` dependencies and download the pinned model outside Git. The example below uses CPU even if CUDA PyTorch is installed. `SmolVLMProvider` currently extracts one visible object name and leaves events empty. Its fixed 0.5 confidence is an uncalibrated placeholder, so review the result before using it in a story.

```powershell
uv pip install --python .venv\Scripts\python.exe -e ".[vlm]"
.venv\Scripts\python.exe -c "from huggingface_hub import snapshot_download; snapshot_download('HuggingFaceTB/SmolVLM-256M-Instruct', revision='7e3e67edbbed1bf9888184d9df282b700a323964', local_dir='D:/models/smolvlm-256m')"
$env:PYTHONPATH = "$PWD\backend"
.venv\Scripts\python.exe -c "from app.ai.providers import PaddleOCRProvider, SmolVLMProvider; from app.ai.pipeline import analyze_page; print(analyze_page('synthetic', 1, 'data/synthetic/page.png', ocr=PaddleOCRProvider(), vision=SmolVLMProvider('D:/models/smolvlm-256m')).model_dump_json())"
```

Real local OCR on a self-created image:

```powershell
uv pip install --python .venv\Scripts\python.exe "paddlepaddle>=3.3,<4" "paddleocr>=3.7,<4"
$env:PYTHONPATH = "$PWD\backend"
.venv\Scripts\python.exe -m app.ai.cli ocr --book-id synthetic-book --page-no 1 --image data/synthetic/page.png --out data/synthetic/ocr-real.json
```

The provider disables oneDNN on Windows CPU because the default inference attempt raised `ConvertPirAttribute2RuntimeAttribute`. The checked-in result is [`sample-ocr-output.real.json`](sample-ocr-output.real.json). It includes recognized text, bounding box, confidence, model version, source, and measured initialization/inference time.

## Local synthetic smoke run

The smoke input is generated locally and is not a book page:

```powershell
New-Item -ItemType Directory -Force data/synthetic
.venv\Scripts\python.exe -c "from PIL import Image; Image.new('RGB',(640,360),'white').save('data/synthetic/page.png')"
$env:PYTHONPATH = "$PWD\backend"
.venv\Scripts\python.exe -m app.ai.cli page --book-id synthetic-book --page-no 1 --image data/synthetic/page.png --out data/synthetic/page.json
```

Expected status: `mock` for page and graph, and `low_confidence` for the story draft. This checks the pipeline only.
The checked-in example is [`sample-ai-output.mock.json`](sample-ai-output.mock.json).

For a text excerpt, `app.ai.cli reading` emits the detected type, minimal chapter/entity/event fields, a private review-required note, and a type-specific `video_strategy`. Notes require a page or chapter source.
