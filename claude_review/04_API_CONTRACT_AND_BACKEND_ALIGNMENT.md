# 04. 后端 A 真实接口契约与角色 C 对齐规范

## 一、接口基准规范

- **基准路径**：统一使用 `/api/...`（开发环境由 Vite 代理到 `http://127.0.0.1:8000`）；
- **认证机制**：除 `/health` 及公开分享链接 `/api/shared-notes/{token}` 之外，所有私有接口必须在 Header 中携带：
  ```http
  Authorization: Bearer <APP_USER_TOKENS>
  ```
- **真实性约束**：后端响应 HTTP 4xx/5xx 时，前端提取 `detail` 错误并向用户抛出真实错误提示，严禁静默视为成功。

---

## 二、角色 C 核心对接接口清单

### 1. 交互记录真实上报 (`POST /api/runs/{run_id}/interactions`)

- **请求方式**：`POST`
- **请求头**：`Content-Type: application/json`, `Authorization: Bearer <token>`
- **请求体（严格符合后端 FastAPI 校验模型）**：
  ```json
  {
    "interaction_type": "voice", // 必须为 "voice" 或 "touch"
    "input": {
      "query": "小狐狸戴着什么颜色的围巾？",
      "video_ms": 3500
    },
    "output": {
      "answer": "小狐狸戴着红色的围巾。",
      "evidence": [
        {
          "page_no": 1,
          "snippet": "小狐狸系好红围巾",
          "video_start_ms": 2000,
          "video_end_ms": 5000
        }
      ],
      "producer": "c_interaction_agent" // 必填非空，代表角色 C 智能体输出
    },
    "latency_ms": 280 // 必须为非负整数
  }
  ```
- **服务端响应 (201 Created)**：
  ```json
  {
    "id": "uuid-xxx",
    "run_id": "run-xxx",
    "status": "recorded_only"
  }
  ```

### 2. 交互记录拉取 (`GET /api/runs/{run_id}/interactions`)

- **功能**：拉取后端 SQLite 数据库中持久化存储的交互历史，实现跨终端/刷新后的真实回显。

### 3. 图书分类确认 (`PATCH /api/books/{book_id}/classification`)

- **请求体**：
  ```json
  {
    "confirmed_type": "picture_book" // 合法类型: picture_book / novel / textbook / science / other
  }
  ```
- **异常处理**：若后端返回失败（如未经逐页校对或图书不存在），前端捕获异常并在界面展示错误，`owner_confirmed` 保持 `false`。

### 4. 笔记生命周期与安全只读分享

| 操作 | 接口契约 | 规则约束 |
| :--- | :--- | :--- |
| **生成笔记草稿** | `POST /api/books/{id}/notes/generate` | 生成初始私密草稿 (`status: "DRAFT"`) |
| **笔记审核** | `POST /api/notes/{id}/review` | Body: `{"action": "approve" \| "revise"}`，批准后变为 `APPROVED` |
| **创建只读分享** | `POST /api/notes/{id}/shares` | 仅当状态为 `APPROVED` 时允许创建；未审核调用返回 409 Conflict |
| **撤销分享** | `DELETE /api/notes/{id}/shares/{share_id}` | 服务端立即使对应 Token 失效 |
| **公开查看** | `GET /api/shared-notes/{token}` | 免认证只读查看笔记快照；已撤销或过期返回 404/410 |
