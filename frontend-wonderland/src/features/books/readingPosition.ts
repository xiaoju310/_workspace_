import type { ReadingBook, ReadingPosition } from '../../app/types'
import type { SegmentOut } from '../../types/interaction'
import { pageStartMs } from '../interaction/pageTimeline'

export function normalizeReadingPosition(value: unknown, pageCount: number): ReadingPosition | null {
  if (!value || typeof value !== 'object' || pageCount < 1) return null
  const p = value as ReadingPosition
  if (!Number.isFinite(p.time_ms) || !Number.isFinite(p.page_index) || typeof p.video !== 'boolean') return null
  return {
    time_ms: Math.max(0, Math.floor(p.time_ms)),
    page_index: Math.min(pageCount - 1, Math.max(0, Math.floor(p.page_index))),
    video: p.video,
    ...(typeof p.updated_at === 'string' && Number.isFinite(Date.parse(p.updated_at)) ? { updated_at: p.updated_at } : {}),
    ...(typeof p.run_id === 'string' || p.run_id === null ? { run_id: p.run_id } : {}),
    ...(typeof p.video_key === 'string' ? { video_key: p.video_key } : {}),
  }
}

/** Video time is reusable only for the same run/asset. Otherwise resume the saved page. */
export function resumeTimeMs(book: ReadingBook, durationMs: number, video: boolean, videoKey?: string, segments?: SegmentOut[]): number {
  const p = normalizeReadingPosition(book.reading_position, book.pages.length)
  if (!p) return 0
  const duration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 36000
  const sameRun = p.run_id === undefined || p.run_id === book.run_id
  const sameAsset = p.video_key === undefined || p.video_key === videoKey
  const time = video && p.video && sameRun && sameAsset
    ? p.time_ms
    : pageStartMs(p.page_index, book.pages, video ? segments : undefined, duration).ms
  return Math.max(0, Math.min(duration, time))
}

export function mostRecentlyRead(books: ReadingBook[]): ReadingBook | undefined {
  return books.filter(b => b.status === 'READY' && normalizeReadingPosition(b.reading_position, b.pages.length))
    .sort((a, b) => readingTimestamp(b.reading_position) - readingTimestamp(a.reading_position))[0]
}

function readingTimestamp(p: ReadingPosition | undefined): number {
  const value = p?.updated_at ? Date.parse(p.updated_at) : 0
  return Number.isFinite(value) ? value : 0
}

// A tiny synchronous checkpoint complements IndexedDB: pagehide cannot await a full workspace save.
// It contains only positions, scoped exactly like the existing account/demo drafts.
const checkpointKey = (scope: string) => `${scope}:reading-positions-v1`
function checkpoints(scope: string): Record<string, ReadingPosition> {
  const raw = localStorage.getItem(checkpointKey(scope))
  const value = raw ? JSON.parse(raw) : {}
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}
export function checkpointReadingPosition(scope: string, bookId: string, position: ReadingPosition): boolean {
  try {
    localStorage.setItem(checkpointKey(scope), JSON.stringify({ ...checkpoints(scope), [bookId]: position }))
    return true
  } catch { return false }
}
export function restoreReadingPositions(scope: string, books: ReadingBook[]): ReadingBook[] {
  try {
    const saved = checkpoints(scope)
    return books.map(book => {
      const p = normalizeReadingPosition(saved[book.id], book.pages.length)
      return p && readingTimestamp(p) > readingTimestamp(book.reading_position) ? { ...book, reading_position: p } : book
    })
  } catch { return books }
}

export function removeReadingCheckpoint(scope: string, bookId?: string): void {
  try {
    if(bookId===undefined){localStorage.removeItem(checkpointKey(scope));return}
    const saved=checkpoints(scope)
    delete saved[bookId]
    localStorage.setItem(checkpointKey(scope),JSON.stringify(saved))
  } catch { /* The durable workspace remains authoritative if browser storage is unavailable. */ }
}
