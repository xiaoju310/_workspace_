import type { ButtonHTMLAttributes, ReactNode } from 'react'

const paths: Record<string, ReactNode> = {
  book: <><path d="M3 5q5-2 9 1 4-3 9-1v14q-5-2-9 1-4-3-9-1Z"/><path d="M12 6v14"/></>,
  home: <><path d="m3 10 9-7 9 7v10H4V10"/><path d="M9 20v-7h6v7"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>,
  upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  chevron: <path d="m9 5 7 7-7 7"/>,
  close: <path d="m6 6 12 12M6 18 18 6"/>,
  alert: <><path d="m12 3 10 18H2Z"/><path d="M12 9v5m0 3v.1"/></>,
  spark: <><path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6Z"/><path d="m20 2 .5 1.5L22 4l-1.5.5L20 6l-.5-1.5L18 4l1.5-.5Z"/></>,
  note: <><path d="M6 3h9l4 4v14H5V3Zm8 0v5h5M8 12h8m-8 4h6"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/></>,
  image: <><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1"/><path d="m3 17 6-6 4 4 3-3 5 5"/></>,
  up: <path d="m5 15 7-7 7 7"/>,
  down: <path d="m5 9 7 7 7-7"/>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/></>,
}

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.book}</svg>
}

export function Button({ children, variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost'; children: ReactNode }) {
  return <button className={`button button-${variant} ${className}`} {...props}>{children}</button>
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'green' | 'amber' | 'purple' }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

export function StatePanel({ kind, onRetry, onImport, scope = 'shelf' }: { kind: 'loading' | 'empty' | 'error'; onRetry: () => void; onImport: () => void; scope?: 'shelf' | 'import' }) {
  const content = {
    loading: ['正在整理书架', '请稍候，阅读的世界正在打开。', 'book'],
    empty: ['把第一本好书带进来', '导入有权使用的书页，开始一段新的阅读。', 'book'],
    error: ['书架暂时没有打开', '模拟加载失败。你可以重试，也可以稍后再来。', 'alert'],
  }[kind]
  if (scope === 'import' && kind === 'loading') { content[0] = '正在准备导入工作台'; content[1] = '请稍候，书页选择区马上就绪。' }
  if (scope === 'import' && kind === 'error') { content[0] = '导入工作台暂时不可用'; content[1] = '模拟加载失败，请重新加载后继续。' }
  return <div className={`state-panel state-${kind}`} role={kind === 'error' ? 'alert' : 'status'} aria-live="polite"><span className="state-icon"><Icon name={content[2]} size={30}/></span><h3>{content[0]}</h3><p>{content[1]}</p>{kind !== 'loading' && <Button variant="secondary" onClick={kind === 'empty' ? onImport : onRetry}>{kind === 'empty' ? '导入第一本书' : '重新加载'}<Icon name="arrow" size={17}/></Button>}</div>
}
