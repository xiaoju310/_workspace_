import { useEffect, useRef, useState } from 'react'
import type { VideoGenerationStatus } from '../api/client'
import { apiClient } from '../lib/api'
import GenerationConfirm from './GenerationConfirm'

const defaultPrompt = '保持原书页的角色形象、画风和场景，制作温柔可爱的儿童绘本动画。人物自然轻微活动，镜头平稳，不新增角色，不改写故事，不生成额外文字。'
export interface VideoGenerationApi {
  videoStatus(runId:string):Promise<VideoGenerationStatus>
  generateVideo(runId:string,input:{page_no:number;prompt:string;duration:5;confirm_paid:boolean}):Promise<VideoGenerationStatus>
  resumeVideo(runId:string):Promise<VideoGenerationStatus>
}

/** 状态从服务器恢复；刷新、断网重试不会新建付费任务。 */
export default function VideoGenerationPanel({runId,pages,onReady,api=apiClient}:{
  runId:string;pages:{page_no:number}[];onReady:()=>void;api?:VideoGenerationApi
}) {
  const [status,setStatus]=useState<VideoGenerationStatus|null>(null)
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  const [pollKey,setPollKey]=useState(0)
  const [pageNo,setPageNo]=useState(pages[0]?.page_no??1)
  const [prompt,setPrompt]=useState(defaultPrompt)
  const [confirmed,setConfirmed]=useState(false)
  const [showConfirm,setShowConfirm]=useState(false)
  const [finalConfirm,setFinalConfirm]=useState<'generate'|'resume'|null>(null)
  const pending=useRef(false)
  const dialog=useRef<HTMLDialogElement>(null)
  const cancelButton=useRef<HTMLButtonElement>(null)
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

  useEffect(()=>{
    if(!showConfirm)return
    const el=dialog.current
    const overflow=document.body.style.overflow
    el?.showModal();cancelButton.current?.focus();document.body.style.overflow='hidden'
    return()=>{el?.close();document.body.style.overflow=overflow}
  },[showConfirm])

  async function submit(resume=false){
    if(pending.current||(!resume&&!confirmed))throw new Error('请先核对并确认当前书页')
    pending.current=true;setBusy(true);setError('')
    try{
      const value=resume?await api.resumeVideo(runId):await api.generateVideo(runId,{page_no:pageNo,prompt:prompt.trim(),duration:5,confirm_paid:true})
      setStatus(value);setShowConfirm(false);setPollKey(k=>k+1)
    }catch(e:any){setError(e.message);throw e}
    finally{pending.current=false;setBusy(false)}
  }
  const working=status?.status==='QUEUED'||status?.status==='RUNNING'
  const message=!status?'正在读取视频状态…':working?'豆包正在生成视频，可以继续阅读；刷新后仍可查看状态。'
    :status.status==='SUCCEEDED'?`第 ${status.page_no} 页的短片已保存到服务器，可在互动阅读页播放。`
    :status.status==='FAILED'?(status.error_message??'视频任务未完成。'):'文字分析不包含视频。可单独为一页书页生成短片。'
  return <section className="video-generation-panel" aria-label="豆包视频生成">
    <div><h2>让书页动起来</h2><p>单页短片 · 5 秒 · 720p · 豆包生成（不是全书视频，无配音）</p></div>
    <p role="status">{message}</p>
    {error&&<p role="alert" className="wf-error">{error}</p>}
    <div className="video-generation-actions">
      {status?.status==='NOT_STARTED'&&<button className="button button-primary" disabled={busy||!pages.length} onClick={()=>{setConfirmed(false);setShowConfirm(true)}}>生成单页视频</button>}
      {status?.can_resume&&<button className="button button-primary" disabled={busy} onClick={()=>setFinalConfirm('resume')}>{busy?'正在恢复…':'继续查询原任务（不重新生成）'}</button>}
      <button className="button button-secondary" disabled={busy} onClick={()=>setPollKey(k=>k+1)}>刷新视频状态</button>
    </div>
    {status?.status==='FAILED'&&!status.can_resume&&<p>为避免重复扣费，本次运行不会自动重新生成。请先在方舟控制台核对任务；确认后可重新分析创建新的运行，再手动生成。</p>}
    {finalConfirm&&<GenerationConfirm plan={{
      title:finalConfirm==='resume'?'确认恢复单页视频':'确认单页视频生成',
      pages:[finalConfirm==='resume'?(status?.page_no??pageNo):pageNo],
      services:finalConfirm==='resume'?['只使用已保存的任务凭据向火山方舟查询并下载原产物，不重新上传书页或动作描述。','不新建视频生成请求；原任务的费用以供应商账单为准。']:['火山方舟豆包视频模型；所选书页和动作描述会发送到该服务。','单页约 5 秒、720p，不另行生成插画。'],
      narration:'不包含',
      reuse:finalConfirm==='resume'?['只查询已保存的供应商任务并下载产物，不新建视频生成请求。','原任务仍可能收费，恢复不等于退费或免单。']:['同一运行已有的视频任务会复用，禁止自动重发。',`动作描述：${prompt.trim()}`],
      warnings:['金额未知，以供应商实际账单为准。网络超时请先刷新状态，不要创建新的运行重复生成。']
    }} onConfirm={()=>submit(finalConfirm==='resume')} onCancel={()=>setFinalConfirm(null)}/>}
    <dialog ref={dialog} className="book-delete-dialog video-generation-dialog" aria-labelledby={`video-confirm-${runId}`} onCancel={e=>{e.preventDefault();if(!busy)setShowConfirm(false)}}>
      {showConfirm&&<div className="book-delete-dialog-content">
        <h2 id={`video-confirm-${runId}`}>设置单页短片</h2>
        <p>将把所选书页和动作描述发送给火山方舟豆包，可能产生费用，具体价格以方舟计费为准。只生成一段 5 秒视频，不额外生成插画。</p>
        <label>选择书页<select aria-label="视频来源书页" value={pageNo} disabled={busy} onChange={e=>setPageNo(Number(e.target.value))}>{pages.map(p=><option key={p.page_no} value={p.page_no}>第 {p.page_no} 页</option>)}</select></label>
        <label>动作描述<textarea aria-label="视频动作描述" value={prompt} maxLength={2000} disabled={busy} onChange={e=>setPrompt(e.target.value)} rows={4}/></label>
        <label className="video-consent"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>我有权使用所选书页，同意发送至豆包，并知晓可能收费。</label>
        {error&&<p role="alert" className="wf-error">{error}</p>}
        <div className="book-delete-dialog-actions"><button ref={cancelButton} className="book-delete-keep" disabled={busy} onClick={()=>setShowConfirm(false)}>暂不生成</button><button className="book-delete-confirm" disabled={busy||!confirmed||!prompt.trim()} onClick={()=>{setShowConfirm(false);setFinalConfirm('generate')}}>{busy?'正在提交…':'查看确认清单'}</button></div>
      </div>}
    </dialog>
  </section>
}
