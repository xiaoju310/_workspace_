# 检查脚本

这些脚本验证离线前端与 HTTP 适配器，不连接真实模型或后端。测试会覆盖相应结果 JSON 和截图；不会自动改业务源码。

在可联网环境中，先安装 `frontend/` 开发依赖。此目录额外安装验证工具：

```powershell
cd docs/verification
npm install --no-save --package-lock=false playwright@1.62.1 typescript@5.9.3
node check-full.cjs
node check-extra.cjs
node check-api.cjs
```

要求 Node.js 20.19+ 或 22.12+、已安装 Microsoft Edge。脚本使用系统 Edge，不要求下载 Playwright 浏览器。执行完毕不必把验证工具的 `node_modules/` 提交仓库。

| 脚本 | 覆盖 | 结果 |
|---|---|---|
| `check-full.cjs` | 17 组完整流程、四状态、响应式和异常检查 | `../full-test-results.json`、`../screenshots/full-*.png` |
| `check-extra.cjs` | 6 组来源页、适龄复核、未完成图书、多类型素材、图片转移/刷新、调序 | `../extra-test-results.json` |
| `check-api.cjs` | 5 组路径、JSON、编码、409 和地址校验 | `../api-adapter-test.json` |
| `check-prototype.cjs` | D1 历史原型检查，保留作证据 | `../test-results.json`、D1 截图 |

当前记录来自本机 Edge 实际执行；交付版脚本使用标准模块查找，最终复跑借助本机已有的 Playwright/TypeScript，未安装新依赖。首次联网安装、完整 TypeScript 类型检查、Vite 构建和真实设备/后端验收仍须补跑。

修改源码后，在 `frontend/` 运行 `npm run prototype` 重新生成离线 HTML，再复跑本目录检查。正式构建使用 `npm run build`；离线检查不替代生产构建。
