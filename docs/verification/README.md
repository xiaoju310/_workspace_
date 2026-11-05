# 检查脚本

离线检查脚本验证前端与 HTTP 适配器；check-backend.cjs 另启动隔离的 A 后端进行实际联调。所有检查均不调用真实模型。测试会覆盖相应结果 JSON 和截图；不会自动改业务源码。

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
| `check-api.cjs` | 12 组认证、原图字节、实际契约、错误、超时和媒体下载 | `../api-adapter-test.json` |
| `check-prototype.cjs` | D1 历史原型检查，保留作证据 | `../test-results.json`、D1 截图 |

最新记录来自 Edge 实际执行，脚本使用标准模块查找。2026-11-05 已安装锁定的前端依赖，并通过 npm ci、完整 TypeScript 类型检查和 Vite 构建；真实设备和模型能力仍待验收。

修改源码后，在 `frontend/` 运行 `npm run prototype` 重新生成离线 HTML，再复跑本目录检查。正式构建使用 `npm run build`；离线检查不替代生产构建。

## A 真实接口与页面联调

先在 `backend/.venv` 安装后端 requirements，在本目录安装 Playwright 和 pngjs 验证依赖：`npm install --no-save --package-lock=false playwright@1.62.1 pngjs@7`。然后运行 `node check-backend.cjs`。Windows 默认使用 `backend/.venv/Scripts/python.exe`，其他 Python 路径可通过 `VERIFY_PYTHON` 指定。

脚本使用空闲的本机 18765/15173 端口、独立临时数据库、自制测试图片和随机令牌，启动真实 A 服务与 Vite 代理，再用 Edge 检查页面。退出时停止服务；不使用开发数据库或开发令牌。10 项结果写入 `../backend-integration-results.json`。

本次已按锁文件通过 npm ci、TypeScript/Vite 正式构建；构建不再属于未验证项。历史 D1 和初版自测保留日期，不替代最新记录。
