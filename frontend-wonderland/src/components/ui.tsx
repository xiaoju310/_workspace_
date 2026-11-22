import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Doodle } from './Doodles'
import { OwlMascot } from './OwlMascot'

/** 线性纸艺图标：统一 24 栅格、1.6 描边、圆角端点，避免使用 Emoji 充当图标 */
const paths: Record<string, ReactNode> = {
  book: <><path d="M3 5.2c3-1.3 6-1.3 9 .8 3-2.1 6-2.1 9-.8v13.4c-3-1.3-6-1.3-9 .8-3-2.1-6-2.1-9-.8Z"/><path d="M12 6v13"/></>,
  home: <><path d="m3 10.2 9-7 9 7"/><path d="M5 9.6V20h14V9.6"/><path d="M9.5 20v-5.5h5V20"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  arrow: <><path d="M4 12h15"/><path d="m13 6 6 6-6 6"/></>,
  upload: <><path d="M12 16.5V3.5"/><path d="m6.5 9 5.5-5.5L17.5 9"/><path d="M4 15.5V20h16v-4.5"/></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.4 15.4 5.1 5.1"/></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><path d="M12 14.5v2.5"/></>,
  unlock: <><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 7.5-2"/></>,
  check: <path d="m5 12.5 4.2 4.2L19 6.5"/>,
  chevron: <path d="m9.5 5 7 7-7 7"/>,
  chevronDown: <path d="m5 9.5 7 7 7-7"/>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
  alert: <><path d="M12 3.5 22 20.5H2Z"/><path d="M12 9.5v5"/><path d="M12 17.4v.2"/></>,
  spark: <><path d="m12 3 2.7 6.4L21 12l-6.3 2.6L12 21l-2.7-6.4L3 12l6.3-2.6Z"/></>,
  sparkle: <><path d="m12 4 1.8 4.6L18.5 10l-4.7 1.4L12 16l-1.8-4.6L5.5 10l4.7-1.4Z"/><path d="m19 2.5.7 1.8 1.8.7-1.8.7L19 7.5l-.7-1.8-1.8-.7 1.8-.7Z"/></>,
  note: <><path d="M6 3.5h8.5L19 8v12.5H6Z"/><path d="M14 3.5V8h5"/><path d="M9 12.5h7"/><path d="M9 16.5h5"/></>,
  info: <><circle cx="12" cy="12" r="8.7"/><path d="M12 11v5.5"/><path d="M12 7.8v.2"/></>,
  image: <><rect x="3" y="3.5" width="18" height="17" rx="3.5"/><circle cx="8.4" cy="8.9" r="1.1"/><path d="m3.6 17 5.4-5.2 3.9 3.8 2.9-2.8 4.7 4.6"/></>,
  up: <path d="m5 15 7-7 7 7"/>,
  down: <path d="m5 9 7 7 7-7"/>,
  clock: <><circle cx="12" cy="12" r="8.7"/><path d="M12 7.4V12l3.6 2"/></>,
  calendar: <><rect x="3.5" y="5" width="17" height="16" rx="3"/><path d="M8 3v4M16 3v4M3.5 10.5h17"/></>,
  share: <><circle cx="6.5" cy="12" r="2.6"/><circle cx="17.5" cy="6" r="2.6"/><circle cx="17.5" cy="18" r="2.6"/><path d="m9 10.8 6-3.4M9 13.2l6 3.4"/></>,
  paperplane: <><path d="M21 3.5 3.4 10.6l6.2 2.4 2.4 6.2Z"/><path d="m21 3.5-9.2 9.3"/></>,
  link: <><path d="M10 14a4.2 4.2 0 0 0 6 0l2.6-2.6a4.2 4.2 0 0 0-6-6L11.3 6.7"/><path d="M14 10a4.2 4.2 0 0 0-6 0l-2.6 2.6a4.2 4.2 0 0 0 6 6l1.2-1.2"/></>,
  copy: <><rect x="8.5" y="8.5" width="12" height="12" rx="3"/><path d="M15.5 5.5h-9a3 3 0 0 0-3 3v9"/></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/></>,
  play: <path d="M8 4.8 19 12 8 19.2Z"/>,
  pause: <path d="M8.5 5v14M15.5 5v14"/>,
  mic: <><rect x="9" y="3" width="6" height="10.5" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0"/><path d="M12 18v3"/></>,
  volume: <><path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4Z"/><path d="M16 9a4.5 4.5 0 0 1 0 6"/><path d="M18.6 6.4a8 8 0 0 1 0 11.2"/></>,
  tag: <><path d="M4 4.5h7.4L20 13l-7 7-8.5-8.6Z"/><circle cx="8.4" cy="8.9" r="1.2"/></>,
  layers: <><path d="m12 3.5 8.5 4.5L12 12.5 3.5 8Z"/><path d="m3.5 12.4 8.5 4.5 8.5-4.5"/><path d="m3.5 16.4 8.5 4.5 8.5-4.5"/></>,
  sun: <><circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4 17 7M7 17l-1.6 1.6"/></>,
  cloud: <path d="M7 18.5h10.2a3.8 3.8 0 0 0 .4-7.6 5.4 5.4 0 0 0-10.3-1.3A3.9 3.9 0 0 0 7 18.5Z"/>,
  leaf: <><path d="M4.5 19.5c0-8 5-13 15-13 0 10-5 15-13 15Z"/><path d="M4.5 19.5 15 9"/></>,
  bookmark: <path d="M6.5 3.5h11v17L12 16.2 6.5 20.5Z"/>,
  film: <><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M8 5v14M16 5v14M3 12h18"/></>,
  wand: <><path d="m5 19 10-10"/><path d="m14 4 .9 2.1L17 7l-2.1.9L14 10l-.9-2.1L11 7l2.1-.9Z"/><path d="m19 12 .7 1.6L21 14l-1.3.4L19 16l-.7-1.6L17 14l1.3-.4Z"/></>,
  quote: <path d="M9 6.5c-2.8 1.2-4.2 3.3-4.2 6.2 0 2.4 1.3 4 3.3 4 1.8 0 3-1.2 3-2.9 0-1.6-1-2.7-2.5-2.7-.4 0-.7 0-.9.2.4-1.5 1.5-2.6 3.2-3.4Zm9 0c-2.8 1.2-4.2 3.3-4.2 6.2 0 2.4 1.3 4 3.3 4 1.8 0 3-1.2 3-2.9 0-1.6-1-2.7-2.5-2.7-.4 0-.7 0-.9.2.4-1.5 1.5-2.6 3.2-3.4Z"/>,
  edit: <><path d="M14.5 4.5 19.5 9.5 8 21H3v-5Z"/><path d="m12.5 6.5 5 5"/></>,
  refresh: <><path d="M20 12a8 8 0 1 1-2.7-6"/><path d="M20 4v5h-5"/></>,
  user: <><circle cx="12" cy="8.5" r="3.7"/><path d="M4.5 20.5c1.2-3.8 4-5.7 7.5-5.7s6.3 1.9 7.5 5.7"/></>,
  logout: <><path d="M14 4.5H5.5v15H14"/><path d="M11 12h9"/><path d="m17 8.5 3.5 3.5L17 15.5"/></>,
  settings: <><circle cx="12" cy="12" r="3.1"/><path d="M12 2.8v2.5M12 18.7v2.5M4.5 7.6l2.2 1.2M17.3 15.2l2.2 1.2M4.5 16.4l2.2-1.2M17.3 8.8l2.2-1.2"/></>,
  chart: <><path d="M4 20V4"/><path d="M4 20h16"/><rect x="7.5" y="12" width="3" height="5" rx="1"/><rect x="12.5" y="8.5" width="3" height="8.5" rx="1"/><rect x="17" y="5.5" width="3" height="11.5" rx="1"/></>,
  trash: <><path d="M4.5 7h15"/><path d="M9 7V4.8h6V7"/><path d="M6.5 7 8 20h8l1.5-13"/><path d="M10.5 11v5M13.5 11v5"/></>,
  grid: <><rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/></>,
  list: <><path d="M8 6.5h12M8 12h12M8 17.5h12"/><path d="M4 6.5v.1M4 12v.1M4 17.5v.1"/></>,
  flag: <><path d="M6 21V3.5"/><path d="M6 4.5h11l-2.2 4.2L17 13H6"/></>,
}

