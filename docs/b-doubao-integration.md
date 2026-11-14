# B：豆包作图与视频接入（火山方舟）

本地接入已实现，并用用户本机配置的 Seedream / Seedance 完成一张图片与一个 5 秒视频的真实试验。密钥、图片和视频文件均未上传仓库；模拟接口测试不会调用云服务。

## 使用流程

1. 在火山方舟开通可用的 Seedream（图片）与 Seedance（视频）模型，确认账号权限、余额和用量限额。复制控制台显示的**模型 ID**，不猜测或写死版本。
2. 在运行命令的 PowerShell 会话中配置（**不要把密钥发送给聊天或提交到 Git**）：

```powershell
$env:ARK_API_KEY = "从火山方舟控制台获取的密钥"
$env:DOUBAO_IMAGE_MODEL = "控制台中的 Seedream 模型 ID"
$env:DOUBAO_VIDEO_MODEL = "控制台中的 Seedance 模型 ID"
```

3. 先用**单幅、5 秒、720p** 小样验收，实际调用按火山方舟规则可能产生费用：

```powershell
python -m app.ai.cli doubao-media --page-no 1 `
  --image-prompt "儿童绘本插画，一只小兔子和小乌龟站在草地起跑线，温暖明亮的水彩，角色造型清晰一致，横构图，无文字" `
  --video-prompt "保持首帧角色造型与水彩风格，小兔子轻轻迈步，小乌龟缓慢前行，镜头固定，动作连贯，儿童绘本氛围，无字幕" `
  --out "D:\b-doubao-trial\scene01.mp4"
```

若本机没有安装本项目：`python -m pip install -e ".[test]"`。请在项目根目录运行。输出 `scene01.png`、`scene01.mp4`、`scene01.generation.json`。可用 `python -m app.ai.cli qc-video --video "D:\b-doubao-trial\scene01.mp4" --expected-duration 5 --out "D:\b-doubao-trial\scene01.qc.json"` 做基本媒体检查，再由人核对故事内容、角色一致性和动作质量。

可以使用 `--reference 原书图片.png` 作图片生成参考；上传原书画面到云端前先核对作品授权与赛事规则。**不要把原书长篇文字或受版权保护图像在未经许可情况下上传。**

## 机制与边界

- Seedream 文生图（可选参考图）；本地保存 PNG，再把 PNG Base64 作为 `first_frame` 交给 Seedance 图生视频，轮询成功后下载真正生成的视频。不会用静态图拼接冒充 AI 视频。
- 两个请求的模型 ID、提示词哈希、任务 ID 和输出摘要记入 `.generation.json`；密钥、返回的临时签名链接不记录。任务超时后 JSON 中保留任务 ID，可在方舟控制台查询，避免重复提交造成重复扣费。视频 URL 有效期有限，应及时保存。
- 默认开启水印；单段仅为试片，整本书需按分镜多次生成并人工审核/剪辑，不能保证模型自动忠实复现书本。
- CLI 尚未接进 Web 端异步任务队列；真实登录、调用、支付限额、视频内容和时长待有凭证后验证。

官方接口：[图片生成 API](https://console.volcengine.com/ark/region%3Acn-beijing/docs/image-generation-api)、[创建视频任务](https://console.volcengine.com/ark/region%3Acn-beijing/docs/create-video-generation-task-api)、[查询视频任务](https://console.volcengine.com/ark/region%3Acn-beijing/docs/get-video-generation-task-api)。

## Windows 本机安全配置（推荐）

在项目根目录运行 `powershell -ExecutionPolicy Bypass -File scripts/setup_doubao.ps1`，在**本机终端**输入 API Key 和火山方舟控制台显示的两个模型 ID。密钥用 Windows 当前用户 DPAPI 加密保存到 `%LOCALAPPDATA%\PaperCompanion\Doubao\ark-key.dpapi`，模型 ID 保存到同目录 `models.json`；它们都不在仓库里。此方法不把密钥设为持久环境变量。

配置好后运行（将输出位置换成你希望的位置）：

```powershell
.\scripts\run_doubao.ps1 -ImagePrompt "儿童绘本水彩插画，小兔子与小乌龟在草地起跑线，无文字" -VideoPrompt "保持角色造型和水彩风格，小兔子与小乌龟向前行走，镜头固定" -Out "D:\b-doubao-trial\scene01.mp4"
```

每次运行会调用付费接口。密钥仅在子进程运行期间提供，结束后从启动脚本的环境中清除。**同一 Windows 用户运行脚本**；不要把 `%LOCALAPPDATA%\PaperCompanion\Doubao` 分享给其他人。

## 预算有限：只生成插画（不生成视频）

模型需先在方舟控制台完成开通；仅充值余额不等于开通模型。单次图片生成也可能扣费。

```powershell
.\scripts\run_doubao.ps1 -ImageOnly -ImagePrompt "儿童绘本插画，小兔子与小乌龟在草地起跑线，水彩风格，无文字" -Out "D:\b-doubao-trial\rabbit-tortoise.png"
```

此模式只调用一次 Seedream 图片接口，保存 PNG 和 `.generation.json`；不会创建 Seedance 视频任务。如果失败，查看 JSON 的 `image.status` 和 `image.error_message`。

## 复用现有插画生成视频（不重新生成图片）

```powershell
.\scripts\run_doubao.ps1 -ExistingImage "D:\b-doubao-trial\rabbit-tortoise.png" `
  -VideoPrompt "保持水彩风格与角色外形，小兔子轻轻迈步，小乌龟缓慢爬行，镜头固定，无字幕" `
  -Duration 5 -Out "D:\b-doubao-trial\rabbit-tortoise.mp4"
```

此模式只提交一次 Seedance 图生视频任务；输出 MP4 和 `.generation.json`，已有同名结果时拒绝再次付费提交。也可使用 CLI `doubao-video --image ... --video-prompt ... --out ...`。生成前请确认模型额度与计费。

## 2026-11-14 试验结果

最初用儿童绘本“小兔子与小乌龟在草地起跑线”样例提交 Seedream 图片请求时，没有创建视频任务，也没有获得图片。火山方舟返回 HTTP 429、错误码 `SetLimitExceeded`。这不是普通的请求频率超限；方舟官方错误码说明它表示模型/接入点已触发设置的用量上限、服务暂停。当前账号截图显示“安心体验”已开启，需由账号主人前往“开通管理”核对模型暂停状态和用量上限。**不要自动关闭安心体验或反复重试。** 官方说明关闭安心体验后可能无法重新开启，超出赠送额度会按量计费；由账号主人评估费用并亲自操作。若选择继续付费，应先设置可接受的模型用量上限，再仅试一张图片。

本地运行只保存受限格式的服务端错误码，不保存错误消息、API Key、账号信息或临时 URL。结果见本机 `rabbit-tortoise-seedream-retry-20261114.generation.json`；`video` 为 `null`。


随后用户调整服务设置，Seedream 5.5 单幅图片成功：2496×1664 PNG。复用该图片作为首帧，Seedance 2.5 单次生成约 5.04 秒、24 fps、1178×786 MP4；OpenCV 可以解码首帧及中间帧。测试素材只在本机 `doubao-trial` 目录，未提交 Git。`qc-video` 因本机缺少 ffprobe 返回 `FFPROBE_UNAVAILABLE`，不能据此宣称完整自动质量验收通过。图片/视频的内容质量仍须人工审核；视频按服务计费。
