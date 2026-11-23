import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest'
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

import ImportBookPage from '../ImportBookPage'
import {draftStore} from '../../features/books/draftStore'
import {apiClient} from '../../lib/api'
import {enableAccountSync,syncedScopes} from '../../lib/accountDrafts'
let tree:any,props:any,urls:Set<string>,count:number
const jpeg=btoa(String.fromCharCode(255,216,255,224,1))
const preview=(n=2)=>({page_count:n,pages:Array.from({length:n},(_,i)=>({page_no:i+1,image_base64:jpeg}))})
const pdf=()=>new File(['%PDF-1.7'],'绘本.pdf',{type:'application/pdf'})
function render(){let rounds=0;do{hooks.dirty=false;hooks.cursor=0;tree=ImportBookPage(props);hooks.effects.splice(0).forEach(run=>run());if(++rounds>20)throw Error('loop')}while(hooks.dirty)}
async function settle(){for(let i=0;i<1500;i++)await Promise.resolve();render()}
function findBy(predicate:(n:any)=>boolean,node:any=tree):any{if(!node||typeof node!=='object')return null;if(predicate(node))return node;for(const child of [node.props?.children].flat(Infinity)){if(child===undefined)continue;const found=findBy(predicate,child);if(found)return found}return null}
function fileInput(){return findBy(n=>n.type==='input'&&n.props.type==='file')}
function add(files:File[]){fileInput().props.onChange({target:{files,value:'chosen'}})}
function text(node:any=tree):string{if(typeof node==='string'||typeof node==='number')return String(node);if(!node||typeof node!=='object')return '';return [node.props?.children].flat(Infinity).filter(v=>v!==undefined).map(text).join('')}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r});return {promise,resolve}}
beforeEach(()=>{
 hooks.cursor=0;hooks.slots=[];hooks.effects=[];hooks.dirty=false;urls=new Set();count=0
 vi.stubGlobal('window',new EventTarget());vi.stubGlobal('location',{hash:'#/import'});vi.stubGlobal('history',{replaceState:vi.fn()})
 vi.stubGlobal('Image',class {src='';naturalWidth=100;naturalHeight=100;async decode(){}})
 vi.spyOn(URL,'createObjectURL').mockImplementation(()=>{const url=`blob:import-${++count}`;urls.add(url);return url})
 vi.spyOn(URL,'revokeObjectURL').mockImplementation(url=>{urls.delete(url)})
 vi.spyOn(draftStore,'saveImport').mockResolvedValue(undefined)
 apiClient.setToken('alice-token');enableAccountSync('live:alice',true)
 vi.spyOn(apiClient,'previewPdf').mockResolvedValue(preview())
 props={draftScope:'live:alice',state:'success',setState:vi.fn(),onHome:vi.fn(),onComplete:vi.fn(),serverSync:true,appMode:'live'}
})
afterEach(()=>{vi.useRealTimers();hooks.slots.forEach(slot=>slot?.cleanup?.());hooks.slots=[];syncedScopes.clear();apiClient.setToken('');vi.restoreAllMocks();vi.unstubAllGlobals()})
describe('阅读导入页PDF流程',()=>{
 it('接受超过旧100MB限制的PDF，并允许拖入',async()=>{
  const book=pdf();Object.defineProperty(book,'size',{value:150*1024*1024})
  render()
  findBy(n=>n.props?.onDrop).props.onDrop({preventDefault:vi.fn(),dataTransfer:{files:[book]}})
  await settle()
  expect(apiClient.previewPdf).toHaveBeenCalledTimes(1)
  expect(text()).toContain('绘本-001.jpg')
 })
 it('无授权选项不能继续，图书类型无需手工选择',async()=>{
  render();add([pdf()]);await settle()
  findBy(n=>n.type==='input'&&n.props.placeholder==='例如：森林里的来信').props.onChange({target:{value:'测试书'}})
  findBy(n=>n.type==='select'&&n.props['aria-label']==='是否拥有使用授权').props.onChange({target:{value:'no'}})
  render();findBy(n=>n.type==='form').props.onSubmit({preventDefault:vi.fn()});render()
  expect(text()).toContain('请确认你拥有所选书页的使用授权')
  expect(text()).toContain('自动识别');expect(props.onComplete).not.toHaveBeenCalled()
 })
 it('接受没有MIME的真实PNG，仍拒绝扩展名伪装',async()=>{
  render();add([new File([new Uint8Array([137,80,78,71,13,10,26,10])],'page.png'),new File(['not png'],'broken.png')]);await settle()
  expect(text()).toContain('page.png');expect(text()).toContain('文件内容与图片类型不符')
  expect(vi.mocked(draftStore.saveImport).mock.calls.at(-1)![1].pages).toHaveLength(1)
 })
 it('展开整份PDF并保存页序/原图到草稿，不提交正式分析',async()=>{
  render();add([pdf()]);await settle()
  expect(apiClient.previewPdf).toHaveBeenCalledWith(expect.any(File),100,expect.any(AbortSignal))
  expect(text()).toContain('绘本-001.jpg');expect(text()).toContain('绘本-002.jpg')
  const saved=vi.mocked(draftStore.saveImport).mock.calls.at(-1)![1]
  expect(saved.pages.map(p=>p.name)).toEqual(['绘本-001.jpg','绘本-002.jpg']);expect(saved.pages.every(p=>p.file instanceof File)).toBe(true)
  expect(props.onComplete).not.toHaveBeenCalled();expect(urls.size).toBe(2)
 })
 it('损坏后页不留下部分PDF；同批合法文件仍可导入',async()=>{
  const broken=preview();broken.pages[1].image_base64='%%%';vi.mocked(apiClient.previewPdf).mockResolvedValueOnce(broken).mockResolvedValueOnce(preview(1))
  render();add([pdf(),new File(['%PDF'],'第二本.pdf',{type:'application/pdf'})]);await settle()
  expect(text()).not.toContain('绘本-001.jpg');expect(text()).toContain('第二本-001.jpg');expect(urls.size).toBe(1)
 })
 it('未登录本机模式、空文件和超大文件不发请求',async()=>{
  const huge=new File(['x'],'huge.pdf',{type:'application/pdf'});Object.defineProperty(huge,'size',{value:200*1024*1024+1})
  render();add([new File([],'empty.pdf',{type:'application/pdf'}),huge]);await settle()
  expect(apiClient.previewPdf).not.toHaveBeenCalled()
  props={...props,serverSync:false};render();add([pdf()]);await settle()
  expect(apiClient.previewPdf).not.toHaveBeenCalled();expect(text()).toContain('PDF 需要登录')
 })
 it('解析等待时重复选择不会重复上传',async()=>{
  const pending=deferred<ReturnType<typeof preview>>();vi.mocked(apiClient.previewPdf).mockReturnValue(pending.promise)
  render();add([pdf()]);add([pdf()]);expect(apiClient.previewPdf).toHaveBeenCalledTimes(1)
  pending.resolve(preview());await settle();expect(urls.size).toBe(2)
 })
 it('账号更换后迟到结果不会加入页面或保存到新账号',async()=>{
  const pending=deferred<ReturnType<typeof preview>>();vi.mocked(apiClient.previewPdf).mockReturnValue(pending.promise)
  render();add([pdf()]);apiClient.setToken('bob-token');pending.resolve(preview());await settle()
  expect(text()).not.toContain('绘本-001.jpg');expect(text()).toContain('账号已切换');expect(draftStore.saveImport).not.toHaveBeenCalled();expect(urls.size).toBe(0)
 })
 it('卸载会取消请求且不分配/泄漏迟到书页URL',async()=>{
  const pending=deferred<ReturnType<typeof preview>>();vi.mocked(apiClient.previewPdf).mockReturnValue(pending.promise)
  render();add([pdf()]);const signal=vi.mocked(apiClient.previewPdf).mock.calls[0][2]!
  hooks.slots.forEach(slot=>slot?.cleanup?.());expect(signal.aborted).toBe(true)
  pending.resolve(preview());for(let i=0;i<30;i++)await Promise.resolve()
  expect(draftStore.saveImport).not.toHaveBeenCalled();expect(urls.size).toBe(0)
 })
 it('清空重置会取消旧导入，不把迟到结果放回书页',async()=>{
  const pending=deferred<ReturnType<typeof preview>>();vi.mocked(apiClient.previewPdf).mockReturnValue(pending.promise)
  render();add([pdf()]);props={...props,state:'empty'};render();pending.resolve(preview());await settle()
  expect(text()).not.toContain('绘本-001.jpg');expect(urls.size).toBe(0)
 })
 it('第二份PDF按剩余位置提交，整份超限不截断为部分书页',async()=>{
  vi.mocked(apiClient.previewPdf).mockResolvedValueOnce(preview(99)).mockRejectedValueOnce(new Error('超过剩余可导入页数'))
  render();add([pdf()]);await settle();add([pdf()]);await settle()
  expect(vi.mocked(apiClient.previewPdf).mock.calls.map(call=>call[1])).toEqual([100,1])
  expect(vi.mocked(draftStore.saveImport).mock.calls.at(-1)![1].pages).toHaveLength(99);expect(urls.size).toBe(99)
 })
})