export type IconName = keyof typeof paths

export function Icon({ name, size = 20, strokeWidth = 1.6 }: { name: string; size?: number; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name] ?? paths.book}
    </svg>
  )
}

export function Button({
  children,
  variant = 'primary',
  className = '',
  loading = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost'
  children: ReactNode
  loading?: boolean
}) {
  return (
    <button className={`button button-${variant} ${className}`} aria-busy={loading || undefined} {...props}>
      {loading && <span className="spinner" aria-hidden="true" />}
      {children}
    </button>
  )
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'green' | 'amber' | 'purple' | 'red' }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

export function StatusPill({ tone, children, icon }: { tone: 'success' | 'loading' | 'waiting' | 'warning' | 'error' | 'info'; children: ReactNode; icon?: string }) {
  return (
    <span className={`status-pill status-pill--${tone}`}>
      {icon ? <Icon name={icon} size={13} /> : <span className="dot" aria-hidden="true" />}
      {children}
    </span>
  )
}

export function SectionHead({
  title,
  count,
  subtitle,
  children,
  id,
}: {
  title: string
  count?: number | string
  subtitle?: string
  children?: ReactNode
  id?: string
}) {
  return (
    <div className="section-head">
      <div className="section-title">
        <h2 id={id}>{title}</h2>
        {count !== undefined && <span className="count-pill">{count}</span>}
        {subtitle && <span className="section-subtitle">{subtitle}</span>}
      </div>
      {children}
    </div>
  )
}

