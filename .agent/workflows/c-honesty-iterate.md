---
description: 角色 C 诚实性自查与迭代（评审后或交付前运行）
---
1. 读取 `.agent/skills/paper-companion-honesty/SKILL.md` 与 `references/error-ledger.md`。
2. 运行 `bash .agent/skills/paper-companion-honesty/scripts/audit.sh`，保存输出。
3. 对每条未闭环项按 SKILL.md「标准流程」处理：先写会失败的测试 → 修复 → 变异自检 → 再跑 audit。
4. 把新发现的错误写入 error-ledger.md（含根因）并给 audit.sh 加规则。
5. 输出「已验证 / 未验证 / 依赖他人」三栏交付说明，附命令输出。
