import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { IDBFactory } from 'fake-indexeddb'
import { initialBooks } from '../../../mock/workspace'
import type { ReadingBook } from '../../../app/types'
import type { SegmentOut } from '../../../types/interaction'
import { normalizeReadingPosition, resumeTimeMs, mostRecentlyRead, checkpointReadingPosition, restoreReadingPositions, removeReadingCheckpoint } from '../readingPosition'
import { DraftStore } from '../draftStore'
import HomePage from '../../../pages/HomePage'
import { BookCard } from '../../../components/BookCard'

const position={time_ms:52500,page_index:1,video:true,updated_at:'2026-11-19T10:00:00Z',run_id:'run-a',video_key:'asset:hash'}
const book=():ReadingBook=>({...initialBooks()[0],run_id:'run-a',reading_position:{...position}})
const segments=[{page_no:1,start_ms:0,end_ms:10000},{page_no:2,start_ms:10000,end_ms:60000},{page_no:3,start_ms:60000,end_ms:90000}] as SegmentOut[]
beforeEach(()=>{
  const data=new Map<string,string>()
  vi.stubGlobal('localStorage',{getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>data.set(key,value),removeItem:(key:string)=>data.delete(key)})
})
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks()})

describe('阅读位置兼容、边界与视频恢复',()=>{
  it('首次阅读从第一页开始',()=>{expect(resumeTimeMs({...book(),reading_position:undefined},36000,false)).toBe(0)})
  it.each([null,{}, {time_ms:NaN,page_index:1,video:true},{time_ms:2,page_index:Infinity,video:true},{time_ms:2,page_index:1,video:'yes'}])('损坏记录不影响打开图书：%j',p=>{expect(normalizeReadingPosition(p,3)).toBeNull()})
  it('负数、非整页、页数缩减会安全夹取',()=>{
    expect(normalizeReadingPosition({...position,time_ms:-3,page_index:99.8},2)).toMatchObject({time_ms:0,page_index:1})
    expect(normalizeReadingPosition({...position,page_index:-2},3)?.page_index).toBe(0)
    expect(normalizeReadingPosition(position,0)).toBeNull()
  })
  it('静态阅读按保存页码恢复，不把视频时间套进36秒占位进度',()=>{expect(resumeTimeMs(book(),36000,false)).toBe(12000)})
  it('同一视频恢复超过36秒的真实时间且不提前截断',()=>{expect(resumeTimeMs(book(),90000,true,'asset:hash',segments)).toBe(52500)})
  it('兼容旧版没有运行和产物标识的记录',()=>{expect(resumeTimeMs({...book(),reading_position:{time_ms:42000,page_index:1,video:true}},90000,true)).toBe(42000)})
  it('视频变短时夹取到真实结尾',()=>{expect(resumeTimeMs(book(),20000,true,'asset:hash')).toBe(20000)})
  it('新产物不误用旧时间，改按非均分的真实页时间轴恢复',()=>{expect(resumeTimeMs(book(),90000,true,'new:hash',segments)).toBe(10000)})
  it('新运行不误用旧视频时间',()=>{expect(resumeTimeMs({...book(),run_id:'run-b'},90000,true,'asset:hash',segments)).toBe(10000)})
  it('原本静态阅读的书生成视频后从对应页进入',()=>{expect(resumeTimeMs({...book(),reading_position:{...position,video:false}},90000,true,'asset:hash',segments)).toBe(10000)})
  it('没有时间轴如实按总时长估算',()=>{expect(resumeTimeMs(book(),90000,true,'other')).toBe(30000)})
})

