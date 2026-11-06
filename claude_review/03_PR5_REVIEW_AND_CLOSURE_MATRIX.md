# 纸书智伴 · PR #5 队长审核意见整改说明（Claude 复审后修订版）

> 旧版把 5 项都写成"已闭环"，但源码复核后并不属实。本版按 **已验证 / 未验证 / 依赖他人** 如实记录。
> 另见 `docs/更正说明-2026-11-06.md`。证据命令：`bash .agent/skills/paper-companion-honesty/scripts/audit.sh`（审计规则 + tsc + vitest + build + 离线原型渲染 + 真实后端联调）。

| # | 队长意见 | 现状 | 已验证（文件 / 测试） | 未验证 / 依赖他人 |
|---|---|---|---|---|
| 1 | Live 失败不得编造答案/坐标 | **已整改**：Live 无内置故事；索引取自当前图书校对文字；无依据拒答；触控无视觉模型时只记录点击并返回 `uncertain`；写库失败带 `persisted=false` 并在界面展示；读取接口失败抛错 | `lib/api.ts`、`indexing/*`、`qa/*`；`InteractionApi.test.ts`（17）、`TimeSliceIndexer.test.ts`、`PictureBookRagEngine.test.ts`；变异自检 4/4 变红 | **没有视觉识别模型** → 认物功能不可用（如实 uncertain）。抽取式检索答不出同义词/时序语义问题，6 个基准用例登记为已知缺口 |
| 2 | ASR 必须识别真实录音，空转写不得造句 | **已整改**：zh-CN Web Speech；`onend` 复位 + 超时；错误码映射；置信度透传；阅读页经 `asrManager`；空转写返回 `NO_SPEECH_DETECTED` | `asr/AsrProvider.ts`；`AsrProvider.test.ts`（10，含挂起/超时/自行结束） | **未在真实浏览器验证**；Chrome 在国内网络可能 `network` 失败；A 没有 ASR 接口，**无服务端兜底**；16kHz WAV 目前未被任何服务消费 |
| 3 | 与 A 接口/认证对齐，分类失败不得显示已确认 | **已整改**：统一经 `api/client.ts`（Bearer、超时、detail 解析）；无默认令牌；分类经 `toBackendBookType`（修复 fiction/nonfiction 会 422）；失败抛错不确认；A 的令牌不发给第三方 | `InteractionApi.test.ts`（分类/留痕）、`check-api.cjs`（13） | 真实联调见 `scripts/check-live-flow.sh`；触控 `output.evidence` 的 schema 待 A 确认 |
| 4 | 笔记审核/分享不得只改内存 | **已整改**：先服务端后本地，失败本地不变；撤销失败不再显示成功；link token 缺失视为失败 | `lib/noteSync.ts`；`noteSync.test.ts`（6） | 导入已真实建档，但分析服务未接入，后端不允许生成笔记，界面走不到真实审核和分享（接口链路已由 `scripts/check-live-flow.sh` 验证）；`submit` 步骤 A 无接口 |
| 5 | 不写死 book/run，不用示例视频 | **部分整改**：`run-default` 回退已删除，缺 run_id 直接报错；证据索引来自当前书；时间轴来自 `GET /api/runs/{id}/segments` | `InteractionApi.test.ts`「缺 run_id」 | 视频成片播放与 `assets` 的联调未验证 |

## 触控黑边（维度 2）
`mapClickToContent` 纯函数：元数据未就绪/零尺寸/NaN 一律拒绝；像素夹到 `[0,size-1]`；扣 border/padding；静态书页同样处理；`touch_point/viewport_info` 从 reader 原样透传到 A（此前被丢弃并重算）。`VideoCoordinateMapper.test.ts`（7）。**未验证**：真机竖屏、缩放、CSS transform。

## 遗留清单
见 `.agent/skills/paper-companion-honesty/references/contract-cheatsheet.md`「已知契约空白」与 `docs/HANDOFF_TO_ANTIGRAVITY.md` §3。
