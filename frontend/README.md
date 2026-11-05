# 纸书智伴 · 完整前端与模拟流程

React 18.3.1 + TypeScript 5.9.3 + Vite 7.1.7 + 原生 CSS。Node.js 需 20.19+ 或 22.12+。

## 立即查看

双击 `../docs/prototype/paper-companion-full.html`。这是从相同 TSX 源码生成的独立离线原型，包含 React 18.3.1，不需要安装、服务器或网络。

- 首页 `#/`；导入 `#/import`；校对 `#/review`；分类 `#/classification`；进度 `#/progress`；阅读 `#/reader`；历史 `#/history`；笔记 `#/notes`；分享 `#/sharing`；接口检查 `#/settings`。
- 页脚“原型状态”可切换正常、加载、空数据、失败。
- 上传页点击“试用原创示例”→勾选授权→“确认导入预览”，可看到本地成功状态。
- 选择的图片只在内存预览，进入校对后继续保留，刷新后需重新导入。图书元信息、模拟笔记、分享和历史使用 sessionStorage，仅在当前浏览器标签会话保存。主流程持续显示“演示模式”。设置页的独立后端联调入口会发送实际请求，必须单独填写地址、令牌并授权上传；不会自动把模拟数据上传。

## 继续开发

```powershell
cd frontend
npm ci
npm run dev
```

打开命令输出的本机地址。检查构建：

```powershell
npm run build
npm run preview
```

已生成并纳入 `package-lock.json`（npm 10、lockfile v3）。2026-11-05 已验证 `npm ci` 干净安装、完整 TypeScript 检查与 Vite 生产构建。协作时统一使用 npm 和该锁文件。

安装完成后运行 `npm run prototype`，可从源码重新生成离线 HTML。该脚本针对已固定的 React 18 UMD 目录；修改源码后可用于同步交付预览。

## 目录

| 位置 | 内容 |
|---|---|
| `src/pages/` | 11 个页面：书架/导入/校对/分类/进度/阅读/历史/笔记/分享/只读/设置 |
| `src/components/` | 全页导航、按钮、状态、书籍封面和卡片 |
| `src/app/` | 页面契约、会话状态、模拟编排与回调 |
| `src/api/` | 按 A 实际契约的 Bearer、原图字节、分类/校对/任务与笔记分享适配器 |
| `src/features/books/` | 图书类型、本地图片校验 |
| `src/features/notes/` | 笔记审核与可见性独立字段 |
| `src/features/sharing/` | 后续服务端分享状态的显示模型 |
| `src/mock/` | 原创演示书和笔记 |
| `src/styles/` | 原生响应式 CSS |
| `public/art/` | 原创 SVG 插图、封面、示例页 |

本地限制为 JPG/PNG、每页 10 MB、每书 24 页。检查扩展名、MIME、文件头及图片解码。真实接口接入后须使用 A 的配置并由后端再次验证。前端勾选授权不替代服务端权限判断。

## 已验证与未验证

完整离线原型已在 Edge 156 无头浏览器通过 17 项流程检查与 6 项补充检查，覆盖所有业务页四状态与 1366/1024/390px 布局；HTTP 适配器通过 12 项单元检查，隔离真实后端和浏览器联调通过 10 项检查。复跑方法见 `../docs/verification/README.md`。见 `../docs/full-test-results.json`、`../docs/api-adapter-test.json` 和 `../docs/full-self-test.md`。截图在 `../docs/screenshots/full-*.png`。

已验证构建和 A 现有建书、上传、规则分类、人工校对、任务失败/重试接口。真实平板、OCR/VLM、视频、C 互动模型和主流程笔记分享服务尚未完成全链路验收。Figma 交付为可导入 SVG，不含原生云文件、Auto Layout 和 Figma 连线。


## A 后端独立联调

先按 `backend/README.md` 启动 A 的本地服务并配置 `APP_USER_TOKENS`。通过 `npm run dev` 打开前端，在“接口与演示设置”中使用“A 后端实际接口联调”。默认 `/backend-api` 由 Vite 代理到 `http://127.0.0.1:8000`；`npm run preview` 也有相同本地代理。离线 HTML 不执行真实联调。

令牌仅在联调组件内存中保留，离开页面/刷新/清空后需重新填写。图片按选择顺序发送，使用原始字节与 `image/png` 或 `image/jpeg`，不使用 multipart。上传失败可继续上传未完成页面；已建书后不能更改文件或认证上下文。

A 的分类是标题规则原型；模型未配置时分析返回 `PROVIDER_NOT_CONFIGURED`，页面保留错误和运行标识，不回退模拟成功。主导航的书架、导入、阅读、笔记和分享仍为独立模拟数据。C 的录音/点击推理接口尚待定稿，A 的 interactions 只是结果记录接口。

复跑：`node ../docs/verification/check-api.cjs`；真实联调验收见 `../docs/verification/README.md`。最新修改记录见 `../docs/leader-feedback-2026-11-05.md`。
