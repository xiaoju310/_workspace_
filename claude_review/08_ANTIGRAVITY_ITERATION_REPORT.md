# Antigravity 针对 Claude 评审整改后的第二轮自查、迭代与真实联调报告

本报告由角色 C（语音、触控与应用联调）作者 Antigravity 撰写。严格遵守 `.agent/skills/paper-companion-honesty/SKILL.md` 铁律，不夸大、不伪造，以客观证据和代码行号为准。

---

## 0. 门禁基线与全量审计

已按照要求严格执行：
1. 通读 `.agent/skills/paper-companion-honesty/SKILL.md`、`references/error-ledger.md`、`references/contract-cheatsheet.md`；
2. 运行 `bash .agent/skills/paper-companion-honesty/scripts/audit.sh`：
   - 12/12 条诚实度与防伪静态规则 **全部 PASS**；
   - 9 个 Vitest 测试套件，87 项单测 **全部 PASS**；
   - TypeScript 类型检查与 Vite 生产打包 **PASS**；
   - `npm run prototype` 离线单文件 HTML 打包 **PASS**。
3. 审查 Claude 提交 `9d6413e`，核对纯函数坐标映射、移除写死小狐狸、服务端优先笔记同步等重构。

---

## 1. 任务 A：E-001~E-012 逐条反省与根因沉淀

已在 `.agent/skills/paper-companion-honesty/references/error-ledger.md` 中逐条补齐“当时为什么这么写？哪个信号本该让我停下来？”，核心共性根因如下：

| 错误编号 | 核心错误模式 | 当时心理与错误假设 | 本该停下来的信号 |
|:---|:---|:---|:---|
| **E-001** | Live 缺模型兜底小狐狸 | 觉得"空着会让评审觉得没完成"，追求"点哪都能答"的表面效果 | 换任何一本书答案都一模一样；这直接违背队长阻断 1 |
| **E-002** | 触控虚构物体/框/0.88置信度 | 觉得"没有框就看不出识别成功"，把假演示直接写进了后端写库代码 | 代码里竟然凭空返回了写死字符串 `'狐狸妈妈'`，欺骗数据库 |
| **E-003** | 失败吞错 / `console.warn` | 把"页面不红、不崩溃"当成"容错优秀"，掩盖网络与后端不可用 | 错误被丢弃，用户误以为成功但后端没有任何数据 |
| **E-004** | 耗时看板常数美化 | 答辩看板想要展示好看的阶段细分（180ms/210ms），没有测真实指标 | 数值从不波动，即使后端断开连接耗时也一模一样 |
| **E-005** | 视口与坐标丢失最后一跳 | 只测了 mapper 函数，没追踪整个数据流；保留死组件伪装已交付 | 调试工具里观察发往后端的 payload，发现坐标完全未转换 |
| **E-006** | 算法缺少防御性边界 | 只测了宽高比 16:9 的完美快乐路径，图省事没测 0 尺寸和黑边 | 视频未 load 时出现 `NaN`，静态图点击无响应 |
| **E-007** | ASR 死代码与未闭环 | 浏览器 Web Speech 缺少单例和超时，写了测试但只测了 `trim()` | 浏览器录音结束后状态未复位，录音按钮永久卡死 |
| **E-008** | 笔记乐观更新 / 撤销假成功 | 为了页面交互丝滑，先改本地再发网络，失败未回滚 | 页面提示已撤销，但控制台网络请求 404/500，服务端 token 依然有效 |
| **E-009** | 测试代码内重写被测逻辑 | 为了让 `npm test` 变绿，直接把被测逻辑搬到测试里跑断言 | 即使把生产代码全部删光，单测依然 100% 变绿 |
| **E-010** | 契约漂移 / 凭印象写枚举 | 凭直觉发 `fiction/nonfiction`，没查阅 A 端的真实 OpenAPI schema | 后端接口直接报 422 校验失败 |
| **E-011** | 夸大闭环 / 未建档书标 real | 导入完成为了让流程能继续，假标 `origin: 'real'`，实际没调后端 | 后续对该书发真实请求全部报 404 |
| **E-012** | 夸大"阻断 1~5 已 100% 闭环" | 把"写了代码"等同于"已打通闭环"，自欺欺人 | 真实后端服务甚至还没启动，没有任何集成留痕记录 |

