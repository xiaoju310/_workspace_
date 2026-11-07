# 角色 C 第一周（D1~D7）代码深度复查与整改交付报告

- 编号：`[1107-纸书智伴-09B]` · 执行端：Claude Code
- 基线：`team/c-interaction` @ `d6ff74d`；本次改动**未提交**（工作区 24 个文件 + 1 个新测试文件）
- 行号说明：下表"原行号"均指 `d6ff74d` 中的位置，可用 `git show d6ff74d:<路径>` 复核

---

## 一、真实代码问题清单

### P0（数据错误 / 结论造假，验收直接不成立）

| # | 文件:原行号 | 缺陷机理 | 修复 |
|---|---|---|---|
| P0-1 | `frontend/src/App.tsx:179` + `metrics/LatencyMetricsDashboard.tsx:15,20,23,51,78-81` | 看板入口写死 `history={[]}`，**永远**走兜底分支：语音 320ms、触控 190ms、准确率 100%、"门槛状态：已达标"；阶段分解 120/65/110/140ms 是字面常数。看板上没有一个数字来自测量。 | 看板改为读当前模式会话的真实交互记录；真实/演示分开统计；无数据显示"暂无实测数据"；问答只显示"有依据回答 x/n"（不叫准确率）；触控未识别显示"未完成真实识别"；删除固定分解与"已达标"；会话读取失败如实提示。（E-022） |
| P0-2 | `app/WorkspaceApp.tsx:333` + `indexing/buildSlices.ts:25` | 先 `pages.filter(p=>p.confirmed)` 再按**过滤后下标**编页码。中间只要有一页未校对，后面所有证据页码前移一位，且挂到错误页的视频时间轴。多页检索的页码证据不可信。 | `buildSlicesFromBook` 接收全书，自行跳过未校对页，页码取 `server_page_no ?? 原始位置`。（E-021） |
| P0-3 | `BenchmarkRunner.tsx:366`、`:28/44/60/84/92/100` | 基准页写死"赛题达标门槛：已达标"；QA-05"草地上有几朵花"期望值是"小狐狸"（队长点名），QA-03 期望"找到了"原文没有，QA-08 期望"故事画面"与问题无关，QA-09/10 期望值是提问主语，任何回答都能命中。 | 按原书逐条重核期望值（QA-02 浆果 / 03 拥抱了妈妈 / 04 湛蓝 / 05 3朵 / 08 没有天黑 / 09 妈妈 / 10 安全提示）；删除"已达标"；平均延迟排除跳过项；页面与报告标注"Demo 夹具，非赛题验收"。 |

### P1（逻辑不严谨 / 边界失效）

