import { expect, it } from 'vitest';
import { TimeSliceIndexer } from '../indexing/TimeSliceIndexer';
import { buildSlicesFromBook } from '../indexing/buildSlices';
import { PictureBookRagEngine } from '../qa/PictureBookRagEngine';

it('单字主体问颜色只接受原文同句的明确颜色，不借别页颜色', async () => {
  const engine = new PictureBookRagEngine();
  const index = new TimeSliceIndexer(buildSlicesFromBook([
    { ocr_text: '小禾穿着蓝色上衣。桌上有2个红苹果。' },
    { ocr_text: '小禾拿起一本绿色的书。书名：《森林日记》。' },
  ]));
  const ask = (q: string) => engine.generateAnswer({ book_id: 'local', run_id: 'run', query_text: q, video_ms: 0 }, index);
  const result = await ask('书是什么颜色？');
  expect(result.status).toBe('success');
  expect(result.evidence[0].page_no).toBe(2);
  expect(result.answer).toContain('绿色的书');
  expect((await ask('灯是什么颜色？')).status).toBe('no_evidence');
  const misleading = new TimeSliceIndexer(buildSlicesFromBook([{ ocr_text: '书旁边开着红色的花。' }]));
  expect(misleading.searchEvidence('书是什么颜色？', 0)).toEqual([]);
  const redBricks = new TimeSliceIndexer(buildSlicesFromBook([{ ocr_text: '书是红砖厂写的。' }]));
  expect(redBricks.searchEvidence('书是什么颜色？', 0)).toEqual([]);
});
