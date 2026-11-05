# 纸书智伴 v0.1 API 契约（A / D1）

> 状态：第一天冻结的接口草案。D1 只实现 `/health` 和数据库初始化；下面的扩展接口由后续日期逐步实现。接口以 FastAPI `/docs` 的实际输出为准。

## 通用约定

- 基础地址：`http://127.0.0.1:8000`
- JSON 编码：UTF-8
- 每个业务对象使用字符串 ID。
- 错误格式：`{"detail": "可读的错误说明"}`。
- 只有使用者拥有图书或笔记时，才允许执行修改、审核和分享操作。
- 笔记初始状态为 `DRAFT`；只有主人审核通过后才能创建分享。
- `note_shares.token_hash` 只保存分享令牌哈希，不保存明文令牌。

## D1 已实现

### `GET /health`

用途：检查 API 是否启动。

成功响应：

```json
{
  "status": "ok",
  "service": "paper-companion-api",
  "version": "0.1.0"
}
```

## 后续接口冻结草案

### 图书与分类

#### `POST /api/books`

创建图书。请求字段：`title`、`authorization_ref`。

响应字段：`id`、`title`、`created_at`。

#### `POST /api/books/{book_id}/classify`

自动识别图书类型。可选字段：`requested_type`、`force_reclassify`。

响应字段：`book_id`、`predicted_type`、`confidence`、`reasons`、`status`。

#### `PATCH /api/books/{book_id}/classification`

主人确认或修改类型。请求字段：`confirmed_type`。

响应字段：`book_id`、`confirmed_type`、`confirmed_by`、`status`。

### 分析与笔记

#### `POST /api/books/{book_id}/analyze`

请求字段：`analysis_profile`。响应字段：`job_id`、`status`。

#### `POST /api/books/{book_id}/notes/generate`

请求字段：`note_template`。响应字段：`note_id`、`status`。

#### `GET /api/notes/{note_id}`

返回结构化笔记、来源页码/章节、状态和版本。

#### `PATCH /api/notes/{note_id}`

主人编辑笔记草稿或修订版本。

#### `POST /api/notes/{note_id}/review`

请求字段：`action`，取 `approve` 或 `revise`。`approve` 后状态变为 `PRIVATE`。

### 分享

#### `POST /api/notes/{note_id}/shares`

请求字段：`share_mode`（`invite_only` 或 `link`）、可选 `shared_user_id`、`expires_at`。未审核笔记返回 `409`。

#### `DELETE /api/notes/{note_id}/shares/{share_id}`

撤销分享；撤销后访问返回 `410` 或 `404`。

#### `GET /api/shared-notes/{token}`

只读访问已授权且未过期的笔记分享。

## 业务状态

```text
图书：IMPORTED → CLASSIFIED → CONFIRMED → ANALYZED
笔记：DRAFT → REVIEWING → PRIVATE → SHARED → REVOKED
任务：QUEUED → RUNNING → SUCCEEDED / FAILED / RETRYING
```

## D1 交接

- A → C/D：提供本文件和 `/docs` 地址。
- A → B：约定分析输出字段：`book_id`、`book_type`、`page_no`、`confidence`、`sources`、`model_version`、`status`。
- A → E：提供业务状态、错误码和 D1 验收项。

## 当前实现补充（2026-11-03，本地原型）

下列内容以 `/docs` 的实际 OpenAPI 为准，不代表真实 AI 模型已经接入。

