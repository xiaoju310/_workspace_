# D3 模型与素材来源/许可核查（2026-11-06）

证据来源：本次获取的 B 分支 189f3632ebb13bb2424f3efe3acaec5d4dfa02d1 的 docs/model-experiments.md，快照在 ../test-results/d3/b-experiments-snapshot.md。本表为团队已有记录转录，未下载权重、未重新核验官方网站和许可证原文，不构成分发许可确认。

| 项目 | 版本与来源记录 | 许可记录与核验状态 | 当前范围 |
|---|---|---|---|
| OCR | PaddleOCR 3.7.0；PP-OCRv6_medium_det / rec；B称从官方模型源经ModelScope取得 | B记录模型README为Apache-2.0；原文及分发条件待B提供 | 历史自制图OCR成功，不是本次运行 |
| VLM | HuggingFaceTB/SmolVLM-256M-Instruct；revision 7e3e67edbbed1bf9888184d9df282b700a323964 | B记录模型卡Apache-2.0；未独立核查 | 历史CPU自制图调用，不是绘本质量结论 |
| 视频候选 | HunyuanVideo-1.5；精确revision/权重未取得 | 许可证原文、适用范围待确认；不得标为已获许可 | 仅候选，不可用/未实测 |
| 视频服务备选 | 尚未配置获准服务 | 服务条款、输入授权、费用和留存待确认 | 待A/B选择 |
| D2及D3测试输入 | 自制PNG/JPEG、故意损坏字节、虚构四书型文本 | 团队本地测试；D2哈希有登记，无真实儿童数据 | 非赛事授权绘本 |
| 后端工具依赖 | backend/requirements.txt；本次实际版本见environment.json | 依赖包随附许可元数据见dependency-licenses.json；本次未分发依赖二进制 | 仅隔离环境测试 |
| 前端模拟视频 | docs/demo/frontend-simulation.mp4；来源见docs/source-inventory.md | 团队前端模拟录屏，非模型生成 | 不计真实I2V/T2V |

缺失项：视频provider精确版本、输入授权凭据、许可证原文/适用条件、输出路径及哈希、提示词哈希、单次耗时、峰值显存或账单、成功和失败运行记录。由B提供，E核对后补录。阻塞超过半天应由E向A报告，本次不自动发送团队消息。
