// 注意：这里的期望值记录的是当前行为（回归用），不是标准答案，不能据此报告召回率或准确率。
import { describe, it, expect } from 'vitest';
import { TimeSliceIndexer, DEMO_BOOK_SLICES, contentBigrams } from '../indexing/TimeSliceIndexer';
import { PictureBookRagEngine } from '../qa/PictureBookRagEngine';

export interface EvalCase {
  id: string;
  category: 'normal_chinese' | 'short_single_char' | 'english_mixed' | 'number_query' | 'temporal_intent' | 'safety' | 'out_of_domain';
  query: string;
  expectEvidence: boolean;
  expectedPage?: number;
  notes: string;
}

export const EVALUATION_CASES: EvalCase[] = [
  { id: 'EV-01', category: 'normal_chinese', query: '小狐狸戴着什么颜色的红围巾？', expectEvidence: true, expectedPage: 1, notes: '多二元组命中红围巾' },
  { id: 'EV-02', category: 'normal_chinese', query: '皮皮给生病的狐狸妈妈采摘什么？', expectEvidence: true, expectedPage: 2, notes: '命中狐狸妈妈、红浆果' },
  { id: 'EV-03', category: 'normal_chinese', query: '湛蓝色的羽毛和金黄色的嘴巴是谁？', expectEvidence: true, expectedPage: 3, notes: '命中湛蓝、金黄' },
  { id: 'EV-04', category: 'normal_chinese', query: '啄木鸟医生叮嘱小狐狸什么？', expectEvidence: true, expectedPage: 4, notes: '命中啄木鸟、悬崖/小溪' },
  { id: 'EV-05', category: 'normal_chinese', query: '黄昏时夕阳把森林染成了什么颜色？', expectEvidence: true, expectedPage: 5, notes: '命中黄昏、夕阳、橙红' },
  { id: 'EV-06', category: 'normal_chinese', query: '小狐狸最后平安回到了哪里？', expectEvidence: true, expectedPage: 6, notes: '命中最后、小屋' },
  { id: 'EV-07', category: 'short_single_char', query: '谁', expectEvidence: false, notes: '停用词过滤后为空，二元组长度0，正确拒答' },
  { id: 'EV-08', category: 'short_single_char', query: '鸟', expectEvidence: false, notes: '单字长度为1被过滤，无二元组，拒答（短问句缺口）' },
  { id: 'EV-09', category: 'short_single_char', query: '溪', expectEvidence: false, notes: '单字长度为1被过滤，无二元组，拒答（短问句缺口）' },
  { id: 'EV-10', category: 'short_single_char', query: '大雁', expectEvidence: true, expectedPage: 3, notes: '两字词可生成二元组[大雁]，精准命中第3页' },
  { id: 'EV-11', category: 'english_mixed', query: 'fox 是什么？', expectEvidence: false, notes: 'fox切出fo/ox，在中文OCR中无匹配，拒答' },
  { id: 'EV-12', category: 'english_mixed', query: 'blue bird 在哪里？', expectEvidence: false, notes: '英文无法对齐中文语义，拒答' },
  { id: 'EV-13', category: 'english_mixed', query: '小狐狸的 red scarf 是什么？', expectEvidence: false, notes: '小狐狸非区分词，英文无匹配，拒答' },
  { id: 'EV-14', category: 'number_query', query: '第1页有什么？', expectEvidence: false, notes: '停用词去功能词后单数字1被丢弃，二元组为空，拒答' },
  { id: 'EV-15', category: 'number_query', query: '3朵粉色小花在哪个地方？', expectEvidence: true, expectedPage: 1, notes: '包含3朵/粉色/小花，可生成二元组并命中第1页' },
  // 时序意图在文本无词重叠时 coverage (0+0.3=0.3 < 0.4) 仍会拒答，如实体现抽取式限制
  { id: 'EV-16', category: 'temporal_intent', query: '故事开头讲了什么？', expectEvidence: false, notes: '原文无“开头”二元组，coverage仅0.3<0.4，拒答（语义缺口）' },
  { id: 'EV-17', category: 'temporal_intent', query: '结局是怎样的？', expectEvidence: false, notes: '原文无“结局”二元组，coverage仅0.3<0.4，拒答（语义缺口）' },
  // 长问句多二元组稀释：5个二元组中仅中1个“悬崖”，1/5=0.2 < 0.4，被阈值拦截
  { id: 'EV-18', category: 'safety', query: '如果从悬崖跳下去会怎样？', expectEvidence: false, notes: '多二元组稀释导致1/5=0.2<0.4，单实体被阈值拦截（参数缺口）' },
  { id: 'EV-19', category: 'out_of_domain', query: '今天北京天气怎么样？', expectEvidence: false, notes: '完全无依据，正确拒答' },
  { id: 'EV-20', category: 'out_of_domain', query: '请问勾股定理是什么？', expectEvidence: false, notes: '无依据，正确拒答' },
  { id: 'EV-21', category: 'short_single_char', query: '小狐狸', expectEvidence: false, notes: '小狐狸跨页>50%，非区分性词，按规则拒答防乱召回' },
];

describe('抽取式二元组小评测（21项真实多模态/问答用例）', () => {
  const indexer = new TimeSliceIndexer(DEMO_BOOK_SLICES);
  const engine = new PictureBookRagEngine();

  for (const c of EVALUATION_CASES) {
    it(`${c.id} [${c.category}] "${c.query}" -> 依据=${c.expectEvidence}`, async () => {
      const resp = await engine.generateAnswer(
        { book_id: 'b', run_id: 'r', query_text: c.query, video_ms: 0 },
        indexer
      );

      if (c.expectEvidence) {
        expect(resp.status).toBe('success');
        expect(resp.evidence.length).toBeGreaterThan(0);
        if (c.expectedPage) {
          expect(resp.evidence[0].page_no).toBe(c.expectedPage);
        }
      } else {
        expect(resp.status).toBe('no_evidence');
        expect(resp.evidence.length).toBe(0);
      }
    });
  }

  it('二元组提取对短字符与数字的边界行为验证', () => {
    // 单字: 长度为1，忽略
    expect(contentBigrams('谁')).toEqual([]);
    expect(contentBigrams('鸟')).toEqual([]);
    expect(contentBigrams('1')).toEqual([]);
    // 两个字: 生成1个二元组
    expect(contentBigrams('大雁')).toEqual(['大雁']);
    // 数字+汉字
    expect(contentBigrams('3朵花')).toEqual(['3朵', '朵花']);
    // 英文单词
    expect(contentBigrams('fox')).toEqual(['fo', 'ox']);
  });
});
