/**
 * 第 5 轮（D8~D14）回归测试。每组对应 error-ledger 的一个新条目（E-028 ~ E-030）或一个新交付物，
 * 关键用例做过变异自检（撤回修复后变红），见 docs/C-两周交付说明-D1-D14.md。
 */
import { describe, it, expect } from 'vitest';
import { pickVideoAsset, loadRunVideo } from '../../../lib/runVideo';
import { ApiClient, buildFrameInput } from '../../../lib/api';
import { ApiError, createApiClient } from '../../../api/client';
import { fitWithin } from '../frameCapture';
import { parseSharedRef, serverShareHash, loadSharedNote, toSharedNoteView } from '../../../lib/sharedNoteView';
import { percentile, latencyStats, summarizeRecords, buildInteractionCsv } from '../../../lib/latencyExport';
import type { BackendInteractionRecord } from '../../../lib/latencyExport';
import { buildSlicesFromBook } from '../indexing/buildSlices';
import { TimeSliceIndexer } from '../indexing/TimeSliceIndexer';
import { summarizeInteractions } from '../metrics/LatencyMetricsDashboard';
import type { Interaction } from '../../../app/types';

// ---------------- E-028 Live 视频播放 ----------------
describe('E-028 阅读页必须从 A 的运行产物取回 B 的视频', () => {
  const v = (id: string, created_at: string, extra: Partial<any> = {}) => ({ id, asset_type: 'video', mime_type: 'video/mp4', sha256: `sha-${id}`, created_at, ...extra });
  it('只认 video/mp4，多个时取最晚登记的', () => {
    expect(pickVideoAsset([])).toBeNull();
    expect(pickVideoAsset([{ id: 'a', asset_type: 'audio', mime_type: 'audio/wav', sha256: 'x' }])).toBeNull();
    expect(pickVideoAsset([{ id: 'w', asset_type: 'video', mime_type: 'video/webm', sha256: 'x' }])).toBeNull();
    expect(pickVideoAsset([v('old', '2026-11-10T01:00:00Z'), v('new', '2026-11-12T01:00:00Z')])?.id).toBe('new');
  });
  it('没有视频 → none（如实显示静态书页），不会去下载', async () => {
    let downloads = 0;
    const r = await loadRunVideo({ getRunAssets: async () => [{ id: 'a', asset_type: 'subtitle', mime_type: 'text/vtt', sha256: 's' }], getAssetContent: async () => { downloads += 1; return new Blob(); } }, 'run-1', () => 'blob:x');
    expect(r).toEqual({ status: 'none', assetCount: 1 });
    expect(downloads).toBe(0);
  });
  it('有视频 → 带令牌下载成 blob: URL，并带出 asset_id/sha256；丢失的 MIME 按登记类型补上', async () => {
    let made: Blob | null = null;
    const r = await loadRunVideo(
      { getRunAssets: async () => [v('vid', '2026-11-12T00:00:00Z')], getAssetContent: async () => new Blob([new Uint8Array([0, 0, 0, 32])]) },
      'run-1',
      (b) => { made = b; return 'blob:video-1'; }
    );
    expect(r).toMatchObject({ status: 'ready', url: 'blob:video-1', asset: { id: 'vid', sha256: 'sha-vid' }, sizeBytes: 4 });
    expect(made!.type).toBe('video/mp4');
  });
  it('列表失败或内容为空 → 抛错，不能当成"没有视频"', async () => {
    await expect(loadRunVideo({ getRunAssets: async () => { throw new ApiError(401, 'UNAUTHORIZED', '令牌无效'); }, getAssetContent: async () => new Blob() }, 'r')).rejects.toThrow('令牌无效');
    await expect(loadRunVideo({ getRunAssets: async () => [v('vid', '')], getAssetContent: async () => new Blob([]) }, 'r', () => 'blob:x')).rejects.toThrow('视频产物内容为空');
  });
  it('ApiClient.getAssetContent 带 Bearer 令牌请求 /content，返回 Blob', async () => {
    const calls: any[] = [];
    const fetchImpl = (async (url: string, init: any) => {
      calls.push({ url, auth: new Headers(init.headers).get('Authorization') });
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'Content-Type': 'video/mp4' } });
    }) as any;
    const api = new ApiClient({ client: createApiClient('http://localhost:8000', { getToken: () => 'tok', fetch: fetchImpl }) });
    const blob = await api.getAssetContent('run-1', 'asset-1');
    expect(blob.size).toBe(3);
    expect(calls[0]).toEqual({ url: 'http://localhost:8000/api/runs/run-1/assets/asset-1/content', auth: 'Bearer tok' });
  });
});

