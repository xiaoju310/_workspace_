import type { Book, BookType, PreviewState } from '../features/books/types'
import type { TouchPoint, ViewportInfo } from '../types/interaction'

export type Page = 'home' | 'import' | 'review' | 'classification' | 'progress' | 'reader' | 'history' | 'notes' | 'sharing' | 'shared' | 'settings'
export type Navigate = (page: Page, bookId?: string) => void
export type Source = { page_no: number; start_ms: number | null; end_ms: number | null; source: 'original_page' | 'script' | 'video_frame'; quote: string }
export interface PageDraft { id: string; name: string; image_url: string; ocr_text: string; confidence: number; revision: number; confirmed: boolean; demo: boolean }
export interface ReadingBook extends Book {
  authorization_ref: string
  pages: PageDraft[]
  age_band: string
  run_id: string | null
  job_id: string | null
  video_url: string | null
  origin: 'mock' | 'real'
  /** 仅当该书已通过 A 的 POST /api/books 真实建档后才有值；没有它就不能做任何服务端笔记/分类操作 */
  server_book_id?: string | null
  safety_reviewed: boolean
}
export interface ReadingNote {
  id: string; book_id: string; title: string; summary: string; concepts: string[]; sources: Source[]
  review_status: 'draft' | 'in_review' | 'approved' | 'rejected'
  visibility: 'private' | 'shared'
  revision: number; reviewed_revision: number | null; updated_at: string
  /** 服务端笔记 ID（真实建档后才有）；没有则审核/分享只能是本地草稿 */
  server_id?: string | null
}
export interface ShareGrant {
  id: string; token: string; note_id: string; note_revision: number; snapshot: ReadingNote
  mode: 'named_users' | 'expiring_link'; recipients: string[]; expires_at: string; status: 'active' | 'revoked'; created_at: string
  /** 是否已由服务端创建（revoke 时必须调用服务端） */
  server?: boolean
}
export interface Interaction {
  id: string; book_id: string; run_id: string; kind: 'question' | 'touch'; question: string; answer: string
  transcript: string; video_ms: number; sources: Source[]; latency_ms: number | null; created_at: string; uncertain: boolean
  origin: 'mock' | 'real'; cached: boolean
  /** Live 下是否已写入后端 A；false 时界面必须提示 */
  persisted?: boolean; persist_error?: string
}
export interface JobState { status: 'idle' | 'running' | 'failed' | 'review' | 'ready'; stage: number; progress: number; error: string | null; run_id: string | null; events: { stage: string; message: string; time: string }[] }
export interface PageContext {
  book: ReadingBook
  state: PreviewState
  setState: (state: PreviewState) => void
  navigate: Navigate
  notify: (text: string) => void
  appMode?: 'live' | 'demo'
}
export interface WorkflowProps extends PageContext {
  updateBook: (updater: (book: ReadingBook) => ReadingBook) => void
  job: JobState
  setJob: (updater: JobState | ((job: JobState) => JobState)) => void
  onGenerate: () => void
}
/** 坐标映射算法的完整输出，原样透传到 A，不得在下游重算 */
export interface TouchDetail { touch_point: TouchPoint; viewport_info: ViewportInfo }
export interface ReaderProps extends PageContext {
  interactions: Interaction[]
  onInteraction: (item: Interaction) => void
  seekTo: number | null
  onSeekHandled: () => void
  askQuestion: (text: string, videoMs: number, inputMethod?: 'speech' | 'keyboard') => Promise<Interaction>
  identifyTouch: (x: number, y: number, videoMs: number, box: { width: number; height: number }, detail?: TouchDetail) => Promise<Interaction>
}
export interface HistoryProps extends PageContext { interactions: Interaction[]; onSeek: (ms: number) => void }
export interface NotesProps extends PageContext {
  note: ReadingNote | null
  onSave: (patch: Pick<ReadingNote, 'title' | 'summary' | 'concepts'>) => void
  onReview: (decision: 'submit' | 'approve' | 'reject') => void | Promise<void>
  onSeek: (source: Source) => void
}
export interface SharingProps extends PageContext {
  note: ReadingNote | null
  grants: ShareGrant[]
  onCreate: (input: { mode: ShareGrant['mode']; recipients: string[]; minutes: number }) => Promise<ShareGrant | null>
  onRevoke: (id: string) => void | Promise<void>
  onOpen: (grant: ShareGrant) => void
}
export interface SharedProps {
  state: PreviewState; grant: ShareGrant | null; recipient: string; setRecipient: (value: string) => void; navigate: Navigate
}
export interface ImportedBookInput { title: string; authorization_ref: string; type: BookType; pages: { id: string; name: string; url: string; size: number; demo?: boolean }[] }
