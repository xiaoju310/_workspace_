# AI/video experiment log

| date (Beijing) | component | input | result | status |
|---|---|---|---|---|
| 2026-11-03 | GPU | local machine | RTX 4060 Laptop GPU, 8188 MiB VRAM, NVIDIA driver 572.62 | measured |
| 2026-11-03 | FFmpeg | local installation | FFmpeg 9.0 available | measured |
| 2026-11-03 | image tools | isolated `.venv` | Pillow 13.0.0 and OpenCV 5.0.0.93 imported successfully | measured |
| 2026-11-03 | AI schema/prototype | synthetic text and mock providers | 2 pytest cases and smoke checks passed | prototype |
| 2026-11-03 | PaddleOCR / VLM | no authorized sample or installed model | provider interfaces only; no real inference measured | pending |
| 2026-11-03 | true I2V/T2V | local 8 GB GPU | HunyuanVideo-1.5 candidate in design notes lists 14 GB minimum; no model weights or authorized alternative service configured | blocked |
| 2026-11-04 | local synthetic pipeline | generated PNG | page JSON, BookGraph, and story draft produced with `mock / mock / low_confidence` statuses | prototype |
| 2026-11-04 | FFmpeg media utilities | FFmpeg-generated blue test clip | duration probe, timeline, and frame extraction passed | synthetic test only |
| 2026-11-04 | automated checks | local `.venv` | 13 pytest cases passed | measured |
| 2026-11-04 | PaddleOCR | self-created PNG containing `SYNTHETIC PAGE` | PaddleOCR 3.7.0, PP-OCRv6 medium det/rec; text `SYNTHETIC PAGE`, confidence 0.9999807, initialization 3.37 s, inference 2.69 s on CPU | real on synthetic input |
| 2026-11-04 | PaddleOCR first attempt | same self-created PNG | Windows CPU oneDNN runtime error `ConvertPirAttribute2RuntimeAttribute`; rerun with `FLAGS_use_mkldnn=0` and `enable_mkldnn=False` succeeded | failed then fixed |
| 2026-11-04 | automated checks | local `.venv` | 14 pytest cases passed, including real PaddleOCR on a self-created image | measured |
| 2026-11-04 | SmolVLM 256M | self-created PNG | CPU model loaded; short-object prompt returned `Synthetic Page` in 9.92 s after initialization | real on synthetic input |
| 2026-11-04 | OCR + VLM pipeline | same self-created PNG | OCR `SYNTHETIC PAGE` (0.9999807); VLM object `Synthetic Page`; page status `ok`; 88.73 s pipeline time on CPU | real on synthetic input |
| 2026-11-04 | regression tests after VLM install | local `.venv` | plain pytest: 13 passed, 1 failed on Windows torch `shm.dll` load via ModelScope; preloading torch before pytest: 14 passed | environment workaround |

## Reproduction

```powershell
.venv\Scripts\python.exe -m pytest -q tests
# After installing the VLM extra on this Windows environment, preload torch:
.venv\Scripts\python.exe -c "import torch,pytest; raise SystemExit(pytest.main(['-q','tests']))"
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv
ffmpeg -version
```

Source and license for any future OCR, VLM, voice, or video model must be recorded with exact version before using it. The current `mock` and `failed` outputs cannot be presented as real generation. No restricted book pages, child audio, model weights, or credentials are stored here.

The real synthetic OCR JSON is [`sample-ocr-output.real.json`](sample-ocr-output.real.json). It is real for this local self-created input only; it does not establish performance on an authorized book page. PaddleOCR/PaddlePaddle weights were downloaded from the official model source via ModelScope; verify exact model license before redistribution.

Synthetic input provenance: locally generated with Pillow (white 640×360 canvas, drawn rectangle and text `SYNTHETIC PAGE`), stored outside Git at `data/synthetic/page.png`; SHA-256 `419E5ECBF0D7E8F374F2ABCD44D283CBFB685CB2B13EBFC5545FC9393F51F501`.

OCR model records (local official model cache, weights excluded from Git):

| Model | License in model README | SHA-256 of `inference.pdiparams` |
|---|---|---|
| `PP-OCRv6_medium_det` | Apache-2.0 | `85218D2E3D98F5A21C58B4220627BE923A97AEE5DB3CC71F39536AB31AC53960` |
| `PP-OCRv6_medium_rec` | Apache-2.0 | `1B01C79A914587933F615569E75DE54F2E638EBB5D3F3B3C1B38C24EDE8C7319` |

VLM feasibility: `HuggingFaceTB/SmolVLM-256M-Instruct` at commit `7e3e67edbbed1bf9888184d9df282b700a323964` was downloaded from Hugging Face to a local cache outside Git. The model card lists Apache-2.0. `model.safetensors` SHA-256 is `74DEA5904032E5AE99A2E0EEF5179E6AC0F1DEDC3AB0C7C2A5D4D387C843203E`. PyTorch 2.15.0+cpu and Transformers 4.57.6 ran on CPU. The first JSON-constrained prompt returned prose and failed parsing; a short-object prompt succeeded. This establishes one real local visual-understanding call on a synthetic image, not quality on book pages. CUDA inference and peak VRAM remain untested.

I2V/T2V feasibility: the local RTX 4060 Laptop GPU has 8,188 MiB VRAM (7,957 MiB free at inspection). The team's current HunyuanVideo-1.5 candidate requires more than this according to its design notes; no local weights or approved remote provider were found. Status: `blocked`; FFmpeg tests are media-processing tests only.

## Next provider gate

The user selected a local prototype until a suitable cloud GPU or approved video service is available. A real I2V/T2V result therefore remains untested. Before labeling a provider ready, record its exact model version, weight/source license, allowed input scope, timeout, generated output path, elapsed time, peak VRAM or billed cost, prompt hash, and one successful and one failed run.
