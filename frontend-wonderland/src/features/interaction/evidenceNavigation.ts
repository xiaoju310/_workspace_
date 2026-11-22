import type { Source } from '../../app/types'
import type { SegmentOut } from '../../types/interaction'
import { pageNoOf, pageStartMs } from './pageTimeline'
import type { PageRef } from './pageTimeline'

export type EvidenceTarget =
  | { ok: false; message: string }
  | { ok: true; pageIndex: number; pageNo: number; videoMs: number | null; message: string }

/** Resolve only this book's real page numbers. Never present an estimated time as evidence. */
export function resolveEvidenceTarget(
  source: Source, pages: PageRef[], segments?: SegmentOut[], durationMs?: number
): EvidenceTarget {
  const pageIndex = pages.findIndex((page, index) => pageNoOf(page, index) === source.page_no)
  if (!Number.isInteger(source.page_no) || source.page_no < 1 || pageIndex < 0) {
    return { ok: false, message: '这条依据对应的书页不在当前图书中，无法跳转。' }
  }
  let videoMs: number | null = null
  // Original-page evidence refers to the page, not an arbitrary answer timestamp.
  if (source.source !== 'original_page' && Number.isFinite(source.start_ms) && source.start_ms! >= 0) {
    videoMs = source.start_ms
  } else {
    const start = pageStartMs(pageIndex, pages, segments, durationMs ?? 0)
    if (start.exact) videoMs = start.ms
  }
  const outOfRange = videoMs !== null && durationMs !== undefined && videoMs > durationMs
  if (outOfRange) videoMs = null
  return {
    ok: true, pageIndex, pageNo: source.page_no, videoMs,
    message: outOfRange
      ? '依据时间超出当前视频时长，已保留原书页供核对，不进行错误定位。'
      : videoMs === null ? '没有可靠的视频时间点，先查看对应原书页；不会按时长估算答案依据。' : '',
  }
}

/** Plain-text highlighting only: never render an answer or book excerpt as HTML. */
export function splitEvidenceText(text: string, quote: string) {
  const needle = quote.trim()
  const index = needle ? text.indexOf(needle) : -1
  return index < 0 ? { before: text, match: '', after: '' }
    : { before: text.slice(0, index), match: needle, after: text.slice(index + needle.length) }
}
