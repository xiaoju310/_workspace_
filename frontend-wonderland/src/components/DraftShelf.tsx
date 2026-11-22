import { useEffect, useState } from 'react'
import { draftStore } from '../features/books/draftStore'
import type { DraftSummary } from '../features/books/draftStore'
import { Button } from './ui'

export default function DraftShelf({scope,onOpen}:{scope:string;onOpen:(id:string)=>void}){
  const [drafts,setDrafts]=useState<DraftSummary[]>([])
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  useEffect(()=>{let stale=false;void draftStore.listImports(scope).then(d=>{if(!stale)setDrafts(d)}).catch((e:Error)=>{if(!stale)setError(e.message)});return()=>{stale=true}},[scope])
  async function remove(id:string){
    if(!window.confirm('确定删除这份导入草稿及其中尚未转入书架的原图吗？此操作不可恢复。'))return
    setBusy(true)
    try{await draftStore.deleteImport(scope,id);setDrafts(await draftStore.listImports(scope));setError('')}
    catch(e:any){setError(`删除失败：${e.message}`)}finally{setBusy(false)}
  }
  if(!drafts.length&&!error)return null
  return <section className="page-content draft-shelf" aria-label="我的导入草稿"><div className="paper-card"><h2>我的导入草稿</h2><p>尚未完成的书在这里等你。已经导入的书可在下方书架继续校对和阅读。</p>{error&&<p role="alert">草稿读取或操作失败：{error}</p>}{drafts.map(d=><div className="draft-row" key={d.id}><div><strong>{d.title}</strong><p>{d.pageCount} 页 · {new Date(d.updatedAt).toLocaleString()}</p></div><Button disabled={busy} onClick={()=>onOpen(d.id)}>继续草稿</Button><Button disabled={busy} variant="ghost" onClick={()=>{void remove(d.id)}}>删除草稿</Button></div>)}</div></section>
}
