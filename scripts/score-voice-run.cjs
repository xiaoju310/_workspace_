#!/usr/bin/env node
/**
 * 真人语音测试打分：读取历史页「导出后端留痕与延迟统计」得到的 CSV，与参考问句逐条对齐，
 * 计算语音识别字错率（CER）、改字比例、问答延迟 P50/P95。不判断回答是否正确（需要人工判定）。
 *
 * 用法：
 *   node scripts/score-voice-run.cjs <interactions.csv> <reference.json>
 *   node scripts/score-voice-run.cjs --self-test
 *
 * reference.json：按提问顺序排列的数组，例如 [{"id":"QA-01","text":"这只戴红围巾的小动物是谁"}, ...]
 * 对齐规则：CSV 里 input_method=speech 的问答记录按 created_at 排序后，与参考数组逐条对应。
 * 条数不一致时直接报错，不猜测对应关系（漏问/多问请先在 CSV 里删掉多余行或补问）。
 */
const fs = require('fs');

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

/** 只比较汉字、字母和数字；去掉标点空格，英文转小写；导出时防公式注入加的前导单引号也去掉 */
function normalize(s) {
  return String(s).replace(/^'(?=[=+\-@])/, '').toLowerCase().replace(/[^\p{Script=Han}\p{L}\p{N}]/gu, '');
}

function editDistance(a, b) {
  const x = [...a], y = [...b];
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= y.length; j += 1) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[y.length];
}

function percentile(values, p) {
  const v = values.filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
  if (!v.length) return null;
  return v[Math.min(v.length, Math.max(1, Math.ceil((p / 100) * v.length))) - 1];
}

function score(csvText, reference) {
  const speech = parseCsv(csvText)
    .filter((r) => r.type === 'voice' && r.input_method === 'speech')
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (speech.length !== reference.length) {
    throw new Error(`语音问答记录 ${speech.length} 条，参考问句 ${reference.length} 条，数量不一致，无法逐条对齐`);
  }
  let errors = 0, chars = 0;
  const items = speech.map((r, i) => {
    const ref = normalize(reference[i].text);
    const hyp = normalize(r.asr_transcript);
    const d = editDistance(ref, hyp);
    errors += d; chars += [...ref].length;
    return { id: reference[i].id, reference: reference[i].text, asr: r.asr_transcript, asr_error: r.asr_error || null,
      cer: ref.length ? +(d / [...ref].length).toFixed(3) : null, edited: r.transcript_edited === 'true',
      status: r.status, evidence_pages: r.evidence_pages, latency_ms: r.latency_ms === '' ? null : Number(r.latency_ms) };
  });
  const lat = items.map((i) => i.latency_ms).filter((n) => n !== null);
  return {
    samples: items.length,
    cer: chars ? +(errors / chars).toFixed(3) : null,
    edited_ratio: items.length ? +(items.filter((i) => i.edited).length / items.length).toFixed(3) : null,
    asr_failed: items.filter((i) => i.asr_error).length,
    latency_ms: { n: lat.length, p50: percentile(lat, 50), p95: percentile(lat, 95) },
    note: 'CER 只衡量识别文字；回答是否正确需要人工逐条判定。样本少于 20 条时 P95 不稳定。',
    items,
  };
}

function selfTest() {
  const assert = require('assert');
  assert.strictEqual(editDistance('小狐狸', '小狐狸'), 0);
  assert.strictEqual(editDistance('小狐狸找妈妈', '小湖里找妈妈'), 2);
  assert.strictEqual(normalize('“小狐狸”，在找谁呀？ ABC'), '小狐狸在找谁呀abc');
  assert.strictEqual(normalize("'=1+1"), '11');
  const csv = '﻿created_at,type,input_method,asr_transcript,asr_error,transcript_edited,status,evidence_pages,latency_ms\r\n'
    + '2026-11-10T02:00:02Z,voice,speech,"小湖里在找谁,呀",,true,success,2,300\r\n'
    + '2026-11-10T02:00:01Z,voice,speech,小狐狸是谁,,false,success,1,100\r\n'
    + '2026-11-10T02:00:03Z,voice,keyboard,打字提问,,,success,1,50\r\n'
    + '2026-11-10T02:00:04Z,touch,touch,,,,uncertain,,80\r\n';
  const out = score(csv, [{ id: 'A', text: '小狐狸是谁' }, { id: 'B', text: '小狐狸在找谁呀' }]);
  assert.strictEqual(out.samples, 2);
  assert.strictEqual(out.items[0].id, 'A');
  assert.strictEqual(out.items[0].cer, 0);
  assert.strictEqual(out.items[1].cer, +(2 / 7).toFixed(3));
  assert.strictEqual(out.cer, +(2 / 12).toFixed(3));
  assert.strictEqual(out.edited_ratio, 0.5);
  assert.deepStrictEqual(out.latency_ms, { n: 2, p50: 100, p95: 300 });
  assert.throws(() => score(csv, [{ id: 'A', text: 'x' }]), /数量不一致/);
  console.log('score-voice-run 自检通过');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === '--self-test') selfTest();
  else if (args.length === 2) {
    const result = score(fs.readFileSync(args[0], 'utf8'), JSON.parse(fs.readFileSync(args[1], 'utf8')));
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.error('用法: node scripts/score-voice-run.cjs <interactions.csv> <reference.json> | --self-test');
    process.exit(2);
  }
}

module.exports = { parseCsv, normalize, editDistance, score };
