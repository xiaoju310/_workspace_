import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { OcrReviewNotice } from '../OcrReviewNotice'
import { ReviewPage } from '../../pages/ReviewPages'
import type { WorkflowProps } from '../../app/types'

function notice(score = .99, text = '原文', demo = false, edited = false) {
  return renderToStaticMarkup(createElement(OcrReviewNotice, { score, text, demo, edited }))
}
describe('每页 OCR 校对提示', () => {
  it('高分也必须显示核对提示，不用绿色表示识别正确', () => {
    const html = notice()
    expect(html).toContain('识别参考分 99 / 100')
    expect(html).toContain('不是文字准确率')
    expect(html).toContain('请每页对照原图')
    expect(html).not.toContain('badge-green')
    expect(html).not.toContain('99%')
  })
  it('低分额外提醒；演示和手工修改均明确说明', () => {
    expect(notice(.5)).toContain('参考分较低')
    expect(notice(.9, '原文', true, true)).toContain('当前分数与文字为演示数据')
    expect(notice(.9, '原文', false, true)).toContain('不评价手工修改后的内容')
  })
  it('可疑行仅提示；无可疑行不显示警告列表', () => {
    expect(notice(.99, '正文\n●\nII')).toContain('发现 2 处可疑独立行')
    expect(notice(.99, '正文\n●\nII')).toContain('系统未自动删除任何文字')
    expect(notice()).not.toContain('可疑独立行')
  })
  it('没有书页时正常显示导入入口', () => {
    const props = { book: { id: 'empty', title: '空书', origin: 'real', pages: [] }, state: 'success', navigate: vi.fn() } as unknown as WorkflowProps
    expect(renderToStaticMarkup(createElement(ReviewPage, props))).toContain('还没有可处理的书页')
  })
  it('实际校对页保留原文且未确认时不能继续', () => {
    const props = {
      book: { id: 'test', title: '测试书', origin: 'real', pages: [{ id: 'p1', name: 'page.png', image_url: '/page.png', ocr_text: '正文\n●\nII', confidence: .99, revision: 1, confirmed: false, demo: false }] },
      state: 'success', setState: vi.fn(), updateBook: vi.fn(), notify: vi.fn(), navigate: vi.fn(),
    } as unknown as WorkflowProps
    const html = renderToStaticMarkup(createElement(ReviewPage, props))
    expect(html).toContain('不是文字准确率')
    expect(html).toContain('正文\n●\nII</textarea>')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>下一步：分类确认/)
  })
})
