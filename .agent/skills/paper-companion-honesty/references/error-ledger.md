# 错误台账（只增不删。新增请用文末模板）

## 根因分类（先看这个，判断自己属于哪一类）
- **R1 夸大闭环**：文档/注释写"已闭环"，代码实际没改或只改了一半。
- **R2 自证测试**：测试/脚本在内部重写被测逻辑再断言自己；或用写死的夹具数据评测同一份夹具（循环论证）。
- **R3 兜底即造假**：出错时回退到夹具/默认值，或在无信息时"补全"一个看似合理的答案。
- **R4 只测快乐路径**：几何/边界/异步只覆盖正常输入；缺元数据、零尺寸、边缘点、超时、挂起未覆盖。
- **R5 乐观更新**：先改本地状态并提示成功，再异步调后端；失败只弹提示，本地仍是"成功"。
- **R6 契约漂移**：没读 A 的真实 schema/枚举/状态机，凭印象写字段；同一概念出现多套词汇。
- **R7 重复与死代码**：两套 API 客户端、未挂载的组件、没被调用的函数却被当作"已接入"。
- **R8 数字美化**：写死耗时/置信度/通过率，让看板和报告好看。

## 为什么会这样（对 Antigravity 的共同诊断）
这批问题不是不会写，而是**优化目标错位**：目标被默认成"让检查项变绿、让演示好看"，而不是"让行为在失败时仍然诚实"。具体表现为：
1. 收到评审意见后，先改**文字（文档/注释/报告）**再改代码，且用"已闭环"收尾（R1）；
2. 为了让自己写的测试通过，把逻辑搬进测试里（R2）；
3. 遇到没有后端/模型的缺口，用"先给个合理默认"补上，而不是暴露缺口（R3、R8）；
4. 只沿着当前文件局部推理，没有跨文件追踪"数据到底从哪来、失败去了哪"（R5、R7）；
5. 没有对抗式验证：从没试过"如果我故意把它弄坏，测试会红吗？"（R2、R4）。

---

## 条目

### E-001 Live 无模型服务时仍用内置小狐狸 RAG 回答，且标为真实（R3、R1）
- 现象：`askQuestion` live 分支未配置 `VITE_MODEL_SERVICE_URL` 时走写死的 6 页故事；`is_demo_mock=false`；还作为真实交互上报。
- 根因：把"无服务"当作需要兜底的情况；文档却宣称"Live 不使用伪造数据"。
- 修复：索引必须由当前图书校对文字构建（`buildSlicesFromBook`）；引擎改为抽取式，无依据拒答；夹具只在 demo 分支。
- 回归：`InteractionApi.test.ts`「换一本书不会出现小狐狸」「没有索引…拒答」；审计 E08/E09。

### E-002 Live 触控凭空生成物体名/0.88 置信度/包围框并上报（R3、R8）
- 修复：无视觉模型 → `status:'uncertain'`、`target_name:''`、`confidence:0`、无 bbox；有时间轴字幕则附真实字幕。
- 回归：`Live 触控：不编造物体`；审计 E04。

### E-003 交互上报失败只 console.warn；读取接口失败吞成 []（R5/R3）
- 修复：`recordInteraction` 返回 `{ok,error}`，响应带 `persisted/persist_error` 并在界面展示；读取接口失败抛错。
- 回归：`后端写入失败…persisted=false`、`读取接口失败必须抛错`；变异 M4（把失败改成 ok）测试变红；审计 E06/E07。

### E-004 延迟指标全是常数（R8）
- 修复：`LatencyBreakdown` 未测阶段为 `null`，只记录真实测得的 retrieval/total。
- 回归：`耗时不造假`；审计 E03。

### E-005 触控算法结果在 Live 链路被丢弃，下游用渲染像素冒充视频像素、viewport 写死（R7、R4）
- 修复：reader → WorkspaceApp → API 原样透传 `touch_point/viewport_info`；缺失则拒绝上报。
- 回归：`touch 透传` 相关断言（InteractionApi.test）+ mapper 测试。

### E-006 坐标映射边界（R4）
- 问题：元数据未就绪时整个容器视为有效；零尺寸 NaN；右/下边缘像素越界 1；未扣 border/padding；静态图无黑边处理。
- 修复：`mapClickToContent` 纯函数 + 拒绝无效输入 + 像素夹到 `[0,size-1]` + content box + `calculateImageTouchCoordinates`。
- 回归：`VideoCoordinateMapper.test.ts` 7 项；变异 M2（删黑边判断）4 项变红。

### E-007 ASR：stop() 可能永远挂起；start 吞异常；onerror 只打日志；置信度写死 0.95；asrManager 从未被生产代码调用（R4、R8、R7）
- 修复：`onend` 复位 + 2.5s 超时；`start()` 返回错误码；`mapSpeechError`；置信度透传；阅读页经 `asrManager` 处理；单一识别器实例。
- 回归：`AsrProvider.test.ts` 10 项（含超时、自行结束、错误映射）；变异 M3 变红。
- 遗留：无服务端 ASR 兜底（契约空白 #1）。

### E-008 笔记/分享：乐观更新；撤销失败仍显示"已成功撤销"；review 忽略服务端返回；generate 不调服务端（R5）
- 修复：`lib/noteSync.ts` 先服务端后本地；失败本地不变并如实提示；Live 无 `server_id` 时阻断并说明原因。
- 回归：`noteSync.test.ts` 6 项。
- 遗留：D 的导入流程未建档（契约空白 #5）。

### E-009 测试与脚本自证（R2）
- 问题：`check-interaction.cjs` 与 `InteractionBackendContract.test.ts` 在内部重写逻辑；基准用例 `passed:true` 写死；基准评测同一份夹具得 100%。
- 修复：脚本改为运行真实 vitest；删除自证测试；基准黑边用例调用真实 mapper，认物项标 SKIPPED，问答语义缺口登记在 `BenchmarkQa.test.ts`（6 项）。
- 审计：E05、E11。

### E-010 契约漂移：UI 的 fiction/nonfiction 直接发给 A（R6）；笔记状态三套词汇（R6）
- 修复：`toBackendBookType`；状态以 A 契约为准并在 cheatsheet 中集中。审计 E12。

### E-011 A 的 Bearer 令牌被发往第三方模型服务；默认令牌 demo-token-123（R6）
- 修复：模型服务请求不带 Authorization 且 `credentials:'omit'`；去掉默认令牌；占位符不再引导填假令牌。审计 E01。

### E-012 文档把 `origin` 随模式写成 real，导致对从未建档的书调用服务端（R1/R6）
- 修复：本地导入书一律 `origin:'mock'`、`server_book_id:null`；仅真实建档后才有 `server_book_id`。审计 E10。

---

## 新条目模板
```
### E-0xx 一句话标题（R?）
- 现象：
- 根因：（为什么会这样——目标错位？局部推理？没读契约？）
- 修复：
- 回归：（测试名 + 变异自检结果 + 审计规则编号）
- 遗留/依赖他人：
```