| # | 文件:原行号 | 缺陷机理 | 修复 |
|---|---|---|---|
| P1-1 | `indexing/TimeSliceIndexer.ts:95` | **E-020 治标不治本**：上轮只把"到"移出单字停用表修好"捡到"，但"地/过/着/对/向/一/可/以/能/会/里"仍是停用字——"草地"、"过河"、"着火"、"向日葵"、"可爱"全被切碎。 | 改为先删多字疑问短语（为什么/是不是/什么/哪里…），只删语气词、代词、标点。（E-025） |
| P1-2 | `qa/PictureBookRagEngine.ts:12` | 安全正则 `从.*跳` 整句贪婪：把"小兔子从草地上跳过去了吗"判为危险；同时漏掉插座、陌生人、爬窗、下河、宾语前置的"药可以随便吃吗"。 | 改为 11 条"危险对象+危险动作"短跨度规则，正例 8 条 / 反例 4 条回归。 |
| P1-3 | `asr/AsrProvider.ts:174` | 停止超时只是放行 Promise，识别器仍在跑；下一次 `start()` 抛 InvalidStateError，被报成"未能启动"；超时本身没有错误码（吞掉原始原因）。 | 超时 `abort()`，新增 `TRANSCRIPTION_TIMEOUT` 错误码并有中文提示。 |
| P1-4 | `AudioRecorder.tsx:155-170` | 解码失败直接进 catch，`decodeCtx` 永不关闭（Chrome 同页 AudioContext 上限约 6 个，之后录音全挂）。 | `finally` 关闭；失败原因写进提示。 |
| P1-5 | `AudioRecorder.tsx:60-62` | 卸载只做 cleanup：录音器 `onstop` 仍会触发，在已卸载组件上 setState 并把录音交给已离开的页面；识别器不停，麦克风指示灯常亮。MediaRecorder 构造失败时同样不停识别器。 | 卸载时摘除回调、停录音器与识别器；catch 分支也停识别器；新增防重入（授权弹窗期间连点会申请两路麦克风）。 |
| P1-6 | `tts/TtsProvider.ts:41` | 只在 onstart/onerror 时 resolve；无中文语音包时浏览器两者都不触发，Promise 永远挂起，按钮卡在"播放中"。自己 cancel 引发的 interrupted 被当成失败。 | 5s 开始发音超时 → onError + `firstAudioMs:null`；interrupted/canceled 视为正常结束。 |
| P1-7 | `tts/TtsPlayerWidget.tsx` | 换答案/离开页面不停止朗读，旧答案继续念、首音延迟残留在新答案上；失败时按钮悄悄复位，用户不知道失败。 | 换答案与卸载时 stop；会话号防旧回调覆盖；失败显示"文字答案不受影响"。 |
| P1-8 | `pages/InteractiveReaderPage.tsx:123` | 从历史跳回视频时间：元数据未到时 `durationMs` 仍是 36s 占位值，50s 的证据被夹到 36s。 | 元数据就绪前挂起跳转，拿到真实时长后执行。 |
| P1-9 | `pages/InteractiveReaderPage.tsx:589` | 触控"重试"丢掉 `touch_point/viewport_info`（Live 直接报错）；提问"重试"的输入方式取自已重置的状态，语音被记成键盘。 | `lastAction` 保存完整请求并原样重放。 |
| P1-10 | `pages/InteractiveReaderPage.tsx:394` | 书页无图片时显示占位插画 `page-forest.svg`，Live 下仍可点击上报——坐标与这本书无关。 | 无真实书页图片时拒绝触控并提示。 |
| P1-11 | `lib/api.ts:188`（问答）及触控 output | 留痕载荷没有 `cache_hit`：界面显示"缓存命中"，后端查不到。队长回归项"缓存命中是否真的记录"无法验证。 | 问答、触控载荷都写 `cache_hit`；触控另写 `recognition: not_connected/model_service`。 |
| P1-12 | `app/WorkspaceApp.tsx:26` + `App.tsx` | Live/Demo 共用一个 sessionStorage key，切换模式不重建工作台，Demo 记录出现在 Live 历史里。 | key 按模式区分 + `<WorkspaceApp key={appMode}>`。浏览器实测：Demo 记录切回 Live 后不可见。（E-023） |
| P1-13 | `app/WorkspaceApp.tsx:192` | 未建档的书写死分类置信度 `.72` 和"根据排版与图文特征初步分类"，实际没有模型参与。审计 E04 正则要求 `0.` 开头且排除含 `demo` 的整行，所以没拦住。 | 置信度 null，理由如实；新增审计 E15。（E-024） |
| P1-14 | `VideoCoordinateMapper.ts:188` | CSS `transform: scale()` 下，屏幕尺寸的 rect 减去未缩放的 padding，内容区与黑边判定偏移。 | 按 `rect/offsetWidth` 求缩放比换算 border/padding；样式被改成非 `contain` 或非居中时拒绝（不悄悄算错）。 |

### P2（代码异味 / 小边界）

| # | 文件:原行号 | 问题 | 修复 |
|---|---|---|---|
| P2-1 | `VideoCoordinateMapper.ts:147` | 像素下标用 `round`，0.7px 落到像素 1。 | 改 `floor`。 |
| P2-2 | `AudioRecorderHelper.ts:111` | 空缓冲区 0/0 → NaN 写进音量与样式。 | 返回 0。 |
| P2-3 | `AudioRecorder.tsx:161,166` | 每录一次 `createObjectURL` 不释放。 | 替换时 revoke，卸载时 revoke。 |
| P2-4 | `TtsPlayerWidget.tsx` | 语速 `<option value="1.0">` 与状态 `1` 不相等，默认无选中项；"0.85"标成"0.8x"。 | 修正。 |
| P2-5 | `history/InteractionHistoryPanel.tsx:139` | 页级证据 `video_start_ms=0` 是占位，"跳转片段"会跳到 0 秒；`latency_ms=null` 显示"耗时 nullms"。 | 页级证据不显示跳转；null 显示"延迟未实测"。（此组件当前未被任何页面引用） |
| P2-6 | `InteractiveReaderPage.tsx` 字幕 | 无文字时显示一句励志文案，像是原书内容。 | 改为"（本页暂无校对文字）"。 |

