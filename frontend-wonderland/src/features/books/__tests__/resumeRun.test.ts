import { describe, expect, it, vi } from 'vitest'
import { initialBooks } from '../../../mock/workspace'
import { bookResumePage, resumeSavedRun } from '../resumeRun'

const book = () => ({ ...initialBooks()[0], server_book_id: 'server-book', run_id: 'new-run', status: 'GENERATING' as const, safety_reviewed: false })
describe('继续历史任务', () => {
  it('重新打开已有运行进入工作台，尚未分析的书继续校对，已就绪的书继续阅读', () => {
    expect(bookResumePage(book())).toBe('progress')
    expect(bookResumePage({ ...book(), run_id: null })).toBe('review')
    expect(bookResumePage({ ...book(), status: 'READY' })).toBe('reader')
  })
  it('只读原运行并保留书页、校对和阅读草稿，切换后须重新复核', async () => {
    const current = { ...book(), safety_reviewed: true, video_url: 'blob:new-run' }
    const api = { getRun: vi.fn().mockResolvedValue({ id: 'old-run', book_id: 'server-book', model_manifest: { analysis_mode: 'text_only' } }), analyzeBook: vi.fn(), understandPages: vi.fn(), generateBookVideo: vi.fn() }
    const next = await resumeSavedRun(api, current, 'old-run')
    expect(next).toEqual({ ...current, run_id: 'old-run', preferred_run_id: 'old-run', job_id: null, status: 'GENERATING', safety_reviewed: false, pages_only: false, video_url: null, analysisMode: 'text_only' })
    expect(next.pages).toBe(current.pages)
    expect(current.run_id).toBe('new-run')
    expect(api.getRun).toHaveBeenCalledExactlyOnceWith('old-run')
    expect(api.analyzeBook).not.toHaveBeenCalled()
    expect(api.understandPages).not.toHaveBeenCalled()
    expect(api.generateBookVideo).not.toHaveBeenCalled()
  })
  it('拒绝错误图书或错误运行，读取失败不更改当前草稿', async () => {
    const current = book()
    const api = { getRun: vi.fn().mockResolvedValue({ id: 'old-run', book_id: 'other-book', model_manifest: {} }) }
    await expect(resumeSavedRun(api, current, 'old-run')).rejects.toThrow('不属于当前图书')
    api.getRun.mockResolvedValue({ id: 'unexpected', book_id: 'server-book', model_manifest: {} })
    await expect(resumeSavedRun(api, current, 'old-run')).rejects.toThrow('不属于当前图书')
    api.getRun.mockRejectedValue(new Error('连接失败'))
    await expect(resumeSavedRun(api, current, 'old-run')).rejects.toThrow('连接失败')
    expect(current.run_id).toBe('new-run')
  })
})