export function StatePanel({
  kind,
  onRetry,
  onImport,
  scope = 'shelf',
  title,
  description,
}: {
  kind: 'loading' | 'empty' | 'error'
  onRetry: () => void
  onImport: () => void
  scope?: 'shelf' | 'import'
  title?: string
  description?: string
}) {
  const content = {
    loading: { title: '正在整理书架', text: '请稍候，阅读的世界正在打开。', icon: 'book' },
    empty: { title: '把第一本好书带进来', text: '导入有权使用的书页，开始一段新的阅读。', icon: 'book' },
    error: { title: '书架暂时没有打开', text: '模拟加载失败。你可以重试，也可以稍后再来。', icon: 'alert' },
  }[kind]
  if (scope === 'import' && kind === 'loading') { content.title = '正在准备导入工作台'; content.text = '请稍候，书页选择区马上就绪。' }
  if (scope === 'import' && kind === 'error') { content.title = '导入工作台暂时不可用'; content.text = '模拟加载失败，请重新加载后继续。' }
  return (
    <div className={`state-panel state-${kind}`} role={kind === 'error' ? 'alert' : 'status'} aria-live="polite">
      <span className="state-icon">
        <Icon name={content.icon} size={30} />
      </span>
      <h3>{title ?? content.title}</h3>
      <p>{description ?? content.text}</p>
      {kind !== 'loading' && (
        <Button variant="secondary" onClick={kind === 'empty' ? onImport : onRetry}>
          {kind === 'empty' ? '导入第一本书' : '重新加载'}
          <Icon name="arrow" size={17} />
        </Button>
      )}
      {kind !== 'loading' && (
        kind === 'empty' ? <OwlMascot className="doodle doodle--state" size={92} />
          : <Doodle name="cloud" className="doodle doodle--state" size={92} />
      )}
    </div>
  )
}
