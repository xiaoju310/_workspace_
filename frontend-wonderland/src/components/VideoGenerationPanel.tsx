import { useEffect, useRef, useState } from 'react'
import type { VideoGenerationStatus } from '../api/client'
import { apiClient } from '../lib/api'
import GenerationConfirm from './GenerationConfirm'

export interface VideoGenerationApi {
  videoStatus(runId:string):Promise<VideoGenerationStatus>
  resumeVideo(runId:string):Promise<VideoGenerationStatus>
}

/** 仅兼容查询历史单页任务；新视频统一由故事工坊生成全部分镜。 */
export default function VideoGenerationPanel({runId,onReady,api=apiClient}:{
  runId:string;pages:{page_no:number}[];onReady:()=>void;api?:VideoGenerationApi
}) {
  const [status,setStatus]=useState<VideoGenerationStatus|null>(null)
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  const [pollKey,setPollKey]=useState(0)
  const [showResume,setShowResume]=useState(false)
  const pending=useRef(false)
  const readyCallback=useRef(onReady)
  const readyAsset=useRef('')
  readyCallback.current=onReady

  useEffect(()=>{
    let stopped=false
    let timer:ReturnType<typeof setTimeout>|undefined
    const tick=async()=>{
      try {
        const value=await api.videoStatus(runId)
        if(stopped)return
        setStatus(value);setError('')
        if(value.status==='SUCCEEDED'&&value.asset_id&&readyAsset.current!==value.asset_id){
          readyAsset.current=value.asset_id;readyCallback.current()
        }
        if(value.status==='QUEUED'||value.status==='RUNNING')timer=setTimeout(tick,3000)
      }catch(e:any){if(!stopped)setError(`读取视频状态失败：${e.message}。可重新查询，不会提交新任务。`)}
    }
    void tick()
    return()=>{stopped=true;if(timer)clearTimeout(timer)}
  },[runId,api,pollKey])

  async function resume(){
    if(pending.current||!status?.can_resume)throw new Error('当前没有可查询的历史视频任务')
    pending.current=true;setBusy(true);setError('')
    try{
      const value=await api.resumeVideo(runId)
      setStatus(value);setPollKey(k=>k+1)
    }catch(e:any){setError(e.message);throw e}
    finally{pending.current=false;setBusy(false)}
  }
  const working=status?.status==='QUEUED'||status?.status==='RUNNING'
  const message=working?'正在查询历史单页任务，可以继续阅读；刷新后仍可查看状态。'
    :status?.status==='SUCCEEDED'?`第 ${status.page_no} 页的历史短片已保存到服务器，可在互动阅读页播放。`
    :status?.error_message??'历史视频任务未完成。'
  if((!status||status.status==='NOT_STARTED')&&!error)return null
  return <section className="video-generation-panel" aria-label="历史单页视频记录">
    <div><h2>历史单页视频记录</h2><p>此处只查询旧任务。新视频请在故事工坊中使用“一键生成全部视频”。</p></div>
    <p role="status">{message}</p>
    {error&&<p role="alert" className="wf-error">{error}</p>}
    <div className="video-generation-actions">
      {status?.can_resume&&<button className="button button-primary" disabled={busy} onClick={()=>setShowResume(true)}>{busy?'正在恢复…':'继续查询原任务（不重新生成）'}</button>}
      <button className="button button-secondary" disabled={busy} onClick={()=>setPollKey(k=>k+1)}>刷新视频状态</button>
    </div>
    {status?.status==='FAILED'&&!status.can_resume&&<p>旧任务无法继续查询，请先核对原任务记录。生成整书视频请使用故事工坊中的全部视频入口。</p>}
    {showResume&&status?.page_no&&<GenerationConfirm plan={{
      title:'确认查询历史单页视频',
      pages:[status.page_no],
      services:['只使用已保存的任务凭据向火山方舟查询并下载原产物，不重新上传书页或动作描述。','不新建视频生成请求；原任务的费用以供应商账单为准。'],
      narration:'不包含',
      reuse:['只查询已保存的供应商任务并下载产物，不新建视频生成请求。','原任务仍可能收费，恢复不等于退费或免单。'],
      warnings:['金额未知，以供应商实际账单为准。网络超时请先刷新状态，不要创建新的运行重复生成。']
    }} onConfirm={resume} onCancel={()=>setShowResume(false)}/>}
  </section>
}
