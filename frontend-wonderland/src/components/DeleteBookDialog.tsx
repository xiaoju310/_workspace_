import { useEffect, useId, useRef } from 'react'
import type { ReadingBook } from '../app/types'
import { OwlMascot } from './OwlMascot'
import { Icon } from './ui'

/** 原生 dialog 负责焦点圈定和背景隔离；不再使用浏览器默认确认框。 */
export function DeleteBookDialog({ book, busy, error, onCancel, onConfirm }: {
  book: ReadingBook | null
  busy: boolean
  error: string
  onCancel: () => void
  onConfirm: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const cancelButton = useRef<HTMLButtonElement>(null)
  const id = useId()
  const bookId = book?.id
  useEffect(() => {
    const element = dialog.current
    if (!bookId || !element) return
    const previousOverflow = document.body.style.overflow
    element.showModal()
    document.body.style.overflow = 'hidden'
    // 默认选择“先留着”，回车不会误删。关闭时 dialog 自动归还焦点。
    cancelButton.current?.focus()
    return () => { element.close(); document.body.style.overflow = previousOverflow }
  }, [bookId])

  return (
    <dialog ref={dialog} className="book-delete-dialog" aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`} aria-busy={busy || undefined}
      onCancel={event => { event.preventDefault(); if (!busy) onCancel() }}>
      {book && <div className="book-delete-dialog-content">
        <button type="button" className="book-delete-dialog-close" aria-label="关闭删除确认"
          disabled={busy} onClick={onCancel}><Icon name="close" size={20} /></button>
        <div className="book-delete-dialog-mascot"><OwlMascot size={90} /><span>书架整理时间</span></div>
        <h2 id={`${id}-title`}>要和这本书告别吗？</h2>
        <p className="book-delete-dialog-intro">先确认一下，再给书架腾个位置吧。</p>
        <div className="book-delete-dialog-book"><span><Icon name="book" size={26} /></span>
          <div><small>即将删除的图书</small><strong>《{book.title}》</strong></div>
        </div>
        <div id={`${id}-description`} className="book-delete-dialog-warning">
          <strong><Icon name="info" size={18} />删除后无法恢复</strong>
          <p>将移除{book.server_book_id ? '服务器及本机书架中' : '本机书架中'}这本书的书页、笔记、分享和阅读记录。</p>
        </div>
        <p className="book-delete-dialog-safe"><Icon name="check" size={17} />其他图书和独立导入草稿不受影响</p>
        {error && <p role="alert" className="book-delete-dialog-error">{error}</p>}
        <div className="book-delete-dialog-actions">
          <button ref={cancelButton} type="button" className="book-delete-keep" disabled={busy} onClick={onCancel}>先留着</button>
          <button type="button" className="book-delete-confirm" disabled={busy} onClick={onConfirm}>
            <Icon name="trash" size={18} />{busy ? '正在删除…' : '确认删除'}
          </button>
        </div>
      </div>}
    </dialog>
  )
}
