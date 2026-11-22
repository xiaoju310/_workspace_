import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import type { ReaderProps, Source } from '../../app/types'
import type { SegmentOut } from '../../types/interaction'
import { initialBooks } from '../../mock/workspace'

// Exercise the real reader lifecycle and JSX handlers without adding a browser/DOM dependency.
const hooks=vi.hoisted(()=>({cursor:0,slots:[] as any[],effects:[] as (()=>void)[],dirty:false}))
vi.mock('react',async importOriginal=>{
  const real=await importOriginal<typeof import('react')>()
  return {...real,
    useState:(initial:any)=>{
      const index=hooks.cursor++
      if(!(index in hooks.slots))hooks.slots[index]={value:typeof initial==='function'?initial():initial}
      return [hooks.slots[index].value,(next:any)=>{
        const value=typeof next==='function'?next(hooks.slots[index].value):next
        if(!Object.is(value,hooks.slots[index].value)){hooks.slots[index].value=value;hooks.dirty=true}
      }]
    },
    useRef:(value:any)=>{
      const index=hooks.cursor++
      return hooks.slots[index]??(hooks.slots[index]={current:value})
    },
    useEffect:(effect:()=>void|(()=>void),deps?:unknown[])=>{
      const index=hooks.cursor++,old=hooks.slots[index]
      if(!old||!deps||deps.some((v,i)=>!Object.is(v,old.deps?.[i]))){
        const slot={deps,cleanup:old?.cleanup};hooks.slots[index]=slot
        hooks.effects.push(()=>{slot.cleanup?.();slot.cleanup=effect()})
      }
    },
  }
})
import InteractiveReaderPage from '../InteractiveReaderPage'
import VocabularyCards from '../../components/VocabularyCards'
import ReadingBookmarks from '../../components/ReadingBookmarks'

let tree:ReactElement
let props:ReaderProps
function render(){
  let rounds=0
  do {
    hooks.dirty=false;hooks.cursor=0
    tree=InteractiveReaderPage(props)
    const effects=hooks.effects.splice(0);effects.forEach(run=>run())
    if(++rounds>20)throw new Error('Render loop')
  }while(hooks.dirty)
}
function find(type:string,node:any=tree):any {
  if(!node||typeof node!=='object')return null
  if(node.type===type)return node
  const children=node.props?.children
  for(const child of Array.isArray(children)?children:[children]){
    if(Array.isArray(child)){for(const item of child){const found=find(type,item);if(found)return found}}
    else if(child!==undefined) {const found=find(type,child);if(found)return found}
  }
  return null
}
function cleanup(){hooks.slots.forEach(slot=>slot?.cleanup?.())}
const saved={time_ms:52500,page_index:1,video:true,updated_at:'2026-11-19T12:00:00Z',run_id:'run-a',video_key:'asset:hash'}
const segments=[{page_no:1,start_ms:0,end_ms:10000},{page_no:2,start_ms:10000,end_ms:60000},{page_no:3,start_ms:60000,end_ms:90000}] as SegmentOut[]
let windowEvents:EventTarget,documentEvents:EventTarget
beforeEach(()=>{
  hooks.cursor=0;hooks.slots=[];hooks.effects=[];hooks.dirty=false
  windowEvents=new EventTarget();documentEvents=new EventTarget()
  vi.stubGlobal('window',windowEvents)
  vi.stubGlobal('document',Object.assign(documentEvents,{visibilityState:'hidden'}))
  props={book:{...initialBooks()[0],run_id:'run-a',video_url:'blob:video',reading_position:{...saved}},state:'success',setState:vi.fn(),navigate:vi.fn(),notify:vi.fn(),interactions:[],onInteraction:vi.fn(),seekTo:null,onSeekHandled:vi.fn(),askQuestion:vi.fn(),identifyTouch:vi.fn(),appMode:'demo',onReadingPosition:vi.fn(),segments,videoState:{status:'ready',url:'blob:video',asset_id:'asset',sha256:'hash',size_bytes:100}}
})
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks()})
function metadata(duration=90){
  const el={duration,currentTime:0}
  find('video').props.onLoadedMetadata({currentTarget:el});render();return el
}

