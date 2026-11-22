import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import type { Interaction, ReaderProps } from '../../app/types'
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
const segments=[{page_no:1,start_ms:0,end_ms:10000},{page_no:2,start_ms:10000,end_ms:60000},{page_no:3,start_ms:60000,end_ms:90000}] as SegmentOut[]

vi.mock('../../features/interaction/frameCapture',()=>({captureFrame:vi.fn()}))
vi.mock('../../features/interaction/VideoCoordinateMapper',()=>({calculateImageTouchCoordinates:vi.fn(),calculateVideoTouchCoordinates:vi.fn()}))
import { captureFrame } from '../../features/interaction/frameCapture'
import { calculateImageTouchCoordinates, calculateVideoTouchCoordinates } from '../../features/interaction/VideoCoordinateMapper'
import { apiClient } from '../../lib/api'

function findBy(predicate:(n:any)=>boolean,node:any=tree):any {
  if(!node||typeof node!=='object')return null
  if(predicate(node))return node
  for(const child of [node.props?.children].flat(Infinity)){if(child===undefined)continue;const found=findBy(predicate,child);if(found)return found}
  return null
}
function button(label:string){return findBy(n=>n.type==='button'&&(n.props['aria-label']===label||[n.props.children].flat(Infinity).includes(label)))}
function deferred<T>(){let resolve!:(value:T)=>void;let reject!:(e:Error)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
async function settle(){for(let i=0;i<12;i++)await Promise.resolve();render()}
const shot={ok:true as const,snapshot:{blob:new Blob(['frame'],{type:'image/jpeg'}),width:640,height:480,mimeType:'image/jpeg' as const,frameTimeMs:null}}
const calculation={isInsideVideo:true,touchPoint:{norm_x:.25,norm_y:.5,video_pixel_x:200,video_pixel_y:300,video_width:800,video_height:600},viewport:{container_width:800,container_height:600,render_width:800,render_height:600,offset_x:0,offset_y:0,is_letterbox:false},debugInfo:{containerWidth:800,containerHeight:600,renderWidth:800,renderHeight:600,offsetX:0,offsetY:0,isLetterbox:false,clickX:200,clickY:300}}
const response:Interaction={id:'touch-result',book_id:'book',run_id:'run-a',kind:'touch',question:'点击位置',answer:'识别物体：黄瓜。它是一种蔬菜。',transcript:'',video_ms:0,sources:[],latency_ms:30,created_at:'2026-11-21',uncertain:false,origin:'real',recognized:true,cached:false}
class TestVideo {paused=false;currentTime=12.345;pause=vi.fn(()=>{this.paused=true})}
function start(){render();button('点击识物').props.onClick();render();return find('img')}
function click(){findBy(n=>n.props?.['aria-label']==='阅读画面').props.onClick({nativeEvent:{clientX:300,clientY:350},clientX:300,clientY:350,currentTarget:{getBoundingClientRect:()=>({left:100,top:50,width:800,height:600})}})}
beforeEach(()=>{
  hooks.cursor=0;hooks.slots=[];hooks.effects=[];hooks.dirty=false
  vi.stubGlobal('window',new EventTarget());vi.stubGlobal('document',Object.assign(new EventTarget(),{visibilityState:'visible'}));vi.stubGlobal('HTMLVideoElement',TestVideo)
  vi.mocked(captureFrame).mockReset().mockResolvedValue(shot)
  vi.mocked(calculateImageTouchCoordinates).mockReset().mockReturnValue(calculation)
  vi.mocked(calculateVideoTouchCoordinates).mockReset().mockReturnValue(calculation)
  props={book:{...initialBooks()[0],run_id:'run-a',video_url:null,pages:initialBooks()[0].pages.map(p=>({...p,image_url:'blob:page'}))},state:'success',setState:vi.fn(),navigate:vi.fn(),notify:vi.fn(),interactions:[],onInteraction:vi.fn(),seekTo:null,onSeekHandled:vi.fn(),askQuestion:vi.fn(),identifyTouch:vi.fn().mockResolvedValue(response),appMode:'demo',segments}
})
afterEach(()=>{cleanup();hooks.slots=[];apiClient.enableCloudInteractions('run-a',false);vi.unstubAllGlobals();vi.restoreAllMocks()})


function overlay() { return findBy(n=>n.type?.name==='TouchObjectOverlay') }
const located:Interaction={...response,origin:'real',recognized:true,target_name:'黄瓜',bounding_box:[.1,.2,.4,.8]}
describe('识物边界框阅读生命周期',()=>{
  it('视频取点击时刻和原始尺寸，不把框当成整块容器坐标',async()=>{
    props={...props,book:{...props.book,video_url:'blob:video'},segments}
    vi.mocked(props.identifyTouch).mockResolvedValue({...located,video_ms:12345})
    start();const video=new TestVideo();find('video').ref.current=video
    click();await settle()
    expect(video.pause).toHaveBeenCalledTimes(1)
    expect(vi.mocked(props.identifyTouch).mock.calls[0][2]).toBe(12345)
    expect(overlay().props.active).toBe(true)
    expect(overlay().props.point.video_width).toBe(800)
  })
  it('截图未完成时跳转，拒绝旧截图且不调用模型',async()=>{
    const pending=deferred<typeof shot>();vi.mocked(captureFrame).mockReturnValue(pending.promise)
    start().ref.current={};click();render()
    find('input').props.onChange({target:{value:'12000'}});render()
    pending.resolve(shot);await settle()
    expect(props.identifyTouch).not.toHaveBeenCalled()
    expect(overlay().props.active).toBe(false)
  })
  it('快速重复点击只发起一次识物',async()=>{
    const pending=deferred<typeof shot>();vi.mocked(captureFrame).mockReturnValue(pending.promise)
    start().ref.current={};click();click();render()
    expect(captureFrame).toHaveBeenCalledTimes(1)
    pending.resolve(shot);await settle()
    expect(props.identifyTouch).toHaveBeenCalledTimes(1)
  })
  it('黑边点击不产生模型请求或定位结果',async()=>{
    vi.mocked(calculateImageTouchCoordinates).mockReturnValue({...calculation,isInsideVideo:false})
    start().ref.current={};click();await settle()
    expect(captureFrame).not.toHaveBeenCalled()
    expect(props.identifyTouch).not.toHaveBeenCalled()
    expect(overlay().props.active).toBe(false)
  })

  it('传递物体名称、原图尺寸与已暂停画面的定位结果',async()=>{
    vi.mocked(props.identifyTouch).mockResolvedValue(located)
    start().ref.current={};click();await settle()
    expect(overlay().props.item).toEqual(located)
    expect(overlay().props.point).toEqual(calculation.touchPoint)
    expect(overlay().props.active).toBe(true)
  })
  it('恢复播放清除旧框',async()=>{
    vi.mocked(props.identifyTouch).mockResolvedValue(located)
    start().ref.current={};click();await settle()
    button('开始播放').props.onClick();render()
    expect(overlay().props.active).toBe(false)
    expect(overlay().props.point).toBeUndefined()
  })
  it('翻页后不显示旧框或使用迟到结果',async()=>{
    const pending=deferred<Interaction>();vi.mocked(props.identifyTouch).mockReturnValue(pending.promise)
    start().ref.current={};click();await settle()
    find('input').props.onChange({target:{value:'12000'}});render()
    pending.resolve(located);await settle()
    expect(overlay().props.active).toBe(false)
    expect(props.onInteraction).not.toHaveBeenCalled()
  })
  it('换书后旧截图不触发模型',async()=>{
    const pending=deferred<typeof shot>();vi.mocked(captureFrame).mockReturnValue(pending.promise)
    start().ref.current={};click();render()
    props={...props,book:{...props.book,id:'other',run_id:'other-run'}};render()
    pending.resolve(shot);await settle()
    expect(props.identifyTouch).not.toHaveBeenCalled()
    expect(overlay().props.active).toBe(false)
  })
  it('切换运行后不复用已授权的识物状态',()=>{
    props={...props,appMode:'live',book:{...props.book,server_book_id:'server'}}
    apiClient.enableCloudInteractions('run-a',true);start();render()
    props={...props,book:{...props.book,run_id:'run-b'}};render()
    expect(apiClient.cloudInteractionsEnabled('run-b')).toBe(false)
    expect(overlay().props.active).toBe(false)
  })
})
