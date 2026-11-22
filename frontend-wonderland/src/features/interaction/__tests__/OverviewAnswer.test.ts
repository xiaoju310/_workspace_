import { describe, expect, it } from 'vitest';
import { overviewIntent } from '../qa/overviewIntent';
import { PictureBookRagEngine } from '../qa/PictureBookRagEngine';
import { TimeSliceIndexer } from '../indexing/TimeSliceIndexer';
import { buildSlicesFromBook } from '../indexing/buildSlices';
import type { AskQuestionRequest } from '../../../types/interaction';

const turtle = '再说乌龟，爬得也真慢，可他一刻也不停地爬，爬，爬。兔子真的合上眼皮，呼呼睡觉了。';
const req = (query_text: string, extra: Partial<AskQuestionRequest> = {}): AskQuestionRequest => ({
  book_id: 'actual-book', run_id: 'run', video_ms: 0, query_text, ...extra,
});
const index = (texts: string[]) => new TimeSliceIndexer(buildSlicesFromBook(texts.map(ocr_text => ({ ocr_text }))));

describe('概括提问：按范围引用校对原文，不虚构理解结果', () => {
  it.each([
    ['呃，图书。他讲了一个什么事？', 'book'],
    ['这本书主要讲了什么？', 'book'], ['故事讲述了什么？', 'book'],
    ['请问这页讲了什么？', 'page'], ['这一页发生了什么事情呢？', 'page'],
    ['这页讲了什么故事？', 'page'], ['主要内容是什么？', 'page'],
    ['帮我概括一下这本书', 'book'], ['这里讲的是什么？', 'page'],
    ['嗯，能不能告诉我这页写了什么内容呀？', 'page'],
  ])('识别自然问法 %s', (q, scope) => expect(overviewIntent(q)).toBe(scope));

  it.each(['小猫发生了什么事？', '兔子为什么睡觉？', '这本书里有没有大象？', '今天北京天气怎么样？', '这个故事告诉我们什么道理？', '这里为什么着火？', '这页讲了什么，怎么摸插座？'])('不把具体问题吞成概览 %s', q => {
    expect(overviewIntent(q)).toBeNull();
  });

  it('复现截图：保留转写，引用这一页，不添加龟兔赛跑结局', async () => {
    const q = '呃，图书。他讲了一个什么事？';
    const result = await new PictureBookRagEngine().generateAnswer(req(q), index([turtle]));
    expect(result.status).toBe('success');
    expect(result.question).toBe(q);
    expect(result.answer).toContain(turtle);
    expect(result.answer).toContain('不代表完整原书');
    expect(result.answer).not.toMatch(/冠军|赢得|获胜|终点/);
    expect(result.evidence[0]).toMatchObject({ page_no: 1, evidence_type: 'page', source_quote: turtle });
    expect(result.latency.llm_total_ms).toBeNull();
  });

  it('换当前页时缓存不会沿用前一页；同页重复提问会命中缓存', async () => {
    const engine = new PictureBookRagEngine();
    const idx = index(['小猫在看书。', '小狗在浇花。']);
    const one = await engine.generateAnswer(req('这页讲了什么？', { current_page_no: 1 }), idx);
    const two = await engine.generateAnswer(req('这页讲了什么？', { current_page_no: 2 }), idx);
    expect(one.answer).toContain('小猫在看书');
    expect(two.answer).toContain('小狗在浇花');
    expect(two.answer).not.toContain('小猫');
    expect(two.cache_hit).toBe(false);
    expect((await engine.generateAnswer(req('这页讲了什么？', { current_page_no: 2 }), idx)).cache_hit).toBe(true);
    const changed = await engine.generateAnswer(req('这页讲了什么？', { current_page_no: 2 }), index(['小猫在看书。', '小狗在睡觉。']));
    expect(changed.cache_hit).toBe(false);
    expect(changed.answer).toContain('睡觉');
  });

  it('没有时间轴又不知道当前页时不擅自用第一页；明确全书可引用多页', async () => {
    const engine = new PictureBookRagEngine(), idx = index(['第一段原文。', '第二段原文。']);
    expect((await engine.generateAnswer(req('这页讲了什么？'), idx)).status).toBe('no_evidence');
    const whole = await engine.generateAnswer(req('这本书讲了什么？'), idx);
    expect(whole.evidence.map(e => e.page_no)).toEqual([1, 2]);
    expect(whole.answer).toContain('第一段原文');
    expect(whole.answer).toContain('第二段原文');
  });

  it('有真实时间轴时可以定位；显式未知页码不能回退到时间轴或单页', async () => {
    const idx = new TimeSliceIndexer(buildSlicesFromBook([{ ocr_text: '早上出门。' }, { ocr_text: '晚上回家。' }], [
      { id: 's1', run_id: 'run', page_no: 1, start_ms: 0, end_ms: 5000, caption: '', source: { producer: 'test' } },
      { id: 's2', run_id: 'run', page_no: 2, start_ms: 5000, end_ms: 9000, caption: '', source: { producer: 'test' } },
    ]));
    const engine = new PictureBookRagEngine();
    expect((await engine.generateAnswer(req('这里讲了什么？', { video_ms: 6000 }), idx)).evidence[0].page_no).toBe(2);
    expect((await engine.generateAnswer(req('这里讲了什么？', { video_ms: 6000, current_page_no: null }), idx)).status).toBe('no_evidence');
  });

  it('未校对、空白、无效页码均不能拿别页代替；服务端页码保持不变', async () => {
    const idx = new TimeSliceIndexer(buildSlicesFromBook([
      { ocr_text: '未经确认的秘密', confirmed: false, server_page_no: 10 },
      { ocr_text: '真正校对的原文。', confirmed: true, server_page_no: 20 },
      { ocr_text: '', confirmed: true, server_page_no: 30 },
    ]));
    const engine = new PictureBookRagEngine();
    for (const current_page_no of [undefined, 10, 30, 99]) {
      expect((await engine.generateAnswer(req('这页讲了什么？', { current_page_no }), idx)).status).toBe('no_evidence');
    }
    const whole = await engine.generateAnswer(req('整本书讲了什么？'), idx);
    expect(whole.evidence.map(e => e.page_no)).toEqual([20]);
    expect(whole.answer).not.toContain('秘密');
    expect((await engine.generateAnswer(req('讲了什么事？'), index([]))).status).toBe('no_evidence');
  });

  it('长书限制返回规模，明确是节选并保留首尾页证据', async () => {
    const texts = Array.from({ length: 20 }, (_, i) => `页面${i + 1}：${'一段较长的原文。'.repeat(50)}`);
    const out = await new PictureBookRagEngine().generateAnswer(req('这本书主要讲了什么？'), index(texts));
    expect(out.evidence).toHaveLength(6);
    expect(out.evidence[0].page_no).toBe(1);
    expect(out.evidence[5].page_no).toBe(20);
    expect(out.answer).toContain('20 页文字，选取其中 6 页节选');
    expect(out.answer).toContain('…');
    expect(out.answer.length).toBeLessThan(1600);
  });

  it('陌生人物不强答，危险问题保留安全提醒', async () => {
    const engine = new PictureBookRagEngine(), idx = index([turtle]);
    expect((await engine.generateAnswer(req('大象做了什么事？'), idx)).status).toBe('no_evidence');
    expect((await engine.generateAnswer(req('可以从楼上跳下去吗？'), idx)).answer).toContain('请不要模仿');
  });
});
