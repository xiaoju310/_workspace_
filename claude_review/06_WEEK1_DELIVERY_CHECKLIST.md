# 06. 角色 C 第一周 (D1~D7) 交付全量清单与自查对照

| 日期节点 | 规划交付项 | 对应关键代码与组件 | 实际达成状态 |
| :--- | :--- | :--- | :--- |
| **D1** | 浏览器免转码录音、16kHz 16-bit 单声道 WAV 导出、实时 RMS 音量监听 | `frontend/src/features/interaction/AudioRecorderHelper.ts` | **100% 达成** (通过单测) |
| **D2** | 触控黑边 (Letterbox/Pillarbox) 计算与即时拦截、归一化坐标转换与水波纹高亮 | `frontend/src/features/interaction/VideoCoordinateMapper.ts`<br>`frontend/src/features/interaction/TouchOverlay.tsx` | **100% 达成** (通过单测) |
| **D3** | ASR 统一接口抽象、原生普通话识别、空录音/拒绝权限友好拦截 | `frontend/src/features/interaction/asr/AsrProvider.ts` | **100% 达成** (通过单测) |
| **D4** | 视频时间轴多源证据检索器、分镜脚本与关键帧实体匹配 | `frontend/src/features/interaction/indexing/TimeSliceIndexer.ts` | **100% 达成** (通过单测) |
| **D5** | RAG 绘本依据短答引擎、未知超纲问题 100% 拒答防幻觉 | `frontend/src/features/interaction/qa/PictureBookRagEngine.ts` | **100% 达成** (通过单测) |
| **D6** | TTS 语音播报播放器、律动声波、语速调节与首音频延迟 (TTFA) 毫秒度量 | `frontend/src/features/interaction/tts/TtsProvider.ts`<br>`frontend/src/features/interaction/tts/TtsPlayerWidget.tsx` | **100% 达成** (通过真实发音测试) |
| **D7** | 多模态会话历史留痕面板、延迟指标看板、笔记全周期只读分享、基准测试跑测台 | `frontend/src/features/interaction/history/InteractionHistoryPanel.tsx`<br>`frontend/src/features/interaction/metrics/LatencyMetricsDashboard.tsx`<br>`frontend/src/features/interaction/BenchmarkRunner.tsx`<br>`frontend/src/features/interaction/ReadingNotesDrawer.tsx` | **100% 达成** (全部接入) |
| **扩展 1** | 与后端 A 真实接口契约对齐、交互上报入库 (`POST /api/runs/{run_id}/interactions`) 与分类确认 | `frontend/src/lib/api.ts` | **100% 达成** (通过 check-api 与 check-interaction) |
| **扩展 2** | 与前端 D 同学页面体系大合龙、双模式 (`live` vs `demo`) 物理隔离 | `frontend/src/pages/InteractiveReaderPage.tsx`<br>`frontend/src/app/WorkspaceApp.tsx`<br>`frontend/src/components/BackendWorkbench.tsx` | **100% 达成** (双模无缝集成) |