describe('真实阅读组件的续读生命周期',()=>{
  it('元数据到达前不保存占位位置，真实时长到达恢复52.5秒且保持暂停',()=>{
    render();expect(props.onReadingPosition).not.toHaveBeenCalled()
    const el=metadata();expect(el.currentTime).toBe(52.5)
    expect(props.onReadingPosition).toHaveBeenLastCalledWith(52500,1,true,'asset:hash')
    expect(find('video').props.autoPlay).toBeUndefined()
  })
  it('五秒桶内不重复整本保存，离开与隐藏时刷新精确位置',()=>{
    render();metadata();vi.mocked(props.onReadingPosition!).mockClear()
    find('video').props.onTimeUpdate({currentTarget:{currentTime:53.75}});render()
    expect(props.onReadingPosition).not.toHaveBeenCalled()
    windowEvents.dispatchEvent(new Event('pagehide'))
    expect(props.onReadingPosition).toHaveBeenLastCalledWith(53750,1,true,'asset:hash')
    documentEvents.dispatchEvent(new Event('visibilitychange'))
    expect(props.onReadingPosition).toHaveBeenCalledTimes(2)
  })
  it('暂停即刻保存，不等下一次timeupdate',()=>{
    render();metadata()
    find('video').props.onPause({currentTarget:{currentTime:59.8}})
    expect(props.onReadingPosition).toHaveBeenLastCalledWith(59800,1,true,'asset:hash')
  })
  it('元数据前的历史跳转优先于续读位置',()=>{
    props={...props,seekTo:70000};render();const el=metadata()
    expect(el.currentTime).toBe(70);expect(props.onReadingPosition).toHaveBeenLastCalledWith(70000,2,true,'asset:hash')
  })
  it('加载视频或失败后显示静态页时，不用占位覆盖原视频记录',()=>{
    props={...props,book:{...props.book,video_url:null},videoState:{status:'loading'}}
    render();expect(props.onReadingPosition).not.toHaveBeenCalled()
    props={...props,videoState:{status:'error',error:'offline'}};render()
    windowEvents.dispatchEvent(new Event('pagehide'));expect(props.onReadingPosition).not.toHaveBeenCalled()
  })
  it('从头阅读的显式跳转覆盖旧视频记录',()=>{
    props={...props,seekTo:0};render();expect(metadata().currentTime).toBe(0)
    expect(props.onReadingPosition).toHaveBeenLastCalledWith(0,0,true,'asset:hash')
  })
  it('新产物按页恢复，时间轴稍后到达时修正，不改已开始的播放',()=>{
    props={...props,segments:undefined,videoState:{status:'ready',url:'blob:video',asset_id:'new',sha256:'hash',size_bytes:100}}
    render();expect(metadata().currentTime).toBe(30)
    props={...props,segments};render()
    expect(props.onReadingPosition).toHaveBeenLastCalledWith(10000,1,true,'new:hash')
    find('video').props.onPlay();render()
    find('video').props.onTimeUpdate({currentTarget:{currentTime:45}});render()
    props={...props,segments:[...segments]};render()
    expect(props.onReadingPosition).toHaveBeenLastCalledWith(45000,1,true,'new:hash')
  })
  it('真实卸载时保存尾部位置并移除页面监听',()=>{
    render();metadata();find('video').props.onTimeUpdate({currentTarget:{currentTime:54.2}});render()
    cleanup();expect(props.onReadingPosition).toHaveBeenLastCalledWith(54200,1,true,'asset:hash')
    vi.mocked(props.onReadingPosition!).mockClear()
    windowEvents.dispatchEvent(new Event('pagehide'));expect(props.onReadingPosition).not.toHaveBeenCalled()
    hooks.slots=[]
  })
  it('静态书页按保存页码恢复，缩略页跳转不误用视频时间轴',()=>{
    props={...props,book:{...props.book,video_url:null,reading_position:{...saved,video:false}},videoState:undefined}
    render();expect(find('img').props.alt).toContain('第 2 页')
    const walk=(node:any):any=>{
      if(!node||typeof node!=='object')return null
      if(node.props?.className==='reader-page-strip')return node
      return [node.props?.children].flat(Infinity).filter(Boolean).map(walk).find(Boolean)
    }
    walk(tree).props.children[2].props.onClick();render()
    expect(props.onReadingPosition).toHaveBeenLastCalledWith(24000,2,false,undefined)
    expect(find('img').props.alt).toContain('第 3 页')
  })
  it('无效视频时长不写位置；加载失败后保留最后成功记录',()=>{
    render();metadata(Infinity);expect(props.onReadingPosition).not.toHaveBeenCalled()
    metadata();vi.mocked(props.onReadingPosition!).mockClear()
    find('video').props.onError();render()
    windowEvents.dispatchEvent(new Event('pagehide'));expect(props.onReadingPosition).not.toHaveBeenCalled()
  })

})


