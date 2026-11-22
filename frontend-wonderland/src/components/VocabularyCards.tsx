import { useState } from 'react'
import type { ReadingBook, Source, VocabularyCard } from '../app/types'
import { pageNoOf } from '../features/interaction/pageTimeline'
import { upsertVocabulary, validateVocabulary, vocabularyKey, vocabularySource } from '../features/vocabulary/vocabulary'

type Props = {
  book: ReadingBook
  pageNo: number | null
  onChange: (update: (cards: VocabularyCard[]) => VocabularyCard[]) => void
  onSource: (source: Source) => void
}
type Editor = { id: string | null; word: string; meaning: string; example: string; pageNo: number | null }
export default function VocabularyCards({ book, pageNo, onChange, onSource }: Props) {
  const cards = book.vocabulary ?? []
  const [editor, setEditor] = useState<Editor | null>(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<'all' | 'learning' | 'mastered'>('all')
  const [revealed, setRevealed] = useState<string[]>([])
  const [deleting, setDeleting] = useState<string | null>(null)
  const shown = cards.filter(c => filter === 'all' || c.mastered === (filter === 'mastered'))
  function save() {
    if (!editor) return
    const message = validateVocabulary(editor.word, editor.meaning, editor.example)
    if (message) { setError(message); return }
    if (cards.some(c => c.id !== editor.id && vocabularyKey(c.word) === vocabularyKey(editor.word))) {
      setError('这本书已收录这个生词，请在已有卡片上修改。'); return
    }
    const page = book.pages.find((p, i) => pageNoOf(p, i) === editor.pageNo)
    if (editor.pageNo !== null && !page) { setError('来源书页已不存在，请重新选择。'); return }
    const previous = cards.find(c => c.id === editor.id)
    const now = new Date().toISOString()
    const card: VocabularyCard = {
      id: previous?.id ?? crypto.randomUUID(), word: editor.word.trim(), meaning: editor.meaning.trim(), example: editor.example.trim(),
      source: vocabularySource(editor.pageNo, page?.edit_text ?? page?.ocr_text ?? '', editor.word),
      mastered: previous?.mastered ?? false, created_at: previous?.created_at ?? now, updated_at: now,
    }
    onChange(current => upsertVocabulary(current, card))
    setEditor(null); setError('')
  }
  return <section className="vocabulary-panel" aria-label="本书生词卡片">
    <div className="vocabulary-heading"><h2>生词卡片</h2><span>{cards.length} 个 · 已掌握 {cards.filter(c => c.mastered).length} 个</span>
      <button type="button" onClick={() => { setEditor({ id: null, word: '', meaning: '', example: '', pageNo }); setError('') }}>添加生词</button>
    </div>
    <p className="vocabulary-hint">释义和例句由你填写、核对；不会自动编造词义。卡片随本书草稿保存，请留意页面上方的保存状态。</p>
    {editor && <form className="vocabulary-editor" aria-label={editor.id ? '修改生词卡片' : '添加生词卡片'} onSubmit={event => { event.preventDefault(); save() }}>
      <label>生词<input autoFocus required maxLength={80} value={editor.word} onChange={e => setEditor({ ...editor, word: e.target.value })} /></label>
      <label>释义（可稍后补充）<textarea maxLength={1000} value={editor.meaning} onChange={e => setEditor({ ...editor, meaning: e.target.value })} /></label>
      <label>例句（可选）<textarea maxLength={1000} value={editor.example} onChange={e => setEditor({ ...editor, example: e.target.value })} /></label>
      <label>来源书页<select value={editor.pageNo ?? ''} onChange={e => setEditor({ ...editor, pageNo: e.target.value ? Number(e.target.value) : null })}>
        <option value="">不关联书页</option>
        {book.pages.map((p, i) => <option key={p.id} value={pageNoOf(p, i)}>第 {pageNoOf(p, i)} 页</option>)}
      </select></label>
      <p className="vocabulary-hint">来源页仅作阅读定位；没有可靠视频页码时，请自行选择原书页。</p>
      {error && <p role="alert">{error}</p>}
      <div className="vocabulary-actions"><button type="submit">保存卡片</button><button type="button" onClick={() => { setEditor(null); setError('') }}>取消编辑</button></div>
    </form>}
    <div className="vocabulary-filters" role="group" aria-label="生词复习筛选">
      {([['all', '全部'], ['learning', '待复习'], ['mastered', '已掌握']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => { setFilter(value); setRevealed([]) }}>{label}</button>)}
    </div>
    {!shown.length && <p role="status">{cards.length ? '这个分类暂时没有生词。' : '还没有生词卡片，遇到不认识的词就收录下来吧。'}</p>}
    <div className="vocabulary-grid">{shown.map(card => {
      const open = revealed.includes(card.id)
      return <article className="vocabulary-card" key={card.id} aria-label={`生词：${card.word}`}>
        <h3>{card.word}</h3><span>{card.mastered ? '已掌握' : '待复习'}</span>
        <button type="button" aria-expanded={open} onClick={() => setRevealed(current => open ? current.filter(id => id !== card.id) : [...current, card.id])}>{open ? '收起释义' : '翻卡看释义'}</button>
        {open && <div className="vocabulary-definition"><h4>释义</h4><p>{card.meaning || '还未填写释义，可以点击修改补充。'}</p>{card.example && <><h4>例句</h4><p>{card.example}</p></>}</div>}
        <div className="vocabulary-actions">
          {card.source && <button type="button" onClick={() => onSource(card.source!)}>回到原文 · 第 {card.source.page_no} 页</button>}
          <button type="button" onClick={() => onChange(current => current.map(c => c.id === card.id ? { ...c, mastered: !c.mastered, updated_at: new Date().toISOString() } : c))}>{card.mastered ? '还需复习' : '标记已掌握'}</button>
          <button type="button" onClick={() => { setEditor({ id: card.id, word: card.word, meaning: card.meaning, example: card.example, pageNo: card.source?.page_no ?? null }); setError('') }}>修改</button>
          <button type="button" onClick={() => setDeleting(card.id)}>删除</button>
        </div>
        {deleting === card.id && <div className="vocabulary-delete" role="group" aria-label={`确认删除${card.word}`}><p>确定删除这张生词卡片？</p><button type="button" onClick={() => { onChange(current => current.filter(c => c.id !== card.id)); setDeleting(null); setRevealed(current => current.filter(id => id !== card.id)) }}>确认删除</button><button type="button" onClick={() => setDeleting(null)}>保留卡片</button></div>}
      </article>
    })}</div>
  </section>
}
