import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import type { Interaction, ReaderProps } from '../../app/types'
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
import { AudioRecorder } from '../../features/interaction/AudioRecorder'
import { FrameQuestion } from '../../features/interaction/FrameQuestion'
import { VisualTextFinder } from '../../features/interaction/VisualTextFinder'

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
async function settle(){for(let i=0;i<12;i++)await Promise.resolve();render()}
const shot={ok:true as const,snapshot:{blob:new Blob(['frame'],{type:'image/jpeg'}),width:640,height:480,mimeType:'image/jpeg' as const,frameTimeMs:null}}
const calculation={isInsideVideo:true,touchPoint:{norm_x:.25,norm_y:.5,video_pixel_x:200,video_pixel_y:300,video_width:800,video_height:600},viewport:{container_width:800,container_height:600,render_width:800,render_height:600,offset_x:0,offset_y:0,is_letterbox:false},debugInfo:{containerWidth:800,containerHeight:600,renderWidth:800,renderHeight:600,offsetX:0,offsetY:0,isLetterbox:false,clickX:200,clickY:300}}
const response:Interaction={id:'touch-result',book_id:'book',run_id:'run-a',kind:'touch',question:'点击位置',answer:'识别物体：黄瓜。它是一种蔬菜。',transcript:'',video_ms:0,sources:[],latency_ms:30,created_at:'2026-11-21',uncertain:false,origin:'real',recognized:true,cached:false}
class TestVideo {paused=false;currentTime=12.345;pause=vi.fn(()=>{this.paused=true})}

beforeEach(()=>{
  hooks.cursor=0;hooks.slots=[];hooks.effects=[];hooks.dirty=false
  vi.stubGlobal('window',new EventTarget());vi.stubGlobal('document',Object.assign(new EventTarget(),{visibilityState:'visible'}));vi.stubGlobal('HTMLVideoElement',TestVideo)
  vi.mocked(captureFrame).mockReset().mockResolvedValue(shot)
  vi.mocked(calculateImageTouchCoordinates).mockReset().mockReturnValue(calculation)
  vi.mocked(calculateVideoTouchCoordinates).mockReset().mockReturnValue(calculation)
  props={book:{...initialBooks()[0],run_id:'run-a',video_url:null,pages:initialBooks()[0].pages.map(p=>({...p,image_url:'blob:page'}))},state:'success',setState:vi.fn(),navigate:vi.fn(),notify:vi.fn(),interactions:[],onInteraction:vi.fn(),seekTo:null,onSeekHandled:vi.fn(),askQuestion:vi.fn(),identifyTouch:vi.fn().mockResolvedValue(response),appMode:'demo',onReadingPosition:vi.fn()}
})
afterEach(()=>{cleanup();hooks.slots=[];apiClient.enableCloudInteractions('run-a',false);vi.unstubAllGlobals();vi.restoreAllMocks()})


