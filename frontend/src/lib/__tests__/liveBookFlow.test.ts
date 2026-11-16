import { describe, it, expect, vi } from 'vitest';
import { registerServerBook, startServerAnalysis, summarizeRunJobs } from '../liveBookFlow';
import { fromBackendBookType } from '../api';
import { noteToServerContent } from '../noteSync';

function fakeApi() {
  const calls: string[] = [];
  return {
    calls,
    createBook: vi.fn(async () => { calls.push('create'); return { id: 'srv-1' }; }),
    classifyBook: vi.fn(async () => { calls.push('classify'); return { predicted_type: 'other', confidence: 0.3, reasons: ['r'] }; }),
    uploadPage: vi.fn(async (_b: string, _f: Blob, n: number) => { calls.push(`upload${n}`); }),
    updatePageOcr: vi.fn(async (_b: string, n: number) => { calls.push(`ocr${n}`); }),
    analyzeBook: vi.fn(async () => { calls.push('analyze'); return { job_id: 'j', run_id: 'r', status: 'QUEUED' }; }),
  };
}
const page = (text: string, extra = {}) => ({ ocr_text: text, getImage: async () => new Blob(['x'], { type: 'image/png' }), ...extra });

describe('registerServerBook', () => {
  it('建档后必须立刻分类（否则确认分类 409）', async () => {
    const api = fakeApi();
    const r = await registerServerBook(api, { title: 't', authorization_ref: 'a' });
    expect(api.calls).toEqual(['create', 'classify']);
    expect(r.bookId).toBe('srv-1');
  });
  it('分类失败要抛错并带上已建档的 ID', async () => {
    const api = fakeApi();
    api.classifyBook.mockRejectedValueOnce(new Error('boom'));
    await expect(registerServerBook(api, { title: 't', authorization_ref: 'a' })).rejects.toThrow(/srv-1.*boom/);
  });
});

describe('startServerAnalysis', () => {
  it('按页序上传并写校对文字，最后才发起分析，run_id 来自服务端', async () => {
    const api = fakeApi();
    const out = await startServerAnalysis(api, 'b', [page('一'), page('二')], () => {});
    expect(api.calls).toEqual(['upload1', 'ocr1', 'upload2', 'ocr2', 'analyze']);
    expect(out).toEqual({ job_id: 'j', run_id: 'r' });
  });
  it('重试只补未同步部分，不重复上传（重复上传 A 会 409）', async () => {
    const api = fakeApi();
    await startServerAnalysis(api, 'b', [page('一', { server_page_no: 1, server_synced_text: '一' }), page('改过', { server_page_no: 2, server_synced_text: '旧' })], () => {});
    expect(api.calls).toEqual(['ocr2', 'analyze']);
  });
  it('半途失败：已同步的页通过 onSynced 留下，且不发起分析', async () => {
    const api = fakeApi();
    api.uploadPage.mockImplementationOnce(async () => {}).mockRejectedValueOnce(new Error('413'));
    const synced: number[] = [];
    await expect(startServerAnalysis(api, 'b', [page('一'), page('二')], (i) => synced.push(i))).rejects.toThrow('413');
    expect(synced).toContain(0);
    expect(api.analyzeBook).not.toHaveBeenCalled();
  });
  it('上传后调整页序：直接拒绝，什么都不发', async () => {
    const api = fakeApi();
    await expect(startServerAnalysis(api, 'b', [page('二', { server_page_no: 2 }), page('一', { server_page_no: 1 })], () => {})).rejects.toThrow('顺序');
    expect(api.calls).toEqual([]);
  });
  it('服务端没给 run_id：报错，不自己造', async () => {
    const api = fakeApi();
    api.analyzeBook.mockResolvedValueOnce({ job_id: '', run_id: '', status: 'QUEUED' });
    await expect(startServerAnalysis(api, 'b', [page('一')], () => {})).rejects.toThrow('运行标识');
  });
});

describe('summarizeRunJobs', () => {
  const job = (status: string, code: string | null = null) => ({ status, stage: 'analyze', error_code: code, error_message: code ? '原因' : null });
  it('失败带错误码；全成功才成功；空列表不算成功', () => {
    expect(summarizeRunJobs([job('FAILED', 'PROVIDER_NOT_CONFIGURED')])).toEqual({ phase: 'failed', error: 'PROVIDER_NOT_CONFIGURED：原因' });
    expect(summarizeRunJobs([job('SUCCEEDED')])).toEqual({ phase: 'succeeded' });
    expect(summarizeRunJobs([job('SUCCEEDED'), job('RUNNING')])).toEqual({ phase: 'running' });
    expect(summarizeRunJobs([])).toEqual({ phase: 'running' });
  });
});

describe('辅助映射', () => {
  it('A 的类型映射回 UI，other 交给主人选', () => {
    expect(fromBackendBookType('novel')).toBe('fiction');
    expect(fromBackendBookType('science')).toBe('nonfiction');
    expect(fromBackendBookType('other')).toBe('unknown');
  });
  it('笔记内容带摘要和来源，且不发送 is_placeholder', () => {
    const c = noteToServerContent({ title: 't', summary: 's', concepts: [], sources: [{ page_no: 1, quote: 'q', start_ms: null, end_ms: null }] });
    expect(c.summary).toBe('s');
    expect(c.sources).toEqual([{ page_no: 1, quote: 'q', start_ms: null, end_ms: null }]);
    expect(c).not.toHaveProperty('is_placeholder');
  });
});
