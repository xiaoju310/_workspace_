/**
 * 第 4 轮复查（D1~D7）回归测试。每一组对应 error-ledger 里的一个新条目，
 * 并且都做过变异自检：把修复撤回后，对应用例会变红（见交付报告“变异自检”一节）。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildSlicesFromBook } from '../indexing/buildSlices';
import { TimeSliceIndexer, contentBigrams } from '../indexing/TimeSliceIndexer';
import { PictureBookRagEngine, isDangerousQuestion } from '../qa/PictureBookRagEngine';
import { RealBrowserSpeechRecognition } from '../asr/AsrProvider';
import { BrowserSpeechSynthesisTts } from '../tts/TtsProvider';
import { calculateRMS } from '../AudioRecorderHelper';
import { mapClickToContent, contentBox } from '../VideoCoordinateMapper';
import { summarizeInteractions } from '../metrics/LatencyMetricsDashboard';
import { ApiClient } from '../../../lib/api';
import { createApiClient } from '../../../api/client';
import type { Interaction } from '../../../app/types';

// ---------------- E-021 页码错位 ----------------
describe('E-021 证据页码必须是原书页码（未校对页不能让后面的页码整体前移）', () => {
  const pages = [
    { ocr_text: '小熊在河边钓鱼。', confirmed: true },
    { ocr_text: '这一页还没校对。', confirmed: false },
    { ocr_text: '小熊把金色的大鱼放回了河里。', confirmed: true },
  ];
  it('第 3 页的内容仍然标第 3 页，未校对的第 2 页不进索引', () => {
    const slices = buildSlicesFromBook(pages);
    expect(slices.map((s) => s.page_no)).toEqual([1, 3]);
    const ev = new TimeSliceIndexer(slices).searchEvidence('大鱼放回了哪里', 0);
    expect(ev[0]?.page_no).toBe(3);
  });
  it('视频时间轴按原书页码对齐，不会把第 2 页的时间段挂到第 3 页', () => {
    const segments = [
      { run_id: 'r', page_no: 2, start_ms: 5000, end_ms: 9000, caption: '第二页字幕' },
      { run_id: 'r', page_no: 3, start_ms: 9000, end_ms: 14000, caption: '第三页字幕' },
    ] as any;
    const slices = buildSlicesFromBook(pages, segments);
    const p3 = slices.find((s) => s.page_no === 3)!;
    expect([p3.video_start_ms, p3.video_end_ms]).toEqual([9000, 14000]);
  });
  it('有服务端页码时以服务端页码为准（segments.page_no 用的就是它）', () => {
    const slices = buildSlicesFromBook([{ ocr_text: '甲页', server_page_no: 4 }]);
    expect(slices[0].page_no).toBe(4);
  });
});

// ---------------- E-020 切词根因 ----------------
describe('E-020 根因：实词里的"地/过/着/对/向/一/可"不能被当成停用字切碎', () => {
  it.each([
    ['草地上有几朵花', '草地'],
    ['小熊怎么过河的', '过河'],
    ['房子着火了怎么办', '着火'],
    ['向日葵是什么颜色', '向日'],
    ['它们一起去哪里', '一起'],
    ['小兔子可爱吗', '可爱'],
    ['河对面有什么', '对面'],
  ])('"%s" 保留 "%s"', (q, gram) => {
    expect(contentBigrams(q)).toContain(gram);
  });
  it('疑问短语与语气词仍然被去掉', () => {
    expect(contentBigrams('为什么吗')).toEqual([]);
    expect(contentBigrams('是什么呢')).toEqual([]);
  });
  it('队长举例：草地上的花能检索到原文所在页', () => {
    const idx = new TimeSliceIndexer(
      buildSlicesFromBook([
        { ocr_text: '小兔子住在森林边。' },
        { ocr_text: '草地上开着三朵小黄花。' },
        { ocr_text: '小兔子和朋友在河边玩。' },
      ])
    );
    expect(idx.searchEvidence('草地上有几朵花？', 0)[0]?.page_no).toBe(2);
  });
});

// ---------------- E-019 安全识别 ----------------
describe('E-019 加固：危险提问识别既不能漏、也不能把普通"跳"当危险', () => {
  it.each([
    '如果从悬崖跳下去会怎样？',
    '我可以从窗户跳下去吗',
    '我想玩火可以吗',
    '能用手指摸插座吗',
    '可以跟陌生人走吗',
    '我能一个人去河边游泳吗',
    '药可以随便吃吗',
    '爬阳台好玩吗',
  ])('危险："%s"', (q) => expect(isDangerousQuestion(q)).toBe(true));
  it.each(['小兔子从草地上跳过去了吗', '从前有一只小狐狸', '青蛙跳得高吗', '今天吃什么'])('不危险："%s"', (q) =>
    expect(isDangerousQuestion(q)).toBe(false)
  );
  it('危险提问没有证据时仍附安全提示', async () => {
    const engine = new PictureBookRagEngine();
    const r = await engine.generateAnswer(
      { book_id: 'b', run_id: 'r', video_ms: 0, query_text: '能用手指摸插座吗' },
      new TimeSliceIndexer(buildSlicesFromBook([{ ocr_text: '小熊在河边钓鱼。' }]))
    );
    expect(r.status).toBe('no_evidence');
    expect(r.answer).toContain('这样做很危险');
  });
});

// ---------------- D1/D3 ASR 停止超时 ----------------
class HangRec {
  static last: HangRec;
  lang = ''; continuous = false; interimResults = false; maxAlternatives = 0;
  onresult: any; onerror: any; onend: any;
  running = false; aborted = 0;
  constructor() { HangRec.last = this; }
  start() { if (this.running) throw new Error('InvalidStateError: already started'); this.running = true; }
  stop() { /* 浏览器不触发 onend */ }
  abort() { this.aborted += 1; this.running = false; }
}
describe('D3 ASR：stop 超时必须 abort 并报 TRANSCRIPTION_TIMEOUT，下一次还能启动', () => {
  afterEach(() => vi.useRealTimers());
  it('超时后 abort、报错码、可再次 start', async () => {
    vi.useFakeTimers();
    const r = new RealBrowserSpeechRecognition(HangRec as any);
    expect(r.start()).toBe(true);
    const p = r.stopDetailed();
    await vi.advanceTimersByTimeAsync(3000);
    const res = await p;
    expect(HangRec.last.aborted).toBe(1);
    expect(res.errorCode).toBe('TRANSCRIPTION_TIMEOUT');
    expect(r.start()).toBe(true); // 旧实现：识别器仍在跑，这里抛 InvalidStateError → AUDIO_RECORD_FAILED
  });
});

