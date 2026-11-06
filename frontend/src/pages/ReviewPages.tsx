import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { WorkflowProps } from '../app/types'
import type { BookType, PreviewState } from '../features/books/types'
import { bookTypeLabels } from '../features/books/types'
import { Badge, Button, Icon } from '../components/ui'
import { apiClient } from '../lib/api'

function WorkflowState({ state, title, onRetry, onImport }: { state: PreviewState; title: string; onRetry: () => void; onImport: () => void }) {
  if (state === 'success') return null
  const text = state === 'loading' ? ['正在读取阅读资料', '请稍候，书页和校对记录正在准备。'] : state === 'empty' ? ['还没有可处理的书页', '先导入一本有权使用的图书，再开始校对。'] : ['资料暂时没有打开', '模拟读取失败，你的已保存内容不会因此丢失。']
  return <section className={`state-panel state-${state} wf-state`} role={state === 'error' ? 'alert' : 'status'} aria-live="polite"><span className="state-icon"><Icon name={state === 'error' ? 'alert' : 'book'} size={30}/></span><p className="eyebrow">{title}</p><h2>{text[0]}</h2><p>{text[1]}</p>{state !== 'loading' && <Button variant="secondary" onClick={state === 'empty' ? onImport : onRetry}>{state === 'empty' ? '导入图书' : '重新加载'}<Icon name="arrow" size={17}/></Button>}</section>
}

function WorkflowHeading({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children?: ReactNode }) {
  return <div className="page-heading wf-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="page-description">{description}</p></div>{children}</div>
}

