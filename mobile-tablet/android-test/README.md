# Android 测试 APK

本目录是**独立的 Android 测试安装壳**。安装后输入电脑的 Tailscale Serve HTTPS 地址，应用打开 `mobile-tablet` 移动版网页。APK 内没有账号、书籍、数据库或 API 密钥；电脑端功能和数据没有更改。

## 安装和连接

1. 在电脑上双击 `mobile-tablet/start-mobile.cmd`，确认电脑 `http://127.0.0.1:5174/health` 正常。
2. 在手机和电脑登录同一个 Tailscale 网络。**先查看现有 Serve 配置，不要覆盖桌面版现有分享**；建议先运行 `tailscale serve status` 检查已有配置，再运行 `tailscale serve --bg --https=8443 5174` 将移动版分享到单独的 HTTPS 端口，不覆盖原有 443 分享；若已有 8443 配置，请勿覆盖，改用 10000 或先协商。不要启用 Funnel，也不要开放 MongoDB 的 `27017` 端口。
3. 安装 `纸书智伴-Android测试版.apk`。第一次打开输入完整 `https://……ts.net:8443/` 地址（或实际 Serve 显示的默认 443／`10000` 地址）；APK 不接受 `127.0.0.1`、HTTP、公网域名或证书错误。之后在应用中注册/登录移动版账号（与电脑端账号不同）。
4. 若打不开，先在**手机浏览器**打开相同 HTTPS 地址，排查电脑是否休眠、Tailscale/Serve 是否在线，再回到 APK。

> 这不是离线版：电脑必须运行移动版网页服务、API 和本机 MongoDB。APK 是调试签名，不适合应用商店发布；不要把测试包当正式发布版。

## 重新构建

需要 Android SDK Platform 35、Build Tools 35、JDK 17 或更高、Gradle 8.9。进入本目录后运行 `gradle :app:assembleDebug`；产物在 `app/build/outputs/apk/debug/app-debug.apk`。构建时需设置 `ANDROID_HOME` 和合适的 `JAVA_HOME`。源码不需要修改桌面端。

## 测试范围

电脑端本机 API／MongoDB 烟雾测试以及网页构建不能替代手机真机验收。安装后请重点验证登录、图片选择与上传、阅读／视频播放、横竖屏切换、断网后的提示和重新连接。iPhone/iPad 不能安装 APK。


