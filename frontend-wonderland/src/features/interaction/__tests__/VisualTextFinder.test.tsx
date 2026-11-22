import { beforeEach,afterEach,describe,expect,it,vi } from 'vitest'
const hooks=vi.hoisted(()=>({cursor:0,slots:[] as any[],effects:[] as (()=>void)[]}))
vi.mock('react',async original=>{
  const real=await original<typeof import('react')>()
  return {...real,
    useState:(initial:any)=>{const i=hooks.cursor++;if(!(i in hooks.slots))hooks.slots[i]={value:typeof initial==='function'?initial():initial};return [hooks.slots[i].value,(next:any)=>{hooks.slots[i].value=typeof next==='function'?next(hooks.slots[i].value):next}]},
    useRef:(initial:any)=>{const i=hooks.cursor++;return hooks.slots[i]??(hooks.slots[i]={current:initial})},
    useEffect:(fn:()=>void|(()=>void),deps?:unknown[])=>{const i=hooks.cursor++,old=hooks.slots[i];if(!old||!deps||deps.some((v,j)=>!Object.is(v,old.deps?.[j]))){const slot={deps,cleanup:old?.cleanup};hooks.slots[i]=slot;hooks.effects.push(()=>{slot.cleanup?.();slot.cleanup=fn()})}}
  }
})
import { VisualTextFinder } from '../VisualTextFinder'
import type { FinderProps } from '../VisualTextFinder'
import { safeTextMatches } from '../visualText'
import type { VisualTextResult } from '../visualText'
import { createApiClient } from '../../../api/client'
import { ApiClient } from '../../../lib/api'
let tree:any,props:FinderProps,token:string
function render(){hooks.cursor=0;tree=VisualTextFinder(props);hooks.effects.splice(0).forEach(fn=>fn());hooks.cursor=0;tree=VisualTextFinder(props)}
function nodes(test:(n:any)=>boolean,node:any=tree):any[]{if(!node||typeof node!=='object')return [];return [...(test(node)?[node]:[]),...[node.props?.children].flat(Infinity).filter(n=>n&&typeof n==='object').flatMap(n=>nodes(test,n))]}
function text(node:any):string{return typeof node==='string'?node:!node||typeof node!=='object'?'':[node.props?.children].flat(Infinity).map(text).join('')}
function btn(){return nodes(n=>n.type==='button')[0]}
function setQuery(q='Hello'){nodes(n=>n.props?.['aria-label']==='查找的原画面文字')[0].props.onChange({target:{value:q}});render()}
function consent(){nodes(n=>n.type==='input'&&n.props.type==='checkbox')[0].props.onChange({target:{checked:true}});render()}
function enable(){setQuery();consent()}
function defer<T>(){let resolve!:(v:T)=>void,reject!:(e:Error)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
const result:VisualTextResult={status:'located',matches:[{text:'Hello',confidence:.9,bounding_box:[.1,.2,.6,.4]}],width:1600,height:900,video_ms:12345,frame_source:'server_video_frame',evidence_asset_id:'evidence',frame_sha256:'hash'}
let events:Map<string,()=>void>,video:any
beforeEach(()=>{
  hooks.cursor=0;hooks.slots=[];hooks.effects=[];token='token';events=new Map()
  video={currentTime:12.345,paused:false,seeking:false,readyState:2,pause:vi.fn(()=>{video.paused=true}),addEventListener:vi.fn((name,fn)=>events.set(name,fn)),removeEventListener:vi.fn((name)=>events.delete(name))}
  props={runId:'r',scope:'book-a',pageNo:1,live:true,assetId:'asset',assetSha256:'a'.repeat(64),videoRef:{current:video},imageRef:{current:null},api:{getToken:()=>token,locateFrameText:vi.fn(async()=>result)}}
  render()
})
afterEach(()=>{hooks.slots.forEach(s=>s?.cleanup?.())})
describe('当前原画面文字定位',()=>{
  it('初始渲染不请求收费模型，独立勾选后才可查找',async()=>{
    expect(props.api!.locateFrameText).not.toHaveBeenCalled();expect(btn().props.disabled).toBe(true)
    setQuery();await btn().props.onClick();expect(props.api!.locateFrameText).not.toHaveBeenCalled()
    consent();expect(btn().props.disabled).toBe(false);await btn().props.onClick();render()
    expect(video.pause).toHaveBeenCalledTimes(1)
    expect(props.api!.locateFrameText).toHaveBeenCalledWith('r',expect.objectContaining({confirm_paid:true,frame_kind:'video',video_ms:12345,asset_id:'asset',asset_sha256:'a'.repeat(64)}))
    const svg=nodes(n=>n.type==='svg')[0];expect(svg.props.viewBox).toBe('0 0 1600 900');expect(svg.props.preserveAspectRatio).toBe('xMidYMid meet')
    const rect=nodes(n=>n.type==='rect')[0];expect(rect.props.x).toBe(160);expect(rect.props.width).toBe(800)
  })
  it('双击不重复提交；暂停产生的同时间timeupdate不会误丢结果',async()=>{
    const pending=defer<VisualTextResult>();props.api!.locateFrameText=vi.fn(()=>pending.promise)
    enable();const click=btn().props.onClick;const first=click();click();events.get('timeupdate')!()
    expect(props.api!.locateFrameText).toHaveBeenCalledTimes(1);pending.resolve(result);await first;render();expect(nodes(n=>n.type==='rect')).toHaveLength(1)
  })
  it.each(['seeking','play','timeupdate'])('%s 后清除旧框并丢弃在途响应',async event=>{
    const pending=defer<VisualTextResult>();props.api!.locateFrameText=vi.fn(()=>pending.promise)
    enable();const first=btn().props.onClick();video.currentTime=20;if(event==='play')video.paused=false;if(event==='seeking')video.seeking=true
    events.get(event)!();pending.resolve(result);await first;render();expect(nodes(n=>n.type==='rect')).toHaveLength(0)
  })
  it('换书使授权和在途结果失效',async()=>{
    const pending=defer<VisualTextResult>();props.api!.locateFrameText=vi.fn(()=>pending.promise)
    enable();const first=btn().props.onClick();props={...props,scope:'book-b',runId:'r2'};render()
    pending.resolve(result);await first;render();expect(nodes(n=>n.type==='rect')).toHaveLength(0);expect(btn().props.disabled).toBe(true)
  })
  it('账号已切换但页面尚未重绘时不沿用旧授权发起请求',async()=>{
    enable();token='another-user';await btn().props.onClick();expect(props.api!.locateFrameText).not.toHaveBeenCalled()
  })
  it('退出登录后旧账号响应不显示',async()=>{
    const pending=defer<VisualTextResult>();props.api!.locateFrameText=vi.fn(()=>pending.promise)
    enable();const first=btn().props.onClick();token='';pending.resolve(result);await first;render();expect(nodes(n=>n.type==='rect')).toHaveLength(0);expect(btn().props.disabled).toBe(true)
  })
  it.each(['hash','asset','loading','seeking'])('视频来源或状态无效时不调用模型：%s',async reason=>{
    if(reason==='hash')props.assetSha256=undefined;if(reason==='asset')props.assetId=undefined;if(reason==='loading')video.readyState=1;if(reason==='seeking')video.seeking=true
    render();enable();await btn().props.onClick();expect(props.api!.locateFrameText).not.toHaveBeenCalled()
  })
  it('静态书页使用服务器原图页码，不上传浏览器替代图',async()=>{
    props={...props,videoRef:{current:null},imageRef:{current:{complete:true,naturalWidth:800,addEventListener:vi.fn(),removeEventListener:vi.fn()} as unknown as HTMLImageElement},assetId:undefined,assetSha256:undefined};render();enable();await btn().props.onClick()
    expect(props.api!.locateFrameText).toHaveBeenCalledWith('r',expect.objectContaining({frame_kind:'page',current_page_no:1,video_ms:0}))
  })
  it('书页缺少服务器页码则拒绝猜测',async()=>{
    props={...props,videoRef:{current:null},imageRef:{current:{complete:true,naturalWidth:800,addEventListener:vi.fn(),removeEventListener:vi.fn()} as unknown as HTMLImageElement},pageNo:undefined};render();enable();await btn().props.onClick();expect(props.api!.locateFrameText).not.toHaveBeenCalled()
  })
  it('失败仅显示提示，不自动重试',async()=>{
    props.api!.locateFrameText=vi.fn(async()=>{throw new Error('本次定位失败')});enable();await btn().props.onClick();render()
    expect(text(tree)).toContain('本次定位失败');expect(props.api!.locateFrameText).toHaveBeenCalledTimes(1)
  })
  it('演示模式不提供真实查找入口',()=>{props.live=false;render();expect(nodes(n=>n.type==='button')).toHaveLength(0)})
  it.each([0,.79,NaN,Infinity])('低或非法置信度不画框 %s',confidence=>{expect(safeTextMatches({...result,matches:[{...result.matches[0],confidence}]},'hello')).toEqual([])})
  it.each([[0,0,0,1],[0,0,2,1],[NaN,0,1,1],[1,0,0,1]])('非法边界不画框 %s',box=>{expect(safeTextMatches({...result,matches:[{...result.matches[0],bounding_box:box as any}]},'hello')).toEqual([])})
  it('不把相似词、未找到或不确定结果标为命中',()=>{
    expect(safeTextMatches(result,'world')).toEqual([]);expect(safeTextMatches({...result,status:'not_found'},'hello')).toEqual([])
    expect(safeTextMatches({...result,status:'uncertain'},'hello')).toEqual([])
  })
  it('传输使用本人后端及登录凭据，保留独立授权',async()=>{
    const fetcher=vi.fn(async()=>new Response(JSON.stringify(result),{status:200}))
    const transport=createApiClient('http://127.0.0.1:8000',{getToken:()=> 'private',fetch:fetcher as typeof fetch})
    await transport.locateFrameText('r/1',{query_text:'hello',confirm_paid:true})
    const [url,init]=fetcher.mock.calls[0] as unknown as [string,RequestInit]
    expect(url).toBe('http://127.0.0.1:8000/api/runs/r%2F1/interaction/text');expect(new Headers(init.headers).get('Authorization')).toBe('Bearer private')
    expect(JSON.parse(init.body as string)).toEqual({query_text:'hello',confirm_paid:true})
  })
  it('业务层无独立同意时不请求',async()=>{const api=new ApiClient();api.setToken('private');await expect(api.locateFrameText('r',{query_text:'hello'})).rejects.toThrow('明确同意')})
})

describe('语音接入与授权隔离',()=>{

  it('语音请求默认不收费；独立授权后新口令只执行一次',async()=>{
    video.paused=true
    props.voiceRequest={id:1,query:'Hello',scope:props.scope,videoMs:12345};render()
    expect(props.api!.locateFrameText).not.toHaveBeenCalled()
    nodes(n=>n.props?.['aria-label']==='语音文字框选收费授权')[0].props.onChange({target:{checked:true}});render()
    expect(props.api!.locateFrameText).not.toHaveBeenCalled()
    props.voiceRequest={...props.voiceRequest,id:2};render();await Promise.resolve();render()
    expect(props.api!.locateFrameText).toHaveBeenCalledTimes(1)
    expect(props.api!.locateFrameText).toHaveBeenCalledWith('r',expect.objectContaining({query_text:'Hello',confirm_paid:true,video_ms:12345}))
    render();expect(props.api!.locateFrameText).toHaveBeenCalledTimes(1)
  })
  it('换书或画面变化后的旧语音请求不发送；授权不能跨书页复用',async()=>{
    nodes(n=>n.props?.['aria-label']==='语音文字框选收费授权')[0].props.onChange({target:{checked:true}});render()
    video.paused=true;video.currentTime=20
    props.voiceRequest={id:1,query:'Hello',scope:props.scope,videoMs:12345};render();expect(props.api!.locateFrameText).not.toHaveBeenCalled()
    props.scope='different-book';props.voiceRequest={id:2,query:'Hello',scope:'book-a',videoMs:20000};render()
    expect(props.api!.locateFrameText).not.toHaveBeenCalled();expect(nodes(n=>n.props?.['aria-label']==='语音文字框选收费授权')[0].props.checked).toBe(false)
  })
  it('换书与新语音同一轮到达时也不能使用上本书授权',()=>{
    nodes(n=>n.props?.['aria-label']==='语音文字框选收费授权')[0].props.onChange({target:{checked:true}});render()
    video.paused=true
    props={...props,scope:'new-book',authorizationScope:'new-book',runId:'new-run',voiceRequest:{id:100,query:'当前画面',scope:'new-book',videoMs:12345}};render()
    expect(props.api!.locateFrameText).not.toHaveBeenCalled()
  })
  it('同书换页保留语音授权，但重新登录立即失效',async()=>{
    props.authorizationScope='same-book';render()
    nodes(n=>n.props?.['aria-label']==='语音文字框选收费授权')[0].props.onChange({target:{checked:true}});render()
    video.paused=true;props={...props,scope:'page-two',pageNo:2,voiceRequest:{id:100,query:'Hello',scope:'page-two',videoMs:12345}};render();await Promise.resolve();render()
    expect(props.api!.locateFrameText).toHaveBeenCalledTimes(1)
    token='new-login';props.voiceRequest={id:101,query:'Hello',scope:'page-two',videoMs:12345};render()
    expect(props.api!.locateFrameText).toHaveBeenCalledTimes(1)
  })

})