export function ReviewPage({ book, state, setState, updateBook, navigate, notify }: WorkflowProps) {
  const [selectedId, setSelectedId] = useState(book.pages[0]?.id ?? '')
  const selected = book.pages.find(page => page.id === selectedId) ?? book.pages[0]
  const [text, setText] = useState(selected?.ocr_text ?? '')
  const [error, setError] = useState('')
  const [discardPageId, setDiscardPageId] = useState<string | null>(null)
  const confirmedCount = book.pages.filter(page => page.confirmed).length
  const changed = !!selected && text !== selected.ocr_text
  const allConfirmed = book.pages.length > 0 && confirmedCount === book.pages.length && !changed

  useEffect(() => {
    let target=book.pages[0]?.id??''
    try {const focus=Number(sessionStorage.getItem('paper-companion-focus-page'));if(focus>0&&focus<=book.pages.length)target=book.pages[focus-1].id;sessionStorage.removeItem('paper-companion-focus-page')}catch{/* 无存储时打开第一页 */}
    setSelectedId(target); setError(''); setDiscardPageId(null)
  }, [book.id])
  useEffect(() => { setText(selected?.ocr_text ?? ''); setError('') }, [selected?.id, selected?.ocr_text])

  function choosePage(id: string) {
    if (id === selected?.id) return
    if (changed) { setDiscardPageId(id); return }
    setSelectedId(id)
  }

  function save(confirm: boolean) {
    if (!selected) return
    if (!text.trim()) { setError('这一页还没有文字。请补充识别内容或填写画面描述，再保存校对。'); return }
    updateBook(current => ({
      ...current,
      status: 'REVIEW_REQUIRED',
      safety_reviewed: false,
      pages_only: false,
      classification: current.pages.some(page => page.id === selected.id && page.ocr_text !== text) ? { ...current.classification, owner_confirmed: false } : current.classification,
      pages: current.pages.map(page => page.id === selected.id ? { ...page, ocr_text: text, revision: page.revision + (page.ocr_text === text ? 0 : 1), confirmed: confirm } : page),
    }))
    setError('')
    notify(confirm ? '这一页已校对确认。' : '校对文字已保存，请确认此页后继续。')
  }

  function reorder(index: number, direction: number) {
    if (changed) { setError('先保存当前页的修改，再调整页序。'); return }
    updateBook(current => {
      const pages = [...current.pages]
      ;[pages[index], pages[index + direction]] = [pages[index + direction], pages[index]]
      return { ...current, status: 'REVIEW_REQUIRED', safety_reviewed: false, pages: pages.map(page => ({ ...page, confirmed: false })), classification: { ...current.classification, owner_confirmed: false } }
    })
    notify('页序已更新，请重新确认各页与来源顺序。')
  }

  const effectiveState = state === 'success' && !book.pages.length ? 'empty' : state
  return <div className="page-content workflow-page"><WorkflowHeading eyebrow="READ, CHECK, MAKE IT RIGHT" title="先读懂每一页，再开始新故事。" description={`《${book.title}》 · 检查书页顺序，修正文字，保留每次校对。`}><Button variant="ghost" onClick={() => navigate('import')}>导入其他图书<Icon name="arrow" size={17}/></Button></WorkflowHeading>
    <div className="wf-path"><span className="done"><Icon name="check" size={14}/>导入书页</span><span className="active">02 · 页序与文字校对</span><span>03 · 分类确认</span><span>04 · 分析与生成</span></div>
    <WorkflowState state={effectiveState} title="页序与 OCR 校对" onRetry={() => setState('success')} onImport={() => navigate('import')}/>
    {effectiveState === 'success' && selected && <><div className="wf-context"><span><Icon name="info" size={16}/>{book.origin === 'mock' ? 'OCR 文字与置信度为演示数据，请逐页核对。' : '识别文字供你校对，保存后会更新校对版本。'}</span><Badge tone={allConfirmed ? 'green' : 'amber'}>{confirmedCount} / {book.pages.length} 页已确认</Badge></div>
      <div className="review-layout"><aside className="wf-card page-order"><div className="wf-card-heading"><h2>书页顺序</h2><span>{book.pages.length} 页</span></div><ol>{book.pages.map((page, index) => <li key={page.id} className={selected.id === page.id ? 'chosen' : ''}><button className="page-select" onClick={() => choosePage(page.id)} aria-current={selected.id === page.id ? 'step' : undefined}><img src={page.image_url} alt=""/><div><strong>第 {index + 1} 页</strong><small>{page.confirmed ? '已校对确认' : '待校对'}</small></div>{page.confirmed && <Icon name="check" size={15}/>}</button><div className="order-controls"><button aria-label={`将第 ${index + 1} 页前移`} disabled={index === 0} onClick={() => reorder(index, -1)}><Icon name="up" size={15}/></button><button aria-label={`将第 ${index + 1} 页后移`} disabled={index === book.pages.length - 1} onClick={() => reorder(index, 1)}><Icon name="down" size={15}/></button></div></li>)}</ol><p className="wf-small">调整顺序后需重新确认书页，确保引用页码准确。</p></aside>
      <section className="wf-card original-page"><div className="wf-card-heading"><h2>原始书页</h2><Badge>{selected.demo ? '原创示例' : '本地图片'}</Badge></div><div className="original-image"><img src={selected.image_url} alt={`《${book.title}》第 ${book.pages.indexOf(selected) + 1} 页原图`}/></div><div className="original-caption"><span>第 {book.pages.indexOf(selected) + 1} 页</span><span title={selected.name}>{selected.name}</span></div></section>
      <section className="wf-card ocr-editor"><div className="wf-card-heading"><h2>文字校对</h2><Badge tone={selected.confidence < .8 ? 'amber' : 'green'}>识别置信度 {Math.round(selected.confidence * 100)}%</Badge></div>{selected.confidence < .8 && <p className="wf-warning"><Icon name="alert" size={16}/>此页识别置信度较低，请对照原图检查漏字与错字。</p>}<label htmlFor="ocr-text">书页文字 / 画面描述</label><textarea id="ocr-text" value={text} onChange={event => { setText(event.target.value); setError('') }} rows={12} maxLength={12000} aria-describedby="ocr-help ocr-error"/><div className="ocr-meta"><span>校对版本 r{selected.revision}{changed ? ' · 有未保存修改' : selected.confirmed ? ' · 已确认' : ' · 已保存'}</span><span>{text.length} / 12000</span></div><p id="ocr-help" className="wf-small">无文字的书页可填写画面描述。这里只保存校对内容，不会自动改写原图。</p>{error && <p id="ocr-error" className="wf-error" role="alert">{error}</p>}{discardPageId && <div className="wf-confirm-box" role="alert"><p>当前页有未保存修改。先保存，或放弃修改后切换书页。</p><div><Button variant="secondary" onClick={() => setDiscardPageId(null)}>留在当前页</Button><Button variant="ghost" onClick={() => { setSelectedId(discardPageId); setDiscardPageId(null) }}>放弃修改并切换</Button></div></div>}<div className="wf-actions"><Button variant="secondary" onClick={() => save(false)}>保存校对</Button><Button onClick={() => save(true)}><Icon name="check" size={16}/>确认此页</Button></div></section></div>
      <div className="wf-next-bar"><div><strong>{allConfirmed ? '所有书页已确认，可以继续。' : '逐页确认，让每一个引用都有依据。'}</strong><p>校对修改和版本会随本次阅读会话保留。</p></div><Button disabled={!allConfirmed} onClick={() => navigate('classification', book.id)}>下一步：分类确认<Icon name="arrow" size={17}/></Button></div></>}
  </div>
}