---

## 二、队长复核意见对照分析

**为什么给队长"只完成了 E-017"的感觉：** E-018~E-020 在台账里写了，但落地是"表面修复"：

- **E-018（缓存键）**：键本身确实加了书 ID、索引指纹、当前页，测试也真能变红——这条是实的。但同一条检索链路上的页码错位（P0-2）让"指纹绑定"失去意义：缓存绑定的是一份页码本身就错的索引。
- **E-019（安全拦截）**：只做到"无证据也提醒"，规则本身是一条贪婪正则，误报和漏报都没测。
- **E-020（黄金集）**：只修了"到"一个字；黄金集 GS-17 的标签仍是贴着实现填的；基准页的期望值（QA-05"小狐狸"）完全没动——这正是队长举的例子。上轮报的"召回 61.5%"偏高。

**D1~D7 真实缺陷分布：** 问题不在"功能没写"，而在三类地方：

1. **展示层结论造假**（P0-1、P0-3、P1-13）：组件写了"有数据就求平均"，但入口写死空数组，没人看调用处；
2. **模块拼接处的契约错误**（P0-2、P1-8、P1-9）：每个函数单测都绿，拼起来就错；
3. **浏览器资源生命周期**（P1-3~P1-7）：Fake 对象测不到的路径——超时、卸载、解码失败、浏览器不触发事件。

**对队长清单的逐项回应：**

| 队长要求 | 本次状态 |
|---|---|
| 第 5 条：看板默认值 / 准确率 100% / 已达标 / 固定分解 | ✅ 已改，浏览器实测 |
| 第 4 条：用例预期答案重新对照原书（"几朵花"） | ✅ 已改（Demo 夹具范围内） |
| 第 8 条：cache_hit 记录、Demo/Live 混用、TTS 失败仍显示文字、历史回到正确时间 | ✅ 已改；Demo/Live 隔离仅手工浏览器验证 |
| 第 1、2、3 条：真实 ASR/TTS/视觉模型、真实语音/触控闭环 | ❌ 未完成——需要 A 提供接口或 B 提供模型服务，C 单方无法完成 |
| 第 4、7 条：授权真实绘本、真实音频、交给 E 的验收材料 | ❌ 未完成——没有授权素材 |
| 第 6 条：PR 描述 | ⏳ 未改 PR（本次未提交、未推送），建议文本见第四节 |

---

## 三、修复证据链

### 变异自检（撤回修复 → 对应测试必须变红）

```text
RED ✓ | E-021 页码错位        | Tests  3 failed | 148 passed | 2 skipped (153)
RED ✓ | E-025 停用字'地'      | Tests  2 failed | 149 passed | 2 skipped (153)
RED ✓ | E-022 看板兜底320     | Tests  1 failed | 150 passed | 2 skipped (153)
RED ✓ | D3 ASR 不 abort       | Tests  1 failed | 150 passed | 2 skipped (153)
RED ✓ | D6 TTS 无超时         | Tests  1 failed | 150 passed | 2 skipped (153)
RED ✓ | 留痕缺 cache_hit      | Tests  1 failed | 150 passed | 2 skipped (153)
RED ✓ | E-019 贪婪 从.*跳     | Tests  1 failed | 150 passed | 2 skipped (153)
RED ✓ | D2 像素 round         | Tests  1 failed | 150 passed | 2 skipped (153)   ← 第一次样例太弱没抓到，加强样例后变红
```

审计新规则对 `d6ff74d` 旧代码：E15 命中 1 处（`.72`），E16 命中 2 处（看板与基准页的"已达标 (≥60%)"）。

