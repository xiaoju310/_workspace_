import type { SegmentOut } from '../../../types/interaction';
import type { PictureBookSliceData } from './TimeSliceIndexer';

/** 当前图书页面的最小视图（来自主人校对后的 OCR 文本，而不是任何写死的故事） */
export interface BookPageLike {
  ocr_text: string;
  confirmed?: boolean;
}

/**
 * 基于"当前这本书"构建证据索引：
 * - 页面文字取自主人逐页校对后的 OCR；未校对或为空的页不进入索引；
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
    const text = (page.ocr_text || '').trim();
    if (!text) return;
    const pageNo = index + 1;
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
