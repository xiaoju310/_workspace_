import { describe, expect, it } from 'vitest';
import { buildFrameInput, ApiClient } from '../../../lib/api';
import { createApiClient } from '../../../api/client';
import { buildInteractionCsv, recordToRow } from '../../../lib/latencyExport';
import { pageNoOf, pageStartMs, resolvePageAtTime } from '../pageTimeline';
import type { SegmentOut } from '../../../types/interaction';

// 评审 P0：旧实现按「视频总时长 ÷ 书页数」平均推页码；B 生成的每页视频不等长时，第 2 页的画面会被记成第 1 页。
// 4 页书，视频总长 20 秒；平均切页每页 5 秒，但真实时间轴是 1 页 2 秒、2 页 12 秒、3 页 3 秒、4 页 3 秒。
const pages = [{}, {}, {}, {}];
const seg = (page_no: number, start_ms: number, end_ms: number): SegmentOut => ({
  id: `s${page_no}`, run_id: 'r', page_no, start_ms, end_ms, caption: `第${page_no}页字幕`, source: { producer: 'test' },
} as SegmentOut);
const unequal = [seg(1, 0, 2000), seg(2, 2000, 14000), seg(3, 14000, 17000), seg(4, 17000, 20000)];
const DURATION = 20000;

describe('视频时间 → 页码：以后端时间轴为准，不按总时长平均切（评审 P0）', () => {
  it('不等长视频：平均切页会错的时刻，时间轴给出正确页码', () => {
    // 平均法：7 秒 → floor(7000/5000)=1 → 第 2 页（巧合对）；10 秒 → 第 3 页（错，真实是第 2 页）；15 秒 → 第 4 页（错，真实第 3 页）
    expect(resolvePageAtTime(3000, pages, unequal, DURATION)).toMatchObject({ pageNo: 2, basis: 'timeline', exact: true });
    expect(resolvePageAtTime(10000, pages, unequal, DURATION)).toMatchObject({ pageNo: 2, index: 1, exact: true });
    expect(resolvePageAtTime(15000, pages, unequal, DURATION)).toMatchObject({ pageNo: 3, index: 2, exact: true });
    expect(resolvePageAtTime(1999, pages, unequal, DURATION)).toMatchObject({ pageNo: 1 });
  });
  it('区间边界：左闭右开；视频末帧归最后一段', () => {
    expect(resolvePageAtTime(2000, pages, unequal, DURATION).pageNo).toBe(2);
    expect(resolvePageAtTime(14000, pages, unequal, DURATION).pageNo).toBe(3);
    expect(resolvePageAtTime(20000, pages, unequal, DURATION)).toMatchObject({ pageNo: 4, exact: true });
  });
  it('没有时间轴：只估算，exact=false，标注 estimated（不得声称已准确定位）', () => {
    for (const none of [undefined, [] as SegmentOut[]]) {
      const r = resolvePageAtTime(10000, pages, none, DURATION);
      expect(r).toMatchObject({ basis: 'estimated', exact: false, index: 2 });
    }
  });
  it('时间轴落在区间之外（片头/空档/片尾）：取最近一段，但 exact=false', () => {
    const gap = [seg(1, 1000, 3000), seg(2, 5000, 8000)];
    expect(resolvePageAtTime(500, pages, gap, DURATION)).toMatchObject({ pageNo: 1, basis: 'timeline_gap', exact: false });
    expect(resolvePageAtTime(4000, pages, gap, DURATION)).toMatchObject({ pageNo: 1, basis: 'timeline_gap', exact: false });
    expect(resolvePageAtTime(19000, pages, gap, DURATION)).toMatchObject({ pageNo: 2, basis: 'timeline_gap', exact: false });
  });
  it('区间重叠：取开始得最晚的一段（画面已切到它）', () => {
    const overlap = [seg(1, 0, 6000), seg(2, 4000, 9000)];
    expect(resolvePageAtTime(5000, pages, overlap, DURATION).pageNo).toBe(2);
    expect(resolvePageAtTime(3000, pages, overlap, DURATION).pageNo).toBe(1);
  });
  it('脏数据不参与定位：区间无效、页码不属于这本书', () => {
    const dirty = [seg(1, 3000, 1000), seg(99, 0, 20000), { ...seg(2, 0, 5000), start_ms: Number.NaN } as SegmentOut];
    expect(resolvePageAtTime(1000, pages, dirty, DURATION)).toMatchObject({ basis: 'estimated', exact: false });
  });
  it('页码口径与索引一致：有服务端页码用服务端页码，位置用全书位置（未校对页不会让后面的页错位）', () => {
    const withServer = [{ server_page_no: 11 }, { server_page_no: 12 }, { server_page_no: 13 }];
    expect(pageNoOf(withServer[1], 1)).toBe(12);
    const segs = [seg(11, 0, 1000), seg(12, 1000, 9000), seg(13, 9000, 10000)];
    expect(resolvePageAtTime(5000, withServer, segs, 10000)).toMatchObject({ pageNo: 12, index: 1, exact: true });
    expect(pageNoOf({}, 4)).toBe(5);
  });
  it('跳转到某页：有时间轴取该页最早开始；没有时间轴按平均估算并标 exact=false', () => {
    expect(pageStartMs(1, pages, unequal, DURATION)).toEqual({ ms: 2000, exact: true });
    expect(pageStartMs(2, pages, unequal, DURATION)).toEqual({ ms: 14000, exact: true });
    expect(pageStartMs(2, pages, undefined, DURATION)).toEqual({ ms: 10000, exact: false });
    // 时间轴只登记了部分页：没登记的页不能用别页的时间轴冒充
    expect(pageStartMs(3, pages, [seg(1, 0, 2000)], DURATION)).toEqual({ ms: 15000, exact: false });
  });
  it('只有 1 页的书或空书不崩', () => {
    expect(resolvePageAtTime(5000, [{}], undefined, DURATION)).toMatchObject({ index: 0, pageNo: 1 });
    expect(resolvePageAtTime(5000, [], undefined, DURATION)).toMatchObject({ index: 0, basis: 'estimated', exact: false });
  });
});

