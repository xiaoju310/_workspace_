# AI/video experiment log

| date (Beijing) | component | input | result | status |
|---|---|---|---|---|
| 2026-11-03 | GPU | local machine | RTX 4060 Laptop GPU, 8188 MiB VRAM, NVIDIA driver 572.62 | measured |
| 2026-11-03 | FFmpeg | local installation | FFmpeg 9.0 available | measured |
| 2026-11-03 | image tools | isolated `.venv` | Pillow 13.0.0 and OpenCV 5.0.0.93 imported successfully | measured |
| 2026-11-03 | AI schema/prototype | synthetic text and mock providers | 2 pytest cases and smoke checks passed | prototype |
| 2026-11-03 | PaddleOCR / VLM | no authorized sample or installed model | provider interfaces only; no real inference measured | pending |
| 2026-11-03 | HunyuanVideo-1.5 I2V/T2V candidate | local 8 GB GPU | design notes list 14 GB minimum | blocked |
| 2026-11-05 | AnimateDiff-Lightning T2V | local RTX 4060 Laptop GPU | 512×512, 8 frames at 8 fps, 1 second, 18.63 s elapsed, 3061 MiB peak allocated VRAM; first and last frames show a recognizable butterfly | local feasibility confirmed |
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

I2V/T2V feasibility: the local RTX 4060 Laptop GPU has 8,188 MiB VRAM. HunyuanVideo-1.5 remains unsuitable for this machine under the team's current 14 GB minimum estimate. AnimateDiff-Lightning T2V and LTX-Video 2B I2V now both run locally as feasibility prototypes. FFmpeg tests are media-processing tests only.

AnimateDiff-Lightning 4-step revision `027c893eec01df7330f5d4b733bc9485ee02e8b2` and Stable Diffusion 1.5 revision `451f4fe16113bff5a5d2269ed5ad43b0592e9a14` were downloaded outside Git. Both model cards list CreativeML Open RAIL-M. CUDA PyTorch 2.7.1+cu128, Diffusers 0.37.1, and CPU model offload were used. An initial 256×256 8-frame run produced an MP4 in 18.00 s at 2670 MiB peak allocated VRAM, but extracted frames were illegible saturated color blocks. A float32 VAE decode check did not fix the visual failure. At 512×512, the same 4-step pipeline with prompt `a blue butterfly flying over yellow flowers, clear detailed illustration` generated 8 frames in 18.63 s at 3061 MiB peak allocated VRAM. FFprobe measured 512×512, 8 fps, 8 decoded frames, and 1.000 s. The first and last frames visibly contain a blue butterfly and flowers; motion is subtle. This is one self-created text prompt, not a book-page I2V evaluation or a complete competition video. The generated MP4 and frames are excluded from Git.

On 2026-11-06, LTX-Video 2B distilled FP8 revision `8984fa25007f376c1a299016d0957a37a2f797bb` completed a real image-to-video test using the self-created cyan butterfly frame. The video checkpoint SHA-256 was `D6D8FA8ED3A98346787C2503AC80FB5D7CEBCF80E356B79A2BA361FBADF97E15`; all four official T5 XXL encoder shards passed their published SHA-256 checks. The prompt specified one centered butterfly gently opening and closing its wings while preserving the patterned background. Prompt SHA-256: `2A0DBFD6A5BAE1BCC7FD8BE7D5F497CCFE545452F8F5671F2D5D3AD2FA26425D`; input SHA-256: `DF3B3D2C5D3376043279E17E4652A65662BE2286218FAC92B71D2F4FC24F87D6`. Encoding the prompt on CPU took 24.43 s; the separate video process took 14.79 s and peaked at 6,307 MiB PyTorch allocated VRAM. The MP4 decoded as 256×256, 9 frames, 8 fps. First, middle, and last frames kept the butterfly recognizable, but wing motion was slight and the patterned background visibly warped. This proves local I2V inference fits the 8 GB GPU under these settings; visual quality is not yet suitable for a final story page. Weights, embeddings, and output media remain outside Git. The model's LTXV Open Weights License 0.X requires explicit AI-generated labeling for shared outputs and has separate terms for entities with at least US$10 million annual revenue.

## Next provider gate

The local T2V and I2V feasibility results are recorded above. Before labeling an I2V provider ready for book pages, test representative authorized pages for identity and motion quality, record the exact model version, weight/source license, allowed input scope, timeout, generated output path, elapsed time, peak VRAM or billed cost, prompt hash, and one successful and one failed run.
