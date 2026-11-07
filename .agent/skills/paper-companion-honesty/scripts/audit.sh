#!/usr/bin/env bash
# 纸书智伴 · 角色 C 诚实性静态审计。每条规则来自 references/error-ledger.md 里的一个真实事故。
# 用法: bash .agent/skills/paper-companion-honesty/scripts/audit.sh   (在仓库根目录)
# 发现新的错误类型时：先在 error-ledger.md 记账，再在下方 RULES 加一行规则。
set -u
cd "$(dirname "$0")/../../../.."
SRC=frontend/src
fail=0

# 格式: "ID|说明|grep -E 正则|排除路径正则"
RULES=(
 "E01|默认/硬编码令牌|demo-token|__tests__"
 "E02|run_id 回退成固定值|run-default|__tests__"
 "E03|硬编码的耗时/延迟常数(应为实测或 null)|(asr|llm_first_token|llm_total|tts_first_audio|tts_total)_ms: *[1-9]|__tests__"
 "E04|硬编码置信度(应透传引擎值或 null)|confidence: *0\\.[1-9][0-9]*[,} ]|__tests__|mock/|demo"
 "E05|基准用例硬编码 passed: true|passed: true,|__tests__"
 "E06|空 catch 吞错|catch *(\\([a-z]*\\))? *\\{ *\\}|__tests__|mock/|check-backend"
 "E07|catch 后直接 return 空数组/false(吞错)|catch *\\{ *return (\\[\\]|false)|__tests__"
 "E08|Live 代码引用 Demo 夹具(只允许 lib/api.ts 的 demo 分支与索引定义)|DEMO_BOOK_SLICES|__tests__|indexing/TimeSliceIndexer.ts"
 "E09|出现故事专用硬编码答案|小狐狸皮皮|__tests__|indexing/TimeSliceIndexer.ts|mock/"
 "E10|origin 按模式冒充真实|origin: *appMode *=== *'live' *\\? *'real'|__tests__"
 "E11|测试里自己重写被测逻辑(应 import 生产代码)|function (validateInteractionPayload|checkBoundingBox|processAsrTranscription|canTransition|buildBackendInteractionPayload)|node_modules"
 "E12|UI 书籍类型未映射就发给 A|confirmClassification\\(.*selectedType|__tests__"
)

for rule in "${RULES[@]}"; do
  IFS='|' read -r id desc pat ex1 ex2 ex3 <<<"$rule"
  hits=$(grep -rnE "$pat" "$SRC" docs/verification 2>/dev/null | grep -vE "${ex1:-NOEXCLUDE}" | { [ -n "${ex2:-}" ] && grep -vE "$ex2" || cat; } | { [ -n "${ex3:-}" ] && grep -vE "$ex3" || cat; })
  if [ -n "$hits" ]; then
    echo "✗ [$id] $desc"; echo "$hits" | sed 's/^/    /'; fail=1
  else
    echo "✓ [$id] $desc"
  fi
done

echo "--- 类型检查 / 单测 / 构建 ---"
( cd frontend && npx tsc -b && npx vitest run 2>&1 | tail -5 && npm run build >/dev/null 2>&1 && echo "build ok" ) || fail=1
exit $fail