describe('PDF交付与切换隔离',()=>{
 it('确认预览后把有序JPEG原图交给后续校对，不重新解析PDF',async()=>{
  render();add([pdf()]);await settle()
  findBy(n=>n.type==='input'&&n.props.placeholder==='例如：森林里的来信').props.onChange({target:{value:'PDF测试书'}})
  findBy(n=>n.type==='select'&&n.props['aria-label']==='是否拥有使用授权').props.onChange({target:{value:'yes'}})
  render();vi.useFakeTimers()
  findBy(n=>n.type==='form').props.onSubmit({preventDefault:vi.fn()})
  vi.advanceTimersByTime(700);vi.useRealTimers();render()
  findBy(n=>n.props?.onClick&&text(n).includes('继续校对书页')).props.onClick()
  await settle()
  expect(props.onComplete).toHaveBeenCalledTimes(1)
  const [input,draftId]=props.onComplete.mock.calls[0]
  expect(input.title).toBe('PDF测试书');expect(input.authorization_ref).toBe('用户声明拥有使用授权');expect(input.type).toBe('unknown');expect(draftId).toMatch(/^import-/)
  expect(input.pages.map((p:any)=>p.name)).toEqual(['绘本-001.jpg','绘本-002.jpg'])
  expect(input.pages.every((p:any)=>p.file instanceof File&&p.file.type==='image/jpeg')).toBe(true)
  expect(apiClient.previewPdf).toHaveBeenCalledTimes(1)
 })
 it('账号作用域改变后即使令牌未更新也不接收旧PDF结果',async()=>{
  const pending=deferred<ReturnType<typeof preview>>();vi.mocked(apiClient.previewPdf).mockReturnValue(pending.promise)
  render();add([pdf()]);props={...props,draftScope:'live:bob'};render()
  pending.resolve(preview());await settle()
  expect(text()).not.toContain('绘本-001.jpg');expect(urls.size).toBe(0)
  expect(draftStore.saveImport).not.toHaveBeenCalled()
 })
})
