# 纸书智伴前端字段与 API 交接草案

版本：v0.1-draft · 2026-11-04（北京时间） · 提供方：D · 待审阅：A/C，分类内容由 B 配合

状态：**讨论草案，未冻结、未接真实服务**。D1 原型使用 `frontend/src/mock/` 中的本地数据，不执行以下网络请求。既有接口依据仓库 `docs/设计文档.md` v0.2；扩展字段、错误码与新增路径均是建议。

## 1. D1 的输入输出与边界

输入：书名、授权样本标识/来源说明、本次授权确认、JPG/PNG 页图及本地排列顺序、可选类型意向。

输出：本地缩略图、字段校验反馈、导入摘要、原型成功/失败状态。用户选中的文件不因为本地预览而上传或公开；示例封面及文字采用自制素材。

后续真实输入须由 A 校验并存储，上传授权声明不替代真实鉴权。D 不编写后端权限判定，不在前端假设“勾选即有权分享”。

## 2. 与既有 API 对齐

| 阶段 | 仓库已提出的接口 | 前端需要的输入 | 前端需要的输出 | 对接方/待确认 |
|---|---|---|---|---|
| 建书 | `POST /api/books` | `title`、`authorization_ref` | `book_id` | A；字段长度与授权错误格式待确认 |
| 页图上传 | `POST /api/books/{id}/pages` | multipart 图片、`page_no` | `page_id`、`sha256` | A；批量策略、限制、失败重传待确认 |
| 解析 | `POST /api/books/{id}/parse` | 无 | `job_id` | A/B；在建书和全部页图保存成功后调用 |
| 校对 | `PATCH /api/books/{id}/pages/{page_id}` | OCR/实体/事件修订、`revision` | 新 `revision` | A/B；409 冲突的当前版本内容待确认 |
| 发起生成 | `POST /api/books/{id}/runs` | `age_band`、`voice`、`model_profile` | `run_id`、`job_id` | A/B；可选值由后端提供 |
| 查询进度 | `GET /api/jobs/{id}` | 无 | `stage/status/progress/error_code` | A；进度单位、轮询频率待确认 |
| 读取结果 | `GET /api/runs/{id}` | 无 | 视频受控 URL、时间轴、复核状态 | A/B；URL 有效期、播放错误待确认 |

导入不作为一次不可拆分事务处理：前端保留 `book_id` 和每页的成功/失败状态，失败重试避免重复建书。幂等键、取消/清理未完成导入的方式由 A 确认，D1 原型不模拟出“服务端已经处理”。

## 3. 核心显示模型建议

以下 TypeScript 用于说明数据语义，不是已发布 SDK。命名由 A/C 审阅后统一。现有原型使用 `Book.id` / `NoteDraft.id` 和 `owner_confirmed` 简化字段；本节 `book_id` / `note_id`、版本、权限能力是服务端交接建议，需通过适配层映射。当前 mock 的低置信阈值 0.8 仅用于演示，实际策略由 A/B 提供。

```ts
type BookType = 'picture_book' | 'fiction' | 'nonfiction' | 'unknown';

type BookPipelineStatus =
  | 'UPLOADED'
  | 'PARSING'
  | 'REVIEW_REQUIRED'
  | 'GENERATING'
  | 'SAFETY_REVIEW'
  | 'READY'
  | 'FAILED';

interface BookSummary {
  book_id: string;
  title: string;
  authorization_ref: string;
  page_count: number;
  // 由后端提供受控资产 URL；不传任意本地磁盘路径。
  cover_url: string | null;
  status: BookPipelineStatus;
  classification: Classification | null;
  latest_note: NoteSummary | null;
  updated_at: string; // ISO 8601，含时区
  data_origin: 'mock' | 'real'; // 演示数据与真实产物清楚区分
}

interface Classification {
  classification_id: string;
  predicted_type: BookType;
  confidence: number | null; // 0..1；null 表示未提供
  low_confidence: boolean; // 由模型策略/后端计算，D 只展示
  reasons: string[];
  confirmed_type: BookType | null;
  confirmation_status: 'unconfirmed' | 'confirmed';
  revision: number;
}

interface NoteSummary {
  note_id: string;
  title: string;
  excerpt: string;
  review_status: 'draft' | 'in_review' | 'approved' | 'rejected';
  visibility: 'private' | 'shared';
  updated_at: string;
}
```

图书处理、分类确认、笔记审核和笔记可见性是独立维度。不可将其合并成一个笼统的 `status`，否则“草稿且私密”“审核通过但未分享”等状态无法表达。`data_origin` 为前端展示建议；真实 API 如使用其他来源字段，可在适配层转换。

## 4. 通用阅读新增端点建议

**本节全部待 A/C 确认，不要求其已存在。** 类别名、阈值、鉴权、版本冲突及权限由对应负责人定稿。首页原型不因这些端点尚未实现而阻塞。

