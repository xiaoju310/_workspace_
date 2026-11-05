# Leader 三项建议落实记录

日期：2026-11-05（北京时间）

1. **同步与构建**：已 fetch origin，并确认最新 `origin/main`（`89f97a4`）已在当前 `team/d-frontend` 的祖先中。前次 `.gitignore` 冲突已保留前后端规则。生成 `frontend/package-lock.json`（npm 10.9.2 / lockfile v3）；npm ci 干净安装、完整 TypeScript 检查和 Vite 生产构建通过。源码生成的离线原型也已同步。
2. **演示模式标识**：所有路由增加醒目的置顶“演示模式”横幅，明确导入、生成、阅读、笔记和分享仍为本地模拟；原有结果来源标记保留。独立真实后端联调入口有明确的请求/上传说明，不自动改变主流程的数据来源。
3. **A 接口对齐与调用**：修正 Bearer 认证、建书返回 id、原始图片字节上传、page_no query、实际分类类型、校对 revision 路径与 OCR JSON、analyze/job/run/progress/retry、FastAPI detail 错误。设置页实际调用现有后端。删除不存在的解析/语音问答/点击推理请求，不把登记接口当作推理。

## 验证

- `npm ci --no-audit --no-fund` → 71 个包安装成功，随后 `npm run build` → `tsc -b` 与 Vite 通过。
- 12 组适配器检查：公开/私有认证、缺令牌拦截、JSON id、原图请求、实际路径字段、错误状态、422 数组、无效 JSON、网络超时、204/媒体下载、非法地址和令牌隐藏。
- 10 组真实服务与页面联调：临时数据库、随机测试令牌、自制 PNG；验证上传 SHA-256、重复页 409、坏图 415、跨用户 404、规则分类、校对版本、缺模型失败、三次尝试上限、Vite 代理页面调用、令牌不入存储及手机无横向溢出。
- 主流程仍使用模拟数据，原有完整流程与来源边界检查继续保留；最新原始记录在 `full-test-results.json`、`extra-test-results.json`、`api-adapter-test.json`、`backend-integration-results.json`。

真实模型、C 推理/录音、主流程笔记分享后端替换、真机触屏和现场演示尚未完成。本次未修改 A 的后端，也未公开部署服务或提交凭据。
