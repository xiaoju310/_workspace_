# 纸书智伴 A 后端（本地原型）

## 运行

```powershell
cd C:\Users\29133\Documents\GitHub\_workspace_
python -m venv backend\.venv
backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
$env:APP_USER_TOKENS = '{"owner-local":"请替换成随机长令牌"}'
.\scripts\test-backend.ps1
.\scripts\start-backend.ps1
```

打开 `http://127.0.0.1:8000/docs`。健康检查 `/health` 不需要令牌；私有业务接口使用请求头 `Authorization: Bearer <令牌>`。不要把令牌提交到 Git。

页面上传接口接收 **原始图片字节**，不是 multipart 表单。示例：

```powershell
$headers = @{ Authorization = 'Bearer 请替换成随机长令牌' }
$book = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/api/books -Headers $headers -ContentType 'application/json' -Body '{"title":"自制绘本","authorization_ref":"self-created"}'
$headers['Content-Type'] = 'image/png'
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8000/api/books/$($book.id)/pages?page_no=1" -Headers $headers -InFile '.\my-page.png'
```

默认数据库 `data/paper_companion.db`，上传文件在 `data/books/`；两者都不提交到仓库。可用环境变量 `DATABASE_PATH`、`DATA_ROOT` 改本地路径。测试使用独立临时数据库。

## 真正完成与边界

- 已实现：图书/页面上传、文件头和大小校验、SHA-256、分类规则原型与主人确认、任务状态与查询、重试上限、本地历史/指标、笔记草稿/编辑/审核、链接哈希/过期/撤销、本地 Bearer 身份隔离。
- **不等于真实分析**：未接 B 的 OCR/VLM/视频模型时，分析任务明确失败为 `PROVIDER_NOT_CONFIGURED`；不生成假成功。笔记草稿是占位，需要真实分析与人工校对的来源引用才可审核。
- **未完成**：真实 OCR/VLM、视频/TTS、触控 Agent、官方评测适配、完整并发压测、进程重启恢复、生产身份认证、全链路集成、最终发布。不要把本地原型公开部署。

`/docs` 为当前运行接口准则；具体使用方法见 `docs/api-contract.md`。

## A 的运行产物交接说明

真实文件由 B 放在 `data/runs/<run_id>/` 下，再通过 `POST /api/runs/{run_id}/assets` 登记，并由图书主人调用 `GET /api/runs/{run_id}/assets/{asset_id}/content` 下载。路径必须是后端电脑上的绝对路径；不能用其他运行的目录。时间轴、交互、运行日志和本地 CSV 指标接口见 `docs/api-contract.md`。这些都是记录/检索接口，不会自动生成真实视频或问答。
