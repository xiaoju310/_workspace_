import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import WorkspacePageContent from '../WorkspacePageContent'

function html(page:'reader'|'progress'|'home') {
  return renderToStaticMarkup(<WorkspacePageContent page={page} tools={<section>分镜与生成工具</section>}><section>当前页面主体</section></WorkspacePageContent>)
}
describe('阅读和生成页面分离',()=>{
  it('阅读主体优先，生成工具在其后默认折叠，且只保留一份',()=>{
    const result=html('reader')
    expect(result.indexOf('当前页面主体')).toBeLessThan(result.indexOf('分镜与生成工具'))
    expect(result).toContain('展开查看，不会重新生成')
    expect(result).not.toContain('open=""')
    expect(result.match(/分镜与生成工具/g)).toHaveLength(1)
  })
  it('生成工作台继续优先显示生成工具',()=>{
    const result=html('progress')
    expect(result.indexOf('分镜与生成工具')).toBeLessThan(result.indexOf('当前页面主体'))
    expect(result).not.toContain('<details')
  })
  it('其他页面不显示生成面板',()=>{
    expect(html('home')).not.toContain('分镜与生成工具')
  })
})
