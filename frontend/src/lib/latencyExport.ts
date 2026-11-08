/**
 * D13「导出延迟日志」/ D11「复测延迟、标记缓存命中」：
 * 直接用 A 后端里的交互留痕（GET /api/runs/{run_id}/interactions）生成 CSV 与统计摘要，交给 E 复核。
 *
 * 口径（写进导出文件，避免被误读）：
 *  - 问答：latency_ms 是前端从发起请求到拿到回答的耗时，不含录音时长、ASR、TTS 首音；
 *  - 触控：latency_origin=click 时从点击算起（含截图、读取时间轴），即任务书 D9 的「点击到首字」；
 *    latency_origin=request（重试或旧记录）时从发起识别请求算起；
 *  - TTS 首音未进后端留痕（A 的接口只接受 voice/touch 且只能追加），这里没有这一项；
 *  - P50/P95 用最近秩法(nearest-rank)，只统计 latency_ms 为非负数的样本，并给出样本数；
 *  - 缓存命中与未命中分开统计，避免命中样本把延迟拉低后被当成"热启动效果"；
 *  - 不计算正确率：正确率需要人工标准答案，这里没有。
 */

export interface BackendInteractionRecord {
  id: string;
  run_id: string;
  interaction_type: string;
  input: Record<string, any>;
  output: Record<string, any>;
  latency_ms: number | null;
  created_at: string;
}

export interface LatencyStats {
  n: number;
  p50: number | null;
  p95: number | null;
  mean: number | null;
  max: number | null;
}

/** 最近秩法分位数；空数组返回 null */
export function percentile(values: number[], p: number): number | null {
  const sorted = values.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(sorted.length, rank) - 1];
}

export function latencyStats(values: (number | null | undefined)[]): LatencyStats {
  const ok = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0);
  if (!ok.length) return { n: 0, p50: null, p95: null, mean: null, max: null };
  return {
    n: ok.length,
    p50: percentile(ok, 50),
    p95: percentile(ok, 95),
    mean: Math.round(ok.reduce((s, v) => s + v, 0) / ok.length),
    max: Math.max(...ok),
  };
}

export interface LatencySummary {
  run_id: string;
  generated_at: string;
  total_records: number;
  definitions: Record<string, string>;
  groups: Record<string, LatencyStats & { records: number }>;
}

function groupKey(r: BackendInteractionRecord): string {
  const cache = r.output?.cache_hit === true ? 'cache_hit' : 'cache_miss';
  if (r.interaction_type === 'voice') return `voice_${r.input?.input_method === 'speech' ? 'speech' : 'keyboard'}_${cache}`;
  if (r.interaction_type === 'touch') return `touch_${r.input?.frame_source?.kind ?? 'unknown'}_${cache}`;
  return `other_${cache}`;
}

export function summarizeRecords(runId: string, records: BackendInteractionRecord[], now = new Date()): LatencySummary {
  const buckets = new Map<string, BackendInteractionRecord[]>();
  for (const r of records) {
    const key = groupKey(r);
    buckets.set(key, [...(buckets.get(key) ?? []), r]);
  }
  const groups: LatencySummary['groups'] = {};
  for (const [key, items] of [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    groups[key] = { records: items.length, ...latencyStats(items.map((i) => i.latency_ms)) };
  }
  return {
    run_id: runId,
    generated_at: now.toISOString(),
    total_records: records.length,
    definitions: {
      latency_ms: '问答：前端发起请求到拿到回答（含本地检索或模型服务调用），不含录音时长、ASR、TTS 首音；触控：latency_origin=click 时从点击到拿到识别结果（含截图），=request 时从发起识别请求算起',
      tts_first_audio: '未包含：TTS 首音只在阅读页显示，未写入后端留痕',
      percentile: '最近秩法；n 为有效延迟样本数',
      grouping: '按 类型_输入方式或画面来源_是否缓存命中 分组',
      accuracy: '未计算：需要人工标准答案',
    },
    groups,
  };
}

const COLUMNS = [
  'created_at', 'interaction_id', 'run_id', 'type', 'input_method', 'frame_kind', 'query', 'video_ms',
  'norm_x', 'norm_y', 'status', 'answer_source', 'recognition', 'target', 'cache_hit', 'latency_ms',
  'evidence_pages', 'audio_sha256', 'audio_duration_ms', 'asr_transcript', 'asr_error', 'transcript_edited',
  'frame_snapshot_sha256', 'video_asset_sha256', 'capture_ms', 'latency_origin', 'frame_time_ms', 'paused_on_click',
] as const;

function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value);
  // 防 CSV 公式注入（Excel 会执行以 = + - @ 开头的单元格）
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function recordToRow(r: BackendInteractionRecord): Record<(typeof COLUMNS)[number], unknown> {
  const i = r.input ?? {};
  const o = r.output ?? {};
  const pages = Array.isArray(o.evidence) ? [...new Set(o.evidence.map((e: any) => e?.page_no).filter((p: unknown) => p !== undefined && p !== null))].join('|') : '';
  return {
    created_at: r.created_at,
    interaction_id: r.id,
    run_id: r.run_id,
    type: r.interaction_type,
    input_method: i.input_method ?? (r.interaction_type === 'touch' ? 'touch' : ''),
    frame_kind: i.frame_source?.kind ?? '',
    query: i.query ?? '',
    video_ms: i.video_ms ?? '',
    norm_x: i.norm_x ?? '',
    norm_y: i.norm_y ?? '',
    status: o.status ?? '',
    answer_source: o.answer_source ?? '',
    recognition: o.recognition ?? '',
    target: o.target ?? '',
    cache_hit: o.cache_hit === true ? 'true' : o.cache_hit === false ? 'false' : '',
    latency_ms: r.latency_ms ?? '',
    evidence_pages: pages,
    audio_sha256: i.audio?.sha256 ?? '',
    audio_duration_ms: i.audio?.duration_ms ?? '',
    asr_transcript: i.asr_transcript ?? '',
    asr_error: i.asr_error ?? '',
    transcript_edited: typeof i.transcript_edited === 'boolean' ? String(i.transcript_edited) : '',
    frame_snapshot_sha256: i.frame_snapshot?.sha256 ?? '',
    video_asset_sha256: i.frame_source?.asset_sha256 ?? '',
    capture_ms: i.frame_snapshot?.capture_ms ?? '',
    latency_origin: i.latency_origin ?? '',
    frame_time_ms: i.frame_snapshot?.frame_time_ms ?? '',
    paused_on_click: typeof i.paused_on_click === 'boolean' ? String(i.paused_on_click) : '',
  };
}

export function buildInteractionCsv(records: BackendInteractionRecord[]): string {
  const lines = [COLUMNS.join(',')];
  for (const r of records) {
    const row = recordToRow(r);
    lines.push(COLUMNS.map((c) => cell(row[c])).join(','));
  }
  // BOM：Excel 打开中文不乱码
  return '﻿' + lines.join('\r\n') + '\r\n';
}
