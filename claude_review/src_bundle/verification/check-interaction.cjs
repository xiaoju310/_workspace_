// 角色 C 回归门禁：直接运行真实的 Vitest 套件（导入生产代码），不再在脚本里重写被测逻辑。
// 旧版脚本自己实现了 validateInteractionPayload / checkBoundingBox / 状态机再断言自己，属于自证，已删除。
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const frontend = path.resolve(__dirname, '../../frontend')
console.log('--- 角色 C: 运行 src/features/interaction 全部单测（含 mapper / ASR / API / noteSync） ---')
const r = spawnSync('npx', ['vitest', 'run', 'src/features/interaction'], { cwd: frontend, stdio: 'inherit' })
process.exit(r.status ?? 1)