// ---------------- D8 触控留痕写明画面来源与截图指纹 ----------------
describe('D8 触控留痕：点的是视频还是静态书页、点击瞬间截图指纹', () => {
  const tp = { norm_x: 0.5, norm_y: 0.5, video_pixel_x: 320, video_pixel_y: 240, video_width: 640, video_height: 480 };
  const vp = { container_width: 800, container_height: 450, render_width: 600, render_height: 450, offset_x: 100, offset_y: 0, is_letterbox: true };
  it('fitWithin 等比缩放到长边上限，不放大', () => {
    expect(fitWithin(1920, 1080, 640)).toEqual({ width: 640, height: 360 });
    expect(fitWithin(320, 240, 640)).toEqual({ width: 320, height: 240 });
    expect(fitWithin(0, 240, 640)).toEqual({ width: 0, height: 0 });
  });
  it('视频帧：带视频产物 sha256 与截图 sha256；静态图不带产物信息；没截到图写明原因', async () => {
    const shot = new Blob([new Uint8Array([9, 9, 9])], { type: 'image/jpeg' });
    const video = await buildFrameInput({ kind: 'video', page_no: 2, asset_id: 'a1', asset_sha256: 'vsha', snapshot: shot, snapshot_width: 640, snapshot_height: 480 });
    expect(video.frame_source).toEqual({ kind: 'video', page_no: 2, page_basis: 'unknown', asset_id: 'a1', asset_sha256: 'vsha' });
    expect(video.frame_snapshot).toMatchObject({ mime_type: 'image/jpeg', width: 640, height: 480, size_bytes: 3, storage: 'browser_only' });
    expect((video.frame_snapshot as any).sha256).toMatch(/^[0-9a-f]{64}$/);
    const page = await buildFrameInput({ kind: 'page_image', page_no: 1, asset_id: 'should-drop', snapshot: null, snapshot_error: '画面尺寸未知' });
    expect(page.frame_source).toMatchObject({ kind: 'page_image', asset_id: null, asset_sha256: null });
    expect(page.frame_snapshot).toEqual({ captured: false, reason: '画面尺寸未知' });
    expect((await buildFrameInput(undefined)).frame_source).toEqual({ kind: 'unknown' });
  });
  it('recognizeTouch 写给 A 的 input 里带 frame_source（E 据此区分视频/静态图）', async () => {
    const calls: any[] = [];
    const fetchImpl = (async (_url: string, init: any) => {
      calls.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ id: 'i' }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }) as any;
    const api = new ApiClient({ modelServiceUrl: '', client: createApiClient('http://localhost:8000', { getToken: () => 'tok', fetch: fetchImpl }) });
    await api.recognizeTouch({ book_id: 'b', run_id: 'r1', video_ms: 1200, touch_point: tp, viewport_info: vp }, 'live', { frame: { kind: 'video', page_no: 1, asset_id: 'a1', asset_sha256: 'vsha' } });
    expect(calls[0].input.frame_source).toEqual({ kind: 'video', page_no: 1, page_basis: 'unknown', asset_id: 'a1', asset_sha256: 'vsha' });
    expect(calls[0].output).toMatchObject({ target: '', recognition: 'not_connected' });
  });
});

