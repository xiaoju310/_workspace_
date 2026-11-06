---
name: paper-companion-honesty
description: 纸书智伴角色 C（语音/触控/应用联调）的诚实性与契约守门技能。在修改 frontend/src/lib/api.ts、features/interaction/*、app/WorkspaceApp.tsx、pages/InteractiveReaderPage.tsx，或声称"已闭环/已通过/100%"之前必须使用。包含历史错误台账、静态审计脚本、与后端 A 的契约速查、自查迭代协议。
---

# 纸书智伴 · 角色 C 诚实性技能

## 何时使用
- 改动上述文件之前（先读 `references/error-ledger.md`，避免重犯）；
- 写"已闭环 / 已通过 / 100% / 对齐"这类结论之前（必须附命令输出作证据）；
- 发现了新的错误或被评审指出问题之后（更新台账 + 加审计规则，见"更新协议"）。

## 三条铁律
1. **证据先于结论**：任何"已完成"必须同时给出 (a) 改动的文件:行，(b) 能失败的测试名，(c) 实际命令输出。没有这三样，只能写"未验证"。
2. **失败要被看见**：Live 路径上任何失败（网络/鉴权/校验/写库）都必须到达用户界面或返回值里的显式字段；禁止 `catch {}`、禁止 `catch → return []/false/mock`。
3. **Live 里不存在假数据**：Live 代码路径不得 import 任何夹具（DEMO_*）、不得出现故事专用词/答案、不得硬编码耗时与置信度。拿不到就写 `null` / `uncertain` / `no_evidence`。

## 证据的标准（E-013 之后新增）
- **打开看过**才算证据：截图要真的看，产物要真的运行，发布前逐个检查。
- **能失败**才算门禁：先让它变红一次，再相信它变绿。
- **绕过要写明**：联调里任何跳过接口、直接写库、用假数据的地方，都要写进"已验证"这一栏。
- 流程类功能要从用户入口走完一遍，不能只测函数。

## 标准流程（每次改动都走）
1. `bash .agent/skills/paper-companion-honesty/scripts/audit.sh` → 记录基线（应全绿）。
2. 读 `references/error-ledger.md` 中与本次改动相关的条目；读 `references/contract-cheatsheet.md` 核对字段/状态。
3. 先写**会失败**的测试（必须 `import` 生产代码，禁止在测试里重写被测逻辑），再改代码。
4. **变异自检**：临时破坏被测逻辑一处（如删掉黑边判断、让写库失败返回 ok），确认测试变红，再还原。测试变不红 = 测试无效。
5. 重跑 audit.sh（含 tsc / vitest / build）。
6. 在交付说明里用"已验证 / 未验证 / 依赖他人"三栏如实列出，不得把"未验证"写成"已闭环"。

## 更新协议（让它越用越准）
- 发现新错误 → 在 `references/error-ledger.md` 末尾按模板追加一条（现象/根因/修复/回归测试/审计规则）。
- 能被 grep 抓住的 → 同时在 `scripts/audit.sh` 的 `RULES` 里加一行并确保当前代码对它通过。
- 契约有变（A 改了路由/枚举/状态）→ 先改 `references/contract-cheatsheet.md`，再改代码与测试。
- 每次评审后回填"自我反省"小节：这次错误属于哪一类根因？以前台账里有没有同类？为什么没拦住？

## 目录
- `references/error-ledger.md`：历史错误台账 + 根因分类（先读这个）。
- `references/contract-cheatsheet.md`：A 的接口、枚举、状态机速查，以及已知的契约空白。
- `scripts/audit.sh`：静态审计 + tsc + vitest + build + 离线原型渲染 + 真实后端联调，一键门禁。
