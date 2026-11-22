import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { DeleteBookDialog } from '../DeleteBookDialog'
import { initialBooks } from '../../mock/workspace'

const callbacks = { onCancel: vi.fn(), onConfirm: vi.fn() }
describe('删除确认弹窗', () => {
  it('没有选择图书时不显示操作，选择后显示书名和明确的不可恢复提醒', () => {
    const empty = renderToStaticMarkup(<DeleteBookDialog {...callbacks} book={null} busy={false} error="" />)
    expect(empty).not.toContain('确认删除')
    const book = initialBooks()[0]
    const html = renderToStaticMarkup(<DeleteBookDialog {...callbacks} book={book} busy={false} error="" />)
    expect(html).toContain('<dialog')
    expect(html).toContain('aria-labelledby=')
    expect(html).toContain('aria-describedby=')
    expect(html).toContain(book.title)
    expect(html).toContain('删除后无法恢复')
    expect(html).toContain('先留着')
    expect(html).toContain('其他图书和独立导入草稿不受影响')
    expect(html).toContain('本机书架中')
    expect(html).not.toContain('服务器及')
  })
  it('同步图书提示服务器范围，请求期间关闭和两个操作全部禁用', () => {
    const book = { ...initialBooks()[0], server_book_id: 'test-server-book' }
    const html = renderToStaticMarkup(<DeleteBookDialog {...callbacks} book={book} busy error="" />)
    expect(html).toContain('服务器及本机书架中')
    expect(html).toContain('正在删除…')
    expect(html).toContain('aria-busy="true"')
    expect(html.match(/disabled=""/g)).toHaveLength(3)
  })
  it('失败原因位于弹窗内，保持确认按钮可供重试', () => {
    const html = renderToStaticMarkup(<DeleteBookDialog {...callbacks} book={initialBooks()[0]} busy={false} error="删除失败：网络暂时不可用" />)
    expect(html).toContain('role="alert"')
    expect(html).toContain('删除失败：网络暂时不可用')
    expect(html).toContain('确认删除')
    expect(html).not.toContain('disabled=""')
  })
})