// ---------------- D1 录音音量 ----------------
describe('D1 calculateRMS 空缓冲区', () => {
  it('返回 0 而不是 NaN', () => expect(calculateRMS(new Float32Array(0))).toBe(0));
});

// ---------------- D6 TTS 不发音 ----------------
describe('D6 TTS：浏览器既不 onstart 也不 onerror 时不能永远挂起', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it('超时后 resolve(firstAudioMs=null) 并回调 onError', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('speechSynthesis', { speak: vi.fn(), cancel: vi.fn() });
    vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
    const onError = vi.fn();
    const p = new BrowserSpeechSynthesisTts().speak('你好', { onError, startTimeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(1100);
    await expect(p).resolves.toEqual({ firstAudioMs: null });
    expect(onError).toHaveBeenCalledTimes(1);
  });
  it('被 cancel 打断(interrupted)不算失败', async () => {
    let utt: any;
    vi.stubGlobal('speechSynthesis', { speak: (u: any) => { utt = u; setTimeout(() => u.onerror?.({ error: 'interrupted' }), 5); }, cancel: vi.fn() });
    vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
    const onError = vi.fn();
    const onEnd = vi.fn();
    await new BrowserSpeechSynthesisTts().speak('你好', { onError, onEnd });
    expect(utt).toBeDefined();
    expect(onError).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalled();
  });
});

