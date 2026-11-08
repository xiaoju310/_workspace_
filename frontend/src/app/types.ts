import type { Book, BookType, PreviewState } from '../features/books/types'
import type { TouchPoint, ViewportInfo } from '../types/interaction'
import type { SharedLoadResult } from '../lib/sharedNoteView'

export type Page = 'home' | 'import' | 'review' | 'classification' | 'progress' | 'reader' | 'history' | 'notes' | 'sharing' | 'shared' | 'settings'
export type Navigate = (page: Page, bookId?: string) => void
export type Source = { page_no: number; start_ms: number | null; end_ms: number | null; source: 'original_page' | 'script' | 'video_frame'; quote: string }
export interface PageDraft { id: string; name: string; image_url: string; ocr_text: string; confidence: number; revision: number; confirmed: boolean; demo: boolean; server_page_no?: number | null; server_synced_text?: string | null }
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
  /** 分析未成功时，主人选择只用校对文字开启书页问答（无视频、未经内容复核） */
  pages_only?: boolean
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
  /** 服务端分享的访问信息：只读页据此向 A 核验，而不是看本地快照 */
  server_note_id?: string; server_mode?: 'link' | 'invite_only'
}
export interface Interaction {
  id: string; book_id: string; run_id: string; kind: 'question' | 'touch'; question: string; answer: string
  transcript: string; video_ms: number; sources: Source[]; latency_ms: number | null; created_at: string; uncertain: boolean
  origin: 'mock' | 'real'; cached: boolean
  /** Live 下是否已写入后端 A；false 时界面必须提示 */
  persisted?: boolean; persist_error?: string
  /** 仅触控：是否由真实视觉模型给出了物体名称。未接入模型时为 false，看板据此显示"未完成真实识别" */
  recognized?: boolean
}
export interface JobState { status: 'idle' | 'running' | 'failed' | 'review' | 'ready'; stage: number; progress: number; error: string | null; run_id: string | null; events: { stage: string; message: string; time: string }[]; /** true: 进度来自后端真实任务，不走本地模拟计时器 */ server?: boolean }
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
  onOpenPagesOnly?: () => void
}
/**
 * 一次真实录音的结果（D1）。音频只保存在浏览器里（A 没有音频上传接口），
 * 留痕只写音频指纹与元数据，原始文件由用户下载后交给 E。
 */
export interface VoiceCapture {
  blob: Blob
  mimeType: string
  durationMs: number
  /** 浏览器识别出的原始转写；识别失败时为空串，绝不替用户造句 */
  transcript: string
  transcriptIsFinal: boolean
  asrErrorCode?: string
}
/** 坐标映射算法的完整输出，原样透传到 A，不得在下游重算 */
/** 点击时画面上显示的是什么（视频帧 / 静态书页图），以及点击瞬间的截图（D8） */
export interface TouchFrame { kind: 'video' | 'page_image'; page_no: number; snapshot?: { blob: Blob; width: number; height: number; mimeType: string; frameTimeMs?: number | null } | null; snapshot_error?: string
  /** 点击时刻 performance.now()，作为触控延迟起点（重试时为空，从重试开始计） */
  clicked_at?: number
  /** 截图耗时（毫秒） */
  capture_ms?: number
  /** 截图那一帧的视频时间（毫秒）；与 video_ms 相等说明截的就是点击时的画面 */
  frame_time_ms?: number | null
  /** 点击时视频在播放，已自动暂停锁定画面 */
  paused_on_click?: boolean }
export interface TouchDetail { touch_point: TouchPoint; viewport_info: ViewportInfo; frame?: TouchFrame }
/** Live 下当前 run 的视频状态（来自 A 登记的 B 产物） */
export type RunVideoState =
  | { status: 'loading' }
  | { status: 'none'; assetCount: number }
  | { status: 'ready'; url: string; asset_id: string; sha256: string; size_bytes: number }
  | { status: 'error'; error: string }
export interface ReaderProps extends PageContext {
  /** Live 才有；Demo 不查询后端视频 */
  videoState?: RunVideoState
  onReloadVideo?: () => void
  interactions: Interaction[]
  onInteraction: (item: Interaction) => void
  seekTo: number | null
  onSeekHandled: () => void
  askQuestion: (text: string, videoMs: number, inputMethod?: 'speech' | 'keyboard', voice?: VoiceCapture) => Promise<Interaction>
  identifyTouch: (x: number, y: number, videoMs: number, box: { width: number; height: number }, detail?: TouchDetail) => Promise<Interaction>
}
export interface HistoryProps extends PageContext { interactions: Interaction[]; onSeek: (ms: number) => void
  /** Live：从 A 后端导出当前 run 的交互留痕 CSV 与延迟统计（D13） */
  onExportServer?: () => Promise<void> }
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
  /** Live：服务端核验结果（有值时只读页只展示服务端返回的内容） */
  serverView?: { status: 'loading' } | SharedLoadResult | { status: 'missing' }
  onRetryServer?: () => void
}
export interface ImportedBookInput { title: string; authorization_ref: string; type: BookType; pages: { id: string; name: string; url: string; size: number; demo?: boolean }[] }
