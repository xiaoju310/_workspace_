import type { Book, BookType, PreviewState } from '../features/books/types'

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
  safety_reviewed: boolean
}
export interface ReadingNote {
  id: string; book_id: string; title: string; summary: string; concepts: string[]; sources: Source[]
  review_status: 'draft' | 'in_review' | 'approved' | 'rejected'
  visibility: 'private' | 'shared'
  revision: number; reviewed_revision: number | null; updated_at: string
}
export interface ShareGrant {
  id: string; token: string; note_id: string; note_revision: number; snapshot: ReadingNote
  mode: 'named_users' | 'expiring_link'; recipients: string[]; expires_at: string; status: 'active' | 'revoked'; created_at: string
}
export interface Interaction {
  id: string; book_id: string; run_id: string; kind: 'question' | 'touch'; question: string; answer: string
  transcript: string; video_ms: number; sources: Source[]; latency_ms: number | null; created_at: string; uncertain: boolean
  origin: 'mock' | 'real'; cached: boolean
}
export interface JobState { status: 'idle' | 'running' | 'failed' | 'review' | 'ready'; stage: number; progress: number; error: string | null; run_id: string | null; events: { stage: string; message: string; time: string }[] }
export interface PageContext {
  book: ReadingBook
  state: PreviewState
  setState: (state: PreviewState) => void
  navigate: Navigate
  notify: (text: string) => void
}
export interface WorkflowProps extends PageContext {
  updateBook: (updater: (book: ReadingBook) => ReadingBook) => void
  job: JobState
  setJob: (updater: JobState | ((job: JobState) => JobState)) => void
  onGenerate: () => void
}
export interface ReaderProps extends PageContext {
  interactions: Interaction[]
  onInteraction: (item: Interaction) => void
  seekTo: number | null
  onSeekHandled: () => void
  askQuestion: (text: string, videoMs: number) => Promise<Interaction>
  identifyTouch: (x: number, y: number, videoMs: number, box: { width: number; height: number }) => Promise<Interaction>
}
export interface HistoryProps extends PageContext { interactions: Interaction[]; onSeek: (ms: number) => void }
export interface NotesProps extends PageContext {
  note: ReadingNote | null
  onSave: (patch: Pick<ReadingNote, 'title' | 'summary' | 'concepts'>) => void
  onReview: (decision: 'submit' | 'approve' | 'reject') => void
  onSeek: (source: Source) => void
}
export interface SharingProps extends PageContext {
  note: ReadingNote | null
  grants: ShareGrant[]
  onCreate: (input: { mode: ShareGrant['mode']; recipients: string[]; minutes: number }) => ShareGrant | null
  onRevoke: (id: string) => void
  onOpen: (grant: ShareGrant) => void
}
export interface SharedProps {
  state: PreviewState; grant: ShareGrant | null; recipient: string; setRecipient: (value: string) => void; navigate: Navigate
}
export interface ImportedBookInput { title: string; authorization_ref: string; type: BookType; pages: { id: string; name: string; url: string; size: number; demo?: boolean }[] }
