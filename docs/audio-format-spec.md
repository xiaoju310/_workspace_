# 纸书智伴 · 音频格式与前后端交互接口规范 (v1.0)

**负责人**：C（语音、触控与应用联调）  
**对接人**：A（后端编排/FastAPI）、B（AI视频/TTS）  
**制定日期**：2026-11-04 (D1)

---

## 1. 录音与音频格式标准

为保证语音识别（FunASR / Whisper / 百度ASR等）的高识别率与超低交互延迟，前后端约定如下：

### 1.1 首选规范（前端已实现免转码直出）：
- **音频封装**：WAV (RIFF WAVE)
- **编码格式**：PCM 16-bit 有符号小端整型 (`pcm_s16le`)
- **声道数**：1 (单声道 Mono)
- **采样率**：16,000 Hz (16 kHz)
- **前端实现**：`AudioRecorderHelper.ts` 通过 Web Audio API 在录制结束时直接重采样并生成 PCM 16-bit WAV Blob。
- **收益**：后端接收后**无需调用 FFmpeg 重新转码**，直接送入 ASR 推理流水线，节省 100~300ms 磁盘 I/O 与进程拉起耗时！

### 1.2 兼容兜底规范（当浏览器硬件编解码受限时）：
- **格式**：WebM Opus (`audio/webm;codecs=opus`) 或 MP4 AAC (`audio/mp4`)
- **后端 FFmpeg 转码命令标准备忘**：
  ```bash
  ffmpeg -y -i input.webm -ar 16000 -ac 1 -c:a pcm_s16le output.wav
  ```

---

## 2. 语音问答接口契约

### 请求地址：`POST /api/v1/interaction/qa`
**Content-Type**：`multipart/form-data`

| 字段名 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `audio` | File (Blob) | 否 | 录音文件（WAV 或 WebM），若是文字自测则可为空 |
| `book_id` | string | 是 | 绘本唯一标识符，如 `book-auth-sample-01` |
| `run_id` | string | 是 | 视频生成批次编号，用于追溯模型版本与视频资产 |
| `video_ms` | number / string | 是 | 当前播放时间毫秒数（整数，如 `3500`） |
| `query_text` | string | 否 | 纯文本提问内容（测试或纠错使用） |
| `stream` | boolean / string | 否 | 暂传 `false`，两周内走稳定 HTTP JSON 流程 |

### 响应格式：`application/json`
```json
{
  "run_id": "run-20261104-001",
  "question": "这只小狐狸为什么要找妈妈？",
  "answer": "小狐狸去采野果迷路了，正在寻找回家的路。",
  "status": "success",
  "confidence": 0.94,
  "evidence": [
    {
      "page_no": 1,
      "video_start_ms": 2000,
      "video_end_ms": 5000,
      "evidence_type": "page",
      "confidence": 0.95,
      "snippet": "小狐狸背着小书包，在茂密的树林中四处张望。"
    }
  ],
  "audio_url": "/data/cache/tts_answer_001.mp3",
  "latency": {
    "asr_ms": 140,
    "retrieval_ms": 65,
    "llm_first_token_ms": 210,
    "llm_total_ms": 320,
    "tts_first_audio_ms": 290,
    "tts_total_ms": 420,
    "total_roundtrip_ms": 520
  },
  "cache_hit": false
}
```

**拒答规范**：
当检索置信度低于阈值（如 `< 0.50`）或完全无匹配依据时，必须返回：
- `status`: `"no_evidence"`
- `answer`: `"抱歉，当前绘本故事中未检索到相关内容依据。"`
- `confidence`: 低于 0.4
- 严禁大模型在没有视频与原书事实依据的情况下胡编乱造。

---

## 3. 触控万物识别接口契约

### 请求地址：`POST /api/v1/interaction/touch`
**Content-Type**：`application/json`

```json
{
  "book_id": "book-auth-sample-01",
  "run_id": "run-20261104-001",
  "video_ms": 3500,
  "touch_point": {
    "norm_x": 0.3542,
    "norm_y": 0.4180,
    "video_pixel_x": 453,
    "video_pixel_y": 301,
    "video_width": 1280,
    "video_height": 720
  },
  "viewport_info": {
    "container_width": 800,
    "container_height": 450,
    "render_width": 800,
    "render_height": 450,
    "offset_x": 0,
    "offset_y": 0,
    "is_letterbox": false
  }
}
```

### 响应格式：`application/json`
```json
{
  "run_id": "run-20261104-001",
  "video_ms": 3500,
  "status": "success",
  "target_name": "小狐狸皮皮",
  "explanation": "故事的主人公小狐狸，正戴着红色围巾寻找妈妈。",
  "confidence": 0.93,
  "bounding_box": [0.25, 0.30, 0.45, 0.55],
  "evidence": {
    "page_no": 1,
    "video_start_ms": 2500,
    "video_end_ms": 4500,
    "evidence_type": "video_frame",
    "confidence": 0.93,
    "snippet": "第 1 页视频第 3.5s 提取的关键角色实体"
  },
  "latency_ms": 230,
  "cache_hit": false
}
```

---

## 4. 前端当前自测与 Mock 降级支持

前端已在 `frontend/src/lib/api.ts` 中实现完善的**降级自测适配层**：
1. 若本地 FastAPI 后端已启动且端口连通，前端将直接请求真实接口。
2. 若后端仍在启动/调试中，前端自动切换至符合上述契约的高保真 Mock 响应，并附带耗时模拟与缓存标记，确保 D 角色（UI布局）与 E 角色（评测交付）可以无缝推进，不受环境阻塞！
