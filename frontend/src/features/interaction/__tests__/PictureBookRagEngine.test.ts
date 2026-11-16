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

  it('重复提问命中缓存并标记 cache_hit: true', async () => {
    pictureBookRagEngine.clearCache();
    const first = await ask('小狐狸戴着什么围巾？');
    expect(first.cache_hit).toBe(false);

    const second = await ask('小狐狸戴着什么围巾？');
    expect(second.cache_hit).toBe(true);
    expect(second.answer).toBe(first.answer);
    expect(second.latency.retrieval_ms).toBe(0);

    pictureBookRagEngine.clearCache();
    const third = await ask('小狐狸戴着什么围巾？');
    expect(third.cache_hit).toBe(false);
  });

  describe('缓存不能返回过期答案', () => {
    const req = { book_id: 'b', run_id: 'r', video_ms: 0, query_text: '小熊钓到了什么' };
    const fish = new TimeSliceIndexer([{ page_no: 1, video_start_ms: -1, video_end_ms: -1, ocr_content: '小熊在河边钓到一条金色的大鱼。', entities: [], script: '', frame_objects: [], lighting: '', snippet: '第 1 页' }]);
    const boot = new TimeSliceIndexer([{ page_no: 1, video_start_ms: -1, video_end_ms: -1, ocr_content: '小熊在河边钓到一只旧靴子。', entities: [], script: '', frame_objects: [], lighting: '', snippet: '第 1 页' }]);

    it('未校对时的拒答，校对完成后不再命中', async () => {
      pictureBookRagEngine.clearCache();
      expect((await pictureBookRagEngine.generateAnswer(req, new TimeSliceIndexer([]))).status).toBe('no_evidence');
      const after = await pictureBookRagEngine.generateAnswer(req, fish);
      expect(after).toMatchObject({ status: 'success', cache_hit: false });
    });
    it('改了书页文字后返回新内容', async () => {
      pictureBookRagEngine.clearCache();
      await pictureBookRagEngine.generateAnswer(req, fish);
      const after = await pictureBookRagEngine.generateAnswer(req, boot);
      expect(after.cache_hit).toBe(false);
      expect(after.answer).toContain('旧靴子');
    });
    it('不同的书不共享缓存，同一本书内容未变才命中', async () => {
      pictureBookRagEngine.clearCache();
      await pictureBookRagEngine.generateAnswer(req, fish);
      expect((await pictureBookRagEngine.generateAnswer({ ...req, book_id: 'b2' }, fish)).cache_hit).toBe(false);
      expect((await pictureBookRagEngine.generateAnswer(req, fish)).cache_hit).toBe(true);
    });
  });

  describe('安全提示不依赖证据', () => {
    const idx2 = new TimeSliceIndexer([{ page_no: 1, video_start_ms: -1, video_end_ms: -1, ocr_content: '小狐狸来到悬崖边，啄木鸟说别靠近。', entities: [], script: '', frame_objects: [], lighting: '', snippet: '第 1 页' }]);
    for (const q of ['如果从悬崖跳下去会怎样？', '我想玩火可以吗']) {
      it(`"${q}" 没有依据时仍要提醒`, async () => {
        const r = await pictureBookRagEngine.generateAnswer({ book_id: 'b', run_id: 's', video_ms: 0, query_text: q }, idx2);
        expect(r.status).toBe('no_evidence');
        expect(r.answer).toContain('危险');
      });
    }
    it('普通问题不加安全提示', async () => {
      const r = await pictureBookRagEngine.generateAnswer({ book_id: 'b', run_id: 's', video_ms: 0, query_text: '今天吃什么' }, idx2);
      expect(r.answer).not.toContain('危险');
    });
  });
});
