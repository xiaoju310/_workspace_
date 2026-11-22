import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { ReadingBook } from '../../app/types'
import { initialBooks } from '../../mock/workspace'
const hooks = vi.hoisted(() => ({ cursor:0, slots:[] as any[] }))
vi.mock('react', async original => {
  const real = await original<typeof import('react')>()
  return { ...real, useState:(initial:any) => {
    const i = hooks.cursor++
    if (!(i in hooks.slots)) hooks.slots[i] = typeof initial === 'function' ? initial() : initial
    return [hooks.slots[i], (next:any) => { hooks.slots[i] = typeof next === 'function' ? next(hooks.slots[i]) : next }]
  } }
})
import VocabularyCards from '../VocabularyCards'
let book:ReadingBook, tree:any
const onSource = vi.fn()
function render() {
  hooks.cursor = 0
  tree = VocabularyCards({ book, pageNo:8, onSource, onChange:update => { book = {...book, vocabulary:update(book.vocabulary ?? [])} } })
}
function all(test:(n:any)=>boolean, node:any=tree):any[] {
  if (!node || typeof node !== 'object') return []
  return [...(test(node) ? [node] : []), ...[node.props?.children].flat(Infinity).filter(c=>c && typeof c==='object').flatMap(c=>all(test,c))]
}
function text(node:any):string { return typeof node === 'string' || typeof node === 'number' ? String(node) : !node || typeof node !== 'object' ? '' : [node.props?.children].flat(Infinity).map(text).join('') }
function click(label:string) {
  const button = all(n=>n.type==='button' && text(n)===label)[0]
  if (!button) throw new Error('Missing button '+label)
  button.props.onClick(); render()
}
function edit(word:string, meaning='', example='') {
  all(n=>n.type==='input')[0].props.onChange({target:{value:word}}); render()
  all(n=>n.type==='textarea')[0].props.onChange({target:{value:meaning}}); render()
  all(n=>n.type==='textarea')[1].props.onChange({target:{value:example}}); render()
}
function submit() { all(n=>n.type==='form')[0].props.onSubmit({preventDefault:vi.fn()}); render() }
function add(word='小兔子', meaning='一种小动物', example='小兔子跑来了。') { click('添加生词'); edit(word,meaning,example); submit() }
beforeEach(()=>{
  hooks.cursor=0;hooks.slots=[];onSource.mockClear()
  book={...initialBooks()[0],vocabulary:[],pages:initialBooks()[0].pages.map((p,i)=>({...p,server_page_no:[3,8,12][i],edit_text:'森林里的小兔子来了。'}))}
  render()
})
afterEach(()=>vi.restoreAllMocks())
describe('生词卡片真实组件事件',()=>{
  it('添加词、释义、例句和真实页码，不把页码当数组下标',()=>{
    expect(text(tree)).toContain('还没有生词卡片')
    add()
    expect(book.vocabulary?.[0]).toMatchObject({word:'小兔子',meaning:'一种小动物',example:'小兔子跑来了。',mastered:false,source:{page_no:8,quote:'森林里的小兔子来了。'}})
    expect(all(n=>n.type==='form')).toHaveLength(0)
  })
  it('翻卡前隐藏释义，翻开后可收起',()=>{
    add();expect(text(tree)).not.toContain('一种小动物')
    click('翻卡看释义');expect(text(tree)).toContain('一种小动物')
    click('收起释义');expect(text(tree)).not.toContain('一种小动物')
  })
  it('掌握状态、待复习/已掌握筛选可以来回切换',()=>{
    add();click('标记已掌握');expect(book.vocabulary?.[0].mastered).toBe(true)
    click('待复习');expect(all(n=>n.type==='article')).toHaveLength(0)
    click('已掌握');expect(all(n=>n.type==='article')).toHaveLength(1)
    click('还需复习');expect(book.vocabulary?.[0].mastered).toBe(false)
    expect(all(n=>n.type==='article')).toHaveLength(0)
    click('全部');expect(all(n=>n.type==='article')).toHaveLength(1)
  })
  it('修改卡片保留身份、创建时间和掌握状态',()=>{
    add();click('标记已掌握');const old=book.vocabulary![0]
    click('修改');edit('兔子','核对后的释义','新的例句');submit()
    expect(book.vocabulary?.[0]).toMatchObject({id:old.id,created_at:old.created_at,mastered:true,word:'兔子',meaning:'核对后的释义'})
  })
  it('重复词提示且不覆盖原卡片，空白和超长词拒绝保存',()=>{
    add('Forest');click('添加生词');edit(' ｆｏｒｅｓｔ ');submit()
    expect(text(tree)).toContain('已收录');expect(book.vocabulary).toHaveLength(1)
    edit('  ');submit();expect(text(tree)).toContain('请先填写生词')
    edit('a'.repeat(81));submit();expect(text(tree)).toContain('80个字')
  })
  it('删除需确认，可以取消且只删除目标卡',()=>{
    add();add('森林');click('删除');expect(book.vocabulary).toHaveLength(2)
    click('保留卡片');expect(book.vocabulary).toHaveLength(2)
    click('删除');click('确认删除');expect(book.vocabulary?.map(c=>c.word)).toEqual(['森林'])
  })
  it('点击原文传递真实来源到已有依据跳转',()=>{
    add();click('回到原文 · 第 8 页');expect(onSource).toHaveBeenCalledWith(book.vocabulary![0].source)
  })
  it('未填写释义有明确提示，可不关联书页',()=>{
    click('添加生词');edit('词')
    all(n=>n.type==='select')[0].props.onChange({target:{value:''}});render();submit()
    expect(book.vocabulary![0].source).toBeNull()
    expect(all(n=>n.type==='button' && text(n).startsWith('回到原文'))).toHaveLength(0)
    click('翻卡看释义');expect(text(tree)).toContain('还未填写释义')
  })
  it('取消编辑不保存；来源消失时不误关联其他页面',()=>{
    click('添加生词');edit('取消的词');click('取消编辑');expect(book.vocabulary).toHaveLength(0)
    click('添加生词');edit('词');book={...book,pages:[]};render();submit()
    expect(text(tree)).toContain('来源书页已不存在');expect(book.vocabulary).toHaveLength(0)
  })
  it('现有卡片重新打开仍存在，翻卡状态不持久化',()=>{
    add();click('翻卡看释义');hooks.slots=[];render()
    expect(text(tree)).toContain('小兔子');expect(text(tree)).not.toContain('一种小动物')
  })
})
