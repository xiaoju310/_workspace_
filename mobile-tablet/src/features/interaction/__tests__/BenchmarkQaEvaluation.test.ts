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
  // 第 5 轮（D12，E-030）：无任何内容命中且只指向一端时，用全书首/尾页原文作页级依据
  { id: 'EV-16', category: 'temporal_intent', query: '故事开头讲了什么？', expectEvidence: true, expectedPage: 1, notes: '位置意图兜底：无内容命中 → 第一页' },
  { id: 'EV-17', category: 'temporal_intent', query: '结局是怎样的？', expectEvidence: true, expectedPage: 6, notes: '位置意图兜底：无内容命中 → 最后一页' },
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

/**
 * 独立人工标注黄金标准用例集 (Gold Standard Benchmark)
 * 严格按照 3.F 要求：先标定人类标准答案，再由系统运行，不改期望值以迎合实现。
 */
export interface GoldStandardCase {
  id: string;
  query: string;
  humanGoldHasAnswer: boolean;
  humanGoldPage?: number;
  safetyRequired?: boolean;
  gapCategory?: 'TIMELINE_INTENT' | 'CROSS_LINGUAL' | 'QUERY_DILUTION' | 'STOPWORD_SINGLE_CHAR' | 'PAGE_REFERENCE' | 'VISUAL_COUNT' | 'NONE';
}

export const GOLD_STANDARD_CASES: GoldStandardCase[] = [
  // 基础字面匹配（系统能正确召回）
  { id: 'GS-01', query: '小狐狸戴着什么颜色的红围巾？', humanGoldHasAnswer: true, humanGoldPage: 1, gapCategory: 'NONE' },
  { id: 'GS-02', query: '皮皮给生病的狐狸妈妈采摘什么？', humanGoldHasAnswer: true, humanGoldPage: 2, gapCategory: 'NONE' },
  { id: 'GS-03', query: '湛蓝色的羽毛和金黄色的嘴巴是谁？', humanGoldHasAnswer: true, humanGoldPage: 3, gapCategory: 'NONE' },
  { id: 'GS-04', query: '啄木鸟医生叮嘱小狐狸什么？', humanGoldHasAnswer: true, humanGoldPage: 4, gapCategory: 'NONE' },
  { id: 'GS-05', query: '黄昏时夕阳把森林染成了什么颜色？', humanGoldHasAnswer: true, humanGoldPage: 5, gapCategory: 'NONE' },
  { id: 'GS-06', query: '小狐狸最后平安回到了哪里？', humanGoldHasAnswer: true, humanGoldPage: 6, gapCategory: 'NONE' },
  { id: 'GS-07', query: '大雁', humanGoldHasAnswer: true, humanGoldPage: 3, gapCategory: 'NONE' },
  { id: 'GS-08', query: '3朵粉色小花在哪个地方？', humanGoldHasAnswer: true, humanGoldPage: 1, gapCategory: 'NONE' },

  // 人类标准有答案，但抽取式算法因能力缺口无法召回（如实记录，绝不迎合系统把 humanGold 改为 false）
  { id: 'GS-09', query: '故事开头讲了什么？', humanGoldHasAnswer: true, humanGoldPage: 1, gapCategory: 'TIMELINE_INTENT' },
  { id: 'GS-10', query: '结局是怎样的？', humanGoldHasAnswer: true, humanGoldPage: 6, gapCategory: 'TIMELINE_INTENT' },
  { id: 'GS-11', query: '小狐狸的 red scarf 是什么？', humanGoldHasAnswer: true, humanGoldPage: 1, gapCategory: 'CROSS_LINGUAL' },
  { id: 'GS-12', query: '鸟', humanGoldHasAnswer: true, humanGoldPage: 3, gapCategory: 'STOPWORD_SINGLE_CHAR' },
  { id: 'GS-13', query: '如果从悬崖跳下去会怎样？', humanGoldHasAnswer: true, humanGoldPage: 4, safetyRequired: true, gapCategory: 'QUERY_DILUTION' },

  // 人类标准本就无答案（领域外/无意义单字/无区分性词，应正确拒答）
  { id: 'GS-14', query: '谁', humanGoldHasAnswer: false, gapCategory: 'NONE' },
  { id: 'GS-15', query: 'fox 是什么？', humanGoldHasAnswer: false, gapCategory: 'NONE' },
  { id: 'GS-16', query: 'blue bird 在哪里？', humanGoldHasAnswer: false, gapCategory: 'NONE' },
  // 第 4 轮更正：上一轮把它标成"人类标准无答案"，这是贴着实现填标签——人当然知道第 1 页讲了什么。
  { id: 'GS-17', query: '第1页有什么？', humanGoldHasAnswer: true, humanGoldPage: 1, gapCategory: 'PAGE_REFERENCE' },
  { id: 'GS-18', query: '今天北京天气怎么样？', humanGoldHasAnswer: false, gapCategory: 'NONE' },
  { id: 'GS-19', query: '请问勾股定理是什么？', humanGoldHasAnswer: false, gapCategory: 'NONE' },
  { id: 'GS-20', query: '小狐狸', humanGoldHasAnswer: false, gapCategory: 'NONE' },
  // 第 4 轮新增（队长复查点名）：草地/花在第 1 页画面描述里
  // 标签先于运行写定(有答案/第1页)；运行后如实失败：5 个二元组只命中"草地"，覆盖率 0.2 < 0.4，诊断归为稀释缺口
  { id: 'GS-21', query: '草地上开着什么颜色的花？', humanGoldHasAnswer: true, humanGoldPage: 1, gapCategory: 'QUERY_DILUTION' },
];

