# 完整流程与组件清单

v0.2 · 2026-11-04 · React + TypeScript + Vite / 原生 CSS

| 页面 / 模块 | 职责 | 输入与输出 |
|---|---|---|
| `WorkspaceShell` | 固定导航、当前页面、原型状态 | `Page`、`PreviewState`、`Navigate` |
| `HomePage` + `BookCard` / `BookCover` | 书架、类型、处理状态、最近笔记 | `ReadingBook[]` / `ReadingNote[]` |
| `ImportBookPage` | 书名、授权、页图、校验和排序 | `ImportedBookInput` → 父回调 |
| `ReviewPage` | 页序、OCR 编辑、revision、逐页确认 | `WorkflowProps` / `updateBook` |
| `ClassificationPage` | 预测、置信、理由、主人类型确认、适龄标签 | `WorkflowProps` / `onGenerate` |
| `ProgressPage` | 阶段、失败重试、run/job、日志、内容复核 | `JobState` / `setJob` |
| `InteractiveReaderPage` | 视频或模拟画面、字幕、文本问答、点击反馈 | `ReaderProps` / `Interaction` |
| `HistoryPage` | 提问/点击筛选、来源跳转、导出 | `HistoryProps` |
| `NoteReviewPage` | 编辑/预览、来源、主人审核 | `NotesProps` |
| `ShareNotePage` | 限时/指定用户、复制、撤销、结果 | `SharingProps` / `ShareGrant` |
| `SharedNotePage` | 只读快照、越权/过期/撤销拒绝 | `SharedProps` |
| `SettingsPage` | 手动 `/health` 检查、重置演示 | 服务 URL；不切换业务到真实模式 |
| `createApiClient` | HTTP 超时、错误、路径编码和既有端点 | 服务地址、JSON/FormData |
| `WorkspaceApp` | 会话状态、路由、模拟编排和页面回调 | `src/app/types.ts` 为共享契约 |

## 流程

首页 → 导入 → 逐页校对 → 分类确认 → 模拟生成（失败/重试）→ 内容复核 → 互动阅读 → 历史/来源跳转 → 笔记草稿 → 主人审核 → 分享设置 → 只读预览 → 撤销/过期。

每个业务页提供加载、空数据、成功和失败。页脚是演示状态入口；真实服务接入后由服务状态驱动。输入控件使用原生语义与可见焦点，错误使用 alert，异步反馈使用 status；减少动效偏好受支持。

## 版本与可见性

图书处理、分类主人确认、内容复核、笔记审核和可见性独立。笔记修改或原书内容/顺序变化使旧审核与分享失效，避免未经审核的新内容沿用旧链接。分享展示已审核版本快照；到期、撤销或模拟用户不匹配不渲染内容。

以上是本地模拟的前端行为，真实权限、身份、令牌、持久化和服务版本冲突由 A 实现。录音、音频与复杂互动由 C 接入。字段草案不代表 A/C 已冻结。

## 视觉与交付

暖白、森林绿、米绿；原创 SVG 插画；系统中文字体；桌面 1366、平板 1024、手机 390px。首页/上传高保真 SVG 沿用 D1 设计资产，新增分类、进度、阅读、历史、笔记、分享六张可编辑 SVG 桌面设计参考和 `full-flow.svg` 完整流程图。它们是矢量设计稿，运行行为以离线原型为准。Figma 云文件、Auto Layout 和交互连线仍需导入后整理。
