import { normalizeReadingPosition } from '../features/books/readingPosition'
import type { ReadingBook } from '../app/types'
import { bookTypeLabels } from '../features/books/types'
import { Badge, Icon } from './ui'

/** 立体书封：封面底板 + 书脊高光 + 压印标题 */
export function BookCover({ book }: { book: ReadingBook }) {
  return (
    <div className={`book-cover cover-${book.id}`}>
      <img src={book.cover} alt="" loading="lazy" />
      <div className="cover-lettering">
        <small>PAPER STORIES</small>
        <strong>{book.title}</strong>
        <span>{book.origin === 'mock' ? '原创模拟内容' : '用户导入图书'}</span>
      </div>
    </div>
  )
}

export function BookCard({ book, onOpen }: { book: ReadingBook; onOpen: (book: ReadingBook) => void }) {
  const status = {
    READY: ['可阅读', 'green'],
    REVIEW_REQUIRED: ['待确认', 'amber'],
    GENERATING: ['生成中', 'purple'],
    FAILED: ['处理失败', 'red'],
  } as const
  const [statusLabel, statusTone] = status[book.status]
  const position=book.status==='READY'?normalizeReadingPosition(book.reading_position,book.pages.length):null
  return (
    <button
      className="book-card"
      onClick={() => onOpen(book)}
      aria-label={`查看${book.title}，${book.origin === 'mock' ? '模拟内容' : '真实建档'}，${statusLabel}${position?`，继续阅读第${position.page_index+1}页`:''}`}
    >
      <span className="book-card-shadow" aria-hidden="true" />
      <div className="book-art">
        <BookCover book={book} />
        <span className="book-open">
          <Icon name="arrow" size={18} />
        </span>
      </div>
      <div className="book-meta">
        <h3>{book.title}</h3>
        <div className="book-tags">
          <Badge tone={book.origin === 'mock' ? 'amber' : 'green'}>{book.origin === 'mock' ? '模拟内容' : '真实建档'}</Badge>
          <Badge tone={statusTone}>{statusLabel}</Badge>
        </div>
      </div>
      <div className="book-details">
        <span>{bookTypeLabels[book.classification.confirmed_type ?? book.classification.predicted_type]} · {book.page_count} 页</span>
        <span>{book.updated_label}更新</span>
      </div>
      {position && <span className="book-reading-position"><Icon name="clock" size={14} />继续阅读 · 第 {position.page_index+1} / {book.pages.length} 页</span>}
      {book.classification.confidence !== null && book.classification.confidence < 0.8 && (
        <span className="confidence-note">
          <Icon name="info" size={13} />类型置信度较低，待主人确认
        </span>
      )}
    </button>
  )
}
