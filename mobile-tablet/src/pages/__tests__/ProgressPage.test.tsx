import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ProgressPage from '../ProgressPage'
import type { WorkflowProps, JobState } from '../../app/types'

const baseJob: JobState = {
  status: 'running', stage: 3, progress: 60, error: null, run_id: 'run-real', server: true, events: [],
}

function renderLive(status: JobState['status']) {
  const props = {
    book: { id: 'book-real', title: '测试书', origin: 'real', page_count: 2, authorization_ref: '原创',
      job_id: 'job-real', run_id: 'run-real', pages: [], safety_reviewed: false },
    job: { ...baseJob, status, error: status === 'failed' ? '服务端失败' : null },
    state: 'success', setState: vi.fn(), setJob: vi.fn(), updateBook: vi.fn(),
    onGenerate: vi.fn(), onOpenPagesOnly: vi.fn(), navigate: vi.fn(), notify: vi.fn(),
  } as unknown as WorkflowProps
  return renderToStaticMarkup(createElement(ProgressPage, props))
}

describe('真实任务进度展示', () => {
  it.each(['idle', 'running', 'failed', 'review', 'ready'] as const)('%s 不冒充六阶段或百分比', status => {
    const html = renderLive(status)
    expect(html).toContain('真实任务状态')
    expect(html).toContain('服务端未提供百分比')
    expect(html).not.toContain('本次阅读的六个步骤')
    expect(html).not.toContain('模拟任务进度')
    expect(html).not.toContain('60<small>%')
  })
  it('失败时提供重试和仅书页问答入口', () => {
    const html = renderLive('failed')
    expect(html).toContain('服务端失败')
    expect(html).toContain('重试本次生成')
    expect(html).toContain('先用校对文字做书页问答')
  })
  it('待复核时说明本地确认不能代替平台审核', () => {
    expect(renderLive('review')).toContain('不替代平台安全审核')
  })
  it('完成后仍要求逐页核验媒体和笔记', () => {
    expect(renderLive('ready')).toContain('媒体和笔记请在对应页面核验')
  })
})