function findBy(test:(node:any)=>boolean,node:any=tree):any {
  if(!node||typeof node!=='object')return null
  if(test(node))return node
  for(const child of [node.props?.children].flat(Infinity)){
    if(!child||typeof child!=='object')continue
    const hit=findBy(test,child);if(hit)return hit
  }
  return null
}
function button(label:string){
  const node=findBy(n=>n.type==='button'&&(n.props['aria-label']===label||[n.props.children].flat().some(c=>typeof c==='string'&&c.includes(label))))
  if(!node)throw new Error(`Button not found: ${label}`)
  return node
}
function answer(sources:Source[]){
  props={...props,interactions:[{id:'answer',book_id:props.book.id,run_id:'run-a',kind:'question',question:'谁来了',answer:'小兔子来了',sources,transcript:'',video_ms:52500,latency_ms:10,created_at:'2026-11-19T12:00:00Z',uncertain:false,origin:'mock',cached:false}]}
}
const citation=(patch:Partial<Source>={}):Source=>({page_no:3,source:'original_page',quote:'小兔子',start_ms:null,end_ms:null,...patch})
function openCitation(index=1,page=3){button(`查看答案依据 ${index}：第 ${page} 页`).props.onClick();render()}

describe('答案依据真实组件事件',()=>{
  it('原文在阅读页展开，不离开回答，视频不被强制跳动',()=>{
    answer([citation()]);render();metadata();openCitation()
    expect(props.navigate).not.toHaveBeenCalled()
    expect(findBy(n=>n.props?.['aria-label']==='答案依据详情')).toBeTruthy()
    expect(find('blockquote').props.children).toBe('小兔子')
    expect(find('input').props.value).toBe(52500)
    expect(button('定位依据视频').props.disabled).toBe(false)
    button('定位依据视频').props.onClick();render()
    expect(find('input').props.value).toBe(60000)
    expect(find('video').props.autoPlay).toBeUndefined()
  })
  it('视频依据点击暂停并定位，切换多个依据后返回最初位置',()=>{
    answer([citation({source:'script',page_no:1,start_ms:2000}),citation({source:'video_frame',start_ms:65000})]);render();metadata()
    const media={currentTime:52.5,pause:vi.fn()}
    find('video').ref.current=media
    openCitation(1,1);expect(media.pause).toHaveBeenCalled();expect(media.currentTime).toBe(2)
    openCitation(2,3);expect(media.currentTime).toBe(65)
    button('返回刚才位置').props.onClick();render()
    expect(media.currentTime).toBe(52.5)
    expect(findBy(n=>n.props?.['aria-label']==='答案依据详情')).toBeNull()
  })
  it('静态页按真实服务端编号跳页，高亮校对文字并可返回',()=>{
    props={...props,book:{...props.book,video_url:null,pages:props.book.pages.map((p,i)=>({...p,server_page_no:[3,8,12][i],edit_text:'森林里的小兔子来了'}))},videoState:undefined}
    answer([citation({page_no:12})]);render();openCitation(1,12)
    expect(find('input').props.value).toBe(24000)
    expect(find('mark').props.children).toBe('小兔子')
    button('返回刚才位置').props.onClick();render();expect(find('input').props.value).toBe(12000)
  })
  it('无可靠时间只打开原文，不把均分时间当作答案依据',()=>{
    props={...props,segments:undefined};answer([citation({source:'script'})]);render();metadata();openCitation()
    expect(find('input').props.value).toBe(52500)
    expect(button('定位依据视频').props.disabled).toBe(true)
  })
  it('非法引用不导航不修改位置，明确提示',()=>{
    answer([citation({page_no:99})]);render();metadata();openCitation(1,99)
    expect(props.navigate).not.toHaveBeenCalled()
    expect(props.notify).toHaveBeenLastCalledWith(expect.stringContaining('不在当前图书'))
    expect(find('input').props.value).toBe(52500)
  })
  it('元数据晚到先展示原文，已知真实时长后才允许视频定位',()=>{
    answer([citation({source:'video_frame',start_ms:65000})]);render();openCitation()
    expect(button('定位依据视频').props.disabled).toBe(true)
    metadata();expect(button('定位依据视频').props.disabled).toBe(false)
    button('定位依据视频').props.onClick();render();expect(find('input').props.value).toBe(65000)
    button('返回刚才位置').props.onClick();render();expect(find('input').props.value).toBe(52500)
  })
  it('视频失败或依据越界时保留原文，不定位错误时间',()=>{
    answer([citation({source:'video_frame',start_ms:120000})]);render();metadata();openCitation()
    expect(button('定位依据视频').props.disabled).toBe(true)
    expect(find('input').props.value).toBe(52500)
    find('video').props.onError();render()
    expect(find('blockquote').props.children).toBe('小兔子')
    expect(button('定位依据视频').props.disabled).toBe(true)
  })
  it('没有依据不伪造跳转；其他图书与运行的回答不显示',()=>{
    answer([]);render();expect(findBy(n=>n.props?.['aria-label']?.startsWith('查看答案依据'))).toBeNull()
    props={...props,interactions:props.interactions.map(i=>({...i,run_id:'other',sources:[citation()]}))};render()
    expect(findBy(n=>n.props?.['aria-label']?.startsWith('查看答案依据'))).toBeNull()
  })
})



