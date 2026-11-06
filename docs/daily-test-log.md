# 每日测试记录

## 2026-11-04 D1

- 计划：写 P0 验收清单和 20 条初始功能测试用例
- 已完成：测试用例表、验收清单、记录结构
- 实际运行：未开始，当前工作区未发现项目代码或接口入口
- 状态：待联调
- 阻塞：项目路径、启动方式、接口地址、授权样本未提供
- 下一步：收到运行入口后执行 P0-001 至 P0-020，并附运行 ID、耗时和证据

## 2026-11-05 D2

- 已完成：两页自制示意图；10行文字、2个人物实例和4个物体实例的AI辅助标注；来源及SHA256登记；通用阅读字段验收草案。
- 真实执行：Windows.Media.Ocr中文基线，2页10行，6行通过/4行失败/0未测（去空白、保留标点）；4条真实错例，原始JSON及逐页耗时均保留。
- 范围：自制样本，非授权绘本；Windows OCR非项目PaddleOCR；不以60%行匹配率宣称赛题达标。
- 待办：E本人复核人工金标准，B用相同哈希输入回归PaddleOCR，取得授权绘本后实测。
- 证据：docs/test-results/d2/README.md、ocr-baseline-report.md、ocr-real-01.json、ocr-real-02.json。
- 状态：标注草稿与OCR基线完成，人工复核及项目集成待办；未自动通知团队、未推送。

## 2026-11-06 审核修订（对应 D1–D2）

- 独立工作副本已获取 origin/main（6ec10c996bfea272613634d9f3231deb60d6504a），合并前E分支落后8个main提交，合并无冲突。
- 修复D1清单路径，与 docs/test-cases.csv、docs/daily-test-log.md、docs/metrics.csv 一致。
- 按当前后端源码修订分类、笔记字段和P0计划；science/other为当前枚举，新增类型和字段明确标为拟议变更。
- 原D1“无代码”描述仅为当日历史，当前已有前后端；20条P0仍未实际执行。
- D2仅为自制样本AI辅助标注及Windows OCR基线。E本人复核、PaddleOCR回归、真实授权样本和项目验收仍待办。
- 修订验证与素材检查见 docs/test-results/d2/review-validation.md；PR描述草稿见同目录pr-description.md。