describe('触控留痕写明页码依据：估算页码不得当作确定证据', () => {
  const tp = { norm_x: 0.5, norm_y: 0.5, video_pixel_x: 320, video_pixel_y: 240, video_width: 640, video_height: 480 };
  const vp = { container_width: 800, container_height: 450, render_width: 600, render_height: 450, offset_x: 100, offset_y: 0, is_letterbox: true };
  const make = (calls: any[]) => {
    const fetchImpl = (async (_url: string, init: any) => {
      calls.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ id: 'i' }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }) as any;
    return new ApiClient({ modelServiceUrl: '', client: createApiClient('http://localhost:8000', { getToken: () => 'tok', fetch: fetchImpl }) });
  };
  it('时间轴命中：留痕 page_no + basis=timeline', async () => {
    const calls: any[] = [];
    await make(calls).recognizeTouch({ book_id: 'b', run_id: 'r', video_ms: 10000, touch_point: tp, viewport_info: vp }, 'live', {
      segments: unequal, frame: { kind: 'video', page_no: 2, page_basis: 'timeline' },
    });
    expect(calls[0].input.frame_source).toMatchObject({ kind: 'video', page_no: 2, page_basis: 'timeline' });
  });
  it('没有时间轴：留痕 page_no 为 null、basis=estimated，不写一个看起来确定的页码', async () => {
    const calls: any[] = [];
    await make(calls).recognizeTouch({ book_id: 'b', run_id: 'r', video_ms: 10000, touch_point: tp, viewport_info: vp }, 'live', {
      frame: { kind: 'video', page_no: null, page_basis: 'estimated' },
    });
    expect(calls[0].input.frame_source).toMatchObject({ kind: 'video', page_no: null, page_basis: 'estimated' });
    const f = await buildFrameInput({ kind: 'video', page_no: null });
    expect((f.frame_source as any).page_basis).toBe('unknown');
  });
  it('导出 CSV 带 frame_page_no / frame_page_basis 两列，估算页码留空', () => {
    const rec = (frame_source: any) => ({ id: 'i', run_id: 'r', interaction_type: 'touch', input: { frame_source }, output: {}, latency_ms: 10, created_at: 't' });
    const exact = recordToRow(rec({ kind: 'video', page_no: 2, page_basis: 'timeline' }));
    expect(exact.frame_page_no).toBe(2);
    expect(exact.frame_page_basis).toBe('timeline');
    const est = recordToRow(rec({ kind: 'video', page_no: null, page_basis: 'estimated' }));
    expect(est.frame_page_no).toBe('');
    expect(est.frame_page_basis).toBe('estimated');
    const csv = buildInteractionCsv([rec({ kind: 'video', page_no: null, page_basis: 'estimated' })]);
    expect(csv.split('\n')[0]).toContain('frame_page_no,frame_page_basis');
  });
});
