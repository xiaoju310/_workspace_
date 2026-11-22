import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import type { ReadingBook } from '../../app/types'
import { initialBooks } from '../../mock/workspace'
const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as any[] }))
vi.mock('react', async importOriginal => {
  const real = await importOriginal<typeof import('react')>()
  return { ...real, useState: (initial: any) => {
    const index = hooks.cursor++
    if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === 'function' ? initial() : initial
    return [hooks.slots[index], (next: any) => { hooks.slots[index] = typeof next === 'function' ? next(hooks.slots[index]) : next }]
  } }
})
import ReadingBookmarks from '../ReadingBookmarks'
let book: ReadingBook
let currentPageId: string | null
let tree: ReactElement
const onOpen = vi.fn()
function render() { hooks.cursor = 0; tree = ReadingBookmarks({ book, currentPageId, onOpen, onChange: update => { book = { ...book, bookmarks: update(book.bookmarks ?? []) } } }) }
function all(test: (n: any) => boolean, node: any = tree): any[] {
  if (!node || typeof node !== 'object') return []
  return [...(test(node) ? [node] : []), ...[node.props?.children].flat(Infinity).filter(c => c && typeof c === 'object').flatMap(c => all(test, c))]
}
function text(node: any): string { return typeof node === 'string' || typeof node === 'number' ? String(node) : !node || typeof node !== 'object' ? '' : [node.props?.children].flat(Infinity).map(text).join('') }
function click(label: string) { const button = all(n => n.type === 'button' && text(n) === label)[0]; if (!button) throw new Error(label); button.props.onClick(); render() }
function note(value: string) { all(n => n.type === 'textarea')[0].props.onChange({ target: { value } }); render() }
function select(value: string) { all(n => n.type === 'select')[0].props.onChange({ target: { value } }); render() }
function save() { all(n => n.type === 'form')[0].props.onSubmit({ preventDefault: vi.fn() }); render() }
function add(value = '想再读这一页') { click('添加书签'); note(value); save() }
beforeEach(() => {
  hooks.slots = []; hooks.cursor = 0; onOpen.mockReset()
  book = { ...initialBooks()[0], bookmarks: [], pages: initialBooks()[0].pages.map((page, i) => ({ ...page, server_page_no: [3, 8, 12][i] })) }
  currentPageId = book.pages[1].id; render()
})
describe('书签真实组件事件', () => {
  it('旧书没有bookmarks字段也能添加，使用稳定书页ID和真实页码', () => {
    delete book.bookmarks; render(); expect(text(tree)).toContain('还没有书签')
    add('  喜欢的句子  ')
    expect(book.bookmarks).toHaveLength(1)
    expect(book.bookmarks![0]).toMatchObject({ page_id: book.pages[1].id, note: '喜欢的句子' })
    expect(text(tree)).toContain('回到书页 · 第 8 页')
    click('回到书页 · 第 8 页'); expect(onOpen).toHaveBeenCalledWith(book.bookmarks![0])
  })
  it('允许空备注，已有本页书签改为编辑而不重复添加', () => {
    add('  '); const old = book.bookmarks![0]
    expect(old.note).toBe(''); expect(text(tree)).toContain('未填写备注')
    click('修改本页书签'); note('第二次备注'); save()
    expect(book.bookmarks).toHaveLength(1)
    expect(book.bookmarks![0]).toMatchObject({ id: old.id, created_at: old.created_at, note: '第二次备注' })
  })
  it('手选已有书签页不覆盖原备注', () => {
    add(); currentPageId = book.pages[0].id; render(); click('添加书签'); select(book.pages[1].id); note('不应覆盖'); save()
    expect(text(tree)).toContain('这一页已有书签'); expect(book.bookmarks![0].note).toBe('想再读这一页')
    expect(book.bookmarks).toHaveLength(1)
  })
  it('没有可靠当前页时不猜页，必须手选后才能保存', () => {
    currentPageId = null; render(); click('添加书签'); save()
    expect(text(tree)).toContain('请选择有效书页'); expect(book.bookmarks).toHaveLength(0)
    select(book.pages[2].id); save(); expect(book.bookmarks![0].page_id).toBe(book.pages[2].id)
  })
  it('书页重排后仍指向原页，移除后禁用跳转且不会指向另一页', () => {
    book.pages = book.pages.map(page => ({ ...page, server_page_no: undefined })); render(); add()
    const mark = book.bookmarks![0]; book.pages = [book.pages[1], book.pages[0], book.pages[2]]; render()
    click('回到书页 · 第 1 页'); expect(onOpen).toHaveBeenCalledWith(mark)
    book.pages = book.pages.filter(page => page.id !== mark.page_id); render()
    expect(all(n => n.type === 'button' && text(n) === '回到书页 · 原书页已移除')[0].props.disabled).toBe(true)
  })
  it('编辑时书页被移除不错误保存', () => {
    click('添加书签'); book.pages = []; render(); save()
    expect(text(tree)).toContain('原书页可能已被移除'); expect(book.bookmarks).toHaveLength(0)
  })
  it('限制备注500字，取消编辑不写入', () => {
    click('添加书签'); note('字'.repeat(501)); save(); expect(text(tree)).toContain('最多500个字'); expect(book.bookmarks).toHaveLength(0)
    note('取消'); click('取消编辑'); expect(book.bookmarks).toHaveLength(0)
    add('字'.repeat(500)); expect(book.bookmarks![0].note).toHaveLength(500)
  })
  it('删除需要确认，可取消且仅删除目标书签，不改变阅读位置', () => {
    const position = book.reading_position
    add(); currentPageId = book.pages[2].id; render(); add('第二页书签')
    click('删除书签'); expect(book.bookmarks).toHaveLength(2); click('保留书签'); expect(book.bookmarks).toHaveLength(2)
    click('删除书签'); click('确认删除'); expect(book.bookmarks?.map(item => item.note)).toEqual(['第二页书签'])
    expect(book.reading_position).toBe(position)
  })
  it('重新打开组件仍展示已有书签，不串入另一图书', () => {
    add(); hooks.slots = []; render(); expect(text(tree)).toContain('想再读这一页')
    book = { ...initialBooks()[1], bookmarks: [] }; hooks.slots = []; render()
    expect(text(tree)).toContain('还没有书签'); expect(text(tree)).not.toContain('想再读这一页')
  })
  it('备注只以纯文本显示，不解释HTML', () => {
    add('<img src=x onerror=alert(1)>'); expect(text(tree)).toContain('<img src=x onerror=alert(1)>')
    expect(all(n => n.props?.dangerouslySetInnerHTML)).toHaveLength(0)
  })
})
