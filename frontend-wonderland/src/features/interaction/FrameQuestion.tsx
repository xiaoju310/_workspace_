import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { apiClient } from '../../lib/api'
import type { FrameQuestionResult } from './frameAnswerTypes'

export interface FrameQuestionProps {
  runId?:string; scope:string; pageNo?:number; live:boolean
  videoRef:RefObject<HTMLVideoElement|null>; imageRef:RefObject<HTMLImageElement|null>
  assetId?:string; assetSha256?:string
  api?:Pick<typeof apiClient,'askFrame'|'getToken'>
}
/** Independent explicit consent: never silently reuse object-recognition consent. */
export function FrameQuestion({runId,scope,pageNo,live,videoRef,imageRef,assetId,assetSha256,api=apiClient}:FrameQuestionProps){
  const [query,setQuery]=useState(''),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false)
  const [result,setResult]=useState<FrameQuestionResult|null>(null),[message,setMessage]=useState('')
  const version=useRef(0),pending=useRef(false),frameTime=useRef<number|null>(null),resultIdentity=useRef('')
  const token=api.getToken()
  const identity=useRef('')
  identity.current=`${scope}:${runId}:${pageNo}:${assetId}:${assetSha256}:${token}:${live}`
  function invalidate(){version.current++;pending.current=false;setBusy(false);setResult(null);setMessage('')}
  useEffect(()=>{
    invalidate();setConsent(false)
    const video=videoRef.current,image=imageRef.current
    const onTime=()=>{if(frameTime.current!==null&&video&&(video.seeking||!video.paused||Math.abs(video.currentTime*1000-frameTime.current)>1))invalidate()}
    const onImage=()=>invalidate()
    video?.addEventListener('seeking',onTime);video?.addEventListener('play',onTime)
    video?.addEventListener('timeupdate',onTime);image?.addEventListener('load',onImage)
    return()=>{version.current++;video?.removeEventListener('seeking',onTime);video?.removeEventListener('play',onTime);video?.removeEventListener('timeupdate',onTime);image?.removeEventListener('load',onImage)}
  },[scope,runId,pageNo,assetId,assetSha256,token,live])
  async function find(){
    if(api.getToken()!==token){invalidate();setConsent(false);return}
    if(pending.current||!live||!runId||!token||!consent||!query.trim())return
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
    pending.current=true;setBusy(true);setResult(null);setMessage('正在依据当前画面回答…')
    try{
      const data=await api.askFrame(runId,{query_text:query.trim(),confirm_paid:true,current_page_no:pageNo,
        video_ms:at,frame_kind:video?'video':'page',asset_id:video?assetId:undefined,asset_sha256:video?assetSha256:undefined})
      if(ticket!==version.current||startedIdentity!==identity.current||startedToken!==api.getToken()||
        (video&&(!video.paused||video.seeking||Math.abs(video.currentTime*1000-at)>1)))return
      resultIdentity.current=startedIdentity;setResult(data)
      setMessage(data.status==='answered'?'已依据本次画面回答，请对照画面核验。':'本次画面不足以可靠回答。')
    }catch(e){if(ticket===version.current)setMessage(e instanceof Error?e.message:'画面问答失败；不会自动重试。')}
    finally{if(ticket===version.current){pending.current=false;setBusy(false)}}
  }
  return <>
    {live&&runId&&<details className="visual-text-finder frame-question" onClick={e=>e.stopPropagation()}>
      <summary>针对当前画面提问</summary>
      <label>关于当前画面的问题<input aria-label="当前画面的问题" maxLength={1000} value={query} disabled={busy} onChange={e=>{invalidate();setQuery(e.target.value)}}/></label>
      <label><input type="checkbox" checked={consent} disabled={busy} onChange={e=>{setConsent(e.target.checked);invalidate()}}/>我同意本次将原书页/服务器抽取的当前帧发送给视觉模型，知道每次提问可能收费。</label>
      <button type="button" disabled={busy||!consent||!query.trim()||!token} onClick={()=>void find()}>{busy?'回答中…':'看当前画面回答'}</button>
      <p>仅依据本次画面，不代替整书问答，不推断前后剧情。播放、跳转或换页后旧回答失效。</p>
      {result&&resultIdentity.current===identity.current&&<p aria-label="当前画面回答">{result.answer}</p>}
      {result&&resultIdentity.current===identity.current&&<p>依据：{result.frame_source==='server_video_frame'?`视频 ${(result.video_ms/1000).toFixed(3)} 秒`:`原书第 ${result.page_no} 页`} · 已保存画面证据</p>}
      {message&&<p role="status">{message}</p>}
    </details>}
  </>
}
