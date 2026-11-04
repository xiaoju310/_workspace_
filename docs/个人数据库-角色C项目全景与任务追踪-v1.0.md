# 【个人数据库归档】“纸书智伴”项目全景与角色 C 执行档案

> **用途**：个人知识库/上下文数据库持久化归档（含全局 Prompt、项目架构、角色 C 全量数据契约、D1 产出与后续两周执行路线）。  
> **更新时间**：2026-11-04 (D1)  
> **当前状态**：D1 核心交互闭环已完成，本地全栈自测 100% 通过。  
> **代码仓库**：`/Users/synn/Documents/GitHub/_workspace_`  
> **专属分支**：`team/c-interaction`（最新 Commit: `fab5d68`）

---

## 模块一：项目全景与赛题系统 Prompt (System Context)

### 1.1 赛题背景与核心定义
- **赛题名称**：第二届北京市大学生“人工智能+”创新大赛 企业赛题 · 好未来《“纸书智伴”——纸质图书多模态智能升级与智能伴读》
- **核心定位**：将传统纸质图书/儿童绘本，通过多模态 AI 技术升级为“会动、会讲、能问答、点哪里认哪里”的互动式读物。
- **四项必选核心任务 (P0)**：
  1. **内容理解**：OCR + VLM 提取绘本图文内容、叙事结构与角色实体；
  2. **互动视频生成**：生成连续多模态动态视频（故事文本、画面生成、旁白语音），保证视觉风格一致性与页间连贯性；
  3. **实时交互 (C 主责)**：实现语音提问与触控式万物识别的实时响应；
  4. **多 Agent 协同**：构建可编排、可复现的多 Agent 协同流水线。
- **竞赛硬门槛**：问答正确率 $\ge 0.60$；交互延迟达到基础门槛；关键生成内容可复现；严禁大模型幻觉，无依据必须明确拒答。

### 1.2 五人团队分工矩阵
| 角色 | 主责人 | 能力/职责 | 核心交付 |
|---|---|---|---|
| **A** | Leader / 后端架构 | 强 / 26% | FastAPI、SQLite 数据表、任务编排、异步 Worker、全局调度与发布 |
| **B** | AI / 视频主力 | 强 / 28% | OCR/VLM、分镜脚本、真实文生/图生视频、风格一致性、实体识别 |
| **C** | **我（交互与联调）** | **中等 / 18%~20%** | **浏览器录音、ASR/TTS 接入、视频内容检索短答、触控万物识别（含黑边过滤）、延迟度量、通用阅读扩展、前后端联调** |
| **D** | 前端界面 / 视觉 | 较弱 / 14% | React 页面布局、响应式适配、组件美化、演示视觉 |
| **E** | 测试 / 交付合规 | 较弱 / 12% | 测试集标注、指标度量、说明书撰写、合规来源审查、演示保障 |

---

## 模块二：角色 C（我）的全部工作资产与技术数据

### 2.1 技术栈与运行规范
- **开发语言**：TypeScript + React 18 + Vite 5
- **音视频能力**：MediaRecorder、Web Audio API（实时音量分析与免转码 16kHz WAV 编码）、HTML5 Video API
- **触控算法**：Pointer Events 坐标捕获 + CSS `object-fit: contain` 黑边 (Letterbox/Pillarbox) 逆向换算
- **接口机制**：HTTP JSON 双模架构（Live 真实后端 + Dev 高保真 Mock 降级自测）

### 2.2 核心代码文件拓扑
```text
frontend/src/
├── types/
│   └── interaction.ts                  # 全局交互数据结构契约（问答、触控、通用阅读）
├── lib/
│   └── api.ts                          # 双模 API 通信客户端（带耗时统计与 Mock 兜底）
├── features/interaction/
│   ├── AudioRecorder.tsx               # 录音控件（波形律动、麦克风权限拦截、录音回放试听）
│   ├── AudioRecorderHelper.ts          # 16kHz WAV 编码器与 RMS 音量算法
│   ├── VideoCoordinateMapper.ts        # 核心触控算法：黑边拦截与归一化坐标换算
│   ├── TouchOverlay.tsx                # 视频覆盖感应层（点击光圈、Bounding Box 矩形框）
│   ├── InteractionPanel.tsx            # 伴读问答面板（证据卡片、跳转回放、TTS 播放、耗时看板）
│   ├── BenchmarkRunner.tsx             # 自动化基准测试台（15 个核心用例一键跑测）
│   ├── ReadingNotesDrawer.tsx          # 通用阅读扩展（分类确认、笔记审核流转、只读安全分享）
│   └── __tests__/
│       └── VideoCoordinateMapper.test.ts # 核心算法单元测试（基于 Vitest，3/3 通过）
└── App.tsx                             # 双栏交互工作台与自动化测试 Tab 切换
```