| 建议路径 | 用途 | 输入/输出要点 |
|---|---|---|
| `GET /api/books` | 书架列表 | 分页、书名、类型、处理状态、最近笔记；排序与空集合行为待确认 |
| `GET /api/books/{id}/classification` | 获取预测分类 | 预测类型、0..1 置信度或空值、原因、低置信提示、确认状态、revision |
| `PATCH /api/books/{id}/classification` | 主人确认/修改类型 | `confirmed_type`、`revision`；返回新 revision 和确认状态 |
| `GET /api/books/{id}/notes` | 笔记列表 | 摘要、审核状态、可见性、更新时间；只返回可访问资源 |
| `GET /api/notes/{id}` | 结构化笔记详情 | 摘要、人物/概念、引用、审核状态、可见性、revision |
| `PATCH /api/notes/{id}` | 主人编辑草稿 | 内容、revision；修改已审核内容后是否退回待审由 A 明确 |
| `POST /api/notes/{id}/review` | 主人审核 | `decision`、revision；由后端验证主人身份及当前版本 |
| `POST /api/notes/{id}/shares` | 创建指定用户或限时链接分享 | 目标用户或到期时间；只有有效审核版本可创建 |
| `DELETE /api/notes/{id}/shares/{share_id}` | 撤销分享 | 后端撤销并返回最终状态；保留过期/撤销结果供 UI 展示 |
| `GET /api/shared-notes/{token}` | 只读访问 | 后端核验令牌/目标用户/有效期；不可返回主人编辑能力 |

D1 不接入账号系统或新增分享能力；本节用于避免后续页面缺少必要字段。分享只能暴露被许可的笔记内容和引用，原图/完整衍生内容是否可公开应由授权范围决定。

## 5. 笔记详情与来源引用建议

```ts
interface NoteDocument {
  note_id: string;
  book_id: string;
  run_id: string | null;
  title: string;
  summary: string;
  entities: Array<{
    kind: 'person' | 'concept';
    name: string;
    description: string;
    references: SourceReference[];
  }>;
  references: SourceReference[];
  review_status: 'draft' | 'in_review' | 'approved' | 'rejected';
  visibility: 'private' | 'shared';
  revision: number;
  reviewed_revision: number | null;
  // 权限能力由后端给出；前端不从 owner_id 猜测。
  capabilities: { can_edit: boolean; can_review: boolean; can_share: boolean };
}

interface SourceReference {
  source: 'original_page' | 'script' | 'video_frame';
  page_no: number;
  start_ms: number | null;
  end_ms: number | null;
  excerpt: string | null;
}
```

缺少来源时显示“来源待补充”，不生成虚假的页码/时间；真实分享的审核版本与内容版本必须一致，由后端拒绝过期审核。新笔记默认 `review_status=draft`、`visibility=private`。

## 6. C 的后续交互交接

| 功能 | D 提供的位置与显示状态 | C/A 提供的实际逻辑 |
|---|---|---|
| 录音 | 播放页伴读助手区域；空闲、录制中、提交中、失败、可重试 | MediaRecorder、权限、音频格式、上传和转写 |
| 点击识别 | 播放画面反馈卡片；加载、结果、低置信、无结果 | 黑边扣除、归一化坐标、当前帧/时间与请求 |
| 来源跳转 | 回答与笔记中的页码/时间引用按钮 | run_id 一致性、有效时间轴、资产访问权限 |
| 问答失败 | 可见错误和补救操作，不遮挡播放器 | 超时、无证据、服务错误与可重试性 |

既有提问与触控接口保持 `POST /api/runs/{id}/questions` 和 `POST /api/runs/{id}/touches`。D1 不实现复杂录音、坐标或权限判断。

## 7. 统一失败格式建议

```json
{
  "error": {
    "code": "UNSUPPORTED_FILE_TYPE",
    "message": "仅支持 JPG 或 PNG 页图，请重新选择。",
    "field": "pages",
    "retryable": false,
    "request_id": "example-request-001"
  }
}
```

上述格式和以下错误码是**建议**，最终以 A 的契约为准。

| 情况 | 建议 HTTP/错误码 | 前端处理 |
|---|---|---|
| 必填缺失/非法输入 | 422 / `VALIDATION_ERROR` | 定位字段，保留已输入信息 |
| 格式不支持 | 415 / `UNSUPPORTED_FILE_TYPE` | 说明 JPG/PNG 要求，允许换文件 |
| 单文件/整体过大 | 413 / `UPLOAD_TOO_LARGE` | 显示真实限制与失败文件 |
| 图片无法解码 | 422 / `INVALID_IMAGE` | 指出失败文件，建议重新导出 |
| 授权或身份不足 | 403 / `FORBIDDEN` | 展示后端提示，不绕过或只靠 UI 放行 |
| revision 已变化 | 409 / `REVISION_CONFLICT` | 提示刷新最新版本，不静默覆盖 |
| 服务暂不可用 | 503 / `SERVICE_UNAVAILABLE` | 明确失败和重试入口，避免永久加载 |
| 分享过期/已撤销 | 410 / `SHARE_UNAVAILABLE` | 显示只读失败页，不泄露内容 |

成功样例为 `POST /api/books` 返回 `{"book_id":"example-book-001"}`；示例 ID 不代表真实创建记录。D1 成功/失败用例通过本地 mock 验证；真实端点的 HTTP 行为仍为未测。

## 8. 待审阅清单

1. A：上传限制的配置来源、错误格式、批量上传与重试幂等、分页方式。
2. A/B：类型枚举、分类置信度含义、低置信策略、预测与主人确认的版本关系。
3. A/C：笔记结构、审核/分享权限能力、审核后编辑与撤销/过期行为。
4. A/B/C：书籍状态与 job stage/status 的对应关系；进度比例单位；来源证据字段。
5. A：个人任务书提到 D4、D6、D8 三个不同接入时间，统一实际联调日期。

这些是接口协作的待定项，不能写作已冻结或已获同意。D1 的首页与上传页本地高保真原型可以在这些端点实现之前完成并查看。

