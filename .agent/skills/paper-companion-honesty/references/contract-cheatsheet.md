# 与后端 A 的契约速查（以 docs/api-contract.md 与 /docs OpenAPI 为准，本表只是索引）

## 基础
- 路径统一 `/api/...`；私有接口 `Authorization: Bearer <APP_USER_TOKENS 中的令牌>`；没有"默认令牌"。
- 错误体 `{"detail": "..."}`（422 为数组）。统一经 `frontend/src/api/client.ts` 的 `createApiClient` 发请求（有超时、detail 解析、令牌脱敏）。
- 公开分享 `GET /api/shared-notes/{token}` 不带主人令牌。

## 交互留痕（C 负责）
`POST /api/runs/{run_id}/interactions`
- `interaction_type`: 只有 `voice` | `touch`（键盘提问也记 voice，用 `input.input_method` 区分）
- `output.producer` 必填非空（固定 `c_interaction_agent`）；`output` 不能为空；`latency_ms` 非负整数
- 违反 → 422。成功 201 `{id, run_id, status:"recorded_only"}`。
- 登记 ≠ 真实模型成功运行；不能用它冒充 Agent 推理。
`GET /api/runs/{run_id}/interactions`：读取失败必须报错，空数组只代表确实没有。

## 分类
必须先 `POST /api/books/{id}/classify`，否则确认返回 409。`PATCH /api/books/{id}/classification` body `{confirmed_type}`；枚举 **picture_book|novel|textbook|science|other**。
前端 UI 类型是 picture_book|fiction|nonfiction|unknown → 必须经 `toBackendBookType()` 映射（fiction→novel，nonfiction→other，unknown 拒绝）。

## 笔记与分享（服务端为准）
状态机：`DRAFT → REVIEWING → PRIVATE(approve) → SHARED → REVOKED`
- `POST /api/books/{id}/notes/generate` 需该书已完成真实分析（目前无真实 provider）；
- `POST /api/notes/{id}/review` action=`approve|revise`；缺来源引用不允许 approve；`revise` 后状态是 `REVIEWING`；已审核（PRIVATE/SHARED）的笔记 `PATCH` 返回 409；
- `POST /api/notes/{id}/shares` share_mode=`link|invite_only`，`invite_only` 需 `shared_user_id`；未审核 → 409；link 的明文 token **只在创建响应返回一次**；
- `DELETE /api/notes/{id}/shares/{share_id}` 撤销；撤销后访问 404/410。
- 本地 `review_status`(draft/in_review/approved/rejected) 只是 UI 视图，映射见 `lib/noteSync.ts: serverStatusToLocal`。

## 已知契约空白（需要问 A/B/D，不要自行假设）
1. A 没有 ASR 接口 → 无服务端语音识别兜底（Chrome Web Speech 在国内网络可能 `network` 失败）。
2. 没有视觉识别接口/模型 → 触控只能如实 `uncertain`。
3. 触控 `output` 里 `evidence` 的必填性与结构，A 的 schema 未明确（当前按 `[]`/`[{...}]` 发送）。
4. nonfiction 无法细分 textbook/science，目前归 other。
5. 导入已调用 `POST /api/books` + `classify`；书页和校对文字在"开始分析"时上传。分析服务未接入，后端必然返回 `PROVIDER_NOT_CONFIGURED`，因此笔记生成返回 409，界面走不到真实审核和分享。
6. interactions 路由在 `backend/app/main.py`。联调证据以 `scripts/check-live-flow.sh` 为准。
