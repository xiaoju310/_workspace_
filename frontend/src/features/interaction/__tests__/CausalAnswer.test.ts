import { describe, expect, it } from 'vitest';
import { PictureBookRagEngine } from '../qa/PictureBookRagEngine';
import { TimeSliceIndexer } from '../indexing/TimeSliceIndexer';
import { buildSlicesFromBook } from '../indexing/buildSlices';

describe('causal question does not invent motivation', () => {
  it('rejects an action-only page and accepts explicitly stated purpose', async () => {
    const engine = new PictureBookRagEngine();
    const ask = (text: string) => engine.generateAnswer(
      { book_id: 'different-book', run_id: 'run', query_text: '为什么拿起书？', video_ms: 0 },
      new TimeSliceIndexer(buildSlicesFromBook([{ ocr_text: text }, { ocr_text: '窗外下雨了。' }])),
    );
    const missing = await ask('小兔拿起一本绿色的书。');
    expect(missing.status).toBe('no_evidence');
    expect(missing.answer).toContain('没有写明原因');
    const explicit = await ask('小兔为了学习生字，拿起一本绿色的书。');
    expect(explicit.status).toBe('success');
    expect(explicit.answer).toContain('为了学习生字');
  });
});
