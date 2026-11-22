import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import WorkspaceShell from '../WorkspaceShell'

function markup(focusMode: boolean, appMode: 'demo' | 'live' = 'demo') {
  return renderToStaticMarkup(createElement(WorkspaceShell, {
    focusMode, appMode, page: 'reader', state: 'success', setState: vi.fn(), navigate: vi.fn(),
    children: createElement('section', { 'aria-label': '书页区域' }, '当前书页'),
  }))
}
describe('专注阅读外壳', () => {
  it.each(['demo', 'live'] as const)('%s 隐藏导航、顶栏、模式横幅、页脚和伴读装饰，保留主要书页', mode => {
    const html = markup(true, mode)
    for (const name of ['class="sidebar"', 'class="topbar"', 'class="footer"', 'demo-mode-banner', 'reading-buddy']) expect(html).not.toContain(name)
    expect(html).toContain('workspace-focus')
    expect(html).toContain('id="main"')
    expect(html).toContain('当前书页')
    expect(html).toContain('跳到主要内容')
  })
  it('退出后正常外壳完整恢复', () => {
    const html = markup(false)
    for (const name of ['class="sidebar"', 'class="topbar"', 'class="footer"', 'demo-mode-banner', '当前书页']) expect(html).toContain(name)
    expect(html).not.toContain('workspace-focus')
  })
})
