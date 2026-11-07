import { useEffect, useRef, useState } from 'react'
import { ApiError, createApiClient } from '../api/client'
import type { ApiBookType, BookResponse, ClassificationResponse, JobResponse, PageResponse, ProgressResponse, NoteResponse, ShareResponse } from '../api/client'
import { validatePage } from '../features/books/import'
import { Button, Icon } from './ui'

const typeNames:Record<ApiBookType,string>={picture_book:'绘本',novel:'小说',textbook:'教材',science:'科普',other:'其他'}

export default function BackendWorkbench(){
  const [address,setAddress]=useState('/backend-api')
  const [token,setToken]=useState('')
  const [title,setTitle]=useState('')
  const [authorization,setAuthorization]=useState('')
  const [authorized,setAuthorized]=useState(false)
  const [files,setFiles]=useState<File[]>([])
  const [book,setBook]=useState<BookResponse|null>(null)
  const [pages,setPages]=useState<PageResponse[]>([])
  const [classification,setClassification]=useState<ClassificationResponse|null>(null)
  const [confirmedType,setConfirmedType]=useState<ApiBookType>('picture_book')
  const [pageNo,setPageNo]=useState(1)
  const [ocr,setOcr]=useState('')
  const [job,setJob]=useState<JobResponse|null>(null)
  const [progress,setProgress]=useState<ProgressResponse|null>(null)

  // 角色 C: 交互与笔记联调状态
  const [interactionQuery, setInteractionQuery]=useState('小狐狸戴着什么颜色的围巾？')
  const [interactionRecords, setInteractionRecords]=useState<Record<string, unknown>[]>([])
  const [noteDraft, setNoteDraft]=useState<NoteResponse|null>(null)
  const [shares, setShares]=useState<ShareResponse[]>([])

  const [busy,setBusy]=useState('')
  const [message,setMessage]=useState('')
  const [error,setError]=useState('')
  const tokenRef=useRef(token);tokenRef.current=token
  const locked=useRef(false)
  const mounted=useRef(true)

  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;tokenRef.current=''}},[])

  function client(){
    if(location.protocol==='file:')throw new Error('真实联调请通过 Vite 本地服务打开，离线 HTML 仅用于模拟。')
    const base=address.trim()==='/backend-api'?new URL('/backend-api',location.origin).href:address.trim()
    return createApiClient(base,{getToken:()=>tokenRef.current})
  }

  async function execute(label:string,action:()=>Promise<void>){
    if(locked.current)return
    locked.current=true;setBusy(label);setError('');setMessage('')
    try{await action()}catch(cause){if(mounted.current)setError(cause instanceof ApiError?`HTTP ${cause.status||'—'} · ${cause.code}：${cause.message}`:cause instanceof Error?cause.message:'请求失败，请重试。')}
    finally{locked.current=false;if(mounted.current)setBusy('')}
  }

  async function selectFiles(next:File[]){
    await execute('检查图片',async()=>{
      if(book)throw new Error('已建书后文件顺序固定，请清空当前联调再选择新文件。')
      if(next.length>24)throw new Error('一次最多选择 24 张图片。')
      setFiles([])
      for(const file of next){const reason=await validatePage(file);if(reason)throw new Error(reason)}
      setFiles(next);setMessage(`已检查 ${next.length} 张图片，将按下方顺序发送原始字节。`)
    })
  }

  async function upload(){
    if(!title.trim()||!authorization.trim()||!authorized||!files.length)throw new Error('请填写书名、来源、勾选授权并选择 JPG/PNG 图片。')
    const api=client()
    let current=book
    if(!current){current=await api.createBook({title:title.trim(),authorization_ref:authorization.trim()});setBook(current)}
    const existing=await api.listPages(current.id);setPages(existing)
    const completed=[...existing]
    for(let index=0;index<files.length;index++){
      if(!mounted.current)return
      if(completed.some(page=>page.page_no===index+1))continue
      const result=await api.uploadPage(current.id,files[index],index+1)
      completed.push(result);setPages([...completed].sort((a,b)=>a.page_no-b.page_no))
    }
    setMessage(`服务器已接收 ${completed.length} 页原始图片。book.id：${current.id}`)
  }

  async function classify(){
    if(!book)return
    const result=await client().classifyBook(book.id)
    setClassification(result);setConfirmedType(result.confirmed_type??result.predicted_type)
    setMessage('已读取 A 的标题规则分类；这不是 AI 分类结果。请人工确认。')
  }

  async function confirm(){
    if(!book)return
    setClassification(await client().confirmClassification(book.id,confirmedType));setMessage('图书类型已保存到 A 后端。')
  }

  async function saveRevision(){
    if(!book||!ocr.trim())throw new Error('请输入这一页的人工校对文字。')
    const result=await client().updatePage(book.id,pageNo,{ocr:{text:ocr.trim()}})
    setMessage(`第 ${result.page_no} 页校对已保存，服务端版本 r${result.revision}，来源 ${result.source}。`)
  }

  async function refreshJob(current:JobResponse){
    const api=client()
    let next=await api.getJob(current.job_id)
    for(let attempt=0;attempt<20&&['QUEUED','RUNNING','RETRYING'].includes(next.status);attempt++){
      await new Promise(resolve=>setTimeout(resolve,200))
      if(!mounted.current)return
      next=await api.getJob(current.job_id)
    }
    const nextProgress=await api.progress(current.run_id)
    setJob(next);setProgress(nextProgress)
    const failed=nextProgress.stages.find(stage=>stage.status==='FAILED')
    if(failed){const records=await api.runJobs(current.run_id);const detail=records.find(item=>item.id===current.job_id);throw new Error(`${failed.error_code??'TASK_FAILED'}：${detail?.error_message??'服务端任务失败'}。尚无真实生成结果。`)}
    setMessage(`服务端任务状态：${next.status}；未生成前不会进入模拟成功。`)
  }

  // 角色 C: 真实上报交互记录
  async function reportInteraction(){
    if(!job?.run_id)throw new Error('请先发起分析任务以获得 run_id，或等待任务创建后联调。')
    const doFetch = globalThis.fetch.bind(globalThis)
    const base = address.trim()==='/backend-api'?new URL('/backend-api',location.origin).href:address.trim()
    const res = await doFetch(`${base}/api/runs/${job.run_id}/interactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenRef.current.trim()}`,
      },
      body: JSON.stringify({
        interaction_type: 'voice',
        input: { query: interactionQuery, video_ms: 3500 },
        output: {
          answer: '小狐狸戴着一条红色的围巾。',
          evidence: [{ page_no: 1, snippet: '小狐狸系好红围巾' }],
          producer: 'c_interaction_agent',
        },
        latency_ms: 280,
      }),
    })
    if(!res.ok) {
      const err = await res.text().catch(()=>'')
      throw new Error(`上报交互失败 HTTP ${res.status}: ${err}`)
    }
    setMessage('交互已成功记录到 A 数据库 (带有 producer: c_interaction_agent)。')
    await fetchInteractions()
  }

  async function fetchInteractions(){
    if(!job?.run_id)return
    const list = await client().interactions(job.run_id)
    setInteractionRecords(list)
    setMessage(`已从 A 后端读取 ${list.length} 条真实交互记录。`)
  }

  // 角色 C: 真实笔记生命周期
  async function generateNote(){
    if(!book)return
    const note = await client().generateNote(book.id)
    setNoteDraft(note)
    setMessage(`已调用 A 生成笔记草稿 (note_id: ${note.id}, 状态: ${note.status}, 版本: r${note.version})。`)
  }

  async function reviewNote(action: 'approve' | 'revise'){
    if(!noteDraft)return
    const updated = await client().reviewNote(noteDraft.id, action)
    setNoteDraft(updated)
    setMessage(`笔记审核操作已完成：当前状态为 ${updated.status}。`)
  }

  async function createShare(){
    if(!noteDraft)return
    const res = await client().createShare(noteDraft.id, { share_mode: 'link' })
    setMessage(`只读分享已生成：token=${res.token || res.id}，过期时间: ${res.expires_at || '永久'}。`)
    const currentShares = await client().listShares(noteDraft.id)
    setShares(currentShares)
  }

  async function revokeShare(shareId: string){
    if(!noteDraft)return
    await client().revokeShare(noteDraft.id, shareId)
    setMessage(`分享 ${shareId} 已撤销。`)
    const currentShares = await client().listShares(noteDraft.id)
    setShares(currentShares)
  }

  function clear(){
    setToken('')
    setFiles([])
    setBook(null)
    setPages([])
    setClassification(null)
    setJob(null)
    setProgress(null)
    setOcr('')
    setInteractionRecords([])
    setNoteDraft(null)
    setShares([])
    setMessage('本页凭据和联调记录已清空；后端已创建对象保留。')
    setError('')
  }

  const disabled=Boolean(busy)
  const uploadReady=!!book&&pages.length===files.length&&files.length>0

  return <section className="form-card backend-workbench" aria-labelledby="backend-title">
    <div className="card-title"><Icon name="lock"/><h2 id="backend-title">A 后端实际接口联调与全链路验证</h2></div>
    <p className="settings-copy">本区域会向指定的 A 后端发送真实请求，验证建书、图片上传、分类、校对、任务、伴读交互上报（C）与笔记分享（C）。</p>
    <div className="backend-grid">
      <label className="field">后端地址<input value={address} disabled={disabled||!!book} onChange={e=>setAddress(e.target.value)} placeholder="/backend-api"/><small>默认由 Vite 代理到本机 127.0.0.1:8000，避免跨域。</small></label>
      <label className="field">本地 Bearer 令牌<input type="password" autoComplete="off" value={token} disabled={disabled||!!book} onChange={e=>setToken(e.target.value)} placeholder="A 配置的令牌，仅保留在内存"/><small>不写入本地存储、URL、导出或日志；清空/离开本页即丢弃。</small></label>
    </div>
    <div className="backend-actions">
      <Button variant="secondary" disabled={disabled} onClick={()=>void execute('检查服务',async()=>{const health=await client().health();setMessage(`服务：${health.service} ${health.version} · ${health.status}。健康检查通过。`)})}>检查服务</Button>
      <Button variant="ghost" disabled={disabled} onClick={clear}>清空本页凭据和记录</Button>
    </div>

    <h3>1 · 建书与原始图片上传</h3>
    <div className="backend-grid">
      <label className="field">联调图书名称<input value={title} maxLength={200} disabled={disabled||!!book} onChange={e=>setTitle(e.target.value)}/></label>
      <label className="field">联调素材来源<input value={authorization} maxLength={500} disabled={disabled||!!book} onChange={e=>setAuthorization(e.target.value)}/></label>
    </div>
    <label className="backend-authorization">
      <input type="checkbox" checked={authorized} disabled={disabled||!!book} onChange={e=>setAuthorized(e.target.checked)}/>我有权将所选图片发送给该后端
    </label>
    <label className="field">
      选择联调 JPG/PNG<input type="file" multiple accept="image/jpeg,image/png" disabled={disabled||!!book} onChange={e=>{void selectFiles(Array.from(e.target.files??[]));e.target.value=''}}/>
    </label>
    {!!files.length&&<ol className="backend-files">{files.map((file,index)=><li key={`${file.name}-${index}`}><span>第 {index+1} 页 · {file.name}</span><strong>{pages.some(page=>page.page_no===index+1)?'已上传':'待上传'}</strong></li>)}</ol>}
    <Button disabled={disabled||!files.length||!token.trim()} onClick={()=>void execute('上传书页',upload)}>{book?'继续上传未完成书页':'建书并上传原始图片'}</Button>
    {book&&<p className="backend-id">book.id：{book.id} · 已上传 {pages.length}/{files.length} 页</p>}

    <h3>2 · 分类与人工校对</h3>
    <div className="backend-actions">
      <Button variant="secondary" disabled={disabled||!uploadReady} onClick={()=>void execute('读取分类',classify)}>读取后端分类</Button>
      {classification&&<>
        <label className="field">确认服务端类型
          <select value={confirmedType} disabled={disabled} onChange={e=>setConfirmedType(e.target.value as ApiBookType)}>
            {Object.entries(typeNames).map(([value,label])=><option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <Button disabled={disabled} onClick={()=>void execute('确认分类',confirm)}>保存服务端类型确认</Button>
      </>}
    </div>
    {classification&&<p className="inline-feedback">标题规则原型：{typeNames[classification.predicted_type]} · {Math.round(classification.confidence*100)}% · {classification.reasons.join('；')} · {classification.status}</p>}
    <div className="backend-grid">
      <label className="field">人工校对页码
        <select value={pageNo} disabled={disabled||!pages.length} onChange={e=>{setPageNo(Number(e.target.value));setOcr('')}}>
          {pages.map(page=><option key={page.id} value={page.page_no}>第 {page.page_no} 页</option>)}
        </select>
      </label>
      <label className="field">人工校对文字
        <textarea value={ocr} disabled={disabled||!pages.length} maxLength={12000} rows={3} onChange={e=>setOcr(e.target.value)}/>
      </label>
    </div>
    <Button variant="secondary" disabled={disabled||!pages.length||!ocr.trim()} onClick={()=>void execute('保存校对',saveRevision)}>保存到 A 的校对接口</Button>

    <h3>3 · 分析状态与任务生成</h3>
    <div className="backend-actions">
      <Button disabled={disabled||classification?.status!=='CONFIRMED'||!!job} onClick={()=>void execute('发起真实任务',async()=>{if(!book)return;const next=await client().analyzeBook(book.id);setJob(next);await refreshJob(next)})}>发起 A 的分析任务</Button>
      <Button variant="secondary" disabled={disabled||!job} onClick={()=>void execute('查询任务',async()=>{if(job)await refreshJob(job)})}>查询服务端状态</Button>
      <Button variant="secondary" disabled={disabled||job?.status!=='FAILED'||job.attempts>=3} onClick={()=>void execute('重试任务',async()=>{if(!job)return;const next=await client().retryJob(job.job_id);setJob(next);await refreshJob(next)})}>重试失败任务</Button>
    </div>
    {job&&<p className="backend-id">run_id：{job.run_id}<br/>job_id：{job.job_id} · {job.status} · 尝试 {job.attempts}/3</p>}
    {progress&&<ul className="backend-stages">{progress.stages.map((stage,index)=><li key={index}>{stage.stage} · {stage.status}{stage.error_code?` · ${stage.error_code}`:''}</li>)}</ul>}

    {/* 角色 C: 伴读交互上报联调 */}
    <h3>4 · 伴读交互记录上报与查询 (POST/GET /api/runs/{'{run_id}'}/interactions)</h3>
    <div className="backend-grid">
      <label className="field">测试提问内容
        <input value={interactionQuery} disabled={disabled} onChange={e=>setInteractionQuery(e.target.value)} placeholder="例如：小狐狸戴着什么颜色的围巾？"/>
      </label>
    </div>
    <div className="backend-actions">
      <Button disabled={disabled||!job?.run_id||!interactionQuery.trim()} onClick={()=>void execute('上报交互',reportInteraction)}>
        上报交互记录到 A (带有 producer: c_interaction_agent)
      </Button>
      <Button variant="secondary" disabled={disabled||!job?.run_id} onClick={()=>void execute('拉取交互',fetchInteractions)}>
        查询后端已保存交互记录
      </Button>
    </div>
    {interactionRecords.length > 0 && (
      <div style={{ marginTop: '10px', fontSize: '12px' }}>
        <strong>后端返回的真实交互留痕 ({interactionRecords.length} 条):</strong>
        <ul style={{ paddingLeft: '20px', marginTop: '6px' }}>
          {interactionRecords.map((item: any) => (
            <li key={item.id} style={{ marginBottom: '4px' }}>
              <code>[{item.interaction_type}]</code> {item.input?.query || '触控点击'} → {item.output?.answer || item.output?.target} (延迟: {item.latency_ms}ms · 产生者: {item.output?.producer})
            </li>
          ))}
        </ul>
      </div>
    )}

    {/* 角色 C: 笔记生命周期与安全分享联调 */}
    <h3>5 · 笔记生命周期与只读安全分享 (/api/notes/...)</h3>
    <div className="backend-actions">
      <Button disabled={disabled||!book} onClick={()=>void execute('生成草稿',generateNote)}>
        调用 A 生成笔记草稿
      </Button>
      {noteDraft && (
        <>
          <Button variant="secondary" disabled={disabled||noteDraft.status==='REVIEWING'} onClick={()=>void execute('提交审核',async()=>{await reviewNote('revise')})}>
            提交复核
          </Button>
          <Button disabled={disabled} onClick={()=>void execute('主人审核通过',async()=>{await reviewNote('approve')})}>
            主人审核通过 (Approve)
          </Button>
          <Button disabled={disabled||noteDraft.status!=='REVIEWING'&&noteDraft.status!=='APPROVED'} onClick={()=>void execute('创建只读分享',createShare)}>
            创建只读分享链接
          </Button>
        </>
      )}
    </div>
    {noteDraft && (
      <p className="backend-id">
        笔记 ID: {noteDraft.id} · 状态: <strong>{noteDraft.status}</strong> · 版本: r{noteDraft.version}
      </p>
    )}
    {shares.length > 0 && (
      <div style={{ marginTop: '10px', fontSize: '12px' }}>
        <strong>活动中的安全分享链接 ({shares.length} 个):</strong>
        <ul style={{ paddingLeft: '20px', marginTop: '6px' }}>
          {shares.map((s) => (
            <li key={s.id} style={{ marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>Token: <code>{s.token || s.id}</code> · 模式: {s.share_mode} · 状态: {s.status}</span>
              <button
                type="button"
                style={{ fontSize: '11px', color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                onClick={()=>void execute('撤销分享',()=>revokeShare(s.id))}
              >
                撤销
              </button>
            </li>
          ))}
        </ul>
      </div>
    )}

    {busy&&<p role="status" className="inline-feedback">{busy}中，请稍候…</p>}
    {message&&<p role="status" className="inline-feedback">{message}</p>}
    {error&&<p role="alert" className="backend-error">{error}</p>}
  </section>
}
