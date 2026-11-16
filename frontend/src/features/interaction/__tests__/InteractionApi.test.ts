import { describe, it, expect, vi } from 'vitest';
import { ApiClient, buildInteractionPayload, toBackendBookType } from '../../../lib/api';
import { createApiClient } from '../../../api/client';
import { TimeSliceIndexer } from '../indexing/TimeSliceIndexer';
import { buildSlicesFromBook } from '../indexing/buildSlices';

/** 带记录的假后端：只替换网络，走真实的 createApiClient + ApiClient 代码 */
function setup(opts: { status?: number; body?: unknown; token?: string; modelServiceUrl?: string; modelFetch?: any } = {}) {
  const calls: { url: string; init: any }[] = [];
  const fetchStub = async (url: string, init: any) => {
    calls.push({ url, init });
    const status = opts.status ?? 201;
    return new Response(JSON.stringify(opts.body ?? { id: 'i1', run_id: 'r1', status: 'recorded_only' }), { status, headers: { 'Content-Type': 'application/json' } });
  };
  const transport = createApiClient('http://localhost:8000', { getToken: () => opts.token ?? 'tok', fetch: fetchStub as any });
  const api = new ApiClient({ client: transport, modelServiceUrl: opts.modelServiceUrl, fetchImpl: opts.modelFetch });
  return { api, calls };
}

const idx = new TimeSliceIndexer(buildSlicesFromBook([{ ocr_text: '小熊在河边钓到一条金色的大鱼。' }, { ocr_text: '大鱼说谢谢你放了我。' }]));
const askReq = (q: string) => ({ book_id: 'b', run_id: 'r1', video_ms: 1000, query_text: q });
const tpReq = (nx: number, ny: number) => ({
  book_id: 'b', run_id: 'r1', video_ms: 2000,
  touch_point: { norm_x: nx, norm_y: ny, video_pixel_x: Math.round(nx * 1919), video_pixel_y: Math.round(ny * 1079), video_width: 1920, video_height: 1080 },
  viewport_info: { container_width: 800, container_height: 600, render_width: 800, render_height: 450, offset_x: 0, offset_y: 75, is_letterbox: true },
});

describe('buildInteractionPayload（被生产代码使用的真实函数）', () => {
  it('强制 producer、整数非负延迟、合法类型、非空 output', () => {
    const p = buildInteractionPayload('voice', { query: 'q' }, { answer: 'a' }, 12.6);
    expect(p).toMatchObject({ interaction_type: 'voice', latency_ms: 13, output: { producer: 'c_interaction_agent', answer: 'a' } });
    expect(() => buildInteractionPayload('voice', {}, { a: 1 }, -1)).toThrow();
    expect(() => buildInteractionPayload('voice', {}, { a: 1 }, NaN)).toThrow();
    expect(() => buildInteractionPayload('x' as any, {}, { a: 1 }, 1)).toThrow();
    expect(() => buildInteractionPayload('touch', {}, {}, 1)).toThrow();
  });
  it('不能让调用方覆盖 producer', () => {
    expect(buildInteractionPayload('touch', {}, { producer: 'evil', a: 1 }, 1).output.producer).toBe('c_interaction_agent');
  });
});

describe('Live 问答：不编造、如实留痕', () => {
  it('基于当前书检索，POST /api/runs/{id}/interactions 带 Bearer 与 producer', async () => {
    const { api, calls } = setup();
    const r = await api.askQuestion({ ...askReq('小熊钓到了什么'), input_method: 'speech' }, 'live', undefined, { indexer: idx });
    expect(r).toMatchObject({ status: 'success', is_demo_mock: false, answer_source: 'local_extractive', persisted: true });
    expect(r.answer).toContain('金色的大鱼');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://localhost:8000/api/runs/r1/interactions');
    expect(calls[0].init.headers.get('Authorization')).toBe('Bearer tok');
    const body = JSON.parse(calls[0].init.body);
    expect(body.interaction_type).toBe('voice');
    expect(body.input.input_method).toBe('speech');
    expect(body.output.producer).toBe('c_interaction_agent');
    expect(body.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('换一本书不会出现小狐狸；无依据 → no_evidence 且仍如实留痕', async () => {
    const { api, calls } = setup();
    const r = await api.askQuestion(askReq('小狐狸戴什么颜色的围巾'), 'live', undefined, { indexer: idx });
    expect(r.status).toBe('no_evidence');
    expect(r.answer).not.toContain('红');
    expect(JSON.parse(calls[0].init.body).output.uncertain).toBe(true);
  });

  it('没有索引(未校对)：拒答而不是回退到内置故事', async () => {
    const { api } = setup();
    const r = await api.askQuestion(askReq('主角是谁'), 'live');
    expect(r.status).toBe('no_evidence');
    expect(r.evidence).toHaveLength(0);
  });

  it('后端写入失败：persisted=false 并带原因(detail)，不静默', async () => {
    const { api } = setup({ status: 422, body: { detail: '延迟不能为负' } });
    const r = await api.askQuestion(askReq('小熊钓到了什么'), 'live', undefined, { indexer: idx });
    expect(r.persisted).toBe(false);
    expect(r.persist_error).toContain('延迟不能为负');
  });

  it('401 / 网络失败 同样返回 persisted=false', async () => {
    expect((await setup({ status: 401, body: { detail: '未授权' } }).api.askQuestion(askReq('小熊钓到了什么'), 'live', undefined, { indexer: idx })).persisted).toBe(false);
    const transport = createApiClient('http://localhost:8000', { getToken: () => 't', fetch: (async () => { throw new TypeError('offline'); }) as any });
    const r = await new ApiClient({ client: transport }).askQuestion(askReq('小熊钓到了什么'), 'live', undefined, { indexer: idx });
    expect(r.persisted).toBe(false);
    expect(r.persist_error).toContain('无法连接');
  });

  it('缺 run_id / 空问题 → 抛错，不回退 run-default', async () => {
    const { api, calls } = setup();
    await expect(api.askQuestion({ ...askReq('x'), run_id: '' }, 'live', undefined, { indexer: idx })).rejects.toThrow('run_id');
    await expect(api.askQuestion(askReq('   '), 'live')).rejects.toThrow('为空');
    expect(calls).toHaveLength(0);
  });

  it('没有令牌：不发网络，persisted=false（不存在默认 demo token）', async () => {
    const { api, calls } = setup({ token: '' });
    const r = await api.askQuestion(askReq('小熊钓到了什么'), 'live', undefined, { indexer: idx });
    expect(r.persisted).toBe(false);
    expect(calls).toHaveLength(0);
    expect(api.getToken()).not.toContain('demo');
  });

  it('外部模型服务：不携带 A 的 Bearer；失败则抛错，不回退本地编造', async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify({ answer: 'A', evidence: [], status: 'success', confidence: 1, latency: { total_roundtrip_ms: 1 } }), { status: 200 }));
    const { api } = setup({ modelServiceUrl: 'http://model.test', modelFetch: ok });
    await api.askQuestion(askReq('x'), 'live', undefined, { indexer: idx });
    const init = (ok.mock.calls[0] as any)[1];
    expect(JSON.stringify(init.headers)).not.toContain('Bearer');
    const bad = vi.fn(async () => new Response('x', { status: 500 }));
    await expect(setup({ modelServiceUrl: 'http://model.test', modelFetch: bad }).api.askQuestion(askReq('x'), 'live', undefined, { indexer: idx })).rejects.toThrow('外部模型服务');
  });
});