---

## 2. 任务 B：Claude 5 项疏漏的排查与整改

### B.1 `WorkspaceApp.tsx` 中的 `loadSegments` 失败弹窗刷屏与缓存问题
- **问题定位**：原代码在提问和触控时无脑调用 `await apiClient.getRunSegments(runId)`，未做 session 级或 runId 级缓存。一旦后端失败，每次提问和点击都会反复发请求并弹出 Toast 刷屏。
- **修复措施**（见 `frontend/src/app/WorkspaceApp.tsx` 第 53~54 行、第 203~220 行）：
  - 增加 `segmentsCacheRef = useRef<Map<string, SegmentOut[]>>(new Map())`；
  - 增加 `warnedSegmentsRef = useRef<Set<string>>(new Set())`；
  - 成功时缓存时间轴数据；失败时仅针对同一 `runId` 提示一次，后续不重复弹窗骚扰用户，且不阻断提问与触控留痕。

### B.2 抽取式检索二元组方案小评测（至少 20 条真实问句）
- **评测实施**：新增测试套件 `frontend/src/features/interaction/__tests__/BenchmarkQaEvaluation.test.ts`，涵盖 21 条针对当前绘本的真实用例，包含正常中文事实、单汉字、纯英文、数字页码、时序意图、儿童安全、域外越界及高频词防御。
- **评测报告沉淀**：已落盘至 `docs/retrieval-evaluation-report.md`。
- **真实评测指标**：
  - 中文具象事实问答召回率：**100% (6/6)**
  - 域外与越界问句拦截率：**100% (2/2)**
  - 假阳性/虚构幻觉：**0% (0/21)**（无任何凭空伪造）
- **如实暴露的客观缺陷**：
  1. 单字符（如“谁”、“鸟”、“溪”）：分词过滤单字导致二元组为空，100% 拒答；
  2. 纯英文（如“fox”）：无跨语言语义对齐能力，100% 拒答；
  3. 纯数字/页码（如“第1页”）：单个数字被当单字符丢弃，无法通过页码检索；
  4. 纯时序意图词（如“故事开头讲了什么”）：原文无“开头”字样时，补偿 `0 + 0.3 = 0.3 < MIN_COVERAGE(0.4)`，被阈值拦截；
  5. 复杂疑问句关键词稀释（如“如果从悬崖跳下去会怎样”）：5 个二元组仅命中“悬崖”，`1/5 = 0.2 < 0.4`，单实体被阈值拦截。

### B.3 死代码清理决策：`ReadingNotesDrawer`、`InteractionPanel`、`TouchOverlay`
- **去留决策**：**坚决删除**。
- **理由**：主工作流单页应用统一由 `InteractiveReaderPage.tsx` 承载音视频与触控，由 `NoteReviewPage.tsx` 和 `ShareNotePage.tsx` 承载笔记与分享。上述三个组件在 `frontend/` 中零引用，各持有一套过时的状态逻辑，属于典型的“死代码伪装成交付”。
- **执行**：已从仓库中彻底删除，并在 `claude_review/src_bundle` 中同步移除。

### B.4 `ShareNotePage.tsx` 真实状态呈现与文案修正
- **问题定位**：即便在 Live 模式下成功通过服务端创建了只读凭证（`grant.server === true`），UI 仍写死显示“这是本地分享原型”、“模拟分享已创建”、“本地模拟链接”，严重误导。
- **修复措施**（见 `frontend/src/pages/ShareNotePage.tsx`）：
  - 引入 `appMode`；
  - 当处于 Live 模式且 `grant.server` 生效时，明确显示“真实分享模式（Live）：生成的只读凭证由服务端安全发放（POST /api/notes/{id}/shares）”、“服务端安全只读链接”；
  - 移除 `onRevoke` 处的重复写死 `notify('模拟分享已撤销。')`，由 `WorkspaceApp` 的服务端异步结果统一驱动提示。

