import { useEffect, useState } from 'react'
import type { GenerationRecords as Records } from '../api/client'
import { apiClient } from '../lib/api'
const statuses:Record<string,string>={QUEUED:'已提交 · 排队中',RUNNING:'处理中',RETRYING:'恢复中',SUCCEEDED:'已完成',FAILED:'失败'}
const stages:Record<string,string>={vision:'图文理解',book_video:'多页视频',video:'单页视频',analysis:'书页分析',analyze:'书页分析'}
export default function GenerationRecords({bookId,api=apiClient}:{bookId:string;api?:{generationRecords:(id:string)=>Promise<Records>}}){
  const [value,setValue]=useState<Records|null>(null)
  const [error,setError]=useState('')
  const [nonce,setNonce]=useState(0)
  useEffect(()=>{
    let stopped=false
    let timer:ReturnType<typeof setTimeout>|undefined
    setValue(null);setError('')
    async function load(){
      try{const next=await api.generationRecords(bookId);if(stopped)return;setValue(next);setError('');timer=setTimeout(load,5000)}
      catch(e){if(!stopped)setError(e instanceof Error?e.message:'无法读取记录')}
    }
    void load()
    return()=>{stopped=true;if(timer)clearTimeout(timer)}
  },[bookId,api,nonce])
  function download(){
    if(!value)return
    const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}))
    const link=document.createElement('a');link.href=url;link.download=`generation-records-${bookId}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  return <section className="generation-records reading-workflow-panel" aria-label="生成与费用记录">
    <h2>生成与费用记录</h2><p>当前书籍 · 包含历史分析运行 · 金额未知（无可信账单）</p>
    <div className="video-generation-actions"><button className="button button-secondary" onClick={()=>setNonce(n=>n+1)}>刷新生成记录</button><button className="button button-ghost" disabled={!value} onClick={download}>导出生成记录</button></div>
    {error&&<p role="alert">读取失败：{error}。旧记录如仍显示，仅供参考；不要据此重复提交。</p>}
    {!value&&!error&&<p role="status">正在读取服务端记录…</p>}
    {value&&<><p>{value.billing_note}</p><p>已记录生成任务：{value.records.length}；已完成 {value.records.filter(r=>r.status==='SUCCEEDED').length}；失败 {value.records.filter(r=>r.status==='FAILED').length}。任务数不是收费调用次数。</p>
      {!value.records.length&&<p>尚无生成任务记录，不表示账号没有其他消费。</p>}
      <div className="generation-record-list">{value.records.map(r=><article key={r.job_id}>
        <h3>{stages[r.stage]??r.stage} · {statuses[r.status]??r.status}</h3>
        <p>{r.created_at} · 运行 {r.run_id} · 任务 {r.job_id}</p>
        <p>{r.page_scope==='submitted'?'提交时书页':'当前书页（历史分析未留存页码快照）'}：{r.page_nos.join('、')||'未记录'}</p>
        {r.submitted_count!==null&&<p>有任务凭据的已提交片段 {r.submitted_count}；有保存记录 {r.downloaded_count}（不代表文件已通过本次完整性检查）；提交结果不明 {r.uncertain_count}。</p>}
        {r.completed_vision_calls!==null&&<p>已记录成功完成的按页图文调用 {r.completed_vision_calls} 次；失败/结果不明调用未计入，不是完整计费次数。</p>}
        {r.submitted_count===null&&r.completed_vision_calls===null&&<p>未记录逐次模型调用，不能从任务数推算费用。</p>}
        <p>配音：{r.narration?'本机中文配音':'不包含'} · 金额未知{r.error_code?` · 错误标识：${r.error_code}`:''}</p>
      </article>)}</div></>}
  </section>
}