// ---------------- D2 坐标 ----------------
describe('D2 坐标映射：像素下标与 CSS 缩放', () => {
  it('像素下标用 floor：norm 极小值落在像素 0，右边缘落在 width-1', () => {
    // 0.7px 落在第 0 列像素内部，10.6px 落在第 10 列内部；round 会给出 1 和 11
    const a = mapClickToContent({ clickX: 0.7, clickY: 10.6, containerW: 1000, containerH: 1000, origW: 1000, origH: 1000 });
    expect(a.touchPoint).toMatchObject({ video_pixel_x: 0, video_pixel_y: 10 });
    const b = mapClickToContent({ clickX: 999.6, clickY: 10, containerW: 1000, containerH: 1000, origW: 1000, origH: 1000 });
    expect(b.touchPoint!.video_pixel_x).toBe(999);
  });
  it('transform: scale(2) 下 border/padding 按缩放比换算（旧实现直接相减，内容区偏 10px）', () => {
    vi.stubGlobal('getComputedStyle', () => ({
      borderLeftWidth: '0', borderTopWidth: '0', borderRightWidth: '0', borderBottomWidth: '0',
      paddingLeft: '10px', paddingTop: '10px', paddingRight: '10px', paddingBottom: '10px',
    }));
    const el = {
      offsetWidth: 220, offsetHeight: 220,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 440, height: 440 }),
    } as any;
    expect(contentBox(el)).toEqual({ left: 20, top: 20, width: 400, height: 400 });
    vi.unstubAllGlobals();
  });
});

// ---------------- D7 看板 ----------------
const item = (over: Partial<Interaction>): Interaction => ({
  id: Math.random().toString(36), book_id: 'b', run_id: 'r', kind: 'question', question: 'q', answer: 'a', transcript: '',
  video_ms: 0, sources: [], latency_ms: null, created_at: '', uncertain: true, origin: 'real', cached: false, ...over,
});
describe('D7 延迟看板：没有数据就没有数字，真实与演示分开', () => {
  it('空记录：平均延迟为 null（界面显示"暂无实测数据"），不再兜底 320/190/100%', () => {
    const s = summarizeInteractions([], 'real');
    expect(s.voice.avgLatencyMs).toBeNull();
    expect(s.touch.avgLatencyMs).toBeNull();
    expect(s.voice.total).toBe(0);
  });
  it('只对实测样本求平均，演示记录不进真实统计', () => {
    const list = [
      item({ latency_ms: 100, origin: 'real', uncertain: false, sources: [{ source: 'original_page', page_no: 1, start_ms: null, end_ms: null, quote: '' }] }),
      item({ latency_ms: 300, origin: 'real' }),
      item({ latency_ms: null, origin: 'real' }),
      item({ latency_ms: 5, origin: 'mock' }),
    ];
    const real = summarizeInteractions(list, 'real');
    expect(real.voice).toMatchObject({ total: 3, measured: 2, avgLatencyMs: 200, withEvidence: 1 });
    expect(summarizeInteractions(list, 'mock').voice.total).toBe(1);
  });
  it('触控未接入视觉模型：recognized=0，界面显示"未完成真实识别"', () => {
    const s = summarizeInteractions([item({ kind: 'touch', latency_ms: 20 }), item({ kind: 'touch', latency_ms: 40 })], 'real');
    expect(s.touch).toMatchObject({ total: 2, recognized: 0, unrecognized: 2, avgLatencyMs: 30 });
  });
});

// ---------------- 留痕里的 cache_hit ----------------
describe('交互留痕必须带 cache_hit（回归项：缓存命中是否真的记录）', () => {
  it('第二次相同提问：后端载荷 output.cache_hit=true', async () => {
    const calls: any[] = [];
    const fetchImpl = (async (url: string, init: any) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: 'i' }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }) as any;
    const api = new ApiClient({ client: createApiClient('http://localhost:8000', { getToken: () => 'tok', fetch: fetchImpl }) });
    const idx = new TimeSliceIndexer(buildSlicesFromBook([{ ocr_text: '小熊在河边钓到一条金色的大鱼。' }, { ocr_text: '大鱼说谢谢。' }]));
    const req = { book_id: 'cache-b', run_id: 'r1', video_ms: 0, query_text: '小熊钓到了什么' };
    await api.askQuestion(req, 'live', undefined, { indexer: idx });
    await api.askQuestion(req, 'live', undefined, { indexer: idx });
    expect(JSON.parse(calls[0].init.body).output.cache_hit).toBe(false);
    expect(JSON.parse(calls[1].init.body).output.cache_hit).toBe(true);
  });
});
