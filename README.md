# 纸书智伴项目工作区

项目资料：

- [可实施设计文档](docs/设计文档.md)
- [五人总任务分配与两周逐日计划](docs/总任务分配与两周计划.md)
- 设计文档已扩展：通用图书分类、类型分析器、读书笔记、主人审核与授权分享
- 个人任务书（v1.1）：见 `docs/成员任务书/`

## 协作约定

成员在各自的 `team/*` 分支提交代码，向 `main` 发起 Pull Request（PR），由仓库负责人审核后合并。请勿直接向 `main` 推送。**注意：若仓库设置尚未启用分支保护，这只是团队约定，不构成 GitHub 的技术强制限制。**

- `team/a-backend`：后端架构、编排与部署
- `team/b-ai-video`：OCR/VLM、故事与视频生成
- `team/c-interaction`：语音、问答、触控与联调
- `team/d-frontend`：UI/UX 与前端页面
- `team/e-testing-docs`：测试、指标、文档与演示

不要提交授权绘本原图、语音测试集、模型权重、密钥或真实儿童数据。模型和工具来源、许可证及运行配置按设计文档记录。

## Windows 一键启动（本机）

下载或克隆**整个项目文件夹**后，双击根目录的 `启动纸书智伴.cmd`。首次运行会建立项目专用 Python 环境、安装依赖、构建界面，启动服务并用默认浏览器打开 `http://127.0.0.1:8000/`；之后再次双击可直接打开已运行的服务。首次安装依赖需要网络。不要只复制 `.cmd`，它必须与 `backend/`、`frontend/`、`scripts/` 在同一个项目目录下。

电脑需预先安装 **Python 3.11+（包含 pip）**、**Node.js LTS（包含 npm）**、**MongoDB Community Server（作为 Windows 服务安装）**。缺少任一项时脚本会提示；MongoDB 不会被脚本下载、改配置或开放网络端口。默认仅本机访问，不会自动创建管理员账号；注册普通账号后可登录。管理员账号需要在本机单独、安全地创建（见 [账号与网络说明](docs/mongodb-accounts-network.md)）。若已有 8000 端口被其他程序占用，脚本会停止并提示；可以在 PowerShell 中运行 `& .\scripts\launch.ps1 -Port 8001`。服务日志在 `data/logs/`，数据库和图书数据在 `data/`，不要删除。此入口不是公网部署方案。


## Windows 局域网共享（只在可信网络演示）

**服务器电脑**（本机）继续安装 MongoDB、Python、Node.js 并保持开机；**其他电脑不用安装 MongoDB 或项目**，只需接入同一个可信局域网，使用浏览器打开服务器电脑显示的地址。

- `启动纸书智伴.cmd`：原本机模式，默认 `127.0.0.1:8000`，别人无法通过此地址访问。
- `启动纸书智伴-局域网共享.cmd`：共享模式，默认 `8001`，只监听一张 **Private（专用）** 网卡的 IPv4 地址；首次运行需要管理员确认添加 Windows 防火墙规则，仅允许专用网络、该地址/端口、同一子网访问。MongoDB 仍只监听本机，不开放 `27017`。其他电脑打开启动窗口打印的 `http://<服务器局域网IP>:8001/`，不要在其他电脑输入 `127.0.0.1`。

**当前这台电脑的 WLAN 与 Radmin VPN 都是 Public（公共）**，因此共享启动会明确拒绝，绝不会自行改动网络类别。只有在确认 WLAN 是自己控制的可信家庭/团队网络后，才在 Windows 的「设置 → 网络和 Internet → WLAN → 当前连接的网络 → 网络配置文件类型」中手动选「专用网络」，然后重试共享启动。不可信的校园/酒店/公共 Wi-Fi 不要改为专用。若有多个专用网卡，可以在 PowerShell 用 `& .\scripts\launch.ps1 -Share -Port 8001 -InterfaceAlias 'WLAN'` 指定。管理员弹窗被取消时共享不会启动。

这只是**局域网内的 HTTP 演示方案**，传输未加密，账号密码及图书内容不适合敏感或真实儿童资料。不要做路由器端口映射、不要把地址暴露到公网，也不要对 MongoDB 放行端口。正式异地访问还需要 HTTPS、数据库认证及进一步安全审查。电脑关机/休眠、IP 改变、网络不在同一子网或防火墙被组织策略限制时，其他电脑无法访问；改地址后重新运行启动器并使用新地址。Windows 的客户端隔离设置也可能阻止同一 Wi-Fi 内设备互访。

共享规则不会在关闭软件时自动删除。如果不再需要共享，可用**管理员 PowerShell** 查看/删除本软件规则（只处理名称以 `PaperCompanion-LAN-` 开头的规则）：

```powershell
Get-NetFirewallRule -Name 'PaperCompanion-LAN-*' -ErrorAction SilentlyContinue
Get-NetFirewallRule -Name 'PaperCompanion-LAN-*' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
```

删除规则前请确认显示的规则确实是本软件创建的。数据仍保存在服务器电脑；别人的浏览器只承担界面与联网访问，不会自动获得本机文件。项目启动入口不负责外网部署。

## 校园网共享：Tailscale 私有网络（推荐）

校园 WLAN 保持 Windows **Public（公共）**，不要开放 `8000/8001` 或 MongoDB 的 `27017`，也不要设置路由器端口映射。服务器电脑先安装 [Tailscale](https://tailscale.com/download/windows) 并登录、连接；在 Tailscale 管理后台按最小权限邀请组员加入同一 tailnet，并检查访问控制。组员在自己的设备安装、登录 Tailscale，**不用安装本项目或 MongoDB**。

服务器电脑双击 `启动纸书智伴-Tailscale共享.cmd`：先检查登录和已有共享配置，再启动仅监听 `127.0.0.1:8000` 的软件，并用 **Tailscale Serve（不是 Funnel）**生成 tailnet 内的 HTTPS 地址。把窗口显示的 `https://<设备名>.<tailnet>.ts.net/` 发送给获准访问的组员；他们在浏览器打开后自行注册普通账号。Tailscale 登录/邀请不等于本软件登录。首次启用 Serve 可能需要你在 Tailscale 控制台批准 HTTPS；按屏幕提示操作。**不要运行 `tailscale funnel`。**

共享会在后台保持，关掉窗口不会自动停止。停止共享：在服务器电脑运行 `tailscale serve --https=443 off`，再用 `tailscale serve status` 核对；如需立即禁止某位组员，另在 Tailscale 管理后台撤销其设备或访问权限。电脑必须开机、Tailscale 保持连接；若 `443` 已有其他 Serve 配置，脚本拒绝覆盖，请先自行检查。私有 HTTPS 只保护传输和网络入口：本机 MongoDB 尚未启用数据库认证，图书/任务等业务数据仍使用 SQLite。不要上传真实儿童隐私或敏感图书，正式对外运营还需安全审查。