// 第 4 轮实测：召回 8/15 = 53.3%（上一轮 61.5% 是因为 GS-17 标签贴着实现填、且没有 GS-21），精确率 8/8。
// 第 5 轮（D12 修主要错误类型，E-030 位置意图兜底）：GS-09/GS-10 由 FN 变 TP → 召回 10/15 = 66.7%，精确率 10/10。
// 注意：这条规则是看着 TIMELINE_INTENT 这类错误写的，在同一本书、同一批题上复测，不是独立留出集结果；
// 规则本身不含任何故事词，另有换书的留出用例见 Round5Regression.test.ts。标签一律未改。
const GOLD_MEASURED = { tp: 10, fn: 5, fp: 0, tn: 6 };

describe('独立人工标注黄金标准评测 (Gold Standard Benchmark)', () => {
  const indexer = new TimeSliceIndexer(DEMO_BOOK_SLICES);
  const engine = new PictureBookRagEngine();

  it('测量真实召回率、精确率与缺口分布，绝不循环论证', async () => {
    let tp = 0; // 真实有答案，系统成功召回
    let fn = 0; // 真实有答案，系统漏召回（能力缺口）
    let fp = 0; // 真实无答案，系统错误召回（假阳性）
    let tn = 0; // 真实无答案，系统正确拒答

    const identifiedGaps: Array<{ id: string; query: string; gap: string }> = [];

    for (const c of GOLD_STANDARD_CASES) {
      const resp = await engine.generateAnswer(
        { book_id: 'b', run_id: 'r', query_text: c.query, video_ms: 0 },
        indexer
      );
      const systemFound = resp.status === 'success' && resp.evidence.length > 0;

      if (c.safetyRequired) {
        // 安全底线检查：无论是否命中证据，必须触发安全提示（危险动作劝阻）
        expect(resp.answer).toContain('这样做很危险，请不要模仿');
      }

      if (c.humanGoldHasAnswer) {
        if (systemFound) {
          tp += 1;
        } else {
          fn += 1;
          identifiedGaps.push({ id: c.id, query: c.query, gap: c.gapCategory ?? 'UNKNOWN' });
        }
      } else {
        if (systemFound) {
          fp += 1;
        } else {
          tn += 1;
        }
      }
    }

    const recall = tp / (tp + fn);
    const precision = tp / (tp + fp);

    // 实测值（第 4 轮，标签更正 + 切词修复后重新跑出，不是先定数字再调代码）：
    console.info('[GOLD]', JSON.stringify({ tp, fn, fp, tn, recall: Number(recall.toFixed(3)), precision: Number(precision.toFixed(3)), gaps: identifiedGaps }));
    // 注意：这 21 条全部基于同一本 Demo 夹具书（小狐狸），只能说明抽取式检索在这本书上的行为，
    // 不能外推为"任意图书准确率"。授权真实绘本的评测集尚未建立（依赖 B/E 提供素材）。
    expect({ tp, fn, fp, tn }).toEqual(GOLD_MEASURED);
    expect(precision).toBe(GOLD_MEASURED.tp / (GOLD_MEASURED.tp + GOLD_MEASURED.fp));
  });
});
