# 门禁测试夹具

| 文件 | 内容 | 来源 | 用途 |
|---|---|---|---|
| `synthetic-test-video.mp4` | 640×480（4:3）、10fps、6 秒 H.264；浅色背景、底部绿色色块、中央橙色圆（位置固定），左上角写着 `SYNTHETIC TEST CLIP`；**每帧不同**：写有帧号，顶部蓝色色条随时间右移 | C 用 OpenCV 程序生成的合成画面，不含任何绘本或赛事素材 | CDP 门禁步骤 H：登记为运行产物 → 阅读页下载播放 → 在视频上测黑边拦截与触控留痕；播放中点击时核对"截图就是点击那一帧" |

**这不是 B 生成的视频**，只用来验证"前端能取回并播放 A 登记的视频、能在视频帧上做坐标换算和留痕"。
真实视频（B 的生成结果）到位后，需要用 B 的 `run_id` 再做一次人工验收。

生成方式（可复现）：`python3 scripts/fixtures/make_synthetic_video.py scripts/fixtures/synthetic-test-video.mp4`（OpenCV `avc1`，60 帧）。
sha256：`018e3b16cbe609556985b59c794482e9719da19fe07dc0a01580c13092fbb790`
