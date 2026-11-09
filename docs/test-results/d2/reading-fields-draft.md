# D1–D2 通用阅读字段草案（2026-11-06 修订）

依据本次同步的 main（6ec10c996bfea272613634d9f3231deb60d6504a）中的 backend/app/schemas.py、backend/app/main.py 和 docs/api-contract.md 核对。以下“当前字段”为源码静态核对，尚未由 E 做接口实测。

## 当前后端约定

| 字段或操作 | 当前名称和值 | E 后续验收 |
|---|---|---|
| 图书类型 | picture_book / novel / textbook / science / other | 科普使用 science；其他类型使用 other |
| 请求自动分类 | requested_type（可省略）、force_reclassify | 不传类型与显式指定类型分开测试 |
| 分类响应 | book_id / predicted_type / confidence / reasons / confirmed_type / confirmed_by / status | confidence 是数值；不将规则分数视作校准概率 |
| 主人确认请求 | confirmed_type | 通过 PATCH /api/books/{book_id}/classification；检查归属 |
| 主人确认响应 | confirmed_type / confirmed_by / status | 自动分类不能代替主人确认；状态 CLASSIFIED / CONFIRMED |
| 笔记输出 | id / book_id / owner_id / content / status / version / created_at / updated_at | 归属、版本及状态可追踪 |
| 最小笔记内容 | content.template / content.summary / content.sources / content.is_placeholder | 占位内容不能认定真实分析成功；核验来源 |
| 笔记审核 | action=approve / revise | DRAFT / REVIEWING；审核通过后 PRIVATE，之后才可创建分享 |
| 分享接口 | share_mode=invite_only / link，shared_user_id，expires_at | 默认私有由权限和状态保障；不假设有 visibility 字段 |

当前请求枚举不接受 popular_science、unknown。请求遇到这些值应记录校验结果，不能直接当成有效类型提交；本次仅静态核对，未执行该测试。

## 拟议变更（未实现，待 A/B 确认）

- 若需要显式“无法分类”，讨论新增 unknown；当前先按 other 及 reasons 表示，不能未经确认改 API。
- popular_science 若需保留只作为展示或未来兼容别名；当前接口统一 science，不在本次修改后端枚举。
- 原草案 type_confidence、owner_confirmed_type、note_id、source_refs 对应当前 confidence、confirmed_type、id、content.sources；前者不再作为已实现字段描述。
- confirmed_at 虽在内部持久化，当前 ClassificationOut 未暴露；扩展响应需另行约定。
- visibility、独立 review_status、key_points、笔记内 model_version/run_id/output_mode 为拟议字段或展示需求，不宣称当前 NoteOut 已提供。

后续覆盖四类书、other、非法枚举、低置信度、主人改分类、缺来源笔记、未审核分享和越权审核。分享过期/撤销仍在后续任务验证。全部保留未测状态，D2 优先绘本主链路。