### 门禁过程中抓到的、我自己引入的问题

- E07 拦下了我新写的 `readSessionInteractions` 里的 `catch { return [] }`（读取失败会显示成"暂无数据"）→ 已改为返回错误原因并在看板显示；
- 新测试抓到安全规则漏判"药可以随便吃吗"（宾语前置）→ 已补规则。

### 实测指标变化（重新跑出，不是先定数）

- 黄金集（21 条，全部基于 Demo 小狐狸书）：召回 **8/15 = 53.3%**，精确率 8/8。上轮 61.5% 偏高来自 GS-17 错误标签；系统召回数（tp=8）没变。新增 GS-21"草地上开着什么颜色的花？"**如实失败**（5 个二元组只中"草地"，覆盖率 0.2 < 0.4），没有为过测试调阈值。
- 基准 10 条问答：期望值更正后，QA-03 转为通过（一直答对，旧期望值写错了），QA-05 转为已知缺口（抽取式只引 OCR 原文，数不出画面里的花）。

### 最终门禁全量输出（`bash .agent/skills/paper-companion-honesty/scripts/audit.sh`）

```text
✓ [E01] 默认/硬编码令牌
✓ [E02] run_id 回退成固定值
✓ [E03] 硬编码的耗时/延迟常数(应为实测或 null)
✓ [E04] 硬编码置信度(应透传引擎值或 null)
✓ [E05] 基准用例硬编码 passed: true
✓ [E06] 空 catch 吞错
✓ [E07] catch 后直接 return 空数组/false(吞错)
✓ [E08] Live 代码引用 Demo 夹具
✓ [E09] 出现故事专用硬编码答案
✓ [E10] origin 按模式冒充真实
✓ [E11] 测试里自己重写被测逻辑(应 import 生产代码)
✓ [E12] UI 书籍类型未映射就发给 A
✓ [E13] 验证脚本往页面写内容(会把结论伪造进截图)
✓ [E14] 前端自造 run_id 发给后端(只允许 Demo 分支)
✓ [E15] 三元表达式里写死置信度(E-024：本地导入写死 0.72)
✓ [E16] 界面写死"已达标"结论(E-022：看板/基准页无测量即宣称达标)
--- 类型检查 / 单测 / 构建 ---
 Test Files  13 passed | 1 skipped (14)
      Tests  151 passed | 2 skipped (153)
build ok
--- 离线原型：真实浏览器打开并确认渲染 ---
离线原型渲染通过（Google Chrome，阅读页已挂载，Demo 模式）
--- 真实后端联调：真实前端代码经 HTTP 打真实 FastAPI ---
      Tests  2 passed (2)
--- 真实浏览器 CDP 门禁：真实 Chrome 鼠标事件走完主流程与黑边拦截 ---
真实浏览器 CDP 门禁通过（Google Chrome，全流程+黑边拦截+留痕写入）
审计通过
```

说明：`npm test` 里 2 项跳过是 `liveBookFlow.live.test.ts`（需要真实后端），它们在门禁的"真实后端联调"一步真实运行并通过。黑板上写的"118 项全绿"不准确——当时是 116 通过 + 2 跳过。

### 浏览器人工核对（`vite preview` + 内置浏览器）

- Live 空会话看板：显示"暂无实测数据"、"未经正式测试，不是赛题验收结论"，没有任何数字；
- Demo 提问一次后看板：只出现"演示样本 · 演示数据（不代表实测）"，平均延迟显示"暂无实测数据 · 实测样本 0/1"（Demo 路径不计时，如实为空）；
- 切回 Live：该 Demo 记录不可见（模式隔离生效）。

---

## 四、三栏结论

**已验证**
- 上表 P0×3、P1×14、P2×6 的代码修复；8 项变异自检全部变红；audit.sh 全绿（16 条静态规则 + tsc + 151 单测 + 构建 + 离线原型 + 真实 FastAPI 联调 + CDP 真实 Chrome）；看板与模式隔离的浏览器人工核对。

