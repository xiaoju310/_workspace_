import { describe, it, expect } from 'vitest';
import { TimeSliceIndexer, DEFAULT_BOOK_SLICES } from '../indexing/TimeSliceIndexer';

describe('TimeSliceIndexer (绘本视频时间片与多模态证据索引测试)', () => {
  const indexer = new TimeSliceIndexer(DEFAULT_BOOK_SLICES);

  it('用例 1: 根据时间毫秒数精确定位当前页', () => {
    const sliceP1 = indexer.findSliceByVideoMs(3500);
    expect(sliceP1?.page_no).toBe(1);

    const sliceP3 = indexer.findSliceByVideoMs(22000);
    expect(sliceP3?.page_no).toBe(3);

    const sliceP6 = indexer.findSliceByVideoMs(50000);
    expect(sliceP6?.page_no).toBe(6);
  });

  it('用例 2: 实体与情节关联检索 (召回当前页事实证据)', () => {
    const evidence = indexer.searchEvidence('这只戴红围巾的小动物是谁？', 3500);
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence[0].page_no).toBe(1);
    expect(evidence[0].snippet).toContain('戴红围巾');
    expect(evidence[0].confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('用例 3: 跨时间片结尾剧情检索 (找到妈妈了吗)', () => {
    const evidence = indexer.searchEvidence('它最后找到妈妈了吗？', 2000);
    expect(evidence.length).toBeGreaterThan(0);
    // 应当成功召回到第 6 页的团聚剧情
    const p6 = evidence.find((e) => e.page_no === 6);
    expect(p6).toBeDefined();
    expect(p6?.snippet).toContain('团聚');
  });

  it('用例 4: 负样本与超纲词汇过滤 (防幻觉)', () => {
    const negativeEv1 = indexer.searchEvidence('森林里有外星人飞船吗？', 10000);
    expect(negativeEv1).toHaveLength(0);

    const negativeEv2 = indexer.searchEvidence('恐龙和汽车在比赛吗？', 15000);
    expect(negativeEv2).toHaveLength(0);
  });
});
