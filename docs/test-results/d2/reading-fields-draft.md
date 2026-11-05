# D1–D2 通用阅读字段草案（待 A/B 确认）

本文为 E 验收建议，不宣称接口已经实现或团队已冻结字段。

| 字段 | 建议含义 | 验收点 |
|---|---|---|
| book_id / page_no / chapter | 书和来源位置 | 可定位、不跨书串数据 |
| predicted_type | picture_book / novel / textbook / popular_science / unknown | 不支持时明确 unknown |
| type_confidence | 数值或 null | 缺失与 0 区分，说明来源和是否校准 |
| owner_confirmed_type | 主人确认的类型或 null | 自动分类不冒充主人确认 |
| confirmed_by / confirmed_at | 复核人及时间 | 记录变更，不由客户端单独授予权限 |
| note_id / owner_id / book_id | 笔记身份和归属 | 每次读写均检查主人身份 |
| title / summary / key_points | 最小笔记输出 | 对应书型，缺依据明确标记 |
| source_refs | 页码或章节及引用定位 | 笔记可追溯至原始输入 |
| review_status | draft / pending / approved / rejected | 自动生成默认 draft，主人审核后才可分享 |
| visibility | private（默认） | 初次生成不公开 |
| model_version / run_id / output_mode | 来源版本、运行ID、real/mock/cache/static | 分模式记录实测 |

后续验收：覆盖四种书型、低/缺失置信度、主人改分类、笔记缺来源、未审核分享、他人审批越权。分享过期/撤销在 D8–D10 验证，当前均未测。D2 优先绘本主链路。