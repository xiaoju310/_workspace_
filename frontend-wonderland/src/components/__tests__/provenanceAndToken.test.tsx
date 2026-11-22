import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { initialBooks } from '../../mock/workspace'
import { BookCard } from '../BookCard'
import BackendWorkbench from '../BackendWorkbench'
import WorkspaceShell from '../WorkspaceShell'

describe('数据来源与共用令牌标识', () => {
  it('示例图书明确标为模拟内容', () => {
    const html = renderToStaticMarkup(createElement(BookCard, { book: initialBooks()[0], onOpen: () => {} }))
    expect(html).toContain('模拟内容')
    expect(html).toContain('原创模拟内容')
  })

  it('Live 顶栏不把示例图书说成真实生成', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceShell, {
      page: 'home', state: 'success', setState: () => {}, navigate: () => {}, appMode: 'live', bookOrigin: 'mock', children: null,
    }))
    expect(html).toContain('当前图书：模拟内容')
    expect(html).toContain('书架示例仍为模拟')
  })

  it('联调区只显示共用令牌状态，不显示令牌或第二个密码框', () => {
    const secret = 'do-not-render-this-token'
    const html = renderToStaticMarkup(createElement(BackendWorkbench, { token: secret }))
    expect(html).toContain('共用后端访问令牌：已在顶部保存')
    expect(html).not.toContain(secret)
    expect(html).not.toContain('type="password"')
  })
})
