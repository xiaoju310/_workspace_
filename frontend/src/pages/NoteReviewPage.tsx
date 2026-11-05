import { useEffect, useState } from 'react'
import type { NotesProps } from '../app/types'
import { Badge, Button, Icon } from '../components/ui'

const reviewLabels = { draft: '草稿', in_review: '审核中', approved: '已审核', rejected: '已退回' }

export default function NoteReviewPage({ book, note, state, setState, navigate, notify, onSave, onReview, onSeek }: NotesProps) {
  const [title, setTitle] = useState(note?.title ?? '')
  const [summary, setSummary] = useState(note?.summary ?? '')
  const [concepts, setConcepts] = useState(note?.concepts.join('、') ?? '')
  const [error, setError] = useState('')
  const [preview, setPreview] = useState(false)
  useEffect(() => {
    setTitle(note?.title ?? ''); setSummary(note?.summary ?? ''); setConcepts(note?.concepts.join('、') ?? ''); setError('')
  }, [note?.id, note?.revision, note?.title, note?.summary])
  const dirty = !!note && (title !== note.title || summary !== note.summary || concepts !== note.concepts.join('、'))
  const sourceReady = !!note?.sources.length
  const approved = note?.review_status === 'approved' && note.reviewed_revision === note.revision
  function save() {
    if (!title.trim() || !summary.trim()) { setError('请填写笔记标题和摘要，再保存草稿。'); return }
    onSave({ title: title.trim(), summary: summary.trim(), concepts: concepts.split(/[、,，\n]/).map(item => item.trim()).filter(Boolean).slice(0, 20) })
    setError(''); notify('草稿已保存；内容变化后需要重新审核。')
  }
  function review(decision: 'submit' | 'approve' | 'reject') {
    if (dirty) { setError('有尚未保存的修改，请先保存草稿。'); return }
    if (!sourceReady && decision !== 'reject') { setError('这份笔记缺少来源引用，请补充来源后再审核。'); return }
    setError(''); onReview(decision)
  }
  return <div className="page-content notes-page"><div className="page-heading"><div><p className="eyebrow">KEEP THE LITTLE DISCOVERIES</p><h1>把读到的，变成自己的发现。</h1><p className="page-description">《{book.title}》的阅读笔记 · 先核对来源，再由主人审核。</p></div><Button variant="ghost" onClick={() => navigate('reader', book.id)}>回到伴读 <Icon name="arrow" size={16}/></Button></div>
    <div className="notes-origin"><Icon name="info" size={17}/><span>{book.origin === 'mock' ? '模拟笔记与本地主人审核，用于演示流程；不代表模型实测或服务端身份验证。' : '请核对原书与来源引用。审核与分享权限需由服务端确认。'}</span></div>
    {state === 'loading' ? <div className="notes-state" role="status"><span className="notes-state-icon"><Icon name="note" size={28}/></span><h2>正在整理阅读笔记</h2><p>摘要、概念与来源引用正在加载。</p></div> : state === 'error' ? <div className="notes-state" role="alert"><span className="notes-state-icon"><Icon name="alert" size={28}/></span><h2>笔记暂时没有打开</h2><p>本次模拟加载失败，重新加载后可继续审阅。</p><Button variant="secondary" onClick={() => setState('success')}>重新加载笔记</Button></div> : state === 'empty' || !note ? <div className="notes-state"><span className="notes-state-icon"><Icon name="note" size={28}/></span><h2>还没有阅读笔记</h2><p>图书分析完成后，会在这里生成一份默认私密的草稿。</p><Button variant="secondary" onClick={() => navigate('progress', book.id)}>查看分析进度 <Icon name="arrow" size={16}/></Button></div> : <div className="notes-layout"><section className="notes-editor-card"><div className="notes-card-heading"><div className="notes-badges"><Badge tone={approved ? 'green' : 'amber'}>{reviewLabels[note.review_status]}</Badge><Badge tone={note.visibility === 'shared' ? 'green' : 'neutral'}>{note.visibility === 'shared' ? '已分享' : '私密'}</Badge><span className="notes-revision">版本 {note.revision}</span></div><button type="button" className="notes-preview-toggle" aria-pressed={preview} onClick={() => setPreview(value => !value)}>{preview ? '继续编辑' : '预览笔记'} <Icon name={preview ? 'note' : 'book'} size={16}/></button></div>
      {preview ? <article className="notes-preview-article"><p className="notes-article-kicker">《{book.title}》阅读笔记</p><h2>{title || '未命名笔记'}</h2><p>{summary || '摘要尚未填写。'}</p><div className="notes-concept-list">{concepts.split(/[、,，\n]/).map(item => item.trim()).filter(Boolean).map((concept, index) => <Badge key={`${concept}-${index}`}>{concept}</Badge>)}</div></article> : <div className="notes-fields"><label className="notes-field">笔记标题 <span aria-hidden="true">*</span><input aria-label="笔记标题" maxLength={120} value={title} onChange={event => setTitle(event.target.value)} placeholder="给这个发现起个名字"/></label><label className="notes-field">阅读摘要 <span aria-hidden="true">*</span><textarea aria-label="阅读摘要" rows={8} maxLength={6000} value={summary} onChange={event => setSummary(event.target.value)} placeholder="用自己的话整理故事、人物或概念…"/><small>{summary.length} / 6000 字</small></label><label className="notes-field">人物 / 概念<input aria-label="人物或概念" maxLength={500} value={concepts} onChange={event => setConcepts(event.target.value)} placeholder="用顿号分隔，例如：勇气、友谊"/><small>最多保留 20 个条目，便于回看与检索。</small></label></div>}
      <section className="notes-sources"><div className="notes-section-heading"><h2>每一个发现，都有出处</h2><span>{note.sources.length} 处来源引用</span></div>{note.sources.length ? note.sources.map((source, index) => <div className="notes-source" key={`${source.page_no}-${index}`}><span className="notes-source-number">{String(index + 1).padStart(2, '0')}</span><div><blockquote>{source.quote || '此处未提供引用文字，请打开来源核对。'}</blockquote><p>{source.source === 'original_page' ? '原书书页' : source.source === 'script' ? '故事脚本' : '视频画面'} · 第 {source.page_no} 页{source.start_ms !== null ? ` · ${(source.start_ms / 1000).toFixed(1)} 秒` : ''}</p></div><button type="button" onClick={() => onSeek(source)} aria-label={`查看来源第 ${source.page_no} 页`}>查看来源 <Icon name="arrow" size={15}/></button></div>) : <div className="notes-warning"><Icon name="alert" size={17}/>来源待补充；缺少引用时不能提交审核。</div>}</section>
      {error && <p className="notes-form-error" role="alert"><Icon name="alert" size={17}/>{error}</p>}<div className="notes-editor-footer"><span>{dirty ? '有未保存的修改' : '当前内容已保存'} · {book.origin === 'mock' ? '本地模拟' : '服务端数据'}</span><Button variant="secondary" onClick={save} disabled={!dirty}>保存草稿 <Icon name="check" size={17}/></Button></div>
    </section><aside className="notes-review-panel"><div className="notes-review-illustration"><span>✳</span><h2>把分享，交给你决定。</h2><p>草稿属于你。<br/>确认每一条内容，再让它被看见。</p></div><div className="notes-review-body"><div className="notes-review-step"><span className="done"><Icon name="check" size={15}/></span><div><h3>草稿默认私密</h3><p>分析结果不是定稿，先编辑并核对原书。</p></div></div><div className="notes-review-step"><span className={approved ? 'done' : ''}>{approved ? <Icon name="check" size={15}/> : '2'}</span><div><h3>主人审核当前版本</h3><p>{approved ? `版本 ${note.revision} 已通过审核。` : note.review_status === 'in_review' ? '请主人核对摘要、引用与适龄内容。' : '保存内容后，提交主人审核。'}</p></div></div><div className="notes-review-step"><span>3</span><div><h3>选择分享方式</h3><p>指定用户或限时链接，随时撤销。</p></div></div>
      <div className="notes-review-actions">{note.review_status === 'draft' || note.review_status === 'rejected' ? <Button onClick={() => review('submit')} disabled={dirty || !sourceReady}>提交主人审核 <Icon name="arrow" size={16}/></Button> : note.review_status === 'in_review' ? <><Button onClick={() => review('approve')} disabled={dirty || !sourceReady}>主人确认通过 <Icon name="check" size={17}/></Button><Button variant="secondary" onClick={() => review('reject')} disabled={dirty}>退回修改</Button></> : <Button onClick={() => navigate('sharing', book.id)} disabled={dirty || !approved}>设置分享 <Icon name="arrow" size={16}/></Button>}</div>
      {dirty && <p className="notes-inline-help">保存修改会生成新版本，并使旧版审核和分享失效。</p>}{note.review_status === 'rejected' && <p className="notes-inline-help">主人已退回，请修改后重新提交。</p>}<p className="notes-lock-caption"><Icon name="lock" size={14}/>{approved ? '已审核也保持私密，直到你选择分享。' : '未审核的草稿不能分享。'}</p></div></aside></div>}
  </div>
}

