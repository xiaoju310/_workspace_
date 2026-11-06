import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { ImportedBookInput } from '../app/types'
import { Badge, Button, Icon, StatePanel } from '../components/ui'
import { MAX_PAGES, validatePage } from '../features/books/import'
import type { ImportPage } from '../features/books/import'
import type { BookType, PreviewState } from '../features/books/types'

export default function ImportBookPage({ state, setState, onHome, onComplete, serverSync = false }: { state: PreviewState; setState: (value: PreviewState) => void; onHome: () => void; onComplete: (input: ImportedBookInput) => void; serverSync?: boolean }) {
  const [pages, setPages] = useState<ImportPage[]>([])
  const [title, setTitle] = useState('')
  const [authorizationRef, setAuthorizationRef] = useState('')
  const [authorized, setAuthorized] = useState(false)
  const [type, setType] = useState<BookType>('picture_book')
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const pageRef = useRef(pages)
  pageRef.current = pages
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { pageRef.current.forEach(page => { if (!page.demo) URL.revokeObjectURL(page.url) }); if (timerRef.current) clearTimeout(timerRef.current) }, [])
  useEffect(() => {
    setDone(false); setErrors([])
    if (state === 'empty') {
      pageRef.current.forEach(page => { if (!page.demo) URL.revokeObjectURL(page.url) })
      setPages([]); setTitle(''); setAuthorizationRef(''); setAuthorized(false)
    }
  }, [state])

  async function addFiles(files: File[]) {
    if (busy) return
    setBusy(true); setDone(false); setErrors([])
    const available = MAX_PAGES - pageRef.current.length
    const nextErrors: string[] = []
    const nextPages: ImportPage[] = []
    if (files.length > available) nextErrors.push(`每本最多 ${MAX_PAGES} 页，本次仅检查前 ${Math.max(0, available)} 个文件。`)
    try {
      for (const file of files.slice(0, Math.max(0, available))) {
        const error = await validatePage(file)
        if (error) nextErrors.push(error)
        else nextPages.push({ id: crypto.randomUUID(), name: file.name, size: file.size, url: URL.createObjectURL(file) })
      }
      setPages(current => [...current, ...nextPages]); setErrors(nextErrors)
    } catch { setErrors(['图片检查失败，请重新选择文件。']) }
    finally { setBusy(false) }
  }

  function loadDemo() {
    pages.forEach(page => { if (!page.demo) URL.revokeObjectURL(page.url) })
    setPages([1, 2, 3].map(no => ({ id: `demo-${no}`, name: `森林里的来信-${String(no).padStart(2, '0')}.png`, url: ['/art/page-forest-1.svg','/art/page-forest-2.svg','/art/page-forest-3.svg'][no-1], size: 0, demo: true })))
    setTitle('森林里的来信'); setAuthorizationRef('原创合成演示页'); setAuthorized(false); setDone(false); setErrors([])
  }

  function removePage(id: string) {
    setPages(current => { const found = current.find(page => page.id === id); if (found && !found.demo) URL.revokeObjectURL(found.url); return current.filter(page => page.id !== id) }); setDone(false)
  }

  function movePage(index: number, direction: number) {
    setPages(current => { const next = [...current]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; return next }); setDone(false)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const missing: string[] = []
    if (!title.trim()) missing.push('请填写图书名称。')
    if (!authorizationRef.trim()) missing.push('请填写素材来源或授权标识。')
    if (!authorized) missing.push('请确认你拥有所选书页的使用授权。')
    if (!pages.length) missing.push('请至少选择一张书页。')
    setErrors(missing)
    if (missing.length) return
    setBusy(true); setDone(false)
    timerRef.current = setTimeout(() => { setBusy(false); setDone(true); timerRef.current = null }, 700)
  }

  return <div className="import-page page-content"><div className="page-heading"><div><p className="eyebrow">BRING YOUR NEXT STORY</p><h1>让一本好书，开始新的旅程。</h1><p className="page-description">从清晰的书页开始，把故事和发现带进来。</p></div><Button variant="ghost" onClick={onHome}>返回首页 <Icon name="arrow" size={17}/></Button></div>
    <ol className="stepper" aria-label="导入流程"><li className="current" aria-current="step"><span>01</span><div>导入书页<small>添加图片与授权信息</small></div></li><li><span>02</span><div>校对与确认<small>页序、文字和图书类型</small></div></li><li><span>03</span><div>开启阅读<small>分析、笔记与互动伴读</small></div></li></ol>
    {state === 'loading' ? <StatePanel scope="import" kind="loading" onRetry={() => setState('success')} onImport={onHome}/> : state === 'error' ? <StatePanel scope="import" kind="error" onRetry={() => setState('success')} onImport={onHome}/> : <form className="import-layout" onSubmit={submit} noValidate><div className="import-main"><section className="form-card"><div className="card-title"><span className="section-number">1</span><h2>给这本书一个名字</h2><Badge>{serverSync ? '将同步到后端' : '仅本地预览'}</Badge></div><div className="form-grid"><label className="field">图书名称 <span className="required">*</span><input maxLength={100} value={title} onChange={e => { setTitle(e.target.value); setDone(false) }} placeholder="例如：森林里的来信" required disabled={busy || done}/></label><label className="field">图书类型<select value={type} onChange={e => setType(e.target.value as BookType)} disabled={busy || done}><option value="picture_book">绘本 · 互动伴读优先</option><option value="fiction">文学故事 · 笔记原型</option><option value="nonfiction">知识读物 · 笔记原型</option><option value="unknown">暂不确定，稍后确认</option></select></label></div><p className="field-help"><Icon name="info" size={14}/>这里是你的初步选择；分析后会展示预测类型、置信度和理由，由主人最终确认。</p><label className="field source-field">素材来源 / 授权标识 <span className="required">*</span><input maxLength={200} value={authorizationRef} onChange={e => { setAuthorizationRef(e.target.value); setDone(false) }} placeholder="例如：自制内容 / 赛事授权样本编号" required disabled={busy || done}/></label></section>
      <section className="form-card upload-card"><div className="card-title"><span className="section-number">2</span><h2>添加书页图片</h2><span className="muted count-text">{pages.length} / {MAX_PAGES} 页</span></div><label className={`upload-dropzone ${dragging ? 'dragging' : ''} ${busy || done ? 'disabled' : ''}`} onDragOver={e => { e.preventDefault(); if (!busy && !done) setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); if (!busy && !done) void addFiles(Array.from(e.dataTransfer.files)) }}><input ref={inputRef} type="file" accept="image/jpeg,image/png" multiple disabled={busy || done} onChange={e => { void addFiles(Array.from(e.target.files ?? [])); e.target.value = '' }}/><span className="upload-icon"><Icon name="upload" size={30}/></span><strong>{busy ? '正在检查书页…' : '把书页拖到这里，或点击选择'}</strong><span>JPG / PNG · 每张不超过 10 MB · 最多 {MAX_PAGES} 页</span><span className="choose-file">选择书页 <Icon name="plus" size={16}/></span></label><div className="upload-tips"><span><Icon name="check" size={14}/>光线均匀</span><span><Icon name="check" size={14}/>书页完整</span><span><Icon name="check" size={14}/>文字清晰</span><button className="text-button" type="button" onClick={loadDemo} disabled={busy || done}>试用原创示例 <Icon name="arrow" size={14}/></button></div>
        {pages.length > 0 ? <div className="page-preview"><div className="preview-title"><strong>书页预览</strong><span>按阅读顺序排列，可用箭头调整</span></div><ol className="page-list">{pages.map((page, index) => <li key={page.id}><div className="page-thumbnail"><img src={page.url} alt={`第 ${index + 1} 页预览`}/><span>{String(index + 1).padStart(2, '0')}</span></div><div className="page-file"><strong title={page.name}>{page.name}</strong><small>{page.demo ? '原创示例 · 模拟书页' : `${(page.size / 1024 / 1024).toFixed(2)} MB`}</small></div><div className="page-actions"><button type="button" aria-label={`将第 ${index + 1} 页前移`} disabled={index === 0 || busy || done} onClick={() => movePage(index, -1)}><Icon name="up" size={16}/></button><button type="button" aria-label={`将第 ${index + 1} 页后移`} disabled={index === pages.length - 1 || busy || done} onClick={() => movePage(index, 1)}><Icon name="down" size={16}/></button><button type="button" aria-label={`移除第 ${index + 1} 页`} disabled={busy || done} onClick={() => removePage(page.id)}><Icon name="close" size={16}/></button></div></li>)}</ol></div> : <div className="upload-empty"><Icon name="image" size={18}/><span>还没有书页。添加后，可在这里检查顺序。</span></div>}
      </section></div><aside className="import-summary"><div className="summary-header"><span className="summary-flower">✳</span><h2>好故事，从安心开始。</h2><p>每一页都有来源，<br/>每一个发现都属于你。</p></div><div className="summary-body"><div className="summary-point"><span><Icon name="book" size={19}/></span><div><h3>先确认，再开始</h3><p>检查页序与图书类型，识别结果由你校对。</p></div></div><div className="summary-point"><span><Icon name="lock" size={19}/></span><div><h3>笔记默认私密</h3><p>生成的是草稿，主人审核后才能选择分享。</p></div></div><div className="copyright-note"><Icon name="info" size={17}/><p>请使用自制或已获授权的书页。通用阅读功能处于原型阶段，尚未实测支持所有图书。</p></div><label className="authorization"><input type="checkbox" checked={authorized} onChange={e => setAuthorized(e.target.checked)} disabled={busy || done}/><span>我确认拥有所选书页的使用授权，并已填写来源标识。</span></label>
      {errors.length > 0 && <div className="form-errors" role="alert"><strong><Icon name="alert" size={16}/> 请检查以下内容</strong><ul>{errors.map(error => <li key={error}>{error}</li>)}</ul></div>}
      {done && <div className="import-success" role="status"><Icon name="check" size={20}/><div><strong>导入预览已确认</strong><p>《{title}》· {pages.length} 页。当前只完成本地模拟，下一步是校对与分类确认。</p></div></div>}
      <Button type="submit" disabled={busy || done}>{done ? '本地预览已完成' : busy ? '正在检查…' : '确认导入预览'}<Icon name={done ? 'check' : 'arrow'} size={18}/></Button>{done && <><Button type="button" onClick={() => onComplete({ title: title.trim(), authorization_ref: authorizationRef.trim(), type, pages })}>继续校对书页<Icon name="arrow" size={17}/></Button><Button type="button" variant="secondary" onClick={() => setDone(false)}>返回修改</Button></>}<p className="local-only">{serverSync ? <>点“继续校对书页”时，书名和授权标识会发送到后端建档。<br/>书页图片和校对文字在你点“开始分析与生成”时上传。</> : <>文件仅在本机内存预览，刷新后清空。<br/>此版本不会上传或调用识别服务。</>}</p></div></aside></form>}
    <div className="home-footnote"><Icon name="info" size={15}/><span>{serverSync ? '真实模式：图书会在后端建档；模型服务尚未接入，分析会如实返回失败。' : '本地演示：图片只在内存预览；下一步可校对文字和确认分类，模型服务尚未接入。'}</span></div>
  </div>
}