describe('生词卡与阅读页连接',()=>{
  it('静态页传递真实页码及保存回调，回原文复用依据预览',()=>{
    const update=vi.fn()
    props={...props,onVocabularyChange:update,book:{...props.book,video_url:null,pages:props.book.pages.map((p,i)=>({...p,server_page_no:[3,8,12][i]}))},videoState:undefined}
    render()
    const panel=findBy(n=>n.type===VocabularyCards)
    expect(panel.props.pageNo).toBe(8)
    expect(panel.props.onChange).toBe(update)
    panel.props.onSource(citation({page_no:12}));render()
    expect(findBy(n=>n.props?.['aria-label']==='答案依据详情')).toBeTruthy()
    expect(find('input').props.value).toBe(24000)
  })
  it('无可靠视频时间轴时不替用户猜生词来源页',()=>{
    props={...props,onVocabularyChange:vi.fn(),segments:undefined};render()
    expect(findBy(n=>n.type===VocabularyCards).props.pageNo).toBeNull()
    metadata();expect(findBy(n=>n.type===VocabularyCards).props.pageNo).toBeNull()
  })
  it('正在查看的依据页优先于视频当前页，避免错记来源',()=>{
    props={...props,onVocabularyChange:vi.fn()};answer([citation()]);render();metadata();openCitation()
    expect(findBy(n=>n.type===VocabularyCards).props.pageNo).toBe(3)
  })
})


