import { useRef, useState } from 'react'
import type { RunVideoState } from '../app/types'
import { Button, Icon } from './ui'

/** 主人先预览已有产物；只有明确确认后才开放互动，不替用户同意云端调用。 */
export default function OwnerVideoPreview({videoState,onReload,onReview,onConfirmReview}:{
  videoState?:RunVideoState;onReload?:()=>void;onReview:()=>void;onConfirmReview?:()=>void
}) {
  const [playbackError,setPlaybackError]=useState(false)
  const [reviewed,setReviewed]=useState(false)
  const submitted=useRef(false)
  const canConfirm=reviewed&&videoState?.status==='ready'&&!playbackError&&Boolean(onConfirmReview)
  function confirmReview() {
    if(!canConfirm||submitted.current)return
    submitted.current=true
    onConfirmReview?.()
  }
  return <section className="owner-video-preview paper-card paper-card--lg" aria-label="主人视频预览与内容复核">
    <h2>{videoState?.status==='ready'?'你的视频已生成，先播放检查内容。':'正在准备视频预览。'}</h2>
    <p>当前仍待主人内容复核，不代表视频生成失败。可先查看已保存的视频；确认原书忠实度、配音和适龄内容后，再开启互动伴读。预览不会重新生成或调用收费功能。</p>
    {videoState?.status==='ready'?<>
      <video aria-label="已生成视频（主人复核预览）" src={videoState.url} controls playsInline preload="metadata" onError={()=>{setPlaybackError(true);setReviewed(false)}} />
      {playbackError&&<p role="alert">视频暂时无法播放，请重新读取已保存的视频；不要重新生成。</p>}
    </>:<p role={videoState?.status==='error'?'alert':'status'}>
      {videoState?.status==='loading'?'正在读取本次运行已保存的视频，请稍候…':videoState?.status==='error'?'读取已保存视频失败，请重新检查。不会自动重试生成。':'本次运行尚未读取到已保存的视频，请查看生成记录或重新检查。'}
    </p>}
    {onConfirmReview&&<div className="owner-video-preview__review">
      <h3>在这里确认内容复核</h3>
      <label className="owner-video-preview__check">
        <input type="checkbox" checked={reviewed} disabled={videoState?.status!=='ready'||playbackError}
          onChange={event=>setReviewed(event.target.checked)} />
        <span>我已检查本次视频，确认原书主要人物、情节与场景无重要遗漏，配音和内容适龄，同意进入互动伴读。</span>
      </label>
      <Button disabled={!canConfirm} onClick={confirmReview}>确认内容复核并进入互动伴读<Icon name="arrow" size={17}/></Button>
      <p>这只记录你的内容复核，不代表平台审核通过，也不会开启可能收费的云端问答或识物。</p>
    </div>}
    <div className="wf-actions">
      {onReload&&videoState?.status!=='loading'&&<Button variant="secondary" onClick={onReload}>重新读取已保存视频</Button>}
      <Button variant="secondary" onClick={onReview}>查看生成进度与复核记录<Icon name="arrow" size={17}/></Button>
    </div>
    <p>仅播放不会修改复核状态，也不会自动开启云端问答与认物。</p>
  </section>
}