describe('最近阅读与即时备份',()=>{
  it('按阅读时间挑最新可读书，不改变原书架顺序',()=>{
    const first=book(),last={...book(),id:'second',reading_position:{...position,updated_at:'2026-11-19T11:00:00Z'}}
    const pending={...last,id:'pending',status:'GENERATING' as const,reading_position:{...position,updated_at:'2026-11-19T12:00:00Z'}}
    const books=[first,last,pending];expect(mostRecentlyRead(books)?.id).toBe('second');expect(books[0]).toBe(first)
  })
  it('账号/演示和不同书籍互不串位，刷新后恢复更新的备份',()=>{
    const b=book();checkpointReadingPosition('live:alice',b.id,{...position,time_ms:57000,updated_at:'2026-11-19T12:00:00Z'})
    expect(restoreReadingPositions('live:alice',[b])[0].reading_position?.time_ms).toBe(57000)
    expect(restoreReadingPositions('live:bob',[b])[0]).toBe(b)
    expect(restoreReadingPositions('demo',[b])[0]).toBe(b)
    expect(restoreReadingPositions('live:alice',[{...b,id:'other'}])[0].reading_position).toEqual(position)
  })
  it('旧备份不会覆盖更晚的账号草稿，备份不会复活已删除图书',()=>{
    checkpointReadingPosition('scope',book().id,{...position,updated_at:'2026-11-18T12:00:00Z'})
    const b=book();expect(restoreReadingPositions('scope',[b])[0]).toBe(b);expect(restoreReadingPositions('scope',[])).toEqual([])
  })
  it('删除/重置后清掉对应备份，其他书不受影响',()=>{
    checkpointReadingPosition('scope',book().id,position);checkpointReadingPosition('scope','other',position)
    removeReadingCheckpoint('scope',book().id)
    expect(localStorage.getItem('scope:reading-positions-v1')).not.toContain(book().id)
    expect(localStorage.getItem('scope:reading-positions-v1')).toContain('other')
    removeReadingCheckpoint('scope');expect(localStorage.getItem('scope:reading-positions-v1')).toBeNull()
  })
  it('储存被禁用时返回失败，让上层提示，不中断阅读',()=>{
    vi.spyOn(localStorage,'setItem').mockImplementation(()=>{throw new Error('quota')})
    expect(checkpointReadingPosition('scope','book',position)).toBe(false)
  })
  it('损坏的即时备份不会破坏持久书架',()=>{
    localStorage.setItem('scope:reading-positions-v1','{broken');const books=[book()]
    expect(restoreReadingPositions('scope',books)).toBe(books)
  })
  it('新存储实例能恢复阅读位置且账号隔离',async()=>{
    const factory=new IDBFactory();const store=new DraftStore(factory,'reading-test')
    await store.saveWorkspace('alice',{books:[book()],notes:[],grants:[],interactions:[]})
    const reopened=new DraftStore(factory,'reading-test')
    expect((await reopened.loadWorkspace('alice'))?.data.books[0].reading_position).toEqual(position)
    expect(await reopened.loadWorkspace('bob')).toBeNull()
  })
})

describe('书架继续阅读展示',()=>{
  const home=(books:ReadingBook[])=>renderToStaticMarkup(<HomePage state="success" setState={()=>{}} onImport={()=>{}} onBook={()=>{}} onStartOver={()=>{}} onNote={()=>{}} onDeleteBook={async()=>{}} books={books} notes={[]}/>)
  it('新书架不假装已有阅读记录',()=>{expect(home(initialBooks())).not.toContain('上次读到这里')})
  it('首页提供最近阅读、继续与从头操作；书卡也显示页码',()=>{
    const html=home([book()]);expect(html).toContain('上次读到这里');expect(html).toContain('第 2 / 3 页');expect(html).toContain('从头阅读');expect(html).toContain('继续阅读《')
    expect(renderToStaticMarkup(<BookCard book={book()} onOpen={()=>{}}/>)).toContain('继续阅读 · 第 2 / 3 页')
  })
  it('越界页码显示夹取结果，空页和未就绪图书不展示继续入口',()=>{
    expect(home([{...book(),reading_position:{...position,page_index:99}}])).toContain('第 3 / 3 页')
    expect(home([{...book(),pages:[]}])).not.toContain('上次读到这里')
    expect(home([{...book(),status:'FAILED'}])).not.toContain('上次读到这里')
  })
})
