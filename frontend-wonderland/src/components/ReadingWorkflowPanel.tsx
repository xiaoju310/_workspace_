import { useEffect, useRef, useState } from 'react'
import type { Storyboard, WorkflowStatus } from '../api/client'
import { apiClient } from '../lib/api'
import GenerationConfirm from './GenerationConfirm'
import { workflowPlan } from '../features/books/generationPlan'

export interface ReadingWorkflowApi {
  workflow(runId:string):Promise<WorkflowStatus>
  understandPages(runId:string,pages:number[],options?:{fast_mode:boolean;concurrency:number}):Promise<unknown>
  resumeVision?(runId:string):Promise<unknown>
  reuseVision?(runId:string):Promise<unknown>
  retryUncertainVision?(runId:string,pages:number[],options?:{fast_mode:boolean;concurrency:number}):Promise<unknown>
  makeStoryboard(runId:string):Promise<unknown>
  saveStoryboard(runId:string,revision:number,story:Storyboard):Promise<unknown>
  approveStoryboard(runId:string,revision:number,coverageConfirmed?:boolean):Promise<unknown>
  generateBookVideo(runId:string,narration?:boolean):Promise<unknown>
  resumeBookVideo(runId:string):Promise<unknown>
  enableCloudInteractions(runId:string,enabled:boolean):void
  subscribeCloudInteractions?:(listener:()=>void)=>(()=>void)
  cloudInteractionsEnabled(runId:string):boolean
  getAssetContent?(runId:string,assetId:string):Promise<Blob>
}

