/**
 * 真实联调：真实前端代码（createApiClient / ApiClient / liveBookFlow / noteSync）经真实 HTTP 打真实 FastAPI。
 * 由 scripts/check-live-flow.sh 启动后端后运行；没有 LIVE_BACKEND_URL 时跳过。
 *
 * 唯一的绕过（Phase B 开头，已明确标注）：B 的分析 provider 未接入，分析必然失败，
 * 后端规定未分析的书不能生成笔记。为测笔记链路，这里把运行状态直接改成成功。
 * 所以 Phase B 证明的是"笔记→审核→分享→撤销"，不证明分析成功。
 */
import { describe, it, expect } from 'vitest';
import { createApiClient } from '../../api/client';
import { ApiClient } from '../api';
import { registerServerBook, startServerAnalysis, summarizeRunJobs } from '../liveBookFlow';
import { createShareOnServer, noteToServerContent, reviewOnServer, revokeShareOnServer } from '../noteSync';
import { TimeSliceIndexer } from '../../features/interaction/indexing/TimeSliceIndexer';
import { buildSlicesFromBook } from '../../features/interaction/indexing/buildSlices';

const env = (globalThis as any).process?.env ?? {};
const BASE: string | undefined = env.LIVE_BACKEND_URL;
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
const png = () => new Blob([PNG], { type: 'image/png' });

async function markRunSucceeded(runId: string, bookId: string) {
  // @ts-ignore 仅测试环境使用 node 模块
  const { execFileSync } = await import('node:child_process');
  const sql = `import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);c.execute("UPDATE runs SET status='SUCCEEDED' WHERE id=?",(sys.argv[2],));c.execute("UPDATE books SET status='ANALYZED' WHERE id=?",(sys.argv[3],));c.commit()`;
  execFileSync('python3', ['-c', sql, env.LIVE_DATABASE_PATH, runId, bookId]);
}

describe.skipIf(!BASE)('真实后端联调', () => {
  const transport = createApiClient(BASE ?? 'http://127.0.0.1:1', { getToken: () => env.LIVE_TOKEN ?? '' });
  const api = new ApiClient({ client: transport, modelServiceUrl: '' });

  it('Phase A：建档→确认→上传→分析→如实失败→书页问答和触控留痕→回读', async () => {
    const { bookId, classification } = await registerServerBook(api, { title: '联调用书', authorization_ref: 'live-check' });
    expect(classification.reasons.length).toBeGreaterThan(0);
    expect((await api.confirmCategory(bookId, 'fiction')).confirmed_type).toBe('novel');

    const pages = [{ ocr_text: '小熊在河边钓到一条金色的大鱼。', server_page_no: null as number | null, server_synced_text: null as string | null, getImage: async () => png() }];
    const started = await startServerAnalysis(api, bookId, pages, (i, p) => Object.assign(pages[i], p));
    expect(pages[0].server_page_no).toBe(1);

    let phase = summarizeRunJobs(await api.runJobs(started.run_id));
    for (let i = 0; i < 40 && phase.phase === 'running'; i += 1) {
      await new Promise((r) => setTimeout(r, 100));
      phase = summarizeRunJobs(await api.runJobs(started.run_id));
    }
    expect(phase).toMatchObject({ phase: 'failed' });
    expect((phase as any).error).toContain('PROVIDER_NOT_CONFIGURED');

    // 重试不会因重复上传而 409
    const again = await startServerAnalysis(api, bookId, pages, (i, p) => Object.assign(pages[i], p));
    expect(again.run_id).not.toBe(started.run_id);

    const indexer = new TimeSliceIndexer(buildSlicesFromBook(pages));
    const answer = await api.askQuestion({ book_id: bookId, run_id: started.run_id, video_ms: 0, query_text: '小熊钓到了什么', input_method: 'keyboard' }, 'live', undefined, { indexer });
    expect(answer).toMatchObject({ status: 'success', persisted: true });
    expect(answer.answer).toContain('金色的大鱼');

    const touch = await api.recognizeTouch({
      book_id: bookId, run_id: started.run_id, video_ms: 0,
      touch_point: { norm_x: 0.5, norm_y: 0.5, video_pixel_x: 960, video_pixel_y: 540, video_width: 1920, video_height: 1080 },
      viewport_info: { container_width: 800, container_height: 600, render_width: 800, render_height: 450, offset_x: 0, offset_y: 75, is_letterbox: true },
    }, 'live');
    expect(touch).toMatchObject({ status: 'uncertain', target_name: '', persisted: true });

    const records = (await api.fetchRemoteInteractions(started.run_id)) as any[];
    expect(records.map((r) => r.interaction_type)).toEqual(['voice', 'touch']);
    expect(records[1].input.viewport_info.offset_y).toBe(75);

    // 本地伪造的 run_id 必须写入失败且如实上报
    const fake = await api.askQuestion({ book_id: bookId, run_id: 'run-local-fake', video_ms: 0, query_text: '小熊钓到了什么' }, 'live', undefined, { indexer });
    expect(fake.persisted).toBe(false);

    // 分析失败时不能生成笔记
    await expect(api.generateNoteDraft(bookId)).rejects.toThrow('真实分析');
  }, 30000);

  it('Phase B（运行状态由测试直接置为成功）：笔记→审核→分享→公开读取→撤销→失效', async () => {
    const { bookId } = await registerServerBook(api, { title: '联调用书 B', authorization_ref: 'live-check' });
    await api.confirmCategory(bookId, 'picture_book');
    const started = await startServerAnalysis(api, bookId, [{ ocr_text: '第一页文字。', getImage: async () => png() }], () => {});
    await new Promise((r) => setTimeout(r, 300));
    await markRunSucceeded(started.run_id, bookId);

    const draft = await api.generateNoteDraft(bookId);
    expect(draft.status).toBe('DRAFT');
    await expect(reviewOnServer(api, draft.id, 'approve')).rejects.toThrow('占位');

    await api.updateNote(draft.id, noteToServerContent({ title: 't', summary: '摘要', concepts: [], sources: [{ page_no: 1, quote: '第一页文字。', start_ms: null, end_ms: null }] }));
    expect((await reviewOnServer(api, draft.id, 'approve')).local).toBe('approved');

    const share = await createShareOnServer(api, draft.id, { mode: 'link', recipients: [], expiresAt: new Date(Date.now() + 3600e3).toISOString() });
    expect(share.token).toBeTruthy();
    expect((await api.getSharedNote(share.token!)).id).toBe(draft.id);

    await revokeShareOnServer(api, draft.id, share.id);
    await expect(api.getSharedNote(share.token!)).rejects.toThrow();
  }, 30000);
});
