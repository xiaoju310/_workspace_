import { useEffect, useRef, useState } from 'react'

export interface GenerationPlan {
  title:string
  pages:number[]
  services:string[]
  narration:string
  reuse:string[]
  warnings:string[]
}
export default function GenerationConfirm({plan,onConfirm,onCancel}:{plan:GenerationPlan;onConfirm:()=>Promise<unknown>;onCancel:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null)
  const cancel=useRef<HTMLButtonElement>(null)
  const pending=useRef(false)
  const signature=JSON.stringify(plan)
  const [consent,setConsent]=useState('')
  const accepted=consent===signature
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null
    const overflow=document.body.style.overflow
    dialog.current?.showModal();cancel.current?.focus();document.body.style.overflow='hidden'
    return()=>{dialog.current?.close();document.body.style.overflow=overflow;previous?.focus()}
  },[])
  async function submit(){
    if(!accepted||!plan.pages.length||pending.current||error)return
    pending.current=true;setBusy(true);setError('')
    try{await onConfirm();onCancel()}catch(e){setError(e instanceof Error?e.message:'提交失败，请先刷新任务状态后核对，勿重复生成。')}
    finally{pending.current=false;setBusy(false)}
  }
  return <dialog ref={dialog} className="book-delete-dialog generation-confirm" aria-labelledby="generation-confirm-title" onCancel={e=>{e.preventDefault();if(!pending.current)onCancel()}}>
    <div className="book-delete-dialog-content">
      <h2 id="generation-confirm-title">{plan.title}</h2>
      <h3>本次确认清单</h3>
      <p>处理书页：{plan.pages.length?plan.pages.map(n=>`第 ${n} 页`).join('、'):'无书页（不可提交）'} · 共 {plan.pages.length} 页</p>
      <h3>服务与本机处理</h3><ul>{plan.services.map(s=><li key={s}>{s}</li>)}</ul>
      <p>配音：{plan.narration}</p>
      <h3>复用与恢复</h3><ul>{plan.reuse.map(s=><li key={s}>{s}</li>)}</ul>
      <h3>费用与注意事项</h3><ul>{plan.warnings.map(s=><li key={s}>{s}</li>)}</ul>
      <p>金额未知：尚未接入可信供应商账单，不显示估算价格或“免费额度”。失败不代表未收费。</p>
      <label className="workflow-consent"><input type="checkbox" checked={accepted} disabled={busy} onChange={e=>setConsent(e.target.checked?signature:'')}/>我已核对书页、服务、配音和复用说明，有权使用相关内容，并同意上述处理及可能产生的费用。</label>
      {error&&<p role="alert" className="wf-error">{error}。如提交结果不明，请先取消并刷新记录核对，不要直接重复生成。</p>}
      <div className="book-delete-dialog-actions"><button ref={cancel} className="button button-secondary" disabled={busy} onClick={onCancel}>取消，暂不执行</button><button className="button button-primary" disabled={busy||!accepted||!plan.pages.length||Boolean(error)} onClick={()=>void submit()}>{busy?'正在提交…':'确认清单并执行'}</button></div>
    </div>
  </dialog>
}
