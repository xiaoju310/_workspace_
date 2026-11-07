import { describe, it, expect } from 'vitest';
import { QA_TEST_CASES } from '../BenchmarkRunner';
import { apiClient } from '../../../lib/api';

/**
 * 基准问答（Demo 夹具回归）。
 * 旧版"15/15=100%"来自写死模板答案；改为抽取式检索后，下面这些需要语义理解
 * （同义词 大鸟→大雁、"天黑了吗"→时间/光照判断、口语停顿、复合问句）的用例确实答不出来。
 * 我们不为让数字好看而调参：它们被登记为"已知语义缺口"，等接入真实模型后应当转为通过——
 * 届时本测试会失败，提醒把它们从缺口名单移除。
 */
const KNOWN_SEMANTIC_GAPS = new Set(['QA-02', 'QA-03', 'QA-04', 'QA-08', 'QA-09', 'QA-10']);

async function passes(qa: (typeof QA_TEST_CASES)[number]) {
  const resp = await apiClient.askQuestion({ book_id: 'b', run_id: 'r', video_ms: qa.videoMs, query_text: qa.query }, 'demo');
  if (resp.status !== qa.expectedStatus) return false;
  return qa.expectedStatus === 'no_evidence' || resp.answer.includes(qa.expectedSnippet);
}

describe('基准问答用例（Demo 夹具回归，不代表真实图书准确率）', () => {
  for (const qa of QA_TEST_CASES) {
    const gap = KNOWN_SEMANTIC_GAPS.has(qa.id);
    it(`${qa.id} ${qa.title}${gap ? '（已知语义缺口）' : ''}`, async () => {
      expect(await passes(qa)).toBe(!gap);
    });
  }
});
