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
  props={book:{...initialBooks()[0],run_id:'run-a',video_url:null,pages:initialBooks()[0].pages.map(p=>({...p,image_url:'blob:page'}))},state:'success',setState:vi.fn(),navigate:vi.fn(),notify:vi.fn(),interactions:[],onInteraction:vi.fn(),seekTo:null,onSeekHandled:vi.fn(),askQuestion:vi.fn(),identifyTouch:vi.fn().mockResolvedValue(response),appMode:'demo',onReadingPosition:vi.fn()}
})
afterEach(()=>{cleanup();hooks.slots=[];apiClient.enableCloudInteractions('run-a',false);vi.unstubAllGlobals();vi.restoreAllMocks()})

describe('点击识物阅读流程',()=>{
  it('默认不启用；开启后点击静态书页暂停自动播放，记录位置并展示结果',async()=>{
    render();find('img').ref.current={};click();expect(captureFrame).not.toHaveBeenCalled()
    button('开始播放').props.onClick();render();expect(button('暂停播放')).toBeTruthy()
    button('点击识物').props.onClick();render();find('img').ref.current={};click();render()
    expect(button('开始播放').props.disabled).toBe(true)
    expect(findBy(n=>n.props?.['aria-label']==='已选择的识物位置').props.style).toEqual({left:'25%',top:'50%'})
    await settle()
    expect(props.identifyTouch).toHaveBeenCalledTimes(1)
    const args=vi.mocked(props.identifyTouch).mock.calls[0]
    expect(args.slice(0,4)).toEqual([.25,.5,0,{width:800,height:600}])
    expect(args[4]?.frame).toMatchObject({kind:'page_image',page_no:1,paused_on_click:true})
    expect(button('开始播放').props.disabled).toBe(false)
    expect(findBy(n=>n.props?.className==='reader-touch-panel')).toBeTruthy()
    expect(props.onInteraction).toHaveBeenCalledWith(response)
  })
  it('视频先暂停并读取实际帧时间，不采用滞后的进度状态',async()=>{
    props={...props,book:{...props.book,video_url:'blob:video'},segments};start()
    const video=new TestVideo();find('video').ref.current=video;click();await settle()
    expect(video.pause).toHaveBeenCalledTimes(1)
    expect(vi.mocked(props.identifyTouch).mock.calls[0][2]).toBe(12345)
    expect(vi.mocked(props.identifyTouch).mock.calls[0][4]?.frame).toMatchObject({kind:'video',page_no:2,paused_on_click:true})
  })
  it('截图期间连续点击只处理一次，也不允许同时提问',async()=>{
    const pending=deferred<typeof shot>();vi.mocked(captureFrame).mockReturnValue(pending.promise)
    start().ref.current={};click();click()
    find('form').props.onSubmit({preventDefault:vi.fn()})
    expect(captureFrame).toHaveBeenCalledTimes(1);expect(props.askQuestion).not.toHaveBeenCalled()
    pending.resolve(shot);await settle();expect(props.identifyTouch).toHaveBeenCalledTimes(1)
  })
  it('拦截黑边与未就绪图片，不发识别请求',async()=>{
    vi.mocked(calculateImageTouchCoordinates).mockReturnValue({...calculation,isInsideVideo:false,reason:'请点击图片内的物体'})
    start().ref.current={};click();await settle()
    expect(captureFrame).not.toHaveBeenCalled();expect(props.identifyTouch).not.toHaveBeenCalled()
    expect(findBy(n=>n.props?.role==='alert')).toBeTruthy()
  })
  it('占位插画不作为原书页进行识物',async()=>{
    props={...props,book:{...props.book,pages:props.book.pages.map(p=>({...p,image_url:''}))}}
    start().ref.current={};click();await settle();expect(captureFrame).not.toHaveBeenCalled();expect(props.identifyTouch).not.toHaveBeenCalled()
  })
  it('失败重试沿用原坐标、截图、页码，不重新截图',async()=>{
    vi.mocked(props.identifyTouch).mockRejectedValueOnce(new Error('识物服务未配置'))
    start().ref.current={};click();await settle()
    const first=vi.mocked(props.identifyTouch).mock.calls[0]
    button('重试这次操作').props.onClick();await settle()
    const second=vi.mocked(props.identifyTouch).mock.calls[1]
    expect(second.slice(0,4)).toEqual(first.slice(0,4));expect(second[4]?.frame?.snapshot).toBe(first[4]?.frame?.snapshot)
    expect(second[4]?.frame?.page_no).toBe(1);expect(second[4]?.frame?.clicked_at).toBeUndefined();expect(captureFrame).toHaveBeenCalledTimes(1)
  })
  it('截图返回前翻页，不再发送旧页识别请求',async()=>{
    const pending=deferred<typeof shot>();vi.mocked(captureFrame).mockReturnValue(pending.promise)
    start().ref.current={};click();find('input').props.onChange({target:{value:'12000'}});render()
    pending.resolve(shot);await settle();expect(props.identifyTouch).not.toHaveBeenCalled();expect(button('退出识物').props.disabled).toBe(false)
  })
  it('识别返回前翻页，不展示或登记迟到的旧结果',async()=>{
    const pending=deferred<Interaction>();vi.mocked(props.identifyTouch).mockReturnValue(pending.promise)
    start().ref.current={};click();await settle();find('input').props.onChange({target:{value:'12000'}});render()
    pending.resolve(response);await settle();expect(props.onInteraction).not.toHaveBeenCalled();expect(findBy(n=>n.props?.['aria-label']==='已选择的识物位置')).toBeNull()
  })
  it('离开阅读页后完成截图，不调用模型',async()=>{
    const pending=deferred<typeof shot>();vi.mocked(captureFrame).mockReturnValue(pending.promise)
    start().ref.current={};click();cleanup();pending.resolve(shot);await settle();expect(props.identifyTouch).not.toHaveBeenCalled()
  })
  it('截图异常可恢复，不产生未处理异常或卡在加载中',async()=>{
    vi.mocked(captureFrame).mockRejectedValueOnce(new Error('canvas failed'))
    start().ref.current={};click();await settle();expect(button('退出识物').props.disabled).toBe(false);expect(props.identifyTouch).not.toHaveBeenCalled()
  })
  it('专注阅读仍显示画面下方识物结果',async()=>{
    props={...props,focusMode:true};start().ref.current={};click();await settle()
    expect(find('aside').props.hidden).toBe(true)
    expect(findBy(n=>n.props?.className==='reader-touch-panel').props.hidden).not.toBe(true)
    expect(findBy(n=>n.type==='strong'&&n.props.children==='识物结果')).toBeTruthy()
  })
  it('云端授权必须手动勾选，开启识物模式本身不授权',async()=>{
    props={...props,appMode:'live',book:{...props.book,server_book_id:'server-book'}}
    vi.spyOn(apiClient,'speechCapabilities').mockResolvedValue({asr_available:false} as any)
    start();expect(apiClient.cloudInteractionsEnabled('run-a')).toBe(false)
    const consent=findBy(n=>n.type==='input'&&n.props.type==='checkbox'&&n.props.checked===false&&n.props.disabled===false)
    consent.props.onChange({target:{checked:true}});render();expect(apiClient.cloudInteractionsEnabled('run-a')).toBe(true)
    findBy(n=>n.type==='input'&&n.props.type==='checkbox'&&n.props.checked===true).props.onChange({target:{checked:false}})
    expect(apiClient.cloudInteractionsEnabled('run-a')).toBe(false);expect(props.identifyTouch).not.toHaveBeenCalled()
  })
  it('工坊中更改云端授权，阅读页开关同步更新',()=>{
    props={...props,appMode:'live',book:{...props.book,server_book_id:'server-book'}}
    vi.spyOn(apiClient,'speechCapabilities').mockResolvedValue({asr_available:false} as any)
    start();apiClient.enableCloudInteractions('run-a',true);render()
    expect(findBy(n=>n.props?.className==='reader-touch-consent').props.children[0].props.checked).toBe(true)
    apiClient.setToken('changed-user');render()
    expect(findBy(n=>n.props?.className==='reader-touch-consent').props.children[0].props.checked).toBe(false)
  })
  it('旧截图迟到不会解除新点击的锁或重复调用',async()=>{
    const old=deferred<typeof shot>(),fresh=deferred<typeof shot>()
    vi.mocked(captureFrame).mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
    start().ref.current={};click();find('input').props.onChange({target:{value:'12000'}});render();click();render()
    old.resolve(shot);await settle();expect(button('退出识物').props.disabled).toBe(true);click()
    expect(captureFrame).toHaveBeenCalledTimes(2);fresh.resolve(shot);await settle();expect(props.identifyTouch).toHaveBeenCalledTimes(1)
    expect(vi.mocked(props.identifyTouch).mock.calls[0][4]?.frame?.page_no).toBe(2)
  })

})


