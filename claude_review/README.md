# 纸书智伴 · 角色 C（伴读交互与全链路联调）审查指引包

> **致审阅专家 / Claude**：
> 本目录为第二届北京市大学生“人工智能+”创新大赛——好未来企业赛题《“纸书智伴”：纸质图书多模态智能升级与智能伴读》中，**任务角色 C（语音、触控与应用联调负责人）** 交付的完整代码、设计架构、测试套件与队长审核闭环资料。
> 请审阅本包中的技术设计、代码实现与测试结果，重点审核真实接口契约对齐、防幻觉机制、触控黑边拦截算法以及模式物理隔离。

---

## 一、审查快速导航

| 序号 | 审查文档 | 核心内容 |
| :--- | :--- | :--- |
| **01** | [01_PROJECT_AND_COMPETITION_CONTEXT.md](./01_PROJECT_AND_COMPETITION_CONTEXT.md) | 赛题背景、团队五大角色职责划分、角色 C 第一周全量目标 |
| **02** | [02_ARCHITECTURE_AND_TECHNICAL_DESIGN.md](./02_ARCHITECTURE_AND_TECHNICAL_DESIGN.md) | 角色 C 技术架构设计、核心算法、防幻觉 RAG、黑边拦截、TTS |
| **03** | [03_PR5_REVIEW_AND_CLOSURE_MATRIX.md](./03_PR5_REVIEW_AND_CLOSURE_MATRIX.md) | 队长针对 PR #5 提出的 5 大评审意见逐条闭环整改对照表 |
| **04** | [04_API_CONTRACT_AND_BACKEND_ALIGNMENT.md](./04_API_CONTRACT_AND_BACKEND_ALIGNMENT.md) | 与后端 A 的真实接口契约规范 (`/api/...`、Bearer 认证、留痕) |
| **05** | [05_TEST_SUITE_AND_VERIFICATION_REPORT.md](./05_TEST_SUITE_AND_VERIFICATION_REPORT.md) | 全量自动化测试报告 (17 项单元测试 + 16 项验证脚本 + 15 项基准) |
| **06** | [06_WEEK1_DELIVERY_CHECKLIST.md](./06_WEEK1_DELIVERY_CHECKLIST.md) | D1~D7 每日交付任务核验清查清单 |
| **源码** | [src_bundle/](./src_bundle/) | 角色 C 交付的全部核心 TypeScript/React 源代码镜像 |

---

## 二、一分钟本地快速复现与验证

在包含本项目的仓库根目录下，可直接运行以下命令验证全部门禁：

```bash
# 1. 验证后端 A 接口适配契约 (12/12 PASS)
node docs/verification/check-api.cjs

# 2. 验证角色 C 交互、黑边、空转写与状态机 (4/4 PASS)
node docs/verification/check-interaction.cjs

# 3. 运行全部 Vitest 单元测试 (17/17 PASS)
cd frontend && npm test

# 4. TypeScript 严格类型检查与 Vite 生产构建 (0 errors, 0 warnings)
npm run build

# 5. 编译自包含离线单文件 HTML 原型 (669 KB)
npm run prototype
```

---

## 三、审查核心关注点提示

1. **真实服务模式 (Live) 与本地演示模式 (Demo) 物理隔离**：
   - 是否在真实模式下坚决不使用伪造数据？接口失败时是否诚实向用户报错？
2. **触控黑边拦截算法 (VideoCoordinateMapper)**：
   - 是否精确剔除了 `object-fit: contain` 产生的 Letterbox 与 Pillarbox 黑边？
   - 是否通过了数学边界的单测覆盖？
3. **真实语音识别与空转写护航 (AsrProvider)**：
   - 是否接入了原生普通话识别？
   - 空转写或静音时是否杜绝了替用户编造假提问？
4. **后端 A 规范严格对齐 (api.ts)**：
   - 交互记录上报是否严格包含 `output.producer: "c_interaction_agent"`、合法类型及非负延迟？
   - 分类确认是否对接 `PATCH /api/books/{id}/classification`？
   - 笔记全生命周期（草稿 -> 审核 -> 只读分享 -> 撤销）是否完全由服务端驱动？
