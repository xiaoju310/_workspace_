# B: AI understanding and video module

This branch provides the first runnable AI/video module for B's work. Real local PaddleOCR and SmolVLM were verified on one self-created test image. TTS and true I2V/T2V generation are still unavailable and are not claimed as complete.

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

For real local image understanding, install the optional `vlm` dependencies and download the pinned model outside Git. The example below uses CPU; the installed PyTorch build has no CUDA support. `SmolVLMProvider` currently extracts one visible object name and leaves events empty. Its fixed 0.5 confidence is an uncalibrated placeholder, so review the result before using it in a story.

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