describe('自动语音问答',()=>{
  function recorder(){return findBy(n=>n.type?.name==='AudioRecorder')}
  function optIn(){findBy(n=>n.props?.['aria-label']==='自动语音问答').props.onChange({target:{checked:true}});render()}
  function record(text='乌龟在哪里？',meta={}){recorder().props.onRecordingComplete(new Blob(['voice']),'audio/wav',text,{durationMs:800,recordingStoppedAt:performance.now(),asrCompletedAt:performance.now(),transcriptIsFinal:true,...meta})}
  function player(){return findBy(n=>n.type?.name==='TtsPlayerWidget')}
  it('默认仍需确认，不会直接提交录音',()=>{
    render();record();render();expect(props.askQuestion).not.toHaveBeenCalled()
    expect(find('textarea').props.value).toBe('乌龟在哪里？')
  })
  it('主动开启后定稿即提交，答案自动朗读；重复回调不篡改首次指标',async()=>{
    vi.mocked(props.askQuestion).mockResolvedValue({...response,id:'voice-answer',kind:'question'})
    render();optIn();record();await settle()
    expect(props.askQuestion).toHaveBeenCalledTimes(1)
    expect(vi.mocked(props.askQuestion).mock.calls[0][2]).toBe('speech')
    expect(player().props.autoPlayKey).toBeTruthy()
    player().props.onPlaybackStart();render()
    const status=()=>findBy(n=>n.props?.['aria-label']==='自动语音统计')
    expect(status().props.children.filter((v:any)=>typeof v==='string'||typeof v==='number').join('')).toContain('1/1')
    player().props.onPlaybackError();render()
    expect(status().props.children.filter((v:any)=>typeof v==='string'||typeof v==='number').join('')).toContain('1/1')
  })
  it('未定稿与识别错误不自动发送，失败仍进入总样本',()=>{
    render();optIn();record('部分文字',{transcriptIsFinal:false});render()
    record('识别文字',{asrErrorCode:'TRANSCRIPTION_NETWORK_ERROR'});render()
    record('',{asrErrorCode:'NO_SPEECH_DETECTED'});render()
    expect(props.askQuestion).not.toHaveBeenCalled()
    expect(findBy(n=>n.props?.['aria-label']==='自动语音统计').props.children.filter((v:any)=>typeof v==='string'||typeof v==='number').join('')).toContain('0/3')
  })
  it('请求失败不自动朗读；快速重复回调只提交一次',async()=>{
    const pending=deferred<Interaction>();vi.mocked(props.askQuestion).mockReturnValue(pending.promise)
    render();optIn();record();record();render()
    expect(props.askQuestion).toHaveBeenCalledTimes(1)
    pending.reject(new Error('服务未就绪'));await settle()
    expect(player()).toBeNull()
    expect(findBy(n=>n.props?.['aria-label']==='自动语音统计').props.children.filter((v:any)=>typeof v==='string'||typeof v==='number').join('')).toContain('0/1')
  })
  it('换书后拒绝旧录音回调和旧答案，自动开关与统计重置',async()=>{
    const pending=deferred<Interaction>();vi.mocked(props.askQuestion).mockReturnValue(pending.promise)
    render();optIn();const oldRecorder=recorder();record();render()
    props={...props,book:{...props.book,id:'other-book',run_id:'other-run'}};render()
    oldRecorder.props.onRecordingComplete(new Blob(['voice']),'audio/wav','旧书问题',{durationMs:100,transcriptIsFinal:true})
    pending.resolve(response);await settle()
    expect(props.askQuestion).toHaveBeenCalledTimes(1);expect(props.onInteraction).not.toHaveBeenCalled()
    expect(findBy(n=>n.props?.['aria-label']==='自动语音问答').props.checked).toBe(false)
    expect(findBy(n=>n.props?.['aria-label']==='自动语音统计')).toBeNull()
  })
  it('切换语言会替换录音会话并拒绝旧语言结果',()=>{
    render();optIn();const oldRecorder=recorder()
    findBy(n=>n.props?.['aria-label']==='提问语言').props.onChange({target:{value:'en-US'}});render()
    expect(recorder().props.language).toBe('en-US');expect(recorder().key).not.toBe(oldRecorder.key)
    oldRecorder.props.onRecordingComplete(new Blob(['voice']),'audio/wav','旧结果',{durationMs:100,transcriptIsFinal:true})
    expect(props.askQuestion).not.toHaveBeenCalled()
  })
})
