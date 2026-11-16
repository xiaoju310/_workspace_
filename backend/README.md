# 纸书智伴 A 后端（本地原型）

> 当前电脑版默认使用 MongoDB 账号登录。下方历史 `APP_USER_TOKENS` 示例仅适用于显式开启的本地 legacy 测试模式；日常使用请参阅 `docs/mongodb-accounts-network.md` 和 `docs/电脑版提交说明-2026-11-16.md`。


> 新增 MongoDB 注册/登录与管理员账号，使用说明见 `docs/mongodb-accounts-network.md`。下文固定 `APP_USER_TOKENS` 是旧版联调说明，普通启动已不再使用；图书等业务数据仍保留 SQLite。

## 运行

```powershell
cd <你的仓库根目录>
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

单本最多 100 页，单页 JPG/PNG 最多 20 MB；逐页上传，不代表 100 页整本分析已经过性能验收。请确保本机有足够磁盘和内存，建议优先压缩图片后导入。

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

B 的 `.generation.json` 成功产物可通过下面的离线导入命令复制到 `data/runs/<run_id>/` 并登记。`APP_API_TOKEN` 应是主人令牌，`--data-root` 必须与后端 `DATA_ROOT` 相同。导入不会再次请求豆包或调用任何生成模型，也不会自动生成时间轴：

```powershell
# B 媒体命令需要其 Python 包依赖（requests/Pillow/OpenCV）；无需下载模型权重。
backend\.venv\Scripts\python.exe -m pip install -e .
$env:APP_API_TOKEN = '请替换为主人令牌'
$env:PYTHONPATH = 'backend' # 未安装本仓库 Python 包时，让命令能找到 app.ai
backend\.venv\Scripts\python.exe -m app.ai.cli import-generation --manifest 'D:\outputs\sample.generation.json' --run-id '<运行ID>' --data-root .\data
```

若运行与图书不匹配、页码不存在或成功产物格式不符会拒绝；视频失败而插画成功时仅导入插画，失败产物不会登记；重复导入会拒绝并提示检查。视频只做容器头初筛，**不代表可解码或内容合格**，仍须用 `qc-video` 和人工复核。若登记期间网络故障，先查看资产列表和专属运行目录，再决定是否重试，不要直接删除产物。

也可以手动把真实文件放在 `data/runs/<run_id>/` 下，再通过 `POST /api/runs/{run_id}/assets` 登记，并由图书主人调用 `GET /api/runs/{run_id}/assets/{asset_id}/content` 下载。路径必须是后端电脑上的绝对路径；不能用其他运行的目录。时间轴、交互、运行日志和本地 CSV 指标接口见 `docs/api-contract.md`。这些都是记录/检索接口，不会自动生成真实视频或问答。

## 当前本地集成边界

C 阅读页会查询 A 登记的视频/插画；插画只作补充展示，不替换原书图作为触控依据。B 本地分析提供者已接线，模型、OCR 权重和驱动依赖需要另行安装、实测；示例测试中的 mock/伪状态不能视为真实模型成功。E 的问答回归为自制文本页验证，真实麦克风 ASR、TTS、视频画面质量、授权书内容和官方评测尚未验收。共享笔记仍须主人编辑审核后分享。

## 自动识别书页文字（可选）

在仓库根目录运行：

```powershell
backend\.venv\Scripts\python.exe -m pip install -r backend\requirements-ocr.txt
```

重启对应的服务，再用已登录的真实模式导入 JPG/PNG 书页。系统会逐页识别文字，填入“文字校对”草稿；识别结果可能有错漏，必须人工检查并确认。识别失败可手动填写文字/画面描述；已经导入的未确认书页可以在“文字校对”页点击“重新识别这一页”；为保护手工修改和已确认内容，先保存/处理未保存的修改，已确认页不会被 OCR 覆盖。首次使用可能需要等待模型初始化。此组件与整书 AI 分析/视频生成配置不同；安装 OCR 不会解决 `PROVIDER_NOT_CONFIGURED`。演示模式不发送书页到 OCR 服务。


### 校对辅助提示（2026-11-16）

- 校对页使用“识别参考分 / 100”，不是准确率；所有页面都提示对照原图检查，不能因高分跳过人工确认。
- 单独成行的部分装饰符号和少量可疑拉丁字符会按行号提示（例如 `●`、`à`、`II`），只做提醒、不自动删改。短行、页码、英文仍保留；提示不覆盖所有错字或顺序问题。
- “重新识别这一页”会把本次参考分与草稿一起更新，保存后使用本次分数，不继续沿用上次识别的旧分数。
- 原创绘本的 30 项本机模拟测试说明、边界与实拍验收清单见仓库 `docs/OCR-校对改进与验收.md`。模拟变换不能代替真实拍照验收。
