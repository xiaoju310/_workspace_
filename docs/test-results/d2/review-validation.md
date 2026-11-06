# D1–D2 审核修订验证（2026-11-06）

## 基线与范围

源分支 team/e-testing-docs 原提交 dc92eab；本次联网获取 main 基线 6ec10c996bfea272613634d9f3231deb60d6504a。合并前 main 有8个E未包含提交；独立副本已合并，无冲突。原仓库 .git 写入持续拒绝，因此分支同步在独立副本完成；原仓库只写回修订文档，不能称原仓库已完成合并。

本次为文档和测试计划修订。根据当前源码静态核对分类枚举、确认字段、笔记结构和审核状态，不把源码检查等同于接口实测。未重新运行历史OCR；原始输入、JSON和失败记录保留。

## 已执行的检查
- 路径存在：docs/test-cases.csv
- 路径存在：docs/daily-test-log.md
- 路径存在：docs/metrics.csv
- 20条P0全部保持未测。
- 两页图片SHA256均与登记表一致。
- OCR表10行：6通过、4失败；错例表4条；统计与报告一致。
- backend/app/schemas.py：BookType 使用 picture_book/novel/textbook/science/other。
- backend/app/main.py：静态核对分类确认、content.sources、DRAFT/PRIVATE及审核后分享逻辑。
- Git 合并无冲突；git diff --check 检查格式。

## 素材检查

本次修订只涉及 Markdown 和 CSV，没有新增图片、音频、授权书页、模型权重或真实儿童数据。D2 两张图片为自制图，哈希已核对；自制来源及本地测试使用范围见 docs/sources/d2-sample-register.csv。未引入新模型和第三方依赖；Windows OCR 细分模型版本不可获取，历史 JSON 已明确记录。此次文档检查未发现新增凭证内容，不宣称执行了全仓库专业密钥扫描。

## 保留的待办

- E本人复核标注，未完成前不称人工金标准已验收。
- B在同哈希输入上执行项目PaddleOCR回归。
- 20条P0仍未逐条实测，不能勾选项目验收通过。
- 授权真实绘本样本尚未实测。
- 更新PR #3描述需要GitHub会话；本次提供完整草稿，不宣称网页描述已更新。