describe('D9 触控延迟从点击算起（第 5 轮复查）', () => {
  const tp = { norm_x: 0.5, norm_y: 0.5, video_pixel_x: 320, video_pixel_y: 240, video_width: 640, video_height: 480 };
  const vp = { container_width: 800, container_height: 450, render_width: 600, render_height: 450, offset_x: 100, offset_y: 0, is_letterbox: true };
  const make = (calls: any[]) => {
    const fetchImpl = (async (_url: string, init: any) => {
      calls.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ id: 'i' }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }) as any;
    return new ApiClient({ modelServiceUrl: '', client: createApiClient('http://localhost:8000', { getToken: () => 'tok', fetch: fetchImpl }) });
  };
  it('有点击时刻：latency_ms 覆盖点击→结果（含截图），并标 latency_origin=click、写截图耗时', async () => {
    const calls: any[] = [];
    const clickedAt = performance.now();
    await new Promise((r) => setTimeout(r, 60)); // 模拟截图耗时
    await make(calls).recognizeTouch({ book_id: 'b', run_id: 'r1', video_ms: 0, touch_point: tp, viewport_info: vp }, 'live',
      { frame: { kind: 'video', page_no: 1, snapshot: new Blob([new Uint8Array([1])], { type: 'image/jpeg' }), clicked_at: clickedAt, capture_ms: 35 } });
    expect(calls[0].latency_ms).toBeGreaterThanOrEqual(55);
    expect(calls[0].input.latency_origin).toBe('click');
    expect(calls[0].input.frame_snapshot.capture_ms).toBe(35);
  });
  it('没有/非法点击时刻（重试、未来时间、NaN）：从请求开始计，标 request', async () => {
    for (const clicked_at of [undefined, performance.now() + 60_000, Number.NaN]) {
      const calls: any[] = [];
      await make(calls).recognizeTouch({ book_id: 'b', run_id: 'r1', video_ms: 0, touch_point: tp, viewport_info: vp }, 'live', { frame: { kind: 'page_image', page_no: 1, clicked_at } });
      expect(calls[0].input.latency_origin).toBe('request');
      expect(calls[0].latency_ms).toBeLessThan(1000);
    }
    expect((await buildFrameInput(undefined)).latency_origin).toBe('request');
  });
  it('截图帧时间与点击锁定画面一起留痕；静态书页不写帧时间', async () => {
    const shot = new Blob([new Uint8Array([7])], { type: 'image/jpeg' });
    const v = await buildFrameInput({ kind: 'video', page_no: 1, snapshot: shot, frame_time_ms: 1640, paused_on_click: true });
    expect((v.frame_snapshot as any).frame_time_ms).toBe(1640);
    expect(v.paused_on_click).toBe(true);
    const img = await buildFrameInput({ kind: 'page_image', page_no: 1, snapshot: shot, frame_time_ms: 99 });
    expect((img.frame_snapshot as any).frame_time_ms).toBeNull();
    expect(img.paused_on_click).toBe(false);
  });
  it('CSV 带 capture_ms 与 latency_origin 两列', () => {
    const csv = buildInteractionCsv([{ id: 'x', run_id: 'r', interaction_type: 'touch', input: { latency_origin: 'click', frame_snapshot: { capture_ms: 12 } }, output: {}, latency_ms: 80, created_at: 't' }]);
    const [head, row] = csv.replace(/^\uFEFF/, '').trim().split('\r\n');
    const cols = head.split(',');
    const vals = row.split(',');
    expect(vals[cols.indexOf('capture_ms')]).toBe('12');
    expect(vals[cols.indexOf('latency_origin')]).toBe('click');
  });
});