/** 云端操作均由主人主动触发；刷新只读状态，不自动重新请求收费模型。 */
export default function ReadingWorkflowPanel({runId,pages,onReady,api=apiClient}:{
  runId:string;pages:{page_no:number}[];onReady:()=>void;api?:ReadingWorkflowApi
}) {
  const [value,setValue]=useState<WorkflowStatus|null>(null)
  const [coverageConfirmed,setCoverageConfirmed]=useState(false)
  const [error,setError]=useState('')
  const [confirmation,setConfirmation]=useState<'vision'|'vision-resume'|'vision-retry'|'video'|'resume'|null>(null)
  const [busy,setBusy]=useState(false)
  const [selected,setSelected]=useState(pages.slice(0,12).map(p=>p.page_no))
  const [visionConsent,setVisionConsent]=useState(false)
  const [fastMode,setFastMode]=useState(true)
  const [concurrency,setConcurrency]=useState(2)
  const [videoConsent,setVideoConsent]=useState(false)
  const [narration,setNarration]=useState(true)
  const [cloud,setCloud]=useState(api.cloudInteractionsEnabled(runId))
  const [draft,setDraft]=useState<Storyboard|null>(null)
  const [dirty,setDirty]=useState(false)
  const [nonce,setNonce]=useState(0)
  const pending=useRef(false)
  const revision=useRef(-1)
  const ready=useRef('')
  const callback=useRef(onReady)
  callback.current=onReady
  useEffect(()=>{
    let stopped=false
    let timer:ReturnType<typeof setTimeout>|undefined
    const tick=async()=>{
      try{
        const status=await api.workflow(runId)
        if(stopped)return
        setValue(status)
        if(status.revision!==revision.current){
          revision.current=status.revision;setDraft(status.storyboard);setDirty(false);setCoverageConfirmed(false)
        }
        if(status.asset_id&&ready.current!==status.asset_id){ready.current=status.asset_id;callback.current()}
        if(status.tasks.some(t=>['QUEUED','RUNNING','RETRYING'].includes(t.status)))timer=setTimeout(tick,3000)
      }catch(e:any){if(!stopped)setError(e.message)}
    }
    void tick()
    return()=>{stopped=true;if(timer)clearTimeout(timer)}
  },[runId,api,nonce])
  useEffect(()=>{
    const sync=()=>setCloud(api.cloudInteractionsEnabled(runId))
    sync()
    return api.subscribeCloudInteractions?.(sync)
  },[api,runId])
  async function action(fn:()=>Promise<unknown>){
    if(pending.current)return
    pending.current=true;setBusy(true);setError('')
    try{await fn();setNonce(n=>n+1)}catch(e:any){setError(e.message)}finally{pending.current=false;setBusy(false)}
  }
  function patch(index:number,key:'caption'|'prompt',text:string){
    if(!draft)return
    setDraft({...draft,shots:draft.shots.map((s,i)=>i===index?{...s,[key]:text}:s)});setDirty(true)
  }
  function mergeNext(index:number){
    if(!draft||!draft.shots[index+1])return
    const first=draft.shots[index],next=draft.shots[index+1]
    const caption=first.caption+'；'+next.caption,prompt=first.prompt+'；接着表现：'+next.prompt
    if(caption.length>1200||prompt.length>2000){setError('合镜描述超出长度限制，请先精简相关镜头描述；没有自动删减原文。');return}
    const merged={...first,caption,prompt,source_page_nos:[...(first.source_page_nos??[first.page_no]),...(next.source_page_nos??[next.page_no])]}
    setDraft({...draft,shots:[...draft.shots.slice(0,index),merged,...draft.shots.slice(index+2)]});setDirty(true);setCoverageConfirmed(false)
  }
  const coverageComplete=value?.coverage?.complete??false
  const active=value?.tasks.some(t=>['QUEUED','RUNNING','RETRYING'].includes(t.status))
  const video=value?.tasks.find(t=>t.stage==='book_video')
  const vision=value?.tasks.filter(t=>t.stage==='vision'||t.stage.startsWith('vision_')).at(-1)
  const analyzed=new Set(value?.vision?.map(p=>p.page_no)??[])
  const attempted=new Set(value?.vision_progress?.map(p=>p.page_no)??[])
  const freshSelected=selected.filter(n=>!analyzed.has(n)&&!attempted.has(n))
  const resumeJob=value?.tasks.find(t=>t.status==='FAILED'&&value.vision_progress?.some(p=>p.job_id===t.job_id&&p.status==='PENDING'))?.job_id
  const resumePages=value?.vision_progress?.filter(p=>p.job_id===resumeJob&&p.status==='PENDING').map(p=>p.page_no)??[]
  const uncertainPages=value?.vision_progress?.filter(p=>p.status==='UNCERTAIN').map(p=>p.page_no)??[]
  const reusablePages=value?.reusable_vision_page_nos??[]
  const retryPages=uncertainPages.filter(n=>!reusablePages.includes(n))
  const visionBlocked=Boolean(video)||(value?.source_current===false&&Boolean(value?.vision))||(!value?.vision_progress&&Boolean(value?.tasks.some(t=>(t.stage==='vision'||t.stage.startsWith('vision_'))&&t.status==='FAILED')))
  const locked=busy||Boolean(active)
  const labels:Record<string,string>={QUEUED:'排队中',RUNNING:'处理中',RETRYING:'恢复中',SUCCEEDED:'已完成',FAILED:'未完成'}
  async function downloadEvidence(assetId:string){
    if(!api.getAssetContent)return
    await action(async()=>{
      const blob=await api.getAssetContent!(runId,assetId)
      const url=URL.createObjectURL(blob)
      const link=document.createElement('a');link.href=url;link.download=`frame-evidence-${assetId}.${blob.type==='image/png'?'png':'jpg'}`;link.click()
      setTimeout(()=>URL.revokeObjectURL(url),1000)
    })
  }
  function exportWorkflow(){
    if(!value)return
    const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}))
    const link=document.createElement('a');link.href=url;link.download=`reading-workflow-${runId}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  async function confirmedAction(){
    if(!confirmation||!value||pending.current||active)throw new Error('任务状态已变化，请刷新核对')
    if(confirmation==='vision'&&(visionBlocked||!freshSelected.length||freshSelected.length>12))throw new Error('分析批次或来源已变化，请刷新核对')
    if(confirmation==='vision-resume'&&(visionBlocked||!value.vision_resume_available||!api.resumeVision||!resumePages.length))throw new Error('没有可继续的未发送页，请刷新核对')
    if(confirmation==='vision-retry'&&(visionBlocked||!api.retryUncertainVision||!retryPages.length))throw new Error('没有需要重新分析的结果不明页，请刷新核对')
    if(!['vision','vision-resume','vision-retry'].includes(confirmation)&&(dirty||!value.approved||!value.source_current||!coverageComplete))throw new Error('分镜或书页已变化，请重新确认')
    if(confirmation==='video'&&narration&&!value.capabilities.narration_available)throw new Error('本机中文配音尚未就绪，请检查语音组件后刷新进度')
    pending.current=true;setBusy(true);setError('')
    try{
      if(confirmation==='vision')await api.understandPages(runId,freshSelected,{fast_mode:fastMode,concurrency})
      else if(confirmation==='vision-resume')await api.resumeVision!(runId)
      else if(confirmation==='vision-retry')await api.retryUncertainVision!(runId,retryPages,{fast_mode:fastMode,concurrency})
      else if(confirmation==='video')await api.generateBookVideo(runId,narration)
      else await api.resumeBookVideo(runId)
      setNonce(n=>n+1)
    }finally{pending.current=false;setBusy(false)}
  }
  return <section className="reading-workflow-panel" aria-label="图文理解与分镜">
    <div className="workflow-heading"><div><h2>猫头鹰的故事工坊</h2><p>看懂书页 → 检查分镜 → 主人确认 → 一键生成全部视频 → 合成完整视频（可选本机中文配音）</p></div><button className="button button-ghost" disabled={busy} onClick={()=>setNonce(n=>n+1)}>刷新进度</button></div>
    {confirmation&&value&&<GenerationConfirm plan={workflowPlan(confirmation,value,confirmation==='vision'?freshSelected:confirmation==='vision-resume'?resumePages:confirmation==='vision-retry'?retryPages:(value.storyboard?.shots.flatMap(s=>s.source_page_nos??[s.page_no])??[]),narration,{fast_mode:fastMode,concurrency})} onConfirm={confirmedAction} onCancel={()=>setConfirmation(null)}/>}
    {!value&&<p role="status">正在读取故事工坊…</p>}
    {error&&<p role="alert" className="wf-error">{error}</p>}
    {value&&<>
      {!value.capabilities.vision_configured&&<p className="workflow-warning">尚未配置“视觉理解模型”。已有作图、视频模型不等于看图模型。请提供方舟控制台中实际可用的视觉模型编号，再由本机 scripts/configure-vision-model.ps1 安全保存（不填写密钥、不试调用收费接口）。仅检测配置是否存在，不代表已验证权限；本地文字阅读仍可正常使用。</p>}
      <details open={!value.vision}>
        <summary>1 · 图文理解（每批最多 12 页，可分批补齐全书）</summary>
        <p>用于识别角色、场景和事件。图片会发送到豆包，结果仍需主人检查。不覆盖你校对的原文。</p>
        <button className="button button-ghost" disabled={locked||visionBlocked} onClick={()=>{setSelected(pages.filter(p=>!analyzed.has(p.page_no)&&!attempted.has(p.page_no)).slice(0,12).map(p=>p.page_no));setVisionConsent(false)}}>选择下一批未分析页</button>
        <div className="workflow-page-list">{pages.map(p=><label key={p.page_no}><input type="checkbox" checked={selected.includes(p.page_no)} disabled={locked||visionBlocked||analyzed.has(p.page_no)||attempted.has(p.page_no)} onChange={e=>{setVisionConsent(false);setSelected(s=>e.target.checked?s.length<12?[...s,p.page_no].sort((a,b)=>a-b):s:s.filter(n=>n!==p.page_no))}}/>第 {p.page_no} 页{analyzed.has(p.page_no)?'（已分析）':attempted.has(p.page_no)?'（已在任务中）':''}</label>)}</div>
        <label className="workflow-consent"><input type="checkbox" checked={fastMode} disabled={locked} onChange={e=>{setFastMode(e.target.checked);setVisionConsent(false)}}/>快速模式（默认开启）：减少分析等待，结果仍需核对原图。</label>
        <label>同时分析页数 <select aria-label="同时分析页数" value={concurrency} disabled={locked} onChange={e=>{setConcurrency(Number(e.target.value));setVisionConsent(false)}}>{[1,2,3].map(n=><option key={n} value={n}>{n} 页</option>)}</select></label>
        <label className="workflow-consent"><input type="checkbox" checked={visionConsent} disabled={locked} onChange={e=>setVisionConsent(e.target.checked)}/>我同意将所选 {freshSelected.length} 页发给豆包做图文理解，知道可能按页收费。</label>
        <button className="button button-primary" disabled={locked||!visionConsent||!freshSelected.length||!value.capabilities.vision_configured||visionBlocked} onClick={()=>setConfirmation('vision')}>理解所选书页</button>
        {vision&&<p role="status">图文理解：{labels[vision.status]??vision.status}。已分析 {analyzed.size} / {pages.length} 页。可继续选择未分析页，每批单独确认；失败或结果不明不会自动重发。</p>}
        {value.vision_resume_available&&api.resumeVision&&<button className="button button-secondary" disabled={locked||visionBlocked||!value.capabilities.vision_configured} onClick={()=>setConfirmation('vision-resume')}>继续未发送书页</button>}
        {!!reusablePages.length&&api.reuseVision&&<button className="button button-secondary" disabled={locked||visionBlocked} onClick={()=>action(()=>api.reuseVision!(runId))}>免费复用已有分析：第 {reusablePages.join('、')} 页</button>}
        {!!retryPages.length&&api.retryUncertainVision&&<button className="button button-secondary" disabled={locked||visionBlocked||!value.capabilities.vision_configured} onClick={()=>setConfirmation('vision-retry')}>核对后重新分析结果不明页：第 {retryPages.join('、')} 页</button>}
        {!!value.vision_progress?.length&&<details><summary>逐页分析进度与耗时</summary>{value.vision_progress.map(p=><p key={p.page_no}>第 {p.page_no} 页：{({PENDING:'未发送',SUBMITTING:'分析中',UNCERTAIN:'结果不明，请核对请求记录',SUCCEEDED:'已保存'} as Record<string,string>)[p.status]??p.status}{p.diagnostics.elapsed_ms!==undefined?` · ${(p.diagnostics.elapsed_ms/1000).toFixed(1)} 秒`:''}{p.diagnostics.error_code?` · ${p.diagnostics.error_code}`:''}{p.diagnostics.http_status?` · HTTP ${p.diagnostics.http_status}`:''}{p.diagnostics.request_id?` · 请求 ${p.diagnostics.request_id}`:''}</p>)}</details>}
      </details>
      {value.vision&&<details><summary>查看图文分析（待人工复核）</summary>{value.vision.map(p=><article className="workflow-meaning" key={p.page_no}><h3>第 {p.page_no} 页{p.uncertain?' · 有不确定内容':''}</h3><p>{p.summary}</p><p>场景：{p.scene}</p><p>角色：{p.entities.map(e=>`${e.name}（${e.description}）`).join('；')||'未可靠识别'}</p><p>事件：{p.events.join('；')||'未可靠识别'}</p></article>)}</details>}
      <details open={Boolean(draft)}><summary>2 · 编辑和确认分镜（本步骤不收费）</summary>
        {!draft&&<button className="button button-secondary" disabled={locked||!value.vision||!value.source_current} onClick={()=>action(()=>api.makeStoryboard(runId))}>根据书页分析整理分镜</button>}
        {draft&&<>
          <section aria-label="逐页覆盖检查"><h3>逐页覆盖检查（包括重要无字情节）</h3>
            <p>目前保守检查全部导入页，不自动排除封面、版权页或无字页。长书请逐批分析所有导入页，再重新整理分镜并逐页复核；新增分析会使旧分镜确认失效。</p>
            {value.coverage?.pages.map(p=><p key={p.page_no}>第 {p.page_no} 页 → {p.shot_numbers.length?`镜头 ${p.shot_numbers.join('、')}`:'尚未覆盖'}</p>)}
            {!coverageComplete&&<p role="alert">逐页覆盖未通过：未覆盖 {value.coverage?.missing_page_nos.join('、')||'待检查'}；未分析 {value.coverage?.unanalyzed_page_nos.join('、')||'无'}。不能确认或开始整书生成。</p>}
            <p>来源映射不证明画面已经体现全部情节。跨页合镜仍以主来源页图片生成，须人工确认其他来源页的重要内容在描述和实际成片中体现。</p>
            <label><input type="checkbox" checked={coverageConfirmed} disabled={locked||dirty||Boolean(video)||!coverageComplete} onChange={e=>setCoverageConfirmed(e.target.checked)}/>我已逐页核对分镜，确认重要人物、事件、场景和重要无字情节均有所体现。</label>
          </section>
          <label className="workflow-field">跨页角色设定<textarea value={draft.character_guide} maxLength={2000} disabled={locked||Boolean(video)} onChange={e=>{setDraft({...draft,character_guide:e.target.value});setDirty(true)}}/></label>
          {draft.shots.map((shot,index)=><article className="workflow-shot" key={shot.page_no}><h3>镜头 {index+1} · 主来源：第 {shot.page_no} 页</h3>{index<draft.shots.length-1&&<button type="button" disabled={locked||Boolean(video)} onClick={()=>mergeNext(index)}>与下一镜合并并保留来源页</button>}<label className="workflow-field">覆盖的来源页（跨页合镜填逗号分隔页码；主来源页须为首个页码）<input aria-label={`镜头 ${index+1} 来源页`} value={(shot.source_page_nos??[shot.page_no]).join(',')} disabled={locked||Boolean(video)} onChange={e=>{const ns=e.target.value.split(/[,，\s]+/).filter(Boolean).map(Number);setDraft({...draft,shots:draft.shots.map((s,i)=>i===index?{...s,source_page_nos:ns}:s)});setDirty(true);setCoverageConfirmed(false)}}/></label><label className="workflow-field">故事内容<textarea value={shot.caption} maxLength={1200} disabled={locked||Boolean(video)} onChange={e=>patch(index,'caption',e.target.value)}/></label><label className="workflow-field">动画动作描述<textarea value={shot.prompt} maxLength={2000} disabled={locked||Boolean(video)} onChange={e=>patch(index,'prompt',e.target.value)}/></label></article>)}
          <p>角色设定会复用于所有片段，但不能保证模型完全一致，请逐段检查人物、内容与儿童适宜性。</p>
          <div className="video-generation-actions"><button className="button button-secondary" disabled={locked||!dirty||Boolean(video)} onClick={()=>action(async()=>{await api.saveStoryboard(runId,value.revision,draft);revision.current=-1})}>保存分镜修改</button><button className="button button-primary" disabled={locked||dirty||value.approved||Boolean(video)||!value.source_current||!coverageComplete||!coverageConfirmed} onClick={()=>action(()=>api.approveStoryboard(runId,value.revision,coverageConfirmed))}>{value.approved?'主人已确认当前分镜':'我已检查内容，确认当前分镜'}</button></div>
          {dirty&&<p>有未保存修改，请先保存，再确认。</p>}
          {!value.source_current&&<p role="alert">书页已被重新校对，原分析和分镜已失效，不会继续生成。</p>}
        </>}
      </details>
      <details open={Boolean(draft)}><summary>3 · 一键生成全部视频</summary>
        <p>一次确认后，系统自动按顺序生成全部 {draft?.shots.length??0} 个已确认分镜的视频，再合成完整视频，无需逐页点击。每个分镜约 5 秒，片段分别计费；全部导入页须已分析并通过分镜覆盖检查。遇到失败会保存进度，恢复时复用已提交片段。</p>
        {!value.capabilities.composition_available&&<p className="workflow-warning">视频合成工具尚未就绪。系统会在收费前拦截，请先在服务器配置 FFMPEG_PATH。</p>}
        <label className="workflow-consent"><input type="checkbox" checked={video?(value.narration??narration):narration} disabled={locked||Boolean(video)} onChange={e=>setNarration(e.target.checked)}/>添加本机中文配音（默认开启）：朗读已确认分镜的“故事内容”，不调用收费语音服务。配音较长时会延长末帧，避免截断；恢复任务沿用首次选择。</label>
        {!video&&narration&&value.capabilities.narration_available&&<p role="status">中文配音已就绪：整书生成时自动朗读每个分镜的故事内容，并将声音合入最终视频。</p>}
        {!value.capabilities.narration_available&&<p role="alert">本机中文配音未就绪；请检查 Windows 中文语音组件及服务器运行环境，再刷新进度。已选择配音时不能提交生成；如需无声视频，请明确取消配音选项。</p>}
        <label className="workflow-consent"><input type="checkbox" checked={videoConsent} disabled={locked} onChange={e=>setVideoConsent(e.target.checked)}/>我确认分镜已经检查，允许发送相关书页，并承担多个视频片段的费用。恢复时尚未提交的片段也会收费。</label>
        {!video&&<button className="button button-primary" disabled={locked||dirty||!coverageComplete||!value.approved||!videoConsent||!value.capabilities.video_configured||!value.capabilities.composition_available||(narration&&!value.capabilities.narration_available)} onClick={()=>setConfirmation('video')}>一键生成全部视频</button>}
        {video?.status==='FAILED'&&!['PROVIDER_TERMINAL','SUBMISSION_UNCERTAIN'].includes(video.error_code??'')&&<button className="button button-secondary" disabled={locked||!videoConsent} onClick={()=>setConfirmation('resume')}>继续生成剩余视频</button>}
        {!!value.clips.length&&<p role="status">片段进度：已下载 {value.clips.filter(c=>c.downloaded).length} / {value.clips.length}；已提交 {value.clips.filter(c=>c.submitted).length} / {value.clips.length}。</p>}
        {value.asset_id&&<p role="status">已合成并保存，可在互动阅读中播放。时间轴按实际解码后的片段长度生成。</p>}
      </details>
      <details><summary>4 · 可选：开启豆包问答与点击认物</summary><p>只在你本次开启期间，将每次问题或点击画面发送给豆包。每次可能收费；刷新页面或退出登录后需要重新授权。长书会从全书文字及已有图文分析中选取最相关的最多 12 页，并记录检索页码；这不是逐页穷尽总结。视频点击优先由服务器抽取真实帧，识别截图及来源将随本书产物保存，供主人导出核对。没有开启时继续使用本地文字问答，不伪装视觉识别。</p><label className="workflow-consent"><input type="checkbox" checked={cloud} disabled={!value.capabilities.vision_configured} onChange={e=>{setCloud(e.target.checked);api.enableCloudInteractions(runId,e.target.checked)}}/>我同意本次使用云端问答与认物，知道会上传书中内容/当前画面并可能按次收费。</label></details>
      <div className="workflow-task-list">{value.tasks.map(t=><p key={t.stage}><strong>{(t.stage==='vision'||t.stage.startsWith('vision_'))?'图文理解':'多页视频'}</strong>：{labels[t.status]??t.status}{t.error_message&&<span role="alert"> · {t.error_message}</span>}</p>)}</div>
      {api.getAssetContent&&(value.events??[]).filter(e=>e.event==='touch_evidence_saved'||e.event==='text_evidence_saved'||e.event==='frame_qa_evidence_saved').map((event,index)=>{
        let record:{asset_id?:string;frame_source?:string;page_no?:number}={}
        try{record=JSON.parse(event.safe_metadata_json)}catch{return null}
        return record.asset_id?<p key={record.asset_id}>{event.event==='frame_qa_evidence_saved'?'画面问答':event.event==='text_evidence_saved'?'文字定位':'认物'}证据 {index+1} · 第 {record.page_no} 页 · {record.frame_source==='server_video_frame'?'服务器真实视频帧':record.frame_source==='server_original_page'?'原始书页':'浏览器截图（来源未核验）'} <button className="button button-ghost" disabled={locked} onClick={()=>downloadEvidence(record.asset_id!)}>下载证据画面</button></p>:null
      })}
      <button className="button button-ghost" onClick={exportWorkflow}>导出分析、分镜和流程记录</button>
    </>}
  </section>
}
