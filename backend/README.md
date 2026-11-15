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
- **分析 provider 已接线，默认不启用**：未配置时任务明确失败为 `PROVIDER_NOT_CONFIGURED`，不会生成假成功。配置 B 的本地 PaddleOCR/SmolVLM 后，可逐页分析并保存 OCR、视觉实体/事件、来源页码、模型版本和任务状态；需用授权书页实测效果。
- **未完成**：真实视频/TTS、触控 Agent、官方评测适配、完整并发压测、生产身份认证、全链路集成、最终发布。不要把本地原型公开部署。

`/docs` 为当前运行接口准则；具体使用方法见 `docs/api-contract.md`。

## 接入 B 的本地分析模型（可选）

先安装 `requirements.txt`。以下模型依赖比较大，确认机器空间/内存与模型授权后再安装；模型权重放在 Git 仓库之外：

```powershell
.\backend\.venv\Scripts\python.exe -m pip install -r backend\requirements-ai.txt
$env:AI_PROVIDER = 'b_local'
$env:AI_VLM_MODEL_PATH = 'D:\models\smolvlm-256m' # 改为本机已下载的模型目录
$env:AI_VLM_DEVICE = 'cpu'
$env:AI_OCR_LANG = 'ch'
```

B 的已验证模型为 SmolVLM-256M-Instruct，具体权重版本/许可证与实测范围见 B 的运行记录。此处接通的是 OCR + 单个可见物体识别；事件抽取和可靠的读书摘要仍未达到真实效果要求，生成的笔记需要主人校对。未配置模型、依赖加载失败或输入异常会明确记为 `FAILED`，可在 `/api/runs/{run_id}/jobs` 查看错误码；配置修好后可调用 `POST /api/jobs/{job_id}/retry`，最多三次。

分析结果在 `GET /api/runs/{run_id}` 的 `config.analysis_result`；页级 OCR/视觉结果及来源写在 `pages.ocr_json` / `pages.vision_json`。这只代表本地分析链路可运行，不代表 P0 视频/语音/触控整条链路已完成。

## A 的运行产物交接说明

真实文件由 B 放在 `data/runs/<run_id>/` 下，再通过 `POST /api/runs/{run_id}/assets` 登记，并由图书主人调用 `GET /api/runs/{run_id}/assets/{asset_id}/content` 下载。路径必须是后端电脑上的绝对路径；不能用其他运行的目录。时间轴、交互、运行日志和本地 CSV 指标接口见 `docs/api-contract.md`。这些都是记录/检索接口，不会自动生成真实视频或问答。
