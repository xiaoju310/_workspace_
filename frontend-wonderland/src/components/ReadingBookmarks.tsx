import { useState } from 'react'
import type { ReadingBook, ReadingBookmark } from '../app/types'
import { pageNoOf } from '../features/interaction/pageTimeline'

type Props = {
  book: ReadingBook
  currentPageId: string | null
  onChange: (update: (items: ReadingBookmark[]) => ReadingBookmark[]) => void
  onOpen: (bookmark: ReadingBookmark) => void
}
type Editor = { id: string | null; pageId: string; note: string }

/** Page identity, not page number or array position, survives reordering. */
export default function ReadingBookmarks({ book, currentPageId, onChange, onOpen }: Props) {
  const bookmarks = book.bookmarks ?? []
  const [editor, setEditor] = useState<Editor | null>(null)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  function start() {
    const existing = bookmarks.find(item => item.page_id === currentPageId)
    setEditor({ id: existing?.id ?? null, pageId: currentPageId ?? '', note: existing?.note ?? '' })
    setError(''); setMessage(''); setDeleting(null)
  }
  function save() {
    if (!editor) return
    if (!book.pages.some(page => page.id === editor.pageId)) { setError('请选择有效书页；原书页可能已被移除。'); return }
    if (editor.note.length > 500) { setError('书签备注最多500个字。'); return }
    if (bookmarks.some(item => item.id !== editor.id && item.page_id === editor.pageId)) { setError('这一页已有书签，请修改已有书签的备注。'); return }
    const now = new Date().toISOString()
    const next: ReadingBookmark = { id: editor.id ?? crypto.randomUUID(), page_id: editor.pageId, note: editor.note.trim(), created_at: now, updated_at: now }
    onChange(items => editor.id
      ? items.map(item => item.id === editor.id ? { ...item, note: next.note, updated_at: now } : item)
      : items.some(item => item.page_id === next.page_id) ? items : [...items, next])
    setEditor(null); setError(''); setMessage('书签已更新，将随本书草稿保存。')
  }
  return <section className="bookmark-panel" aria-label="本书书签">
    <div className="bookmark-heading">
      <div><h2>本书书签 <span>（{bookmarks.length}）</span></h2><p>收藏想再读的书页；不会替换上次阅读位置。</p></div>
      <button type="button" onClick={start} disabled={!book.pages.length}>{bookmarks.some(item => item.page_id === currentPageId) ? '修改本页书签' : '添加书签'}</button>
    </div>
    {message && <p role="status">{message}</p>}
    {editor && <form className="bookmark-editor" onSubmit={event => { event.preventDefault(); save() }}>
      <label>书签书页<select value={editor.pageId} disabled={editor.id !== null} onChange={event => setEditor({ ...editor, pageId: event.target.value })}>
        <option value="">请选择书页</option>
        {book.pages.map((page, index) => <option key={page.id} value={page.id}>第 {pageNoOf(page, index)} 页 · {page.name}</option>)}
      </select></label>
      {!currentPageId && !editor.id && <p>当前视频页码尚未准确定位，请手动选择书页；不会按估算页码添加。</p>}
      <label>书签备注（选填，最多500字）<textarea value={editor.note} maxLength={500} placeholder="例如：想再读一遍的段落" onChange={event => setEditor({ ...editor, note: event.target.value })} /></label>
      {error && <p role="alert">{error}</p>}
      <div className="bookmark-actions"><button type="submit">保存书签</button><button type="button" onClick={() => { setEditor(null); setError('') }}>取消编辑</button></div>
    </form>}
    <details className="bookmark-list"><summary>展开书签列表（{bookmarks.length}）</summary>
      {!bookmarks.length && <p>还没有书签，读到喜欢的地方就添加一个吧。</p>}
      {bookmarks.map(item => {
        const index = book.pages.findIndex(page => page.id === item.page_id)
        const label = index < 0 ? '原书页已移除' : `第 ${pageNoOf(book.pages[index], index)} 页`
        return <article key={item.id} className="bookmark-item">
          <h3>{label}</h3><p>{item.note || '未填写备注'}</p>
          <div className="bookmark-actions">
            <button type="button" disabled={index < 0} onClick={() => onOpen(item)}>回到书页 · {label}</button>
            <button type="button" onClick={() => { setEditor({ id: item.id, pageId: item.page_id, note: item.note }); setError(''); setMessage(''); setDeleting(null) }}>修改备注</button>
            <button type="button" onClick={() => setDeleting(item.id)}>删除书签</button>
          </div>
          {deleting === item.id && <div className="bookmark-delete" role="group" aria-label="确认删除书签">
            <p>删除这个书签？书页和阅读进度不会被删除。</p>
            <button type="button" onClick={() => {
              onChange(items => items.filter(mark => mark.id !== item.id)); setDeleting(null)
              if (editor?.id === item.id) setEditor(null)
              setMessage('书签已删除。')
            }}>确认删除</button>
            <button type="button" onClick={() => setDeleting(null)}>保留书签</button>
          </div>}
        </article>
      })}
    </details>
  </section>
}