describe('书签与阅读页真实连接', () => {
  function setupBookmark() {
    const mark = { id: 'mark-1', page_id: props.book.pages[2].id, note: '再读', created_at: '2026-11-21T00:00:00Z', updated_at: '2026-11-21T00:00:00Z' }
    props = { ...props, onBookmarksChange: vi.fn(), book: { ...props.book, bookmarks: [mark] } }
    return mark
  }
  function panel() { return findBy(n => n.type === ReadingBookmarks) }
  it('静态书签按稳定ID跳到当前真实页码并保留返回入口', () => {
    const mark = setupBookmark()
    props = { ...props, videoState: undefined, book: { ...props.book, video_url: null, pages: props.book.pages.map((p, i) => ({ ...p, server_page_no: [3, 8, 12][i] })) } }
    render(); expect(panel().props.currentPageId).toBe(props.book.pages[1].id)
    expect(panel().props.onChange).toBe(props.onBookmarksChange)
    panel().props.onOpen(mark); render()
    expect(findBy(n => n.props?.['aria-label'] === '书签原书页详情')).toBeTruthy()
    expect(find('input').props.value).toBe(24000)
    expect(panel().props.currentPageId).toBe(mark.page_id)
    button('返回刚才位置').props.onClick(); render(); expect(find('input').props.value).toBe(12000)
  })
  it('可靠视频时间轴自动暂停并定位到书签页，返回恢复原位置', () => {
    const mark = setupBookmark(); render(); metadata()
    const media = { currentTime: 52.5, pause: vi.fn() }; find('video').ref.current = media
    panel().props.onOpen(mark); render()
    expect(media.pause).toHaveBeenCalled(); expect(media.currentTime).toBe(60)
    expect(find('input').props.value).toBe(60000)
    button('返回刚才位置').props.onClick(); render(); expect(media.currentTime).toBe(52.5)
  })
  it('无时间轴/视频尚未就绪不伪造定位，但可以打开原书页', () => {
    const mark = setupBookmark(); props = { ...props, segments: undefined }; render()
    expect(panel().props.currentPageId).toBeNull()
    panel().props.onOpen(mark); render()
    expect(findBy(n => n.props?.['aria-label'] === '书签原书页详情')).toBeTruthy()
    expect(button('定位书页视频').props.disabled).toBe(true)
    metadata(); expect(find('input').props.value).toBe(52500)
    expect(panel().props.currentPageId).toBe(mark.page_id)
  })
  it('书签与答案依据切换时正确区分标题，并保留最初返回位置', () => {
    const mark = setupBookmark(); answer([citation()]); render(); metadata()
    panel().props.onOpen(mark); render()
    expect(findBy(n => n.props?.['aria-label'] === '书签原书页详情')).toBeTruthy()
    openCitation()
    expect(findBy(n => n.props?.['aria-label'] === '答案依据详情')).toBeTruthy()
    expect(findBy(n => n.props?.['aria-label'] === '书签原书页详情')).toBeNull()
    button('返回刚才位置').props.onClick(); render(); expect(find('input').props.value).toBe(52500)
  })
  it('移除书页后不按旧下标跳转', () => {
    const mark = setupBookmark(); props = { ...props, book: { ...props.book, pages: props.book.pages.filter(p => p.id !== mark.page_id) } }
    render(); panel().props.onOpen(mark); render()
    expect(props.notify).toHaveBeenLastCalledWith('书签对应的原书页已移除，无法跳转。')
    expect(findBy(n => n.props?.['aria-label'] === '书签原书页详情')).toBeNull()
  })
  it('视频加载失败仍能看书签原页，不触发视频跳转', () => {
    const mark = setupBookmark(); render(); metadata(); find('video').props.onError(); render()
    expect(panel().props.currentPageId).toBeNull()
    panel().props.onOpen(mark); render()
    expect(button('定位书页视频').props.disabled).toBe(true)
    expect(find('input').props.value).toBe(52500)
  })
})