describe('Live 触控：不编造物体', () => {
  it('无视觉模型 → uncertain，无物体名/包围框/置信度，原样上报 viewport 与像素', async () => {
    const { api, calls } = setup();
    const r = await api.recognizeTouch(tpReq(0.5, 0.5), 'live');
    expect(r).toMatchObject({ status: 'uncertain', target_name: '', confidence: 0, is_demo_mock: false, persisted: true });
    expect(r.bounding_box).toBeUndefined();
    const body = JSON.parse(calls[0].init.body);
    expect(body.interaction_type).toBe('touch');
    expect(body.input.viewport_info.offset_y).toBe(75);
    expect(body.input.pixel_x).toBe(Math.round(0.5 * 1919));
    expect(body.output.producer).toBe('c_interaction_agent');
  });

  it('时间轴有字幕时附真实依据', async () => {
    const { api } = setup();
    const r = await api.recognizeTouch(tpReq(0.5, 0.5), 'live', {
      segments: [{ id: 's', run_id: 'r1', page_no: 2, start_ms: 1000, end_ms: 3000, caption: '大鱼游过来', source: { producer: 'b' } }],
    });
    expect(r.evidence?.snippet).toBe('大鱼游过来');
    expect(r.explanation).toContain('大鱼游过来');
  });

  it('越界/黑边坐标 → out_of_bounds 且不上报', async () => {
    const { api, calls } = setup();
    expect((await api.recognizeTouch(tpReq(1.2, 0.5), 'live')).status).toBe('out_of_bounds');
    expect(calls).toHaveLength(0);
  });

  it('写入失败 → persisted=false', async () => {
    const { api } = setup({ status: 503, body: { detail: '服务不可用' } });
    expect((await api.recognizeTouch(tpReq(0.5, 0.5), 'live')).persisted).toBe(false);
  });
});

describe('Demo 隔离', () => {
  it('Demo 永远标 is_demo_mock、绝不访问后端；Live 永远不是 demo', async () => {
    const { api, calls } = setup();
    const q = await api.askQuestion(askReq('小狐狸为什么迷路'), 'demo');
    expect(q).toMatchObject({ is_demo_mock: true, answer_source: 'demo_fixture' });
    const t = await api.recognizeTouch(tpReq(0.5, 0.5), 'demo');
    expect(t).toMatchObject({ is_demo_mock: true, target_name: '', confidence: 0 });
    expect(calls).toHaveLength(0);
    const live = await api.askQuestion(askReq('小熊钓到了什么'), 'live', undefined, { indexer: idx });
    expect(live.is_demo_mock).toBe(false);
  });
});

describe('读取接口失败必须抛错（不再吞成空数组）', () => {
  it('interactions / segments / assets', async () => {
    const { api } = setup({ status: 503, body: { detail: '挂了' } });
    await expect(api.fetchRemoteInteractions('r1')).rejects.toThrow('挂了');
    await expect(api.getRunSegments('r1')).rejects.toThrow();
    await expect(api.getRunAssets('r1')).rejects.toThrow();
  });
});

describe('分类确认', () => {
  it('UI 类型映射到 A 的枚举；unknown 拒绝；失败抛错', async () => {
    expect(toBackendBookType('fiction')).toBe('novel');
    expect(toBackendBookType('picture_book')).toBe('picture_book');
    expect(() => toBackendBookType('unknown')).toThrow();
    const ok = setup({ status: 200, body: { book_id: 'b', confirmed_type: 'novel', status: 'CONFIRMED' } });
    await ok.api.confirmCategory('b', 'fiction');
    expect(JSON.parse(ok.calls[0].init.body)).toEqual({ confirmed_type: 'novel' });
    expect(ok.calls[0].init.method).toBe('PATCH');
    await expect(setup({ status: 409, body: { detail: '请先校对' } }).api.confirmCategory('b', 'fiction')).rejects.toThrow('请先校对');
  });
});