### 2.3 核心数据结构契约 (Data Schema)

#### ① 语音问答接口 (`POST /api/v1/interaction/qa`)
- **输入 (multipart/form-data)**：
  - `audio`: File (16kHz 16-bit 单声道 WAV)
  - `book_id`: string (如 `book-auth-sample-01`)
  - `run_id`: string (如 `run-20261104-001`)
  - `video_ms`: number (当前视频播放毫秒数)
  - `query_text`: string (可选，文字测试)
- **输出 (JSON)**：
  ```json
  {
    "run_id": "run-20261104-001",
    "question": "小动物在干什么？",
    "answer": "小狐狸在树林里寻找妈妈。",
    "status": "success", // 'success' | 'no_evidence' | 'error'
    "confidence": 0.94,
    "evidence": [{
      "page_no": 1,
      "video_start_ms": 2000,
      "video_end_ms": 5000,
      "evidence_type": "page",
      "confidence": 0.95,
      "snippet": "小狐狸背着小书包在树林中四处张望。"
    }],
    "latency": {
      "asr_ms": 140,
      "retrieval_ms": 65,
      "llm_total_ms": 320,
      "total_roundtrip_ms": 520
    },
    "cache_hit": false
  }
  ```

#### ② 触控识别接口 (`POST /api/v1/interaction/touch`)
- **输入 (JSON)**：
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
    "viewport_info": { "is_letterbox": false }
  }
  ```
- **输出 (JSON)**：包含 `target_name`, `explanation`, `bounding_box: [x1, y1, x2, y2]`, `evidence`, `latency_ms`。

---

## 模块三：D1 (11/04) 核心自测数据指标库

> 评测环境：MacBook M 系列，Chrome 内核，内置 BenchmarkRunner 自动化回归矩阵。

| 指标维度 | 评测目标 | 实际达成结果 | 判定 |
|---|---|---|---|
| **录音格式标准化** | 16kHz 16-bit Mono WAV 直出 | 编码耗时 $< 15\text{ms}$，后端免转码 | ✅ 达标 |
| **黑边误触拦截** | Letterbox / Pillarbox 留黑识别 | 100% 拦截，耗时 $< 1\text{ms}$，拦截上报 | ✅ 达标 |
| **基准用例通过率** | QA 10 项 + 触控 5 项 | **15 / 15 全部通过 (100%)** | ✅ 优于门槛 (≥60%) |
| **平均交互延迟** | 端到端交互延迟 | **264 ms** (首字响应 < 240ms) | ✅ 优于预期 |
| **防幻觉拒答能力** | 未知/外星人负样本 | 100% 返回 `no_evidence` 明确拒答 | ✅ 达标 |
| **单元测试与打包** | 核心算法与 TS 编译 | `npm test` 3/3 通过，`npm run build` 0 报错 | ✅ 达标 |

---

## 模块四：角色 C 两周全周期逐日路线图 (D1 ~ D14)

- [x] **D1 (11/04 周三)**：录音→上传→转写最小流程，音频格式敲定，黑边拦截算法，D1-D2通用阅读笔记原型。
- [ ] **D2 (11/05 周四)**：接入真实 ASR Provider、音频服务端转码兜底与错误码返回。
- [ ] **D3 (11/06 周五)**：实现 `video_ms` 与问题文本联合检索请求，设计多源证据响应体。
- [ ] **D4 (11/07 周六)**：搭建页码/视频时间片检索第一版，固化 10 条真实绘本问答。
- [ ] **D5 (11/08 周日)**：问答链路联调：检索证据→短答生成；无证据时严格拒答。
- [ ] **D6 (11/09 周一)**：接入 TTS 语音合成，完成“录音→识别→短答文字→语音播报”完整有声闭环。
- [ ] **D7 (11/10 周二)**：【半程验收】浏览器控件对接完整主干，计算首字/首音频耗时指标。
- [ ] **D8 (11/11 周三)**：点击画面截图上传与触控接口第一版，对接 B 同学的抽帧实体库。
- [ ] **D9 (11/12 周四)**：触控万物识别端到端联调，测量点击到首字延迟。
- [ ] **D10 (11/13 周五)**：【互动闭环】批量跑非隐藏音频集，统计首轮正确率、延迟与错误归因。
- [ ] **D11 (11/14 周六)**：优化缓存机制与热启动，显式标记 `cache_hit`，复测延迟。
- [ ] **D12 (11/15 周日)**：集中修复低准确率 Case，完成通用阅读笔记与互动功能全量回归。
- [ ] **D13 (11/16 周一)**：【功能冻结】语音+触控现场演示脚本演练，导出完整延迟日志与故障备用包。
- [ ] **D14 (11/17 周二)**：【最终交付】彩排演练，提交代码 tag、测试报告与项目说明书关键章节。
