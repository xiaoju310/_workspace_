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
import { FrameQuestion } from '../FrameQuestion'
import type { FrameQuestionProps } from '../FrameQuestion'
import type { FrameQuestionResult } from '../frameAnswerTypes'
import { createApiClient } from '../../../api/client'
import { ApiClient } from '../../../lib/api'
let tree:any,props:FrameQuestionProps,token:string
function render(){hooks.cursor=0;tree=FrameQuestion(props);hooks.effects.splice(0).forEach(fn=>fn());hooks.cursor=0;tree=FrameQuestion(props)}
function nodes(test:(n:any)=>boolean,node:any=tree):any[]{if(!node||typeof node!=='object')return [];return [...(test(node)?[node]:[]),...[node.props?.children].flat(Infinity).filter(n=>n&&typeof n==='object').flatMap(n=>nodes(test,n))]}
function text(node:any):string{return typeof node==='string'?node:!node||typeof node!=='object'?'':[node.props?.children].flat(Infinity).map(text).join('')}
function btn(){return nodes(n=>n.type==='button')[0]}
function setQuery(q='画面里有什么？'){nodes(n=>n.props?.['aria-label']==='当前画面的问题')[0].props.onChange({target:{value:q}});render()}
function consent(){nodes(n=>n.type==='input'&&n.props.type==='checkbox')[0].props.onChange({target:{checked:true}});render()}
function enable(){setQuery();consent()}
function defer<T>(){let resolve!:(v:T)=>void,reject!:(e:Error)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
const result:FrameQuestionResult={status:'answered',answer:'可见一只乌龟。',confidence:.9,page_no:2,width:1600,height:900,video_ms:12345,frame_source:'server_video_frame',evidence_asset_id:'evidence',frame_sha256:'hash'}
let events:Map<string,()=>void>,video:any
beforeEach(()=>{
  hooks.cursor=0;hooks.slots=[];hooks.effects=[];token='token';events=new Map()
  video={currentTime:12.345,paused:false,seeking:false,readyState:2,pause:vi.fn(()=>{video.paused=true}),addEventListener:vi.fn((name,fn)=>events.set(name,fn)),removeEventListener:vi.fn((name)=>events.delete(name))}
  props={runId:'r',scope:'book-a',pageNo:1,live:true,assetId:'asset',assetSha256:'a'.repeat(64),videoRef:{current:video},imageRef:{current:null},api:{getToken:()=>token,askFrame:vi.fn(async()=>result)}}
  render()
})
afterEach(()=>{hooks.slots.forEach(s=>s?.cleanup?.())})
describe('指定画面看图问答',()=>{
  it('初始渲染不请求收费模型，独立勾选后才可提问',async()=>{
    expect(props.api!.askFrame).not.toHaveBeenCalled();expect(btn().props.disabled).toBe(true)
    setQuery();await btn().props.onClick();expect(props.api!.askFrame).not.toHaveBeenCalled()
    consent();expect(btn().props.disabled).toBe(false);await btn().props.onClick();render()
    expect(video.pause).toHaveBeenCalledTimes(1)
    expect(props.api!.askFrame).toHaveBeenCalledWith('r',expect.objectContaining({confirm_paid:true,frame_kind:'video',video_ms:12345,asset_id:'asset',asset_sha256:'a'.repeat(64)}))
    expect(text(tree)).toContain('可见一只乌龟。');expect(text(tree)).toContain('12.345 秒')
  })
  it('双击不重复提交；暂停产生的同时间timeupdate不会误丢结果',async()=>{
    const pending=defer<FrameQuestionResult>();props.api!.askFrame=vi.fn(()=>pending.promise)
    enable();const click=btn().props.onClick;const first=click();click();events.get('timeupdate')!()
    expect(props.api!.askFrame).toHaveBeenCalledTimes(1);pending.resolve(result);await first;render();expect(text(tree)).toContain('可见一只乌龟。')
  })
  it.each(['seeking','play','timeupdate'])('%s 后清除旧回答并丢弃在途响应',async event=>{
    const pending=defer<FrameQuestionResult>();props.api!.askFrame=vi.fn(()=>pending.promise)
    enable();const first=btn().props.onClick();video.currentTime=20;if(event==='play')video.paused=false;if(event==='seeking')video.seeking=true
    events.get(event)!();pending.resolve(result);await first;render();expect(text(tree)).not.toContain('可见一只乌龟。')
  })
  it('换书使授权和在途结果失效',async()=>{
    const pending=defer<FrameQuestionResult>();props.api!.askFrame=vi.fn(()=>pending.promise)
    enable();const first=btn().props.onClick();props={...props,scope:'book-b',runId:'r2'};render()
    pending.resolve(result);await first;render();expect(text(tree)).not.toContain('可见一只乌龟。');expect(btn().props.disabled).toBe(true)
  })
  it('账号已切换但页面尚未重绘时不沿用旧授权发起请求',async()=>{
    enable();token='another-user';await btn().props.onClick();expect(props.api!.askFrame).not.toHaveBeenCalled()
  })
  it('退出登录后旧账号响应不显示',async()=>{
    const pending=defer<FrameQuestionResult>();props.api!.askFrame=vi.fn(()=>pending.promise)
    enable();const first=btn().props.onClick();token='';pending.resolve(result);await first;render();expect(text(tree)).not.toContain('可见一只乌龟。');expect(btn().props.disabled).toBe(true)
  })
  it.each(['hash','asset','loading','seeking'])('视频来源或状态无效时不调用模型：%s',async reason=>{
    if(reason==='hash')props.assetSha256=undefined;if(reason==='asset')props.assetId=undefined;if(reason==='loading')video.readyState=1;if(reason==='seeking')video.seeking=true
    render();enable();await btn().props.onClick();expect(props.api!.askFrame).not.toHaveBeenCalled()
  })
  it('静态书页使用服务器原图页码，不上传浏览器替代图',async()=>{
    props={...props,videoRef:{current:null},imageRef:{current:{complete:true,naturalWidth:800,addEventListener:vi.fn(),removeEventListener:vi.fn()} as unknown as HTMLImageElement},assetId:undefined,assetSha256:undefined};render();enable();await btn().props.onClick()
    expect(props.api!.askFrame).toHaveBeenCalledWith('r',expect.objectContaining({frame_kind:'page',current_page_no:1,video_ms:0}))
  })
  it('书页缺少服务器页码则拒绝猜测',async()=>{
    props={...props,videoRef:{current:null},imageRef:{current:{complete:true,naturalWidth:800,addEventListener:vi.fn(),removeEventListener:vi.fn()} as unknown as HTMLImageElement},pageNo:undefined};render();enable();await btn().props.onClick();expect(props.api!.askFrame).not.toHaveBeenCalled()
  })
  it('失败仅显示提示，不自动重试',async()=>{
    props.api!.askFrame=vi.fn(async()=>{throw new Error('本次画面问答失败')});enable();await btn().props.onClick();render()
    expect(text(tree)).toContain('本次画面问答失败');expect(props.api!.askFrame).toHaveBeenCalledTimes(1)
  })
  it('演示模式不提供真实画面问答入口',()=>{props.live=false;render();expect(nodes(n=>n.type==='button')).toHaveLength(0)})
  it('改变问题后不显示旧回答',async()=>{enable();await btn().props.onClick();render();setQuery('另一问题');expect(text(tree)).not.toContain('可见一只乌龟。')})
  it('不确定时诚实显示画面不足以回答',async()=>{props.api!.askFrame=vi.fn(async()=>({...result,status:'uncertain' as const,answer:'仅凭当前画面无法可靠回答'}));enable();await btn().props.onClick();render();expect(text(tree)).toContain('不足以可靠回答')})
  it('传输使用本人后端及登录凭据，保留独立授权',async()=>{
    const fetcher=vi.fn(async()=>new Response(JSON.stringify(result),{status:200}))
    const transport=createApiClient('http://127.0.0.1:8000',{getToken:()=> 'private',fetch:fetcher as typeof fetch})
    await transport.askFrame('r/1',{query_text:'画面里有什么？',confirm_paid:true})
    const [url,init]=fetcher.mock.calls[0] as unknown as [string,RequestInit]
    expect(url).toBe('http://127.0.0.1:8000/api/runs/r%2F1/interaction/frame-qa');expect(new Headers(init.headers).get('Authorization')).toBe('Bearer private')
    expect(JSON.parse(init.body as string)).toEqual({query_text:'画面里有什么？',confirm_paid:true})
  })
  it('业务层无独立同意时不请求',async()=>{const api=new ApiClient();api.setToken('private');await expect(api.askFrame('r',{query_text:'画面里有什么？'})).rejects.toThrow('明确同意')})
})
