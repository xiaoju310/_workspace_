import type { SegmentOut } from '../../types/interaction';

/**
 * 视频时间 → 书页页码。
 *
 * 旧实现（阅读页）按「视频总时长 ÷ 书页数」平均切页：B 生成的每页视频未必等长，
 * 第 2 页的画面会被记成第 1 页的证据。现在只在后端登记了真实时间轴(segments)时才声称"定位到某页"；
 * 没有时间轴时仍显示一个估算页码供浏览，但 basis 标为 estimated，留痕不写确定页码。
 */

export type PageBasis =
  /** 落在某个时间轴区间内：页码以后端登记的时间轴为准 */
  | 'timeline'
  /** 有时间轴，但此刻落在区间之外（片头/页间空档/片尾）：取最近一段的页码，不保证准确 */
  | 'timeline_gap'
  /** 没有可用的时间轴：按总时长平均估算，仅供浏览，不能当证据 */
  | 'estimated'
  /** 静态书页图：画面本身就是该页 */
  | 'page_image';

export interface PageRef {
  /** 已上传到 A 时的服务端页码；时间轴 segments.page_no 用的就是它 */
  server_page_no?: number | null;
}

/** 页码口径与 buildSlicesFromBook 一致：服务端页码优先，否则为全书位置(1 起) */
export function pageNoOf(page: PageRef, index: number): number {
  return page.server_page_no && page.server_page_no > 0 ? page.server_page_no : index + 1;
}

export interface PageAtTime {
  /** 在 book.pages 中的位置(0 起)，用于显示 */
  index: number;
  /** 与 segments.page_no 同口径的页码 */
  pageNo: number;
  basis: PageBasis;
  /** 只有 basis === 'timeline' 才算"已准确定位" */
  exact: boolean;
}

/** 可用于定位的区间：数值有效、区间非空、页码属于这本书 */
function usableSegments(pages: PageRef[], segments: SegmentOut[] | undefined): SegmentOut[] {
  if (!segments?.length) return [];
  const known = new Set(pages.map((page, index) => pageNoOf(page, index)));
  return segments.filter(
    (s) =>
      Number.isFinite(s.start_ms) && Number.isFinite(s.end_ms) && s.start_ms >= 0 && s.end_ms > s.start_ms &&
      typeof s.page_no === 'number' && known.has(s.page_no)
  );
}

function indexOfPageNo(pages: PageRef[], pageNo: number): number {
  const found = pages.findIndex((page, index) => pageNoOf(page, index) === pageNo);
  return found >= 0 ? found : 0;
}

function evenSplitIndex(timeMs: number, pageCount: number, durationMs: number): number {
  const n = Math.max(1, pageCount);
  return Math.min(n - 1, Math.max(0, Math.floor(timeMs / Math.max(1, durationMs / n))));
}

export function resolvePageAtTime(
  timeMs: number,
  pages: PageRef[],
  segments: SegmentOut[] | undefined,
  durationMs: number
): PageAtTime {
  const usable = usableSegments(pages, segments);
  if (!usable.length) {
    const index = evenSplitIndex(timeMs, pages.length, durationMs);
    return { index, pageNo: pages.length ? pageNoOf(pages[index], index) : index + 1, basis: 'estimated', exact: false };
  }
  const t = Number.isFinite(timeMs) ? Math.max(0, timeMs) : 0;
  const lastEnd = Math.max(...usable.map((s) => s.end_ms));
  // 区间 [start, end)；视频最后一帧(t === 全部区间的最大 end)归最后一段
  const containing = usable.filter((s) => s.start_ms <= t && (t < s.end_ms || (t === s.end_ms && s.end_ms === lastEnd)));
  if (containing.length) {
    // 区间重叠时取开始得最晚的那段（画面已经切到它）
    const hit = containing.reduce((best, s) => (s.start_ms > best.start_ms ? s : best));
    return { index: indexOfPageNo(pages, hit.page_no), pageNo: hit.page_no, basis: 'timeline', exact: true };
  }
  const ended = usable.filter((s) => s.end_ms <= t);
  const near = ended.length
    ? ended.reduce((best, s) => (s.end_ms > best.end_ms ? s : best))
    : usable.reduce((best, s) => (s.start_ms < best.start_ms ? s : best));
  return { index: indexOfPageNo(pages, near.page_no), pageNo: near.page_no, basis: 'timeline_gap', exact: false };
}

/** 跳到某一页的起点：有该页的时间轴取其最早开始；否则平均估算（exact=false） */
export function pageStartMs(
  index: number,
  pages: PageRef[],
  segments: SegmentOut[] | undefined,
  durationMs: number
): { ms: number; exact: boolean } {
  const pageNo = pages[index] ? pageNoOf(pages[index], index) : index + 1;
  const own = usableSegments(pages, segments).filter((s) => s.page_no === pageNo);
  if (own.length) return { ms: Math.min(...own.map((s) => s.start_ms)), exact: true };
  return { ms: (index / Math.max(1, pages.length)) * durationMs, exact: false };
}

export function pageBasisLabel(basis: PageBasis): string {
  switch (basis) {
    case 'timeline':
      return '依据后端时间轴';
    case 'timeline_gap':
      return '此刻不在时间轴区间内，取最近一段的页码，仅供参考';
    case 'estimated':
      return '后端未登记时间轴，按视频时长平均估算，仅供浏览，点击留痕不记确定页码';
    default:
      return '静态书页';
  }
}
