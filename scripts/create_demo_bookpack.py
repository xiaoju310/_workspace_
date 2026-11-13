"""Create a self-authored 12-page children's story fixture outside Git-tracked assets."""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw


TEXT = [
    "小月亮从云后醒来。", "她想找一个朋友。", "她问树上的小鸟。", "小鸟带她去看小河。",
    "小河说，听听水声吧。", "水声引来一只小青蛙。", "青蛙邀请她去草地。", "草地上有会发光的萤火虫。",
    "大家一起数星星。", "小月亮发现朋友就在身边。", "她把温柔的光分享给大家。", "夜深了，他们说晚安。",
]
SCENES = ["云朵与夜空", "安静的山谷", "大树枝头", "月光下的小河", "河边的水波", "荷叶与青蛙",
          "星光草地", "萤火虫花园", "开阔的夜空", "朋友围成一圈", "温柔的月光", "安静的夜晚"]
MOTION = [["月亮轻轻呼吸", "云朵缓慢移动"], ["月亮微笑", "星星闪烁"], ["小鸟扇动翅膀"], ["水面泛起波纹"],
          ["水波扩散"], ["青蛙轻轻眨眼"], ["草叶摆动"], ["萤火虫缓慢飘动"], ["星星闪烁"],
          ["朋友轻轻摇摆"], ["月光渐亮"], ["云朵慢慢合拢"]]


def main() -> None:
    root = Path("data/synthetic/bookpack_demo")
    pages = root / "pages"
    pages.mkdir(parents=True, exist_ok=True)
    page_records = []
    for index, (text, scene, subjects) in enumerate(zip(TEXT, SCENES, MOTION), 1):
        image = Image.new("RGB", (1536, 2048), (18, 30 + index * 2, 68 + index * 4))
        draw = ImageDraw.Draw(image)
        draw.ellipse((250, 180, 520, 450), fill=(245, 229, 154), outline=(255, 247, 208), width=8)
        for star_x, star_y in ((100, 130), (620, 160), (120, 620), (650, 700), (540, 90)):
            draw.ellipse((star_x, star_y, star_x + 14, star_y + 14), fill=(255, 244, 170))
        draw.rounded_rectangle((96, 1660, 1440, 1920), radius=48, fill=(255, 255, 255))
        image.save(pages / f"{index:02d}.png")
        page_records.append({"page_no": index, "text": text, "scene": scene, "characters": ["小月亮"],
            "motion": {"level": "L2", "camera": "push_in_slow" if index % 3 else "static",
                        "subject": subjects, "duration_s": 6, "prompt": f"watercolor children's book illustration, {scene}, a friendly moon, no text",
                        "seed": 20261113 + index},
            "audio": {"narration": text, "voice": "pending_c_tts", "duration_s": 2.5},
            "source": {"type": "synthetic", "book_id": "pb-demo-001", "page": index, "license": "self-authored fixture"}})
        (pages / f"{index:02d}.json").write_text(json.dumps(page_records[-1], ensure_ascii=False, indent=2), encoding="utf-8")
    manifest = {"book_id": "pb-demo-001", "title": "小月亮找朋友", "age_range": "3-6", "page_count": 12,
                "canvas": [1536, 2048], "image_format": "png", "pages": page_records, "status": "candidate"}
    (root / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(root)


if __name__ == "__main__":
    main()
