"""生成 CDP 门禁用的合成测试视频（不含任何绘本或赛事素材）。

640x480、10fps、6 秒 H.264。每一帧都不同：左上角写帧号，顶部有一条随时间右移的蓝色色条；
中央橙色圆（圆心 320,240）位置固定，供坐标换算检查使用。
帧各不相同，门禁才能核对"留痕里的截图就是点击那一帧"。

用法：python3 scripts/fixtures/make_synthetic_video.py scripts/fixtures/synthetic-test-video.mp4
"""
import sys

import cv2
import numpy as np

W, H, FPS, SECONDS = 640, 480, 10, 6


def main(out_path: str) -> None:
    writer = cv2.VideoWriter(out_path, cv2.VideoWriter_fourcc(*"avc1"), FPS, (W, H))
    if not writer.isOpened():
        raise SystemExit("无法创建 H.264 写入器（需要支持 avc1 的 OpenCV）")
    total = FPS * SECONDS
    for i in range(total):
        frame = np.full((H, W, 3), (200, 230, 245), np.uint8)  # 浅色背景（BGR）
        cv2.rectangle(frame, (0, 400), (W, H), (90, 170, 80), -1)  # 底部绿色色块
        x = int((W - 80) * i / (total - 1))
        cv2.rectangle(frame, (x, 60), (x + 80, 100), (200, 120, 40), -1)  # 移动的蓝色色条
        cv2.circle(frame, (320, 240), 80, (40, 110, 240), -1)  # 中央橙色圆
        cv2.putText(frame, "SYNTHETIC TEST CLIP", (16, 32), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (60, 60, 60), 2)
        cv2.putText(frame, f"FRAME {i:03d}", (16, 140), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (30, 30, 30), 2)
        writer.write(frame)
    writer.release()


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "synthetic-test-video.mp4")
