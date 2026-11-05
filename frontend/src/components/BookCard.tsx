import type { Book } from '../features/books/types'
import { bookTypeLabels } from '../features/books/types'
import { Badge, Icon } from './ui'

export function BookCover({ book }: { book: Book }) {
  return <div className={`book-cover cover-${book.id}`}><img src={book.cover} alt=""/><div className="cover-lettering"><small>PAPER STORIES</small><strong>{book.title}</strong><span>原创演示绘本</span></div></div>
}

export function BookCard({ book, onOpen }: { book: Book; onOpen: (book: Book) => void }) {
  const status = { READY: ['可阅读', 'green'], REVIEW_REQUIRED: ['待确认', 'amber'], GENERATING: ['生成中', 'purple'], FAILED: ['处理失败', 'amber'] } as const
  return <button className="book-card" onClick={() => onOpen(book)} aria-label={`查看${book.title}，${status[book.status][0]}`}>
    <div className="book-art"><BookCover book={book}/><span className="book-open"><Icon name="arrow" size={18}/></span></div>
    <div className="book-meta"><h3>{book.title}</h3><Badge tone={status[book.status][1]}>{status[book.status][0]}</Badge></div>
    <div className="book-details"><span>{bookTypeLabels[book.classification.confirmed_type ?? book.classification.predicted_type]} · {book.page_count} 页</span><span>{book.updated_label}更新</span></div>
    {book.classification.confidence !== null && book.classification.confidence < 0.8 && <span className="confidence-note"><Icon name="info" size={13}/>类型置信度较低，待主人确认</span>}
  </button>
}