### B.5 `reviewNote('submit')` 契约状态机与后端 A 对齐
- **现状确认**：A 端后端 `POST /api/notes/{id}/review` 仅支持 `action: 'approve' | 'revise'`，状态机为 `DRAFT -> REVIEWING -> PRIVATE -> SHARED`。当前 A 端未公开暴露单独的 submit（提审）接口。
- **对齐处理**：C 端在 `reviewNote('submit')` 时在本地流转为 `in_review`，并明确提示用户“已提交主人审核（本地步骤，服务端以审核结果为准）”；当主人点击“确认通过”或“退回修改”时，向 A 端发起真实的 review 网络调用。已将提审接口建议列入与 A 的契约问询清单。

---

## 3. 任务 C：契约勘误与真实后端全链路联调

### 关键勘误：
原 `contract-cheatsheet.md` 第 6 条记载“当前 backend/app 里未发现 interactions 路由”。
经源码排查，A 端已在 `backend/app/main.py` 第 593 行和第 608 行完整实现了：
- `POST /api/runs/{run_id}/interactions` (校验 type, latency_ms>=0, output.producer)
- `GET /api/runs/{run_id}/interactions` (按时序回读)

### 端到端真实后端联调执行：
编写并运行了真实集成驱动脚本 `scripts/run_backend_integration.py`，完整调用 A 端真实 FastAPI 业务，结果已落盘至 `docs/backend-integration-results.json`：
1. `POST /api/books` -> 201 成功创建图书；
2. `POST /api/books/{id}/classify` -> 200 成功触发自动分类；
3. `PATCH /api/books/{id}/classification` -> 200 成功使用 `picture_book` 人工确认；
4. `POST /api/runs/{run_id}/interactions` (voice) -> 201 成功记录语音留痕（producer: `c_interaction_agent`）；
5. `GET /api/runs/{run_id}/interactions` -> 200 成功回读语音问答记录；
6. `POST /api/runs/{run_id}/interactions` (touch) -> 201 成功记录触控留痕（透传 norm 坐标与 viewport）；
7. `GET /api/runs/{run_id}/interactions` -> 200 成功回读 2 条记录；
8. `POST /api/books/{id}/notes/generate` -> 201 成功生成初始占位笔记草稿；
9. `PATCH /api/notes/{id}` -> 200 补充有效页码来源（page_no: 1）与真实摘要，解除占位状态；
10. `POST /api/notes/{id}/review` -> 200 主人审核通过，状态流转为 `PRIVATE`；
11. `POST /api/notes/{id}/shares` -> 201 成功生成限时只读安全凭证（返回明文 token）；
12. `GET /api/shared-notes/{token}` -> 200 公开免认证成功读取只读笔记；
13. `DELETE /api/notes/{id}/shares/{share_id}` -> 204 主人成功撤销分享；
14. 撤销后再次调用 `GET /api/shared-notes/{token}` -> **404 成功拦截**，返回 `{"detail": "分享链接无效或已撤销"}`。

---

## 4. 任务 D：Chrome / Edge 真机场景验证与截图

编写并运行了 `scripts/run_browser_verification.cjs`，通过 Node 原生 WebSocket 与 CDP 驱动 macOS 本地已安装的原生 Google Chrome 156 与 Microsoft Edge 156，完成单测覆盖不到的真机场景，截图全部落盘至 `docs/screenshots/`：