function recorder(){return findBy(n=>n.type===AudioRecorder)}
function recognized(text:string,final=true){recorder().props.onRecordingComplete(new Blob(['audio']), 'audio/wav', text,{durationMs:100,transcriptIsFinal:final,asrErrorCode:null});render()}
function realVideo(){
 props={...props,book:{...props.book,video_url:'blob:video'},appMode:'live'};render()
 const video={readyState:2,duration:90,currentTime:12.345,paused:false,ended:false,pause:vi.fn(()=>{video.paused=true}),play:vi.fn(async()=>{video.paused=false})}
 find('video').ref.current=video;find('video').props.onLoadedMetadata({currentTarget:video});render();video.currentTime=12.345;return video
}
describe('语音从识别到真实动作',()=>{
 it('开始录音不暂停；只有最终暂停口令才触发暂停，不走问答',async()=>{
  const video=realVideo();recorder().props.onRecordingChange(true);render();expect(video.pause).not.toHaveBeenCalled()
  recognized('暂停');await settle();expect(video.pause).toHaveBeenCalledTimes(1);expect(props.askQuestion).not.toHaveBeenCalled()
  expect(findBy(n=>n.props?.['aria-label']==='语音操作结果').props.children).toContain('已执行')
 })
 it('播放、继续真正调用播放；结束停止且归零',async()=>{
  const video=realVideo();video.paused=true
  recognized('播放');await settle();expect(video.play).toHaveBeenCalledTimes(1)
  recognized('暂停');await settle();recognized('继续');await settle();expect(video.play).toHaveBeenCalledTimes(2)
  recognized('结束播放');await settle();expect(video.paused).toBe(true);expect(video.currentTime).toBe(0);expect(props.askQuestion).not.toHaveBeenCalled()
 })
 it('自动语音模式未打开也执行已定稿控制；未定稿不能自动执行',async()=>{
  const video=realVideo();recognized('结束播放',false);await settle();expect(video.pause).not.toHaveBeenCalled();expect(video.currentTime).toBe(12.345)
  find('form').props.onSubmit({preventDefault:vi.fn()});await settle();expect(video.currentTime).toBe(0)
 })
 it('语音场景跳转使用当前书真实时间轴，不生成问答',async()=>{
  props={...props,book:{...props.book,pages:props.book.pages.map((p,i)=>({...p,server_page_no:i+1,confirmed:true,ocr_text:i===1?'黄瓜地里有黄瓜。':'其他原文'}))},segments:[{id:'s',run_id:'run-a',page_no:2,start_ms:30000,end_ms:50000,caption:'黄瓜地',source:{producer:'fixture'}}]}
  const video=realVideo();recognized('找到黄瓜地');await settle();expect(video.currentTime).toBe(30);expect(video.paused).toBe(false);expect(video.play).toHaveBeenCalledTimes(1);expect(props.askQuestion).not.toHaveBeenCalled()
  recognized('暂停');await settle();recognized('找到黄瓜地');await settle();expect(video.paused).toBe(true);expect(video.play).toHaveBeenCalledTimes(1)
 })
 it('找不到场景时显示失败而非伪造定位或问答',async()=>{
  const video=realVideo();recognized('找到不存在的场景');await settle();expect(video.currentTime).toBe(12.345);expect(findBy(n=>n.props?.role==='alert')).toBeTruthy();expect(props.askQuestion).not.toHaveBeenCalled()
 })
 it('框选与看图由语音送到独立功能，并携带当前帧和书范围',async()=>{
  const video=realVideo();recognized('查找“尖尖的”几个字');await settle()
  const request=findBy(n=>n.type===VisualTextFinder).props.voiceRequest;expect(request).toMatchObject({query:'尖尖的',videoMs:12345});expect(request.scope).toBe(findBy(n=>n.type===VisualTextFinder).props.scope)
  recognized('当前画面里有什么？');await settle();expect(findBy(n=>n.type===FrameQuestion).props.voiceRequest).toMatchObject({query:'当前画面里有什么？',videoMs:12345});expect(video.paused).toBe(true);expect(props.askQuestion).not.toHaveBeenCalled()
 })
 it('播放被浏览器拒绝时不报告成功',async()=>{
  const video=realVideo();video.play.mockRejectedValueOnce(new Error('NotAllowed'));recognized('播放');await settle();expect(findBy(n=>n.props?.role==='alert')).toBeTruthy();expect(findBy(n=>n.props?.['aria-label']==='语音操作结果').props.children).not.toContain('已执行')
 })
 it('已挂起收费画面处理时不再执行语音命令',async()=>{
  const video=realVideo();findBy(n=>n.type===FrameQuestion).props.onBusyChange(true);render();recognized('结束播放');await settle();expect(video.currentTime).toBe(12.345);expect(props.askQuestion).not.toHaveBeenCalled()
 })
 it('官方画面问句和高亮口令保持原语种并走实际画面功能',async()=>{
  realVideo();recognized('辣椒什么形状？');await settle()
  expect(findBy(n=>n.type===FrameQuestion).props.voiceRequest.query).toBe('辣椒什么形状？')
  recognized('What jumped out?');await settle()
  expect(findBy(n=>n.type===FrameQuestion).props.voiceRequest.query).toBe('What jumped out?')
  recognized('高亮“小刺猬”几个字');await settle()
  expect(findBy(n=>n.type===VisualTextFinder).props.voiceRequest.query).toBe('小刺猬')
  expect(props.askQuestion).not.toHaveBeenCalled()
 })
 it('跨页边界按实际视频时钟绑定画面请求，不用滞后的界面页码',async()=>{
  props={...props,book:{...props.book,pages:props.book.pages.map((p,i)=>({...p,server_page_no:i+1,confirmed:true}))},segments:[{id:'s',run_id:'run-a',page_no:2,start_ms:30000,end_ms:50000,caption:'场景',source:{producer:'fixture'}}]}
  const video=realVideo();video.currentTime=35
  recognized('What jumped out?');await settle()
  const panel=findBy(n=>n.type===FrameQuestion)
  expect(panel.props.voiceRequest).toMatchObject({videoMs:35000,scope:panel.props.scope})
  expect(panel.props.pageNo).toBe(2)
 })

})
