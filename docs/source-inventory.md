# 素材与依赖来源

版本 v0.2 · 2026-11-04

| 项目 | 版本/来源 | 许可与本次使用 |
|---|---|---|
| 前端代码与图标 | 本交付原创 React/TS/CSS、SVG 线条图标 | 团队项目用途；未引用外部素材 |
| 阅读花园、三本书封、九张分类型示例页 | `frontend/public/art/*.svg`，本次原创绘制 | 虚构书名与合成内容；没有赛事授权原图、真实儿童信息 |
| 高保真设计稿 | `docs/design/*.svg`，本次原创 | 可导入 Figma；未创建原生云文件 |
| React / ReactDOM | 18.3.1；正式依赖来源 npm `react` / `react-dom`，MIT | 离线 HTML 复用本机 Trae CN 附带的 React 官方 UMD 运行库，保留版权头；MIT 原文在 `licenses/react-MIT.txt` |
| TypeScript | 5.9.3；微软 TypeScript，Apache-2.0 | 本机已有编译器仅用于 TSX 语法转译，不随包分发；正式工程锁定开发依赖版本 |
| Vite | 7.1.7；npm `vite`，MIT | 开发依赖，网络限制尚未安装/构建 |
| React Vite 插件 | 5.0.4；npm `@vitejs/plugin-react`，MIT | 开发依赖，尚未安装 |
| React 类型 | `@types/react` 18.3.12、`@types/react-dom` 18.3.1，MIT | 开发依赖，尚未安装；完整类型检查未执行 |
| 系统字体 | Microsoft YaHei、SimSun 等系统字体回退 | 仅引用字体名，未分发字体文件，不请求远程字体 |
| 验证工具 | 本机 Playwright 1.62.1、Microsoft Edge 156.0.4314.50 | 仅用于本地自动操作与截图，不随包分发 |

直接依赖已固定版本。传递依赖的 lockfile 需要首次联网安装后生成；本包不伪造依赖哈希或安装成功记录。所有页面、截图和演示状态明确标记模拟数据，没有真实模型产出。录屏为本机 Edge 页面真实操作；WebM 用本机已有 FFmpeg 7.1 编码，MP4 用 FFmpeg 6.1.1/libx264 转码，未分发工具二进制。