// ---------------- E-029 Live 只读分享走服务端核验 ----------------
describe('E-029 Live 只读分享必须由服务端核验，不能看本地快照', () => {
  const note = { id: 'n1', book_id: 'b', owner_id: 'o', content: { title: 'T', summary: 'S', concepts: ['x', 3], sources: [{ page_no: 2, quote: 'q', start_ms: null }, { quote: 'no page' }] }, status: 'SHARED', version: 3, created_at: '', updated_at: '' } as any;
  it('解析链接：token → 限时链接；note+share → 指定用户；都没有 → null', () => {
    expect(parseSharedRef(new URLSearchParams('token=abc'))).toEqual({ kind: 'link', token: 'abc' });
    expect(parseSharedRef(new URLSearchParams('note=n1&share=s1'))).toEqual({ kind: 'invite', noteId: 'n1', shareId: 's1' });
    expect(parseSharedRef(new URLSearchParams('note=n1'))).toBeNull();
  });
  it('指定用户的链接里不带任何令牌', () => {
    expect(serverShareHash({ mode: 'invite_only', token: 'local-uuid', noteId: 'n 1', shareId: 's1' })).toBe('#/shared?note=n%201&share=s1');
    expect(serverShareHash({ mode: 'link', token: 'srv tok', noteId: 'n', shareId: 's' })).toBe('#/shared?token=srv%20tok');
    expect(() => serverShareHash({ mode: 'link', token: null, noteId: 'n', shareId: 's' })).toThrow();
  });
  it('内容以服务端返回为准；丢掉无页码的来源和非字符串概念', () => {
    expect(toSharedNoteView(note)).toEqual({ title: 'T', summary: 'S', concepts: ['x'], sources: [{ page_no: 2, quote: 'q', start_ms: null }], version: 3, status: 'SHARED' });
  });
  it('404/410/403/401/网络错误 → denied 且写明原因；不返回任何内容', async () => {
    const cases: [unknown, string, string][] = [
      [new ApiError(404, 'NOT_FOUND', 'x'), 'NOT_FOUND', '无效或已经撤销'],
      [new ApiError(410, 'GONE', 'x'), 'GONE', '已经过期'],
      [new ApiError(403, 'FORBIDDEN', 'x'), 'FORBIDDEN', '尚未通过主人审核'],
      [new ApiError(0, 'NETWORK_ERROR', '无法连接服务'), 'NETWORK_ERROR', '暂时无法核验'],
    ];
    for (const [err, code, title] of cases) {
      const r = await loadSharedNote({ getSharedNote: async () => { throw err; }, getInvitedNote: async () => note }, { kind: 'link', token: 't' });
      expect(r.status).toBe('denied');
      expect(r).toMatchObject({ code });
      expect((r as any).title).toContain(title);
      expect((r as any).note).toBeUndefined();
    }
    const invite = await loadSharedNote({ getSharedNote: async () => note, getInvitedNote: async () => { throw new ApiError(401, 'AUTH_REQUIRED', 'x'); } }, { kind: 'invite', noteId: 'n', shareId: 's' });
    expect(invite).toMatchObject({ status: 'denied', code: 'AUTH_REQUIRED' });
    const invite404 = await loadSharedNote({ getSharedNote: async () => note, getInvitedNote: async () => { throw new ApiError(404, 'NOT_FOUND', 'x'); } }, { kind: 'invite', noteId: 'n', shareId: 's' });
    expect((invite404 as any).title).toContain('不在邀请名单');
  });
  it('限时链接读取不带 Bearer；指定用户读取带访问者自己的令牌', async () => {
    const seen: any[] = [];
    const fetchImpl = (async (url: string, init: any) => {
      seen.push({ url, auth: new Headers(init.headers).get('Authorization') });
      return new Response(JSON.stringify(note), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;
    const api = new ApiClient({ client: createApiClient('http://localhost:8000', { getToken: () => 'viewer-token', fetch: fetchImpl }) });
    await loadSharedNote(api, { kind: 'link', token: 'tok' });
    await loadSharedNote(api, { kind: 'invite', noteId: 'n1', shareId: 's1' });
    expect(seen[0]).toEqual({ url: 'http://localhost:8000/api/shared-notes/tok', auth: null });
    expect(seen[1]).toEqual({ url: 'http://localhost:8000/api/notes/n1/shares/s1/view', auth: 'Bearer viewer-token' });
  });
});

// ---------------- D11/D13 延迟日志导出 ----------------
describe('D11/D13 延迟日志：P50/P95、缓存命中分开统计、CSV 安全', () => {
  const rec = (over: Partial<BackendInteractionRecord> & { input?: any; output?: any }): BackendInteractionRecord => ({
    id: 'i', run_id: 'r', interaction_type: 'voice', input: {}, output: {}, latency_ms: 10, created_at: '2026-11-13T00:00:00Z', ...over,
  });
  it('最近秩法分位数；忽略 null/负数；空集为 null', () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentile([], 50)).toBeNull();
    expect(latencyStats([null, -1, 20, 40])).toEqual({ n: 2, p50: 20, p95: 40, mean: 30, max: 40 });
    expect(latencyStats([null])).toEqual({ n: 0, p50: null, p95: null, mean: null, max: null });
  });
  it('按 类型_输入方式/画面_缓存 分组，命中与未命中不混在一起', () => {
    const s = summarizeRecords('r', [
      rec({ latency_ms: 100, input: { input_method: 'speech' }, output: { cache_hit: false } }),
      rec({ latency_ms: 2, input: { input_method: 'speech' }, output: { cache_hit: true } }),
      rec({ latency_ms: 50, interaction_type: 'touch', input: { frame_source: { kind: 'video' } }, output: { cache_hit: false } }),
      rec({ latency_ms: null, interaction_type: 'touch', input: {}, output: {} }),
    ], new Date('2026-11-13T00:00:00Z'));
    expect(Object.keys(s.groups)).toEqual(['touch_unknown_cache_miss', 'touch_video_cache_miss', 'voice_speech_cache_hit', 'voice_speech_cache_miss']);
    expect(s.groups.voice_speech_cache_miss).toMatchObject({ records: 1, n: 1, p50: 100 });
    expect(s.groups.touch_unknown_cache_miss).toMatchObject({ records: 1, n: 0, p50: null });
    expect(s.definitions.accuracy).toContain('未计算');
  });
  it('CSV：带 BOM、逗号/引号/换行转义、防公式注入、证据页去重', () => {
    const csv = buildInteractionCsv([
      rec({ input: { query: '=HYPERLINK("x"), 你好\n第二行', input_method: 'keyboard', audio: { sha256: 'abc' } }, output: { cache_hit: false, evidence: [{ page_no: 2 }, { page_no: 2 }, { page_no: 5 }] } }),
    ]);
    expect(csv.startsWith('﻿')).toBe(true);
    const [, row] = csv.slice(1).split('\r\n');
    expect(row).toContain(`"'=HYPERLINK(""x""), 你好\n第二行"`);
    expect(row).toContain(',2|5,');
    expect(row).toContain(',abc,');
  });
  it('看板：给出 P50/P95 和未命中均值，命中样本不会冒充冷启动耗时', () => {
    const it = (latency: number, cached: boolean): Interaction => ({ id: String(latency), book_id: 'b', run_id: 'r', kind: 'question', question: 'q', answer: 'a', transcript: '', video_ms: 0, sources: [], latency_ms: latency, created_at: '', uncertain: false, origin: 'real', cached });
    const s = summarizeInteractions([it(100, false), it(120, false), it(2, true)], 'real').voice;
    expect(s).toMatchObject({ p50Ms: 100, p95Ms: 120, missAvgMs: 110, hitAvgMs: 2, avgLatencyMs: 74 });
  });
});

// ---------------- E-030 位置意图兜底（留出：换一本书） ----------------
describe('E-030 「开头/结局」类问题：无内容命中时用全书首/尾页原文；保守边界', () => {
  const pages = [
    { ocr_text: '清晨，小刺猬在苹果树下醒来。' },
    { ocr_text: '它把苹果分给了松鼠。' },
    { ocr_text: '傍晚，大家围着篝火唱歌。' },
  ];
  const ask = (idx: TimeSliceIndexer, q: string) => idx.searchEvidence(q, 0);
  it('换一本书仍成立：开头 → 第 1 页，结局 → 第 3 页', () => {
    const idx = new TimeSliceIndexer(buildSlicesFromBook(pages));
    expect(ask(idx, '故事开头讲了什么')[0]?.page_no).toBe(1);
    expect(ask(idx, '结局是怎样的')[0]?.page_no).toBe(3);
  });
  it('首页未校对 → 不拿第 2 页冒充开头，拒答', () => {
    const idx = new TimeSliceIndexer(buildSlicesFromBook([{ ...pages[0], confirmed: false }, pages[1], pages[2]]));
    expect(ask(idx, '故事开头讲了什么')).toEqual([]);
  });
  it('同时问开头和结局、或只有一页 → 不兜底', () => {
    expect(ask(new TimeSliceIndexer(buildSlicesFromBook(pages)), '开头和结局有什么不同')).toEqual([]);
    expect(ask(new TimeSliceIndexer(buildSlicesFromBook([pages[0]])), '故事开头讲了什么')).toEqual([]);
  });
  it('有内容命中时按内容检索，位置词不会把答案拉到最后一页', () => {
    const idx = new TimeSliceIndexer(buildSlicesFromBook(pages));
    expect(ask(idx, '小刺猬最后把苹果分给了谁')[0]?.page_no).toBe(2);
  });
  it('只说「一开始」：只返回真实首页原文，并标为页级证据', () => {
    const idx = new TimeSliceIndexer(buildSlicesFromBook(pages));
    const ev = ask(idx, '一开始');
    expect(ev).toHaveLength(1);
    expect(ev[0].source_quote).toBe(pages[0].ocr_text);
    expect(ev[0].evidence_type).toBe('page');
  });
});
