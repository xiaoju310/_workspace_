import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { ImportedBookInput } from '../app/types'
import { Badge, Button, Icon, StatePanel } from '../components/ui'
import { SceneBackdrop } from '../components/PaperScene'
import { materializePdfPages } from '../features/books/pdfImport'
import { MAX_PAGES, validatePage } from '../features/books/import'
import type { ImportPage } from '../features/books/import'
import { scopeApi } from '../lib/accountDrafts'
import { draftStore } from '../features/books/draftStore'
import type { BookType, PreviewState } from '../features/books/types'

export default function ImportBookPage({
  draftScope,
  requestedDraftId,
  state,
  setState,
  onHome,
  onComplete,
  serverSync = false,
  appMode = 'demo',
}: {
  draftScope: string
  requestedDraftId?: string | null
  state: PreviewState
  setState: (value: PreviewState) => void
  onHome: () => void
  onComplete: (input: ImportedBookInput, draftId: string) => Promise<void>
  serverSync?: boolean
  appMode?: 'live' | 'demo'
}) {
  const [pages, setPages] = useState<ImportPage[]>([])
  const isLive = appMode === 'live'
  const [title, setTitle] = useState('')
  const [authorizationRef, setAuthorizationRef] = useState('')
  const [authorized, setAuthorized] = useState(false)
  const [authorizationChoice, setAuthorizationChoice] = useState('')
  const [type, setType] = useState<BookType>('unknown')
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [dragging, setDragging] = useState(false)
  const addingFiles = useRef(false)
  const importEpoch = useRef(0)
  const importAbort = useRef<AbortController | null>(null)
  const activeScope = useRef(draftScope)
  activeScope.current = draftScope
  useEffect(() => () => { importEpoch.current += 1; importAbort.current?.abort() }, [])
  const inputRef = useRef<HTMLInputElement>(null)
  const pageRef = useRef(pages)
  pageRef.current = pages
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { pageRef.current.forEach(page => { if (!page.demo) URL.revokeObjectURL(page.url) }); if (timerRef.current) clearTimeout(timerRef.current) }, [])
  useEffect(() => {
    setDone(false); setErrors([])
    if (state === 'empty') {
      importEpoch.current += 1; importAbort.current?.abort(); addingFiles.current = false; setBusy(false)
      pageRef.current.forEach(page => { if (!page.demo) URL.revokeObjectURL(page.url) })
      pageRef.current = []; setPages([]); setTitle(''); setAuthorizationRef(''); setAuthorized(false); setAuthorizationChoice('')
    }
  }, [state])

  const [draftId]=useState(()=>requestedDraftId??`import-${crypto.randomUUID()}`)
  const [draftReady,setDraftReady]=useState(!requestedDraftId)
  const [loadError,setLoadError]=useState('')
  const [draftStatus,setDraftStatus]=useState('填写内容后自动保存为草稿')
  const touched=useRef(Boolean(requestedDraftId))
  const saveVersion=useRef(0)
  const pending=useRef(false)
  const alive=useRef(true)
  const submitting=useRef(false)
  useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
  useEffect(()=>{
    if(!requestedDraftId)return
    let stale=false
    void draftStore.loadImport(draftScope,requestedDraftId).then(draft=>{
      if(stale){draft?.pages.forEach(p=>{if(!p.demo)URL.revokeObjectURL(p.url)});return}
      if(!draft)throw new Error('此草稿已不存在，请返回首页重新选择')
      setPages(draft.pages);setTitle(draft.title);setAuthorizationRef(draft.authorizationRef);setAuthorized(draft.authorized);setAuthorizationChoice(draft.authorized?'yes':'');setType('unknown')
      setDraftReady(true);setDraftStatus('已恢复草稿，可以继续编辑')
    }).catch((e:Error)=>{if(!stale)setLoadError(e.message)})
    return()=>{stale=true}
  },[draftScope,requestedDraftId])
  async function saveDraft() {
    if(!draftReady||submitting.current)return
    const version=++saveVersion.current
    pending.current=true;setDraftStatus('正在保存草稿…')
    try {
      await draftStore.saveImport(draftScope,{id:draftId,title,authorizationRef,authorized,type,pages})
      if(alive.current&&version===saveVersion.current){if(location.hash.startsWith('#/import'))history.replaceState(null,'',`#/import?draft=${encodeURIComponent(draftId)}`);pending.current=false;setDraftStatus(`${serverSync?'已同步到账号（可换设备）':'本机草稿已保存'} · ${new Date().toLocaleTimeString()}`)}
    } catch(e:any) {if(alive.current&&version===saveVersion.current)setDraftStatus(`草稿保存失败：${e.message}。请勿关闭页面，稍后重试。`);throw e}
  }
  // 不用卸载时才保存：每次变更立即进入顺序写入队列，切页面也不会取消已开始的保存。
  useEffect(()=>{
    if(!draftReady||!(touched.current||pages.length||title||authorizationRef||authorized||type!=='unknown'))return
    touched.current=true;void saveDraft().catch(()=>{})
  },[pages,title,authorizationRef,authorized,type,draftReady])
  useEffect(()=>{const warn=(e:BeforeUnloadEvent)=>{if(pending.current){e.preventDefault();e.returnValue=''}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)},[])
  async function finishImport(){
    if(submitting.current)return
    setBusy(true);setErrors([])
    try {
      await saveDraft()
      submitting.current=true
      await onComplete({title:title.trim(),authorization_ref:authorizationRef.trim(),type,pages},draftId)
    }catch(e:any){submitting.current=false;setErrors([`导入未完成：${e.message}。草稿仍保留，可重试。`]);setBusy(false)}
  }

  async function addFiles(files: File[]) {
    if (busy || addingFiles.current || !alive.current) return
    addingFiles.current = true
    const epoch = ++importEpoch.current
    const controller = new AbortController()
    importAbort.current = controller
    const active = () => alive.current && activeScope.current === draftScope && importEpoch.current === epoch && !controller.signal.aborted
    // Capture the account token before any asynchronous validation or PDF parsing.
    const api = serverSync ? scopeApi(draftScope) : null
    const assertActive = () => {
      if (!active()) throw new Error('已离开当前导入，未添加书页。')
      api?.getToken()
    }
    setBusy(true); setDone(false); setErrors([])
    const available = MAX_PAGES - pageRef.current.length
    const nextErrors: string[] = []
    const nextPages: ImportPage[] = []
    try {
      for (const file of files) {
        assertActive()
        if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
          if (!serverSync) { nextErrors.push(`${file.name}：PDF 需要登录并连接当前服务器；仅发送到该服务器解析，不调用云端模型。`); continue }
          if (!file.size || file.size > 200 * 1024 * 1024) { nextErrors.push(`${file.name}：PDF 必须为 1 字节至 200 MB。`); continue }
          const remaining = available - nextPages.length
          if (remaining <= 0) { nextErrors.push('没有剩余书页位置，未导入 PDF。'); continue }
          try {
            const parsed = await api!.previewPdf(file, remaining, controller.signal)
            assertActive()
            nextPages.push(...await materializePdfPages(parsed, file.name, remaining, assertActive))
          } catch (error) {
            assertActive()
            nextErrors.push(`${file.name}：${error instanceof Error ? error.message : 'PDF 解析失败'}`)
          }
          continue
        }
        if (nextPages.length >= available) { nextErrors.push(`${file.name}：书页已满，未添加。`); continue }
        const error = await validatePage(file)
        assertActive()
        if (error) nextErrors.push(error)
        else nextPages.push({ id: crypto.randomUUID(), name: file.name, size: file.size, file, url: URL.createObjectURL(file) })
      }
      assertActive()
      pageRef.current = [...pageRef.current, ...nextPages]
      setPages(pageRef.current); setErrors(nextErrors)
    } catch (error) {
      nextPages.forEach(page => URL.revokeObjectURL(page.url))
      if (active()) setErrors([error instanceof Error ? error.message : '书页检查失败，请重新选择文件。'])
    } finally {
      if (importEpoch.current === epoch) { addingFiles.current = false; importAbort.current = null; if (alive.current) setBusy(false) }
    }
  }

  function loadDemo() {
    pages.forEach(page => { if (!page.demo) URL.revokeObjectURL(page.url) })
    setPages([1, 2, 3].map(no => ({ id: `demo-${no}`, name: `森林里的来信-${String(no).padStart(2, '0')}.png`, url: ['/art/page-forest-1.svg','/art/page-forest-2.svg','/art/page-forest-3.svg'][no-1], size: 0, demo: true })))
    setTitle('森林里的来信'); setAuthorizationRef('原创合成演示页'); setAuthorized(false); setAuthorizationChoice(''); setDone(false); setErrors([])
  }

  function removePage(id: string) {
    setPages(current => { const found = current.find(page => page.id === id); if (found && !found.demo) URL.revokeObjectURL(found.url); return current.filter(page => page.id !== id) }); setDone(false)
  }

  function movePage(index: number, direction: number) {
    setPages(current => { const next = [...current]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; return next }); setDone(false)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || addingFiles.current || done) return
    const missing: string[] = []
    if (!title.trim()) missing.push('请填写图书名称。')
    if (!authorized) missing.push('请确认你拥有所选书页的使用授权。')
    if (!pages.length) missing.push('请至少选择一张书页。')
    setErrors(missing)
    if (missing.length) return
    setBusy(true); setDone(false)
    timerRef.current = setTimeout(() => { setBusy(false); setDone(true); timerRef.current = null }, 700)
  }

  const uploaded = pages.length

  if(!draftReady)return <div className="page-content state-panel" role="status"><h2>{loadError?'草稿读取失败':'正在恢复草稿原图…'}</h2><p>{loadError||'请稍等，原图和页序会一起恢复。'}</p><Button onClick={onHome}>返回首页</Button></div>

  return (
    <div className="import-page page-content">
      <SceneBackdrop tone="cool" />

      <div className="page-heading">
        <div>
          <p className="eyebrow">BRING YOUR NEXT STORY</p>
          <h1>让一本好书，开始新的旅程。</h1>
          <p className="page-description">从清晰的书页开始，把故事和发现带进来。</p>
        </div>
        <Button variant="ghost" onClick={onHome}>返回首页 <Icon name="arrow" size={17} /></Button>
      </div>

      <div className="draft-notice paper-card" role="status"><p>{draftStatus}</p><p>书名、授权选择和原图会先保存在本机；登录真实账号后同步到服务器。看到“已同步到账号”再换设备，另一台设备需连接同一服务器。</p><Button type="button" variant="secondary" disabled={busy} onClick={()=>{void saveDraft().catch(()=>{})}}>保存草稿</Button></div>
      <ol className="stepper" aria-label="导入流程">
        <li className="current" aria-current="step"><span>01</span><div>导入书页<small>添加图片与授权信息</small></div></li>
        <li><span>02</span><div>校对与确认<small>页序、文字和图书类型</small></div></li>
        <li><span>03</span><div>开启阅读<small>分析、笔记与互动伴读</small></div></li>
      </ol>

      {state === 'loading' ? (
        <StatePanel scope="import" kind="loading" onRetry={() => setState('success')} onImport={onHome} />
      ) : state === 'error' ? (
        <StatePanel scope="import" kind="error" onRetry={() => setState('success')} onImport={onHome} />
      ) : (
        <form className="import-layout" onSubmit={submit} noValidate>
          <div className="import-main">
            {/* 工作台 01：命名与授权 */}
            <section className="paper-card paper-card--lg form-card">
              <div className="card-title">
                <span className="section-number">1</span>
                <h2>给这本书一个名字</h2>
                <Badge tone={isLive ? (serverSync ? 'green' : 'amber') : 'neutral'}>
                  {isLive ? (serverSync ? '可同步到后端' : '需先登录') : '本地演示'}
                </Badge>
              </div>
              <div className="form-grid">
                <label className="field">
                  图书名称 <span className="required">*</span>
                  <input
                    maxLength={100}
                    value={title}
                    onChange={e => { setTitle(e.target.value); setDone(false) }}
                    placeholder="例如：森林里的来信"
                    required
                    disabled={busy || done}
                  />
                </label>
                <div className="field">
                  <span>图书类型</span>
                  <strong>自动识别</strong>
                  <span className="field-help">继续校对时自动分类；无法确定时会提示你确认。</span>
                </div>
              </div>
              <label className="field source-field">
                是否拥有所选书页的使用授权 <span className="required">*</span>
                <select aria-label="是否拥有使用授权" value={authorizationChoice} disabled={busy || done}
                  onChange={e => {
                    const choice = e.target.value
                    setAuthorizationChoice(choice); setAuthorized(choice === 'yes')
                    setAuthorizationRef(choice === 'yes' ? '用户声明拥有使用授权' : '')
                    setDone(false)
                  }}>
                  <option value="">请选择</option>
                  <option value="yes">是，我拥有使用授权（含自制内容）</option>
                  <option value="no">否，我没有使用授权</option>
                  <option value="unsure">不确定，需要先核实</option>
                </select>
              </label>
              {(authorizationChoice === 'no' || authorizationChoice === 'unsure') && <p className="field-help">请先取得或核实使用授权，再继续导入。</p>}
            </section>

            {/* 工作台 02：书页 */}
            <section className="paper-card paper-card--lg form-card upload-card">
              <div className="card-title">
                <span className="section-number">2</span>
                <h2>添加书页（图片 / PDF）</h2>
                <span className="muted count-text">{uploaded} / {MAX_PAGES} 页</span>
              </div>

              <label
                className={`upload-dropzone ${dragging ? 'dragging' : ''} ${busy || done ? 'disabled' : ''}`}
                onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = busy || done ? 'none' : 'copy'; if (!busy && !done) setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={e => { e.preventDefault(); setDragging(false); if (!busy && !done) void addFiles(Array.from(e.dataTransfer.files)) }}
              >
                <input
                  ref={inputRef}
                  type="file"
                  accept="image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf"
                  multiple
                  disabled={busy || done}
                  onChange={e => { void addFiles(Array.from(e.target.files ?? [])); e.target.value = '' }}
                />
                <span className="upload-icon"><Icon name="upload" size={30} /></span>
                <strong>{busy ? '正在检查书页…' : '把书页拖到这里，或点击选择'}</strong>
                <span className="upload-hint">PDF 不超过 200 MB，登录后由当前服务器本地解析 · JPG / PNG 每张不超过 20 MB · 最多 {MAX_PAGES} 页</span>
                <span className="choose-file">选择书页 <Icon name="plus" size={16} /></span>
              </label>

              <div className="upload-tips">
                <span><Icon name="check" size={14} />光线均匀</span>
                <span><Icon name="check" size={14} />书页完整</span>
                <span><Icon name="check" size={14} />文字清晰</span>
                <button className="text-button" type="button" onClick={loadDemo} disabled={busy || done}>
                  试用原创示例 <Icon name="arrow" size={14} />
                </button>
              </div>

              {errors.length > 0 && (
                <div className="form-errors" role="alert">
                  <strong><Icon name="alert" size={16} /> 请检查以下内容</strong>
                  <ul>{errors.map(error => <li key={error}>{error}</li>)}</ul>
                </div>
              )}

              {pages.length > 0 ? (
                <div className="page-preview">
                  <div className="preview-title">
                    <strong>书页预览</strong>
                    <span>按阅读顺序排列，可用箭头调整</span>
                  </div>
                  <ol className="page-list">
                    {pages.map((page, index) => (
                      <li key={page.id}>
                        <div className="page-thumbnail">
                          <img src={page.url} alt={`第 ${index + 1} 页预览`} />
                          <span>{String(index + 1).padStart(2, '0')}</span>
                        </div>
                        <div className="page-file">
                          <strong title={page.name}>{page.name}</strong>
                          <small>{page.demo ? '原创示例 · 模拟书页' : `${(page.size / 1024 / 1024).toFixed(2)} MB`}</small>
                        </div>
                        <div className="page-actions">
                          <button type="button" aria-label={`将第 ${index + 1} 页前移`} disabled={index === 0 || busy || done} onClick={() => movePage(index, -1)}><Icon name="up" size={16} /></button>
                          <button type="button" aria-label={`将第 ${index + 1} 页后移`} disabled={index === pages.length - 1 || busy || done} onClick={() => movePage(index, 1)}><Icon name="down" size={16} /></button>
                          <button type="button" aria-label={`移除第 ${index + 1} 页`} disabled={busy || done} onClick={() => removePage(page.id)}><Icon name="close" size={16} /></button>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : (
                <div className="upload-empty">
                  <Icon name="image" size={18} />
                  <span>还没有书页。添加后，可在这里检查顺序。</span>
                </div>
              )}
            </section>
          </div>

          {/* 侧栏：安心卡 */}
          <aside className="import-summary paper-card paper-card--amber paper-card--lg">
            <div className="summary-header">
              <span className="summary-flower"><Icon name="spark" size={26} /></span>
              <h2>好故事，从安心开始。</h2>
              <p>每一页都有来源，<br />每一个发现都属于你。</p>
            </div>
            <div className="summary-body">
              <div className="summary-point">
                <span><Icon name="book" size={19} /></span>
                <div><h3>先确认，再开始</h3><p>检查页序与图书类型，识别结果由你校对。</p></div>
              </div>
              <div className="summary-point">
                <span><Icon name="lock" size={19} /></span>
                <div><h3>笔记默认私密</h3><p>生成的是草稿，主人审核后才能选择分享。</p></div>
              </div>
              <div className="copyright-note">
                <Icon name="info" size={17} />
                <p>请使用自制或已获授权的书页。通用阅读功能处于原型阶段，尚未实测支持所有图书。</p>
              </div>




              {done && (
                <div className="import-success" role="status">
                  <Icon name="check" size={20} />
                  <div>
                    <strong>导入预览已确认</strong>
                    <p>《{title}》· {pages.length} 页。书页已在本机完成预览，下一步是校对与分类确认；登录后原图会随草稿同步，正式分析尚未开始。</p>
                  </div>
                </div>
              )}

              <div className="summary-actions">
                <Button className="button--coral button--block" type="submit" disabled={busy || done}>
                  {done ? '书页预览已完成' : busy ? '正在检查…' : '确认导入预览'}
                  <Icon name={done ? 'check' : 'arrow'} size={18} />
                </Button>
                {done && (
                  <>
                    <Button type="button" disabled={busy} onClick={()=>{void finishImport()}}>
                      继续校对书页<Icon name="arrow" size={17} />
                    </Button>
                    <Button type="button" variant="secondary" disabled={busy} onClick={() => setDone(false)}>返回修改</Button>
                  </>
                )}
              </div>

              <p className="local-only">
                {serverSync ? <>点“继续校对书页”时会向后端建档和请求分类；草稿原图已同步到账号；点“开始分析与生成”时才向分析任务登记书页和校对文字。</> : isLive ? <>当前尚未登录，只能保存本地图片预览；PDF 解析和真实分析需先登录。<br />请先在页面顶部登录，再继续导入。</> : <>本地演示不会上传图片或调用模型；书页会保存为草稿，可稍后继续。</>}
              </p>
            </div>
          </aside>
        </form>
      )}

      <div className="home-footnote">
        <Icon name="info" size={15} />
        <span>
          {serverSync ? '真实模式：建档与分类会调用后端；分析和视频是否可用取决于后端配置，失败会如实显示。' : isLive ? '真实模式尚未登录：本次只保存在浏览器，不会伪装成真实生成。' : '演示模式：可校对文字和体验模拟流程；不调用后端生成模型。'}
        </span>
      </div>
    </div>
  )
}
