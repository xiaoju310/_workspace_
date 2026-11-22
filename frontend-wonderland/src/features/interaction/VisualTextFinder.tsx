import type { FrameVoiceRequest } from './readerIntent'
import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { apiClient } from '../../lib/api'
import { safeTextMatches } from './visualText'
import type { VisualTextResult } from './visualText'

export interface FinderProps {
  authorizationScope?:string; canStart?:()=>boolean; voiceRequest?:FrameVoiceRequest | null; onBusyChange?:(busy:boolean)=>void
  runId?:string; scope:string; pageNo?:number; live:boolean
  videoRef:RefObject<HTMLVideoElement|null>; imageRef:RefObject<HTMLImageElement|null>
  assetId?:string; assetSha256?:string
  api?:Pick<typeof apiClient,'locateFrameText'|'getToken'>
}
/** Independent explicit consent: never silently reuse object-recognition consent. */
export function VisualTextFinder({runId,scope,pageNo,live,videoRef,imageRef,assetId,assetSha256,voiceRequest,authorizationScope,canStart,onBusyChange,api=apiClient}:FinderProps){
  const [query,setQuery]=useState(''),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false)
  const [result,setResult]=useState<VisualTextResult|null>(null),[message,setMessage]=useState('')
  const version=useRef(0),pending=useRef(false),frameTime=useRef<number|null>(null),resultIdentity=useRef('')
  const [voiceAuthorization,setVoiceAuthorization]=useState<string|null>(null)
  const consumedVoice=useRef<number|null>(null)
  const token=api.getToken()
  const voiceAuthorizationKey=JSON.stringify([authorizationScope??scope,runId,assetId,assetSha256,token,live])
  // Bind consent during render as well: effects must not reuse old consent on a new book/login.
  const voiceConsent=voiceAuthorization===voiceAuthorizationKey
  const identity=useRef('')
  identity.current=`${scope}:${runId}:${pageNo}:${assetId}:${assetSha256}:${token}:${live}`
  const matches=result&&resultIdentity.current===identity.current?safeTextMatches(result,query):[]
  function invalidate(){onBusyChange?.(false);version.current++;pending.current=false;setBusy(false);setResult(null);setMessage('')}
  useEffect(()=>{
    invalidate();setConsent(false)
    const video=videoRef.current,image=imageRef.current
    const onTime=()=>{if(frameTime.current!==null&&video&&(video.seeking||!video.paused||Math.abs(video.currentTime*1000-frameTime.current)>1))invalidate()}
    const onImage=()=>invalidate()
    video?.addEventListener('seeking',onTime);video?.addEventListener('play',onTime)
    video?.addEventListener('timeupdate',onTime);image?.addEventListener('load',onImage)
    return()=>{onBusyChange?.(false);version.current++;video?.removeEventListener('seeking',onTime);video?.removeEventListener('play',onTime);video?.removeEventListener('timeupdate',onTime);image?.removeEventListener('load',onImage)}
  },[scope,runId,pageNo,assetId,assetSha256,token,live])
  useEffect(()=>{setVoiceAuthorization(null)},[authorizationScope??scope,runId,assetId,assetSha256,token,live])
  useEffect(()=>{
    if(!voiceRequest || consumedVoice.current===voiceRequest.id || voiceRequest.scope!==scope)return
    consumedVoice.current=voiceRequest.id
    invalidate();setQuery(voiceRequest.query)
    const video=videoRef.current
    if(video && (voiceRequest.videoMs===null || Math.abs(video.currentTime*1000-voiceRequest.videoMs)>1 || !video.paused)){
      setMessage('画面已经变化，请在目标画面重新发出语音指令。');return
    }
    if(!voiceConsent){setMessage('已接收语音请求；请先确认本书语音画面处理的收费授权，再点击执行或重新发出指令。');return}
    void find(voiceRequest.query,true)
  },[voiceRequest?.id,scope])
  async function find(requestQuery=query,fromVoice=false){

    if(api.getToken()!==token){invalidate();setConsent(false);return}
    if(pending.current||!live||!runId||!token||!(fromVoice?voiceConsent:consent)||!requestQuery.trim())return
    if(canStart&&!canStart()){setMessage('另一项交互正在处理，请稍后重试；本次没有发送收费请求。');return}
    const video=videoRef.current,image=imageRef.current
    if(video&&(!assetId||!assetSha256||video.readyState<2||video.seeking)){
      setMessage('视频尚未就绪或缺少已登记来源，请刷新后重试。');return
    }
    if(!video&&!pageNo){setMessage('当前书页缺少可靠的服务器页码，请重新打开已同步书页。');return}
    if(!video&&(!image?.complete||!image.naturalWidth)){setMessage('请等待原始书页加载完成。');return}
    video?.pause()
    const at=video?Math.round(video.currentTime*1000):0
    frameTime.current=at
    const ticket=++version.current,startedIdentity=identity.current,startedToken=api.getToken()
    pending.current=true;setBusy(true);onBusyChange?.(true);setResult(null);setMessage('正在查找当前原画面文字…')
    try{
      const data=await api.locateFrameText(runId,{query_text:requestQuery.trim(),confirm_paid:true,current_page_no:pageNo,
        video_ms:at,frame_kind:video?'video':'page',asset_id:video?assetId:undefined,asset_sha256:video?assetSha256:undefined})
      if(ticket!==version.current||startedIdentity!==identity.current||startedToken!==api.getToken()||
        (video&&(!video.paused||video.seeking||Math.abs(video.currentTime*1000-at)>1)))return
      resultIdentity.current=startedIdentity;setResult(data)
      setMessage(safeTextMatches(data,requestQuery).length?'已框出模型定位结果，请对照原画面核验。':data.status==='not_found'?'当前原画面未找到该文字。':'当前画面文字不清晰或位置不可靠，未框选。')
    }catch(e){if(ticket===version.current)setMessage(e instanceof Error?e.message:'文字定位失败；不会自动重试。')}
    finally{if(ticket===version.current){pending.current=false;setBusy(false);onBusyChange?.(false)}}
  }
  return <>
    {result&&matches.length>0&&<svg className="touch-object-overlay visual-text-overlay" viewBox={`0 0 ${result.width} ${result.height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="原画面文字定位（模型结果待核验）">
      {matches.map((match,index)=>{const [l,t,r,b]=match.bounding_box;return <rect key={index} x={l*result.width} y={t*result.height} width={(r-l)*result.width} height={(b-t)*result.height} fill="rgba(250,204,21,.18)" stroke="#facc15" strokeWidth="3" vectorEffect="non-scaling-stroke"/>})}
    </svg>}
    {live&&runId&&<details open={voiceRequest?.scope===scope || undefined} className="visual-text-finder" onClick={e=>e.stopPropagation()}>
      <summary>查找当前画面原有文字</summary>
      <label>文字或单词<input aria-label="查找的原画面文字" maxLength={100} value={query} disabled={busy} onChange={e=>{invalidate();setQuery(e.target.value)}}/></label>
      <label><input type="checkbox" checked={consent} disabled={busy} onChange={e=>{setConsent(e.target.checked);invalidate()}}/>我同意本次将原书页/服务器抽取的当前帧发送给视觉模型，知道每次查找可能收费。</label>
      <label><input aria-label="语音文字框选收费授权" type="checkbox" checked={voiceConsent} disabled={busy} onChange={e=>setVoiceAuthorization(e.target.checked?voiceAuthorizationKey:null)}/>允许本书通过语音触发文字框选；每次会将当前原画面发送给视觉模型，可能收费（换书、换视频或重新登录后失效）。</label>
      <button type="button" disabled={busy||!(consent||(voiceRequest?.scope===scope&&voiceConsent))||!query.trim()||!token} onClick={()=>void find(query,Boolean(voiceRequest?.scope===scope&&voiceConsent))}>{busy?'查找中…':'查找并框选'}</button>
      <p>仅查找当前画面，不搜索整段视频，不用字幕代替。播放、跳转或换页后旧结果失效。</p>
      {message&&<p role="status">{message}</p>}
    </details>}
  </>
}
