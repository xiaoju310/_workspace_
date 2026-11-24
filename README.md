# 开卷有灵

绘本导入、文字校对、分镜复核、视频生成与互动阅读的软件源码。
本仓库不提供用户上传的绘本、真实账户数据、生成视频、聊天记录、运行数据库或本地模型权重。
界面中的内置演示和测试材料是虚构软件样例，不是用户资料或参赛绘本。

## Windows 启动

准备 Python 3.11+（含 pip）、Node.js（含 npm）、本机 MongoDB Community Server。
保留完整项目目录，双击根目录“启动开卷有灵.cmd”；首次安装依赖需要联网。
默认地址为 `http://127.0.0.1:8000/`。运行数据保存在本机 `data/`，不纳入 Git。
不要把运行目录、私人备份、数据库或账号配置打包到公开发布附件中。

## 本机千问（可选）

运行 `python scripts/setup-local-qwen.py` 安装本机模型运行环境。
脚本从上游下载 Ollama 与 `qwen3-vl:4b`；模型与配置保存在仓库之外，不随源码上传。
安装完成并重新启动软件后，在阅读界面主动开启本机识物与问答。
本机问答失败不会自动回退到收费模型。视频生成、其他云端模块和在线语音不是因此免费或离线。

## 更新与数据边界

- [软件更新说明](docs/public-release/software-update.md)
- [本机数据与发布边界](docs/public-release/data-boundary.md)
- [本机模型与第三方许可说明](docs/public-release/third-party-models.md)

## 开发验证

- 后端：安装 `backend/requirements.txt` 后运行 `python -m pytest backend/tests tests`。
- 前端：在 `frontend-wonderland` 运行 `npm test` 和 `npm run build`。
- 发布前：先显式暂存需要的代码，再运行 `python scripts/check-publication.py --staged`。
- 提交后：运行 `python scripts/check-publication.py --revision HEAD` 复核实际提交树。

检查脚本采用路径白名单，并检查常见密钥、个人目录及数据库/模型/媒体文件。
它不能证明不存在所有隐私，仍须人工审查差异；历史提交也必须单独检查。
不要使用 `git add -f` 绕过排除规则，不要把整个工作目录压缩后上传。

## 协作

变更推送到 `team/*` 分支，由负责人审核 PR；不直接推送或合并 main。
详见 [协作与审核规则](docs/协作与审核规则.md)。