- 私有接口统一使用 `Authorization: Bearer <令牌>`；本地令牌在 `APP_USER_TOKENS` JSON 中配置，未配置时返回 503。令牌和真实用户数据不要提交到仓库。
- `POST /api/books/{book_id}/pages?page_no=1`：请求体为图片原始字节，`Content-Type: image/png` 或 `image/jpeg`。校验文件头、10MB 上限；成功 201，重复页码 409，不支持的格式 415。
- `GET /api/books/{book_id}/pages`：按页码排序；`GET /api/books/{book_id}`：图书信息。
- `GET /api/books/{book_id}/runs`、`GET /api/runs/{run_id}`、`GET /api/runs/{run_id}/jobs`、`GET /api/jobs/{job_id}`、`POST /api/jobs/{job_id}/retry`、`GET /api/runs/{run_id}/history`、`GET /api/runs/{run_id}/progress`、`GET /api/runs/{run_id}/metrics`：本地运行与状态查询。当前没有真实分析 provider，分析任务会以 `PROVIDER_NOT_CONFIGURED` 失败；重试最多 3 次。
- 分类目前使用标题关键词，低置信时须人工确认；不能宣称 AI 分类准确率达标。
- 笔记生成需图书已完成真实分析。草稿默认占位，缺来源引用或仍标记为占位时不允许审核通过。审核之后才可分享。
- 链接分享的原始 token 只在创建响应返回一次；数据库存 SHA-256。过期与撤销后拒绝访问。当前仅是本地演示授权，不应公开部署。


- `PATCH /api/books/{book_id}/pages/{page_no}/revision` 与 `GET .../revisions`：主人手工校对 OCR/视觉 JSON 并保留修订号；这不是自动模型解析。
- `POST /api/runs/{run_id}/assets` 与 `GET .../assets`：只登记 `data/runs/<run_id>/` 中已存在的 MP4/MP3/WAV/VTT 产物及哈希，不执行生成；不返回任意本地文件路径。
- `GET /api/notes/{note_id}/shares`：主人查看分享元数据，不返回链接明文令牌。
- `GET /api/notes/{note_id}/shares/{share_id}/view`：仅被邀请且已配置本地登录令牌的用户只读查看；分享被撤销或过期后拒绝。

## A 后端扩展接口（2026-11-03）

下列 API 仅建立交接与数据追溯能力，登记数据不等于真实模型已成功运行。均需本地 Bearer 身份且仅图书主人可访问：

| 接口 | 用途 | 失败条件示例 |
|---|---|---|
| `POST/GET /api/runs/{run_id}/segments` | B 登记/查看时间轴，字段 `page_no,start_ms,end_ms,caption,source`；`source.producer` 必填 | 时间倒置、页码不属于图书或缺来源返回 422 |
| `POST/GET /api/runs/{run_id}/interactions` | C 记录/查看触控或语音事件；`interaction_type` 为 `touch`/`voice`，`output.producer` 必填 | 空输出或负延迟返回 422 |
| `POST/GET /api/runs/{run_id}/logs` | 只登记白名单事件与简短标量指标，不接收原文、密钥、prompt | 事件/字段未列入白名单返回 422 |
| `GET /api/runs/{run_id}/metrics.csv` | 本地测试指标导出 | 非主人返回 404；不代表官方评测适配 |
| `GET /api/runs/{run_id}/assets/{asset_id}/content` | 主人下载已登记文件，访问前验证 SHA-256 | 跨 run 404、文件被篡改 409 |

产物登记 `POST /api/runs/{run_id}/assets` 现在只允许位于 `DATA_ROOT/runs/<run_id>/` 的文件，不能登记其他运行或用户的文件。路径为服务端本地绝对路径，不要传客户端设备路径。当前使用分块 SHA-256 校验完整性，尚未做分块下载和并发文件写入锁。分享链接 token 放在 URL 路径中，有被代理/服务器访问日志记录的风险；只可用于本机演示，公开部署前需改造认证和日志策略。

A → B：在自己的生产者完成真实媒体生成后将文件放到指定 run 目录，再登记产物和来源页码时间轴；提供真实模型版本、输入哈希、失败码和成功样例。A → C：按交互 schema 发送触控/语音结果及来源，不能用登记接口冒充 Agent 推理。A → D：以 `/docs` 为准，页面上传发原始图片字节而非表单。A → E：`metrics.csv` 仅为本地运行汇总，不含正确率官方字段；需拿到官方评测 schema 再另行适配。

注意：运行日志的 `safe_metadata` 只接收 `page_no/elapsed_ms/attempt` 非负整数，以及白名单 `error_code/stage`，其余文本被拒绝；不要把用户原文、令牌或提示词放在日志中。产物 SHA-256 已改为分块计算，但并发文件修改仍需部署时的只读文件权限和锁来保障。