export function ClassificationPage({ book, state, setState, updateBook, navigate, notify, onGenerate, appMode }: WorkflowProps) {
  const [selectedType, setSelectedType] = useState<BookType>(book.classification.confirmed_type ?? book.classification.predicted_type)
  const [confirmed, setConfirmed] = useState(book.classification.owner_confirmed)
  const [ageBand, setAgeBand] = useState(book.age_band.startsWith('3') ? '3–6 岁（成人陪同）' : book.age_band.startsWith('9') ? '9–12 岁' : book.age_band.startsWith('12') ? '12 岁以上' : '6–9 岁')
  const [error, setError] = useState('')
  const classification = book.classification
  const lowConfidence = classification.confidence !== null && classification.confidence < .8
  const pagesReady = book.pages.length > 0 && book.pages.every(page => page.confirmed)
  useEffect(() => { setSelectedType(book.classification.confirmed_type ?? book.classification.predicted_type); setConfirmed(book.classification.owner_confirmed); setAgeBand(book.age_band.startsWith('3') ? '3–6 岁（成人陪同）' : book.age_band.startsWith('9') ? '9–12 岁' : book.age_band.startsWith('12') ? '12 岁以上' : '6–9 岁'); setError('') }, [book.id])

  async function confirmClassification() {
    if (selectedType === 'unknown') { setError('请选择一个图书类型后确认；暂不确定时可以先返回校对。'); return }
    if (!pagesReady) { setError('请先完成全部书页校对，再确认分类。'); return }
    
    // 只有真正在 A 后端建档的书(server_book_id)才调用 PATCH /api/books/{id}/classification；
    // 失败时绝不显示"已确认"。本地导入的书只做本地确认，并明确告知未同步。
    if (book.server_book_id) {
      try {
        await apiClient.confirmCategory(book.server_book_id, selectedType)
      } catch (err: any) {
        setError(`后端保存分类失败: ${err.message || '网络或鉴权错误'}。保存失败不能确认。`)
        notify(`分类确认失败: ${err.message}`)
        return
      }
    } else if (appMode === 'live') {
      notify('该书尚未在服务端建档，类型仅在本地确认，未同步到后端。')
    }

    updateBook(current => ({ ...current, age_band: ageBand, classification: { ...current.classification, confirmed_type: selectedType, owner_confirmed: true } }))
    setConfirmed(true); setError(''); notify('图书类型已由主人确认。')
  }

  return <div className="page-content workflow-page"><WorkflowHeading eyebrow="A PLACE FOR EVERY STORY" title="这本书，适合怎样读？" description={`《${book.title}》 · 把预测结果交给主人确认，让接下来的阅读更合适。`}><Button variant="ghost" onClick={() => navigate('review', book.id)}>返回书页校对<Icon name="arrow" size={17}/></Button></WorkflowHeading><div className="wf-path"><span className="done"><Icon name="check" size={14}/>导入与校对</span><span className="active">03 · 分类确认</span><span>04 · 分析与生成</span></div><WorkflowState state={state === 'success' && !book.pages.length ? 'empty' : state} title="图书分类" onRetry={() => setState('success')} onImport={() => navigate('import')}/>
    {state === 'success' && book.pages.length > 0 && <div className="classification-layout"><section className="wf-card classification-result"><div className="wf-card-heading"><h2>分类建议</h2><Badge tone={book.origin === 'mock' ? 'amber' : 'green'}>{book.origin === 'mock' ? '模拟预测' : '模型预测'}</Badge></div><div className="classification-display"><div className="classification-emblem"><Icon name="book" size={38}/></div><p className="wf-overline">预测图书类型</p><h2>{bookTypeLabels[classification.predicted_type]}</h2><div className="confidence-meter" aria-label={classification.confidence === null ? '模型未提供置信度' : `置信度 ${Math.round(classification.confidence * 100)}%`}><span style={{ width: `${Math.max(0, Math.min(100, (classification.confidence ?? 0) * 100))}%` }}/></div><p className={lowConfidence ? 'confidence-figure low' : 'confidence-figure'}>{classification.confidence === null ? '暂未提供置信度' : `${Math.round(classification.confidence * 100)}% 置信度`}</p></div>{lowConfidence && <div className="wf-warning"><Icon name="alert" size={18}/><p><strong>这个判断还不够确定。</strong><br/>请结合书页内容确认或修改类型，不必直接接受预测。</p></div>}<h3>为什么这样判断</h3><ul className="classification-reasons">{classification.reasons.length ? classification.reasons.map(reason => <li key={reason}><Icon name="check" size={15}/>{reason}</li>) : <li>暂未提供判断理由，请根据原书内容确认。</li>}</ul><p className="wf-small">分类是阅读路径的建议，通用图书能力尚需逐类型实测。绘本互动伴读优先。</p></section>
      <section className="wf-card classification-owner"><div className="wf-card-heading"><h2>由你作最后确认</h2><Badge tone={confirmed ? 'green' : 'amber'}>{confirmed ? '主人已确认' : '待主人确认'}</Badge></div><p className="wf-lead">选择最接近原书的类型。</p><fieldset className="type-choices"><legend className="sr-only">确认图书类型</legend>{(['picture_book', 'fiction', 'nonfiction', 'unknown'] as const).map(type => <label className={selectedType === type ? 'type-choice selected' : 'type-choice'} key={type}><input type="radio" name="book-type" value={type} checked={selectedType === type} onChange={() => { setSelectedType(type); setConfirmed(false); setError(''); updateBook(current => ({ ...current, status: 'REVIEW_REQUIRED', safety_reviewed: false, classification: { ...current.classification, owner_confirmed: false } })) }}/><span><strong>{bookTypeLabels[type]}</strong><small>{type === 'picture_book' ? '图像叙事为主，优先进入互动伴读' : type === 'fiction' ? '故事与人物为主，整理情节和阅读发现' : type === 'nonfiction' ? '概念与知识为主，保留定义与来源引用' : '暂不下判断，返回原文继续检查'}</small></span></label>)}</fieldset><label className="field wf-age">阅读年龄建议<select value={ageBand} onChange={event => { setAgeBand(event.target.value); setConfirmed(false); updateBook(current => ({ ...current, status: 'REVIEW_REQUIRED', safety_reviewed: false, classification: { ...current.classification, owner_confirmed: false } })) }}><option>3–6 岁（成人陪同）</option><option>6–9 岁</option><option>9–12 岁</option><option>12 岁以上</option></select></label><p className="wf-small">年龄标签用于界面说明，内容是否适合仍需主人复核。</p>{!pagesReady && <p className="wf-warning"><Icon name="info" size={16}/>还有书页未完成校对，请先返回检查。</p>}{error && <p className="wf-error" role="alert">{error}</p>}<div className="wf-actions"><Button variant="secondary" onClick={confirmClassification}><Icon name="check" size={16}/>确认图书类型</Button><Button disabled={!confirmed || !pagesReady} onClick={onGenerate}>开始分析与生成<Icon name="arrow" size={17}/></Button></div><div className="wf-private"><Icon name="lock" size={17}/><span>笔记会先生成私密草稿，经主人审核后才能分享。原型中的确认不替代服务端鉴权。</span></div></section></div>}
  </div>
}

