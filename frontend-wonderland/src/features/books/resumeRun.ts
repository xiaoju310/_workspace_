import type { ReadingBook } from '../../app/types'
import type { RunResponse } from '../../api/client'

/** 仅读取和选择已有运行，不创建分析、图文理解或视频任务。 */
export async function resumeSavedRun(api: { getRun: (id: string) => Promise<RunResponse> }, book: ReadingBook, runId: string): Promise<ReadingBook> {
  const run = await api.getRun(runId)
  if (!book.server_book_id || run.book_id !== book.server_book_id || run.id !== runId)
    throw new Error('这条运行记录不属于当前图书，未切换任务')
  if (book.run_id === runId) return { ...book, preferred_run_id: runId }
  return {
    ...book, run_id: runId, preferred_run_id: runId, job_id: null,
    status: 'GENERATING', safety_reviewed: false, pages_only: false, video_url: null,
    analysisMode: run.model_manifest.analysis_mode === 'text_only' ? 'text_only' : 'multimodal',
  }
}

export function bookResumePage(book: ReadingBook) {
  return book.status === 'READY' ? 'reader' : book.server_book_id && book.run_id ? 'progress' : 'review'
}
