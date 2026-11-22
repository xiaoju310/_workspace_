import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ReadingBuddy from '../ReadingBuddy'
import { OwlMascot } from '../OwlMascot'

describe('猫头鹰伴读', () => {
  it('使用本地透明素材，装饰图片不重复播报按钮文案', () => {
    const html = renderToStaticMarkup(createElement(OwlMascot, { size: 40 }))
    expect(html).toContain('/art/reading-owl.png')
    expect(html).toContain('width="40"')
    expect(html).toContain('alt=""')
    expect(html).toContain('aria-hidden="true"')
  })
  it('保留页面提示，按钮和提示均使用猫头鹰称呼', () => {
    const html = renderToStaticMarkup(createElement(ReadingBuddy, { page: 'home' }))
    expect(html).toContain('今天想读哪一本呀？我陪你挑！')
    expect(html).toContain('收起猫头鹰的提示')
    expect(html).toContain('收起伴读猫头鹰的提示')
    expect(html).not.toContain('狐狸')
  })
  it('阅读页引导到实际提问框，不假装点击装饰会启动问答', () => {
    const html = renderToStaticMarkup(createElement(ReadingBuddy, { page: 'reader' }))
    expect(html).toContain('提问框')
    expect(html).not.toContain('点我试试')
  })
})