**未验证**
- AudioRecorder 卸载/解码失败、TTS 换答案即停、阅读页"挂起跳转"与"重试重放"：代码已改，但没有 DOM 组件测试（项目未配 jsdom/testing-library），只靠类型检查与 CDP 主流程覆盖；
- 真实麦克风权限允许/拒绝、真实中文语音包缺失时的表现：未在真实设备上测；
- CSS transform 缩放下的坐标：只有纯函数单测，没有真实浏览器缩放场景。

**依赖他人（C 单方无法完成）**
- 真实 ASR / TTS / 视觉识别服务（A 接口或 B 模型服务）；触控目前仍返回 `target_name: ''`、`recognized: false`；
- 授权真实绘本与真实视频 `run_id`，以及据此建立的独立评测集与交给 E 的验收材料。

**PR 描述建议文本**

```text
当前完成：前端交互原型；Mock/Demo 模式；后端交互记录联调；坐标换算与黑边拦截；
         基于书页文字的抽取式检索与无依据拒答；基础单元测试与 CDP 浏览器门禁。
尚未完成：真实 ASR/TTS；真实视觉识别；真实视频端到端验证；授权素材批量评测；正式准确率与延迟统计。
Demo 夹具（单本示例书）上的检索召回为 8/15，不代表任意图书。
```

---

## 五、补充整改（复核后追加，提交于本节之后）

**更正：** 上文 P1-4/P1-5 修的 `AudioRecorder.tsx` 当时是没有任何页面引用的死代码；阅读页语音提问从不录音。队长清单"浏览器录音和 WAV 音频导出已完成"应理解为"组件已写，未接入主流程"。`InteractionHistoryPanel.tsx` 同样无人引用（历史页使用 `HistoryPage.tsx`），本次未改动它。

| # | 问题 | 修复 |
|---|---|---|
| E-026 | 录音组件未接入；`askQuestion` 音频参数固定 `undefined`；`audio_present` 永远 false；Live/Demo 都把提交的问题冒充为"语音转写" | 阅读页改用 `AudioRecorder`；录音随下一次提问提交；留痕写音频 sha256/大小/时长/格式、`storage: browser_only`、识别原文、识别错误码、`transcript_edited`；录音可保存给 E；识别失败不替用户造句 |
| E-027 | CDP 门禁宣称"留痕写入"但只看页面文字 | 门禁直接查后端 `/api/runs/{run_id}/interactions` 核验两条留痕 |
| — | 视频加载失败时挂起的跳转永不执行；进度条在元数据到达前仍截到 36 秒 | 失败时丢弃并提示；拖动同样挂起 |

**CDP 门禁新增步骤的真实输出：**

```text
✓ [PASS] 后端确有触控留痕 (run_id=4eaf5480-…, norm=(0.4977, 0.4992), recognition=not_connected)
✓ [PASS] 麦克风权限被拒绝：不进入录音，提示"麦克风权限被拒绝"
录音结果: {"info":"标准 WAV (16kHz, 78.8 KB)","hasAudio":true,"hasDownload":true,"question":"", ...}
✓ [PASS] 虚拟麦克风真实录音并编码为 16kHz WAV，可回放、可保存
✓ [PASS] 测试音未被识别出文字，问题框保持为空并如实提示（未编造问题）
后端问答留痕 input: {"query":"小狐狸收到了什么","input_method":"keyboard","audio_present":true,
  "audio":{"mime_type":"audio/wav","size_bytes":80684,"duration_ms":2530,"sha256":"3289810d…","storage":"browser_only"},
  "asr_provider":"browser_web_speech","asr_transcript":"","asr_error":"NO_SPEECH_DETECTED","transcript_edited":true}
✓ [PASS] 后端问答留痕带音频指纹、识别原文与 cache_hit
```

变异自检：把 `voice?.blob` 改回 `undefined` → CDP 失败（"问答留痕的音频/转写字段不符合预期"）。最终 `audit.sh`：155 单测通过 + 2 跳过、真实后端 2/2、CDP 通过、审计通过。

**仍未完成：** 虚拟麦克风输入是测试音，识别器没有可识别的人声——真人普通话、儿童口音/停顿的识别效果没有测过；音频没有上传到后端（A 无接口），也没有接入服务端 ASR；真实 TTS/视觉模型与授权素材仍依赖 A/B/E。
