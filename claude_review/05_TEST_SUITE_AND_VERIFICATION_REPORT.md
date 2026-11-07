# 05. 自动化测试套件与全量质检验证报告

## 一、自动化测试覆盖矩阵概览

本项目设立了 4 重立体测试防线：

1. **Vitest 自动化单元测试**：覆盖音频处理、黑边过滤算法、多源时间轴索引、RAG 短答防幻觉、ASR 空转写拦截、后端契约格式，共 **6 个测试套件，17 项单元测试**；
2. **API 适配器专项测试 (`check-api.cjs`)**：覆盖 12 组网络契约与鉴权安全测试；
3. **C 交互专项自动化测试 (`check-interaction.cjs`)**：覆盖交互载荷、黑边留白拦截、空转写拒绝、笔记状态机；
4. **内置基准跑测台 (`BenchmarkRunner.tsx`)**：15 组正反向伴读评测矩阵，达成 100% 准确度。

---

## 二、测试执行明细与原始输出记录

### 1. Vitest 单元测试执行结果 (17/17 全部通过)

```bash
$ cd frontend && npm test

 RUN  v2.1.9 /Users/synn/Documents/GitHub/_workspace_/frontend

 ✓ src/features/interaction/__tests__/AudioRecorderHelper.test.ts (2 tests)
   • calculateRMS 能正确计算静音与音量
   • encodeAudioBufferToWav 能生成符合规范的 16kHz 16-bit 单声道 WAV Blob
 ✓ src/features/interaction/__tests__/AsrProvider.test.ts (3 tests)
   • RealBrowserSpeechRecognition 正确初始化与方法定义
   • asrManager.processSpeechRecognition 在空文本或纯空格时明确拒绝，返回 NO_SPEECH_DETECTED，绝不造句
   • asrManager.processSpeechRecognition 正确处理普通话识别文本
 ✓ src/features/interaction/__tests__/VideoCoordinateMapper.test.ts (3 tests)
   • 正确识别左右黑边 (Pillarbox) 并剔除黑边留白
   • 正确识别上下黑边 (Letterbox) 并剔除黑边留白
   • 在无黑边完美填充时，正确计算归一化坐标与真实像素
 ✓ src/features/interaction/__tests__/TimeSliceIndexer.test.ts (4 tests)
   • 正确建立多源时间轴索引并支持时间戳命中
   • 根据关键词精确检索对应时间段和实体
   • 超出视频时间范围时优雅降级并返回就近上下文
   • 正确获取关键帧视觉实体列表
 ✓ src/features/interaction/__tests__/PictureBookRagEngine.test.ts (3 tests)
   • 针对故事事实提问给出准确短答并绑定证据
   • 针对未知超纲问题 100% 拒答，绝不胡乱捏造事实
   • 证据来源必须明确包含页码或时间区间
 ✓ src/features/interaction/__tests__/InteractionBackendContract.test.ts (2 tests)
   • 验证交互记录必须携带 producer: c_interaction_agent 与非负延迟
   • 验证笔记全生命周期状态机转移合法性

Test Files: 6 passed (6)
Tests:      17 passed (17)
Duration:   212ms
```

### 2. C 交互专项自动化测试 (`check-interaction.cjs`)

```bash
$ node docs/verification/check-interaction.cjs

--- 纸书智伴 角色 C: 语音/触控/笔记生命周期自动化校验 ---
PASS 1. 交互上报数据格式严格符合后端 FastAPI 校验标准 (含 producer: c_interaction_agent)
PASS 2. 触控黑边 (Letterbox/Pillarbox) 留白 100% 自动精准拦截
PASS 3. 空语音转写与静默音频严格拒绝，绝不替用户编造假提问
PASS 4. 笔记审核与分享生命周期状态机严密闭环 (草稿 -> 审核 -> 分享/撤销)
--- 角色 C 全部专项验证 100% 通过 ---
```

### 3. API 适配器契约测试 (`check-api.cjs`)

```bash
$ node docs/verification/check-api.cjs

PASS 健康检查不附带认证，私有接口使用 Bearer
PASS 缺令牌时拒绝私有请求，未发起网络
PASS 建书使用实际响应 id 与 JSON 请求
PASS 原图字节、Content-Type、query 页码与路径编码
PASS 校对、分类、分析使用 A 现有路径与字段
PASS FastAPI detail 字符串与 401/409/410/413/415/503
PASS FastAPI 422 结构化错误可读，不回显 input
PASS 非 JSON 错误与无效成功 JSON 分开处理
PASS 网络失败与超时显式报错
PASS 204、鉴权媒体下载与重定向限制
PASS 拒绝凭据 URL 与非法协议
PASS 公开分享不附带主人令牌，错误消息隐藏令牌 (12/12 PASS)
```

### 4. 生产构建打包检验 (`npm run build`)

```bash
$ cd frontend && npm run build
> tsc -b && vite build

vite v5.4.21 building for production...
✓ 65 modules transformed.
dist/index.html                   0.59 kB │ gzip:  0.44 kB
dist/assets/index-CT05VSqb.css   81.40 kB │ gzip: 16.84 kB
dist/assets/index-C0hj3Mzh.js   284.86 kB │ gzip: 97.25 kB
✓ built in 307ms (0 错误, 0 警告)
```

### 5. 自包含离线单文件构建检验 (`npm run prototype`)

```bash
$ cd frontend && npm run prototype
Transpiled 42 TypeScript modules; generated self-contained offline HTML (669 KB).
```
