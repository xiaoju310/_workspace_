import { describe, it, expect } from 'vitest';
import { pictureBookRagEngine } from '../qa/PictureBookRagEngine';
import { TimeSliceIndexer, DEMO_BOOK_SLICES } from '../indexing/TimeSliceIndexer';

const idx = new TimeSliceIndexer(DEMO_BOOK_SLICES);
const ask = (q: string, ms = 0) => pictureBookRagEngine.generateAnswer({ book_id: 'b', run_id: 'r', video_ms: ms, query_text: q }, idx);

describe('PictureBookRagEngine（抽取式短答）', () => {
  it('有依据：答案是原文节选并绑定页码证据', async () => {
    const r = await ask('小狐狸为什么迷路？');
    expect(r.status).toBe('success');
    expect(r.evidence[0].page_no).toBe(2);
    expect(r.answer).toContain('第 2 页');
    expect(r.answer).toContain('迷路');
  });

  it('无依据：拒答，不生成内容', async () => {
    const r = await ask('森林里有外星人或者恐龙飞船吗？');
    expect(r.status).toBe('no_evidence');
    expect(r.evidence).toHaveLength(0);
    expect(r.answer).toContain('没有找到');
  });

  it('空索引(没有校对文字)：明确说明原因而不是编故事', async () => {
    const r = await pictureBookRagEngine.generateAnswer({ book_id: 'b', run_id: 'r', video_ms: 0, query_text: '主角是谁' }, new TimeSliceIndexer([]));
    expect(r.status).toBe('no_evidence');
    expect(r.answer).toContain('校对');
  });

  it('危险行为：附带通用安全提示，且仍只引用原文', async () => {
    const r = await ask('小狐狸可以从悬崖跳下去吗？');
    expect(r.answer).toContain('危险');
    expect(r.evidence[0].page_no).toBe(4);
  });

  it('耗时不造假：未测量阶段为 null', async () => {
    const r = await ask('小狐狸为什么迷路？');
    expect(r.latency.llm_total_ms).toBeNull();
    expect(r.latency.tts_first_audio_ms).toBeNull();
    expect(r.latency.total_roundtrip_ms).toBeGreaterThanOrEqual(0);
  });
});
