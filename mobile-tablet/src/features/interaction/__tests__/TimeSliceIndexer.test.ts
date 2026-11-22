import { describe, it, expect } from 'vitest';
import { TimeSliceIndexer, DEMO_BOOK_SLICES, contentBigrams } from '../indexing/TimeSliceIndexer';
import { buildSlicesFromBook } from '../indexing/buildSlices';

describe('TimeSliceIndexer（抽取式检索，无故事专用词表）', () => {
  const idx = new TimeSliceIndexer(DEMO_BOOK_SLICES);

  it('按时间定位页片', () => {
    expect(idx.findSliceByVideoMs(3500)?.page_no).toBe(1);
    expect(idx.findSliceByVideoMs(50000)?.page_no).toBe(6);
  });

  it('实体检索：红围巾 → 第 1 页', () => {
    const ev = idx.searchEvidence('这只戴红围巾的小动物是谁？', 3500);
    expect(ev[0]?.page_no).toBe(1);
  });

  it('结局意图（通用规则）→ 最后一页', () => {
    const ev = idx.searchEvidence('它最后找到妈妈了吗？', 2000);
    expect(ev.find((e) => e.page_no === 6)).toBeDefined();
  });

  it('超纲问题无证据（不依赖黑名单）', () => {
    expect(idx.searchEvidence('森林里有外星人飞船吗？', 10000)).toHaveLength(0);
    expect(idx.searchEvidence('小狐狸的爸爸是宇航员吗？', 3000)).toHaveLength(0);
    expect(idx.searchEvidence('今天天气怎么样', 3000)).toHaveLength(0);
  });

  it('只命中全书都有的词（小狐狸）不构成证据', () => {
    expect(idx.searchEvidence('小狐狸会开飞机吗', 3000)).toHaveLength(0);
  });

  it('换一本书：索引完全由该书内容决定，不会出现小狐狸', () => {
    const other = new TimeSliceIndexer(buildSlicesFromBook([{ ocr_text: '小熊在河边钓到一条金色的大鱼。' }, { ocr_text: '大鱼说谢谢你放了我。' }]));
    expect(other.searchEvidence('小熊钓到了什么', 0)[0]?.page_no).toBe(1);
    expect(other.searchEvidence('小狐狸戴什么围巾', 0)).toHaveLength(0);
  });

  it('没有时间轴的页：证据标为 page 级，不伪造视频时间', () => {
    const noTl = new TimeSliceIndexer(buildSlicesFromBook([{ ocr_text: '小熊在河边钓到一条金色的大鱼。' }]));
    const ev = noTl.searchEvidence('小熊钓到了什么', 5000);
    expect(ev[0].evidence_type).toBe('page');
  });

  it('切词会丢弃功能字', () => {
    expect(contentBigrams('为什么吗')).toEqual([]);
  });

  it('"捡到"不能被切坏：原文明写的内容要能答出来', () => {
    const book = new TimeSliceIndexer(buildSlicesFromBook([
      { ocr_text: '清晨，小狐狸在树下捡到一封信。' },
      { ocr_text: '小狐狸带着信走进森林。' },
      { ocr_text: '邮局里，小狐狸写下回信。' },
    ]));
    expect(book.searchEvidence('小狐狸捡到了什么信', 0)[0]?.page_no).toBe(1);
  });

  it('指纹随内容变化，相同内容不变', () => {
    const a = new TimeSliceIndexer(buildSlicesFromBook([{ ocr_text: '甲' }]));
    const b = new TimeSliceIndexer(buildSlicesFromBook([{ ocr_text: '甲' }]));
    const c = new TimeSliceIndexer(buildSlicesFromBook([{ ocr_text: '乙' }]));
    expect(a.fingerprint()).toBe(b.fingerprint());
    expect(a.fingerprint()).not.toBe(c.fingerprint());
  });
});