describe('专注阅读组件', () => {
  it('提供明确开关和退出，切换聚焦按钮且不更换视频引用或位置', () => {
    props = { ...props, onFocusModeChange: vi.fn() }; render(); metadata()
    const video = find('video'), media = { currentTime: 52.5, pause: vi.fn() }
    video.ref.current = media
    button('专注阅读').props.onClick(); expect(props.onFocusModeChange).toHaveBeenLastCalledWith(true)
    const focus = vi.fn(); button('专注阅读').ref.current = { focus }
    props = { ...props, focusMode: true }; render()
    expect(button('退出专注阅读').props['aria-pressed']).toBe(true)
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(find('video').ref).toBe(video.ref); expect(media.currentTime).toBe(52.5)
    expect(media.pause).not.toHaveBeenCalled()
    button('退出专注阅读').props.onClick(); expect(props.onFocusModeChange).toHaveBeenLastCalledWith(false)
    props = { ...props, focusMode: false }; render()
    expect(find('video').ref).toBe(video.ref); expect(find('input').props.value).toBe(52500)
    expect(button('专注阅读').props['aria-pressed']).toBe(false)
  })
  it('隐藏问答、生词和朗读，退出后保留未提交的问题', () => {
    props = { ...props, onFocusModeChange: vi.fn(), onVocabularyChange: vi.fn() }; render()
    find('textarea').props.onChange({ target: { value: '小兔子去哪了？' } }); render()
    props = { ...props, focusMode: true }; render()
    expect(find('aside').props.hidden).toBe(true)
    expect(findBy(n => n.props?.hidden && n.props?.children?.type === VocabularyCards)).toBeTruthy()
    props = { ...props, focusMode: false }; render()
    expect(find('aside').props.hidden).toBe(false)
    expect(find('textarea').props.value).toBe('小兔子去哪了？')
  })
  it('静态翻页沿用阅读位置，首尾边界禁用，书签保留可用', () => {
    props = { ...props, focusMode: true, onBookmarksChange: vi.fn(), videoState: undefined, book: { ...props.book, video_url: null } }; render()
    expect(findBy(n => n.type === ReadingBookmarks)).toBeTruthy()
    expect(button('上一页').props.disabled).toBe(false)
    button('上一页').props.onClick(); render()
    expect(button('上一页').props.disabled).toBe(true)
    expect(props.onReadingPosition).toHaveBeenLastCalledWith(0, 0, false, undefined)
    button('下一页').props.onClick(); render(); button('下一页').props.onClick(); render()
    expect(button('下一页').props.disabled).toBe(true)
    expect(props.onReadingPosition).toHaveBeenLastCalledWith(24000, 2, false, undefined)
  })
  it('视频翻页使用不等分真实时间轴，翻页后仍可退出', () => {
    props = { ...props, focusMode: true, onFocusModeChange: vi.fn() }; render(); metadata()
    const media = { currentTime: 52.5, pause: vi.fn() }; find('video').ref.current = media
    button('下一页').props.onClick(); render(); expect(media.currentTime).toBe(60)
    button('上一页').props.onClick(); render(); expect(media.currentTime).toBe(10)
    button('退出专注阅读').props.onClick(); expect(props.onFocusModeChange).toHaveBeenLastCalledWith(false)
  })
  it('非连续页码导航显示真实编号，不把数组顺序当页码', () => {
    props = { ...props, focusMode: true, videoState: undefined, book: { ...props.book, video_url: null, pages: props.book.pages.map((p, i) => ({ ...p, server_page_no: [3, 8, 12][i] })) } }; render()
    expect(button('第 8 页')).toBeTruthy()
    expect(button('第 12 页')).toBeTruthy()
  })
  it('录音中不能隐藏正在使用的问答工具', () => {
    props = { ...props, onFocusModeChange: vi.fn() }; render()
    const recorder = findBy(n => typeof n.props?.onRecordingChange === 'function')
    recorder.props.onRecordingChange(true); render()
    expect(button('专注阅读').props.disabled).toBe(true)
    recorder.props.onRecordingChange(false); render()
    expect(button('专注阅读').props.disabled).toBe(false)
  })
})
