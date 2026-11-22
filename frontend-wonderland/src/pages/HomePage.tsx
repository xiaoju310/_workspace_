import { useRef, useState } from 'react'
import { BookCard } from '../components/BookCard'
import { Badge, Button, Icon, SectionHead, StatePanel } from '../components/ui'
import { HeroScene, OrnamentStars, SceneBackdrop } from '../components/PaperScene'
import { Doodle } from '../components/Doodles'
import { OwlMascot } from '../components/OwlMascot'
import { DeleteBookDialog } from '../components/DeleteBookDialog'
import type { ReadingBook, ReadingNote } from '../app/types'
import type { BookType, PreviewState } from '../features/books/types'
import { bookTypeLabels } from '../features/books/types'
import { mostRecentlyRead, normalizeReadingPosition } from '../features/books/readingPosition'

export default function HomePage({
  state,
  setState,
  onImport,
  onBook,
  onStartOver,
  onNote,
  onDeleteBook,
  books,
  notes,
  appMode = 'demo',
}: {
  state: PreviewState
  setState: (value: PreviewState) => void
  onImport: () => void
  onBook: (book: ReadingBook) => void
  onStartOver?: (book: ReadingBook) => void
  onNote: (id: string) => void
  onDeleteBook: (book: ReadingBook) => Promise<void>
  books: ReadingBook[]
  notes: ReadingNote[]
  appMode?: 'live' | 'demo'
}) {
  const [filter, setFilter] = useState<BookType | 'all'>('all')
  const [query, setQuery] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ReadingBook | null>(null)
  const [deleteError, setDeleteError] = useState('')
  // 同一轮点击也只发送一次删除请求；失败时保留弹窗，方便重试。
  const deletePending = useRef(false)
  async function removeBook(book: ReadingBook) {
    if (deletePending.current) return
    deletePending.current = true
    setDeletingId(book.id); setDeleteError('')
    try { await onDeleteBook(book); setDeleteTarget(null) }
    catch (e) { setDeleteError(`删除失败：${e instanceof Error ? e.message : String(e)}`) }
    finally { deletePending.current = false; setDeletingId(null) }
  }
  function closeDeleteDialog() {
    if (deletePending.current) return
    setDeleteTarget(null); setDeleteError('')
  }
  const filtered = books.filter(
    book =>
      (filter === 'all' || (book.classification.confirmed_type ?? book.classification.predicted_type) === filter) &&
      book.title.includes(query.trim()),
  )
  const featured = books.filter(book => book.status === 'READY').slice(0, 3)
  const lastRead = mostRecentlyRead(books)
  const lastPosition = lastRead ? normalizeReadingPosition(lastRead.reading_position,lastRead.pages.length) : null
  const shelfCount = state === 'empty' ? 0 : books.length

  return (
    <div className="home-page page-content">
      <DeleteBookDialog book={deleteTarget} busy={deletingId !== null} error={deleteError}
        onCancel={closeDeleteDialog} onConfirm={() => { if (deleteTarget) void removeBook(deleteTarget) }} />
      <SceneBackdrop tone="warm" />
      <OrnamentStars count={6} />

      {/* ------------------------------------------------------------------
          第一屏：奇幻立体纸艺主视觉
          ------------------------------------------------------------------ */}
      <section className="hero" aria-labelledby="hero-title">
        <div className="doodle-layer" aria-hidden="true">
          <Doodle name="cloud" className="doodle doodle--cloud doodle--float" size={116} />
          <Doodle name="sun" className="doodle doodle--sun doodle--float-slow" size={92} />
          <Doodle name="arrow" className="doodle doodle--arrow" size={108} />
          <Doodle name="balloon" className="doodle doodle--balloon doodle--float" size={86} />
          <Doodle name="pencil" className="doodle doodle--pencil" size={84} />
          <Doodle name="sparkle" className="doodle doodle--sparkle doodle--float-slow" size={40} />
        </div>
        <div className="hero-copy">
          <span className="hero-kicker">
            <span className="hero-kicker-line" aria-hidden="true" />
            每一本好书，都值得被读懂
          </span>
          <h1 id="hero-title" className="display-title">
            从一页纸，
            <br />
            到一个<span className="hero-em">会回应</span>的世界。
          </h1>
          <p className="hero-lead">
            导入书页，整理阅读发现。
            <br />
            和故事对话，把每一次好奇留在书里。
          </p>
          <div className="hero-actions">
            <Button className="button--coral" onClick={onImport}>
              <Icon name="plus" size={18} /> 导入一本书
              <Icon name="arrow" size={18} />
            </Button>
            <a className="hero-link" href="#shelf">
              先看看书架
              <Icon name="chevronDown" size={16} />
            </a>
          </div>
          <dl className="hero-facts">
            <div>
              <dt><Icon name="check" size={15} />逐页校对</dt>
              <dd>识别结果由主人确认</dd>
            </div>
            <div>
              <dt><Icon name="quote" size={15} />来源可查</dt>
              <dd>每个回答都带页码</dd>
            </div>
            <div>
              <dt><Icon name="lock" size={15} />笔记私享</dt>
              <dd>审核通过才可分享</dd>
            </div>
          </dl>
        </div>

        <div className="hero-stage">
          <span className="hero-stage-sheet hero-stage-sheet--back" aria-hidden="true" />
          <span className="hero-stage-sheet hero-stage-sheet--mid" aria-hidden="true" />
          <div className="hero-plate">
            <span className="tape tape--tl" aria-hidden="true" />
            <span className="tape tape--tr" aria-hidden="true" />
            <HeroScene />
          </div>
          <span className="hero-bubble" aria-hidden="true">今天，翻开哪一本？</span>
          <OwlMascot className="doodle doodle--hero-owl" size={128} />
          <Doodle name="rabbit" className="doodle doodle--hero-rabbit" size={96} />
          <span className="hero-side-note" aria-hidden="true">READ · WONDER · DISCOVER</span>
        </div>
      </section>

      {state === 'success' && lastRead && lastPosition && (
        <section className="continue-reading" aria-labelledby="continue-reading-title">
          <img src={lastRead.cover} alt="" className="continue-reading-cover" />
          <div className="continue-reading-copy">
            <span className="hero-kicker"><Icon name="clock" size={16} /> 上次读到这里</span>
            <h2 id="continue-reading-title">{lastRead.title}</h2>
            <p>第 {lastPosition.page_index + 1} / {lastRead.pages.length} 页 · 自动记住阅读位置</p>
          </div>
          <div className="continue-reading-actions">
            <Button onClick={() => onBook(lastRead)} aria-label={`继续阅读《${lastRead.title}》`}>继续阅读<Icon name="arrow" size={17} /></Button>
            {onStartOver && <Button variant="ghost" onClick={() => onStartOver(lastRead)}>从头阅读</Button>}
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------------
          阅读探索：错落的推荐与"世界入口"
          ------------------------------------------------------------------ */}
      {featured.length > 0 && (
        <section className="explore" aria-labelledby="explore-title">
          <SectionHead id="explore-title" title="从这里翻开" subtitle="选一本，进入它的世界" count={featured.length}>
            <span className="explore-caption">
              <Icon name="sparkle" size={15} />已可阅读
            </span>
          </SectionHead>
          <div className="explore-row">
            {featured.map((book, index) => (
              <button
                key={book.id}
                className={`explore-card explore-card--${(index % 3) + 1}`}
                onClick={() => onBook(book)}
                aria-label={`阅读《${book.title}》`}
              >
                <div className="explore-cover book-plate">
                  <img src={book.cover} alt="" loading="lazy" />
                </div>
                <div className="explore-body">
                  <span className="explore-index">0{index + 1}</span>
                  <h3>{book.title}</h3>
                  <p>{book.subtitle}</p>
                  <span className="explore-meta">
                    {bookTypeLabels[book.classification.confirmed_type ?? book.classification.predicted_type]} · {book.page_count} 页
                    <Icon name="arrow" size={15} />
                  </span>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------------
          书架：立体收藏空间
          ------------------------------------------------------------------ */}
      <section className="bookshelf" id="shelf" aria-labelledby="shelf-title">
        <SectionHead id="shelf-title" title="我的书架" count={shelfCount} subtitle="故事，在这里等你">
          <label className="search">
            <Icon name="search" size={17} />
            <input
              type="search"
              placeholder="找一本书…"
              aria-label="搜索图书"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </label>
        </SectionHead>

        <div className="shelf-toolbar">
          <div className="filter-tabs" aria-label="图书类型筛选">
            {([['all', '全部图书'], ['picture_book', '绘本'], ['fiction', '文学故事'], ['nonfiction', '知识读物']] as const).map(([value, label]) => (
              <button key={value} className={filter === value ? 'selected' : ''} aria-pressed={filter === value} onClick={() => setFilter(value)}>
                {label}
              </button>
            ))}
          </div>
          <span className="shelf-count">{filtered.length} 本在架</span>
        </div>

        {state !== 'success' ? (
          <StatePanel kind={state} onRetry={() => setState('success')} onImport={onImport} />
        ) : books.length === 0 ? (
          <StatePanel kind="empty" onRetry={() => setState('success')} onImport={onImport} />
        ) : filtered.length === 0 ? (
          <div className="search-empty" role="status">
            <span className="search-empty-icon"><Icon name="search" size={28} /></span>
            <h3>还没有找到这本书</h3>
            <p>试试其他书名，或导入一本新的图书。</p>
            <Button variant="ghost" onClick={() => { setQuery(''); setFilter('all') }}>清除筛选</Button>
          </div>
        ) : (
          <div className="book-grid">
            {filtered.map((book, index) => (
              <div className={`book-slot ${index % 3 === 1 ? 'is-raised' : ''}`} key={book.id}>
                <BookCard book={book} onOpen={onBook} />
                <button type="button" className="book-delete-button"
                  disabled={deletingId !== null || book.status === 'GENERATING'}
                  aria-label={`删除《${book.title}》`}
                  title={book.status === 'GENERATING' ? '正在生成，结束后可删除' : '删除这本图书及关联记录'}
                  onClick={() => { setDeleteError(''); setDeleteTarget(book) }}>
                  <Icon name="trash" size={16} />{deletingId === book.id ? '正在删除…' : '删除图书'}
                </button>
              </div>
            ))}
            <button className="add-book-card" onClick={onImport}>
              <span className="add-book-mark"><Icon name="plus" size={26} /></span>
              <strong>下一本，会是什么？</strong>
              <p>带一本喜欢的书进来</p>
              <span className="add-label">导入图书 <Icon name="arrow" size={15} /></span>
            </button>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------------
          最近的笔记：便签墙
          ------------------------------------------------------------------ */}
      <section className="recent-notes" aria-labelledby="notes-title">
        <SectionHead id="notes-title" title="留住阅读里的小发现" subtitle="最近的笔记">
          <span className="private-caption">
            <Icon name="lock" size={14} />默认私密 · 审核后再分享
          </span>
        </SectionHead>
        {state === 'success' ? (
          <div className="notes-wall">
            {notes.map((note, index) => (
              <button key={note.id} className={`note-card note-card--${(index % 3) + 1}`} onClick={() => onNote(note.id)}>
                <span className="note-icon"><Icon name="note" size={22} /></span>
                <div>
                  <div className="note-title">
                    <h3>{note.title}</h3>
                    <Badge tone={note.review_status === 'draft' ? 'amber' : 'neutral'}>
                      {note.review_status === 'draft' ? '草稿' : '私密'}
                    </Badge>
                    {books.find(book => book.id === note.book_id)?.origin === 'mock' && <Badge tone="amber">模拟笔记</Badge>}
                  </div>
                  <p>《{books.find(book => book.id === note.book_id)?.title}》 · {note.sources.length} 处来源引用</p>
                </div>
                <Icon name="chevron" size={17} />
              </button>
            ))}
          </div>
        ) : (
          <div className="notes-placeholder">
            {state === 'loading' ? '正在整理笔记…' : state === 'error' ? '笔记暂未加载，请在书架重试后查看。' : '阅读之后，把第一个发现留在这里。'}
          </div>
        )}
      </section>

      <div className="home-footnote">
        <Icon name="info" size={15} />
        <span>
          {appMode === 'live'
            ? '书架中的原创示例带有模拟标记；新导入图书可走真实后端，视频和分享以实际接口返回为准。'
            : '当前是本地演示模式：示例图书、任务、笔记和分享均为模拟内容，不代表真实模型结果。'}
        </span>
      </div>
    </div>
  )
}
