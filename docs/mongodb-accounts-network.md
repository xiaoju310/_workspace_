# MongoDB 账号与局域网访问（阶段一）

已接入：MongoDB `users` / `sessions`，注册、登录、退出、账户信息，Argon2 密码哈希、随机会话令牌的 SHA-256 哈希存储、7 天过期及撤销。用户名唯一；注册只能成为普通用户。管理员由本机一次性工具创建。

**重要边界：图书、页面、任务、笔记及分享仍在现有 SQLite `data/paper_companion.db`；图片/视频仍在磁盘。尚未将全部业务数据迁移到 MongoDB，不要删除 SQLite 数据文件。旧 `owner-local` 数据不会自动转给新管理员。MongoDB 已本机测试连通，但这不等于完成公网部署。**

## 本机启动

```powershell
backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
npm --prefix frontend run build
.\scripts\start-backend.ps1 -WithFrontend
```

访问 `http://127.0.0.1:8000/`，可注册和登录。数据库默认 URI `mongodb://127.0.0.1:27017`、库名 `paper_companion`；可通过 `MONGODB_URI`、`MONGODB_DATABASE` 环境变量配置，不要把密码写进仓库。

## 管理员

本机管理员 `admin` 已创建。其随机密码仅保存在当前 Windows 用户的 DPAPI 加密文件 `~\.paper-companion\admin-password.dpapi`，仓库和聊天中都没有密码。只在本人电脑的 PowerShell 中查看：

```powershell
$secure = Get-Content -LiteralPath (Join-Path $HOME '.paper-companion\admin-password.dpapi') -Raw | ConvertTo-SecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
```

查看时屏幕会显示密码，确保无人旁观，不要截图、提交或发送给别人。DPAPI 与当前 Windows 账号绑定；更换电脑前应安全地转移凭据或实现密码重置。新部署首次初始化管理员可用 `PYTHONPATH=backend` 环境下执行 `python -m app.create_admin --username admin`，终端隐藏输入两次密码。已有管理员时会拒绝再次创建。

## 联网（可信局域网演示）

在**服务器电脑**双击根目录的 `启动纸书智伴-局域网共享.cmd`，它会构建前端、启动后端并打印本机局域网地址（默认端口 `8001`）。只在当前网络被 Windows 识别为 **Private / 专用** 时启动；首次需批准管理员弹窗建立仅限专用网络、指定本机 IPv4 和 `LocalSubnet4` 的入站规则。其他电脑只需浏览器打开打印的地址，**不用安装 MongoDB**。本机模式仍用 `启动纸书智伴.cmd`，默认 `127.0.0.1:8000`。具体步骤及防火墙规则清理由根目录 README 说明。

MongoDB 必须只监听本机 `127.0.0.1:27017`，**不要开放 27017**；前后端同源，不需宽泛 CORS。不要再使用 `-Bind 0.0.0.0` 作为共享启动办法。

当前本机 MongoDB `authorization` 为 **disabled**；密码和会话虽已存储，但有本机数据库访问权的进程仍可读数据。局域网 HTTP **不加密**，同一网络的设备可能看到登录传输，因此仅限可信局域网、非敏感演示资料。不得配置公网端口映射。正式发布前必须启用 MongoDB 身份认证和最小权限数据库用户、HTTPS 反向代理与域名、备份和恢复演练、持久化限流、审计、CSRF/会话存储策略、安全审查以及业务数据迁移。当前前端令牌存于本标签页的 `sessionStorage`，避免长期保存，但仍需防御 XSS。

## 接口

- `POST /api/auth/register`，JSON `{"username":"alice","password":"至少12字符"}`
- `POST /api/auth/login`，同样请求体
- `GET /api/auth/me`，Bearer 登录令牌
- `POST /api/auth/logout`，Bearer 登录令牌

默认旧 `APP_USER_TOKENS` 不再有效；仅独立旧版测试显式启用 `AUTH_BACKEND=legacy`、`ALLOW_LEGACY_TOKENS=1`。不可在联网部署启用旧令牌模式。管理员目前仅有身份标记，没有越权访问其他用户资料的接口。

## 校园网私有访问

校园 WLAN 是公共网络时，**不要**改成专用网络以使用上面的局域网入口。改用根目录 `启动纸书智伴-Tailscale共享.cmd`：服务器与组员先安装 Tailscale 并获准加入同一私有网络；组员只需浏览器，不装 MongoDB。该入口只代理本机 `127.0.0.1:8000`，不开放 MongoDB 或校园网入站端口，也不启用 Funnel。共享地址、撤销方法和安全边界见根目录 README 的「校园网共享」。
