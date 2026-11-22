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

  it.each([
    ['小禾拿起书。因为下雨，小鸟飞回家。','小禾为什么拿起书？',false],
    ['小禾拿起书。因为下雨，小鸟飞回家。','小鸟为什么飞回家？',true],
    ['小禾因为下雨，小鸟拿起书。','小禾为什么拿起书？',false],
    ['小禾为了学习生字，拿起书。','小禾为什么拿起书？',true],
    ['因为下雨，小禾拿起书。','小禾为什么拿起书？',true],
    ['小禾拿起书，因为要学习。','小禾为什么拿起书？',true],
    ['小禾拿起书，小鸟因为下雨，飞回家。','小禾为什么拿起书？',false],
    ['因为下雨，小鸟飞回家，小禾拿起书。','小禾为什么拿起书？',false],
    ['小禾看见小鸟拿起书，因为要学习。','小禾为什么拿起书？',false],
    ['因为下雨，小禾没有拿起书。','小禾为什么拿起书？',false],
    ['Xiaohe picks up a book. Birds fly home because it rains.','Why does Xiaohe picks up a book?',false],
    ['Birds do not fly home because it rains.','Why do birds fly home?',false],
    ['Xiaohe picked up a book. A bird flew home because it rained.','Why did Xiaohe pick up a book?',false],
  ])('原因须对应主体及动作：%s',async(text,question,valid)=>{
    const result=await new PictureBookRagEngine().generateAnswer({book_id:'causal-regression',run_id:'offline',query_text:question,video_ms:0},new TimeSliceIndexer(buildSlicesFromBook([{ocr_text:text}])))
    expect(result.status).toBe(valid?'success':'no_evidence')
    if(!valid)expect(result.evidence).toEqual([])
  })
});
