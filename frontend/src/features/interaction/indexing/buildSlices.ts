import type { SegmentOut } from '../../../types/interaction';
import type { PictureBookSliceData } from './TimeSliceIndexer';

/** 当前图书页面的最小视图（来自主人校对后的 OCR 文本，而不是任何写死的故事） */
export interface BookPageLike {
  ocr_text: string;
  /** 显式为 false 的页（未校对）不进入索引；省略视为已校对（兼容纯文本调用） */
  confirmed?: boolean;
  /** 已上传到 A 时的服务端页码；时间轴 segments.page_no 用的就是它 */
  server_page_no?: number | null;
}

/**
 * 基于"当前这本书"构建证据索引：
 * - 页码 = 服务端页码（若有）否则为它在全书中的原始位置(1 起)。
 *   旧实现由调用方先 filter(confirmed) 再按过滤后的下标编号：只要中间有一页未校对，
 *   后面所有页的证据页码都会错位，并且会对上错误页的视频时间轴（P0，见 E-021）。
 *   现在必须传入全书页面，由本函数跳过未校对/空文字的页，页码保持不变。
 * - 若后端 A 已登记时间轴(segments)，用其 start_ms/end_ms/caption 对齐视频；
 * - 没有时间轴时，时间窗口置为 null 语义(start=end=-1)，检索时不使用时序加权，
 *   且证据不会伪装成"视频 x 秒"。
 */
export function buildSlicesFromBook(
  pages: BookPageLike[],
  segments: SegmentOut[] = []
): PictureBookSliceData[] {
  const slices: PictureBookSliceData[] = [];
  pages.forEach((page, index) => {
    if (page.confirmed === false) return;
    const text = (page.ocr_text || '').trim();
    if (!text) return;
    const pageNo = page.server_page_no && page.server_page_no > 0 ? page.server_page_no : index + 1;
    const segs = segments.filter((s) => s.page_no === pageNo);
    const caption = segs.map((s) => s.caption).filter(Boolean).join(' ');
    const start = segs.length ? Math.min(...segs.map((s) => s.start_ms)) : -1;
    const end = segs.length ? Math.max(...segs.map((s) => s.end_ms)) : -1;
    slices.push({
      page_no: pageNo,
      video_start_ms: start,
      video_end_ms: end,
      ocr_content: text,
      entities: [],
      script: caption,
      frame_objects: [],
      lighting: '',
      snippet: `第 ${pageNo} 页：${text.length > 36 ? text.slice(0, 36) + '…' : text}`,
    });
  });
  return slices;
}

export function sliceHasTimeline(slice: PictureBookSliceData): boolean {
  return slice.video_start_ms >= 0 && slice.video_end_ms > slice.video_start_ms;
}
