# 纸书智伴 · 完整前端与模拟流程

React 18.3.1 + TypeScript 5.9.3 + Vite 7.1.7 + 原生 CSS。Node.js 需 20.19+ 或 22.12+。

## 立即查看

双击 `../docs/prototype/paper-companion-full.html`。这是从相同 TSX 源码生成的独立离线原型，包含 React 18.3.1，不需要安装、服务器或网络。

- 首页 `#/`；导入 `#/import`；校对 `#/review`；分类 `#/classification`；进度 `#/progress`；阅读 `#/reader`；历史 `#/history`；笔记 `#/notes`；分享 `#/sharing`；接口检查 `#/settings`。
- 页脚“原型状态”可切换正常、加载、空数据、失败。
- 上传页点击“试用原创示例”→勾选授权→“确认导入预览”，可看到本地成功状态。
- 选择的图片只在内存预览，进入校对后继续保留，刷新后需重新导入。图书元信息、模拟笔记、分享和历史使用 sessionStorage，仅在当前浏览器标签会话保存。健康检查只在设置页明确点击后请求服务，其他流程没有后端请求。

## 继续开发

```powershell
cd frontend
npm install
npm run dev
```

打开命令输出的本机地址。检查构建：

```powershell
npm run build
npm run preview
```

也支持 `pnpm install`、`pnpm dev`。本次网络受限，依赖未安装成功，Vite 构建尚未执行，未生成 lockfile。第一次联网安装并确认构建通过后，把 lockfile 一起提交；后续使用 `npm ci` 或 `pnpm install --frozen-lockfile`。

安装完成后运行 `npm run prototype`，可从源码重新生成离线 HTML。该脚本针对已固定的 React 18 UMD 目录；修改源码后可用于同步交付预览。

## 目录

| 位置 | 内容 |
|---|---|
| `src/pages/` | 11 个页面：书架/导入/校对/分类/进度/阅读/历史/笔记/分享/只读/设置 |
| `src/components/` | 全页导航、按钮、状态、书籍封面和卡片 |
| `src/app/` | 页面契约、会话状态、模拟编排与回调 |
| `src/api/` | 真实 HTTP 接口适配器，业务尚未接线 |
| `src/features/books/` | 图书类型、本地图片校验 |
| `src/features/notes/` | 笔记审核与可见性独立字段 |
| `src/features/sharing/` | 后续服务端分享状态的显示模型 |
| `src/mock/` | 原创演示书和笔记 |
| `src/styles/` | 原生响应式 CSS |
| `public/art/` | 原创 SVG 插图、封面、示例页 |

本地限制为 JPG/PNG、每页 10 MB、每书 24 页。检查扩展名、MIME、文件头及图片解码。真实接口接入后须使用 A 的配置并由后端再次验证。前端勾选授权不替代服务端权限判断。

## 已验证与未验证

完整离线原型已在 Edge 156 无头浏览器通过 17 项流程检查与 6 项补充检查，覆盖所有业务页四状态与 1366/1024/390px 布局；HTTP 适配器另通过 5 项单元检查。复跑方法见 `../docs/verification/README.md`。见 `../docs/full-test-results.json`、`../docs/api-adapter-test.json` 和 `../docs/full-self-test.md`。截图在 `../docs/screenshots/full-*.png`。

尚未验证 npm/Vite 构建、真实平板设备、后端 API、OCR、分类、视频、笔记审核与分享服务。Figma 交付为可导入 SVG，不含原生云文件、Auto Layout 和 Figma 连线。

