#!/usr/bin/env bash
# 纸书智伴 · 角色 C 诚实性审计。每条规则来自 references/error-ledger.md 里的一个真实事故。
# 用法: bash .agent/skills/paper-companion-honesty/scripts/audit.sh   (在仓库根目录)
# 新增规则：在下方按"编号<TAB>说明<TAB>正则<TAB>排除路径正则<TAB>应当命中的样例"加一行。
# 字段用 TAB 分隔：之前用 | 分隔，含 | 的正则被切坏后 grep 报错又被吞掉，E03/E07/E11 一直空转。
# 样例自检保证规则不会再空转：样例命中不了就算审计失败。
set -u
cd "$(dirname "$0")/../../../.."
fail=0
SCOPE=(frontend/src frontend/scripts docs/verification scripts)

RULES=$(cat <<'RULES_END'
E01	默认/硬编码令牌	demo-token	__tests__	const t='demo-token-123'
E02	run_id 回退成固定值	run-default	__tests__	run_id||'run-default'
E03	硬编码的耗时/延迟常数(应为实测或 null)	(asr|llm_first_token|llm_total|tts_first_audio|tts_total)_ms: *[1-9]	__tests__	llm_total_ms: 180
E04	硬编码置信度(应透传引擎值或 null)	confidence: *0\.[1-9][0-9]*[,} ]	__tests__|mock/|demo	confidence: 0.88,
E05	基准用例硬编码 passed: true	passed: true,	__tests__	passed: true,
E06	空 catch 吞错	catch *(\([a-z]*\))? *\{ *\}	__tests__|mock/|check-backend	catch {}
E07	catch 后直接 return 空数组/false(吞错)	catch *\{ *return (\[\]|false)	__tests__	catch { return [] }
E08	Live 代码引用 Demo 夹具	DEMO_BOOK_SLICES	__tests__|indexing/TimeSliceIndexer.ts	new X(DEMO_BOOK_SLICES)
E09	出现故事专用硬编码答案	小狐狸皮皮	__tests__|indexing/TimeSliceIndexer.ts|mock/	这是小狐狸皮皮
E10	origin 按模式冒充真实	origin: *appMode *=== *'live' *\? *'real'	__tests__	origin:appMode==='live'?'real':'mock'
E11	测试里自己重写被测逻辑(应 import 生产代码)	function (validateInteractionPayload|checkBoundingBox|processAsrTranscription|canTransition|buildBackendInteractionPayload)	node_modules	function canTransition(a,b)
E12	UI 书籍类型未映射就发给 A	confirmClassification\(.*selectedType	__tests__	confirmClassification(id,selectedType)
E13	验证脚本往页面写内容(会把结论伪造进截图)	(innerText|textContent|innerHTML) *= *[^=]	frontend/src	errEl.innerText = '已拦截'
E14	前端自造 run_id 发给后端(只允许 Demo 分支)	run_id: *uid\(|run_id: *crypto\.randomUUID	__tests__	run_id:uid('run')
E15	三元表达式里写死置信度(E-024：本地导入写死 0.72)	confidence:[^,]*\?[^,]*: *0?\.[1-9]	__tests__|mock/	confidence:input.type==='unknown'?null:.72
E16	界面写死"已达标"结论(E-022：看板/基准页无测量即宣称达标)	已达标 *\(	__tests__	门槛状态: 已达标 (≥60%)
RULES_END
)

while IFS=$'\t' read -r id desc pat ex sample; do
  [ -z "$id" ] && continue
  if ! printf '%s\n' "$sample" | grep -qE -- "$pat"; then
    echo "✗ [$id] 规则失效：样例没有命中（正则写错了）"; fail=1; continue
  fi
  raw=$(grep -rnE -- "$pat" "${SCOPE[@]}" 2>&1); rc=$?
  if [ "$rc" -ge 2 ]; then echo "✗ [$id] grep 执行失败：$raw"; fail=1; continue; fi
  hits=$(printf '%s' "$raw" | grep -vE -- "$ex")
  if [ -n "$hits" ]; then
    echo "✗ [$id] $desc"; echo "$hits" | cut -c1-200 | sed 's/^/    /'; fail=1
  else
    echo "✓ [$id] $desc"
  fi
done <<<"$RULES"

echo "--- 依赖锁文件：package.json 与 package-lock.json 一致，本机装的就是锁定版本（E-034）---"
( cd frontend && node -e '
const pkg=require("./package.json"), lock=require("./package-lock.json"), root=lock.packages[""]||{};
const bad=[];
for (const f of ["dependencies","devDependencies"]) {
  const a=pkg[f]||{}, b=root[f]||{};
  for (const k of new Set([...Object.keys(a),...Object.keys(b)])) if (a[k]!==b[k]) bad.push(`${f}.${k}: package.json=${a[k]} lock=${b[k]}`);
  for (const k of Object.keys(a)) {
    const want=lock.packages["node_modules/"+k]?.version; let have;
    try { have=require("./node_modules/"+k+"/package.json").version } catch { have="未安装" }
    if (want!==have) bad.push(`${k}: 锁定 ${want}，本机 ${have}（请在 frontend 下 npm ci）`);
  }
}
if (bad.length) { console.error(bad.join("\n")); process.exit(1) }
console.log("锁文件一致，本机依赖与锁定版本相同");
' ) || { echo "✗ 依赖锁文件不一致：干净目录 npm ci 会失败，或本机门禁跑的不是锁定版本"; fail=1; }

echo "--- 类型检查 / 单测 / 构建 ---"
( cd frontend && npx tsc -b && npx vitest run 2>&1 | tail -5 && npm run build >/dev/null 2>&1 && echo "build ok" ) || { echo "✗ 类型检查/单测/构建失败"; fail=1; }

echo "--- 真人语音测试打分脚本自检 ---"
node scripts/score-voice-run.cjs --self-test || { echo "✗ 语音打分脚本自检失败"; fail=1; }

echo "--- 离线原型：真实浏览器打开并确认渲染 ---"
( cd frontend && npm run --silent prototype 2>&1 | tail -3 ) ; [ "${PIPESTATUS[0]}" -eq 0 ] || fail=1
( cd frontend && node scripts/verify-prototype.cjs >/dev/null 2>&1 ) || { echo "✗ 离线原型未通过"; fail=1; }

echo "--- 真实后端联调：真实前端代码经 HTTP 打真实 FastAPI ---"
bash scripts/check-live-flow.sh 2>&1 | grep -E "Tests |未验证|后端未能启动|FAIL" | cut -c1-200
[ "${PIPESTATUS[0]}" -eq 0 ] || { echo "✗ 真实后端联调未通过"; fail=1; }

echo "--- 真实浏览器 CDP 门禁：真实 Chrome 鼠标事件走完主流程与黑边拦截 ---"
node scripts/verify-real-browser-cdp.cjs >/dev/null 2>&1 && echo "真实浏览器 CDP 门禁通过（Google Chrome：全流程+黑边拦截+虚拟麦克风录音+视频产物播放与视频触控（含播放中点击同帧核对）+服务端只读分享核验+后端留痕直查）" || { echo "✗ 真实浏览器 CDP 门禁未通过"; fail=1; }

[ "$fail" -eq 0 ] && echo "审计通过" || echo "审计未通过"
exit $fail