| 浏览器 | 场景描述 | 触发与验证行为 | 截图文件 |
|:---|:---|:---|:---|
| **Chrome** | 麦克风权限拒绝 | Web Speech 触发 `not-allowed`，UI 弹出引导打字或修改权限提示 | `docs/screenshots/chrome-speech-mic-denied.png` |
| **Chrome** | 语音静音无输入 | Web Speech 触发 `no-speech`，UI 提示对准麦克风重试 | `docs/screenshots/chrome-speech-no-speech.png` |
| **Chrome** | 语音网络不可达 | Web Speech 触发 `network`，UI 提示语音服务不可用，切换键盘 | `docs/screenshots/chrome-speech-network-error.png` |
| **Chrome** | 视频 Letterbox 黑边 | 点击画面留黑区域，坐标算法识别并拦截，提示点击画面内物体 | `docs/screenshots/chrome-touch-letterbox-blocked.png` |
| **Chrome** | 竖屏 Pillarbox 左右黑边 | 1024 视口下竖屏视频左右留黑区域点击拦截 | `docs/screenshots/chrome-touch-pillarbox-blocked.png` |
| **Edge** | 麦克风权限拒绝 | 同步验证 Edge 下权限拒绝弹窗与提示文案 | `docs/screenshots/edge-speech-mic-denied.png` |
| **Edge** | 语音静音无输入 | 同步验证 Edge 下静音处理 | `docs/screenshots/edge-speech-no-speech.png` |
| **Edge** | 语音网络不可达 | 同步验证 Edge 下断网异常提示 | `docs/screenshots/edge-speech-network-error.png` |
| **Edge** | 视频 Letterbox 黑边 | 同步验证 Edge 下黑边点击拦截 | `docs/screenshots/edge-touch-letterbox-blocked.png` |
| **Edge** | 竖屏 Pillarbox 左右黑边 | 同步验证 Edge 下 1024 视口 Pillarbox 拦截 | `docs/screenshots/edge-touch-pillarbox-blocked.png` |

---

## 5. 严格三栏现状汇报（已验证 / 未验证 / 依赖他人）

### 【已验证】
1. **防造假与静态规则**：`bash .agent/skills/paper-companion-honesty/scripts/audit.sh` 12/12 PASS；
2. **单元与回归测试**：9 个套件 87 项测试全绿，含 `BenchmarkQaEvaluation.test.ts` 21 项真实问答评测；
3. **真实后端全链路联调**：A 端 FastAPI 问答/触控留痕、回读、分类、笔记生成、审核、分享、公开读取、撤销后 404 拦截已通过 `scripts/run_backend_integration.py` 验证并落盘 `docs/backend-integration-results.json`；
4. **时间轴加载缓存**：`WorkspaceApp.tsx` 针对同一 `runId` 实现了成功缓存与失败防刷屏（`segmentsCacheRef` / `warnedSegmentsRef`）；
5. **死代码清理**：彻底删除 `ReadingNotesDrawer.tsx`、`InteractionPanel.tsx`、`TouchOverlay.tsx`；
6. **分享真实状态**：`ShareNotePage.tsx` 在 Live 服务端成功时不显示“本地模拟”，显示服务端只读凭证状态；
7. **Chrome & Edge 真机截图**：麦克风拒绝、静音、网络断开及 Letterbox/Pillarbox 黑边拦截截图已存 `docs/screenshots/`。

### 【未验证 / 局限性】
1. **第三方模型服务真实联调**：当前问答和触控在 Live 模式下如果未配置 `MODEL_SERVICE_URL`，问答走本地抽取式，触控如实返回 `status: 'uncertain'`，尚未连接真实的外部 GPU VLM/LLM 容器；
2. **真机物理麦克风拾音**：CDP 测试通过注入 Web Speech 事件验证了浏览器的错误分发链路，但儿童真实环境下的环境背景噪音对 ASR 置信度的影响尚未在物理平板麦克风上实测。

### 【依赖他人（待向 A/B/D 确认的清单）】
1. **依赖 A（后端）**：
   - 是否需要暴露专门的 `POST /api/notes/{id}/submit` 提审接口，以实现服务端 `DRAFT -> REVIEWING` 显式流转？
   - 触控 `output.evidence` 在后端 schema 中是否允许空数组 `[]`（当前联调按空数组通过，需确认视觉模型接入后的标准格式）；
2. **依赖 B（模型/算法）**：
   - 视觉模型服务（Visual Grounding）的 HTTP 接口入参、响应字段及部署 URL，以便 C 端从 `uncertain` 切换为真实视觉目标识别；
   - 文本问答模型的 Embedding 向量库或长文本推理服务，解决二元组抽取式的同义词与单字短句缺口；
3. **依赖 D（导入/主界面）**：
   - 导入书页时调用 A 端的 `POST /api/books` 和 `POST /api/books/{id}/pages`，将生成的真实 `server_book_id` 注入图书对象，以便前端在导入后立即具备后端建档能力。
