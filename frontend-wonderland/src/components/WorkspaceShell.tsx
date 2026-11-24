import type { ReactNode } from 'react'
import type { Navigate, Page } from '../app/types'
import type { PreviewState } from '../features/books/types'
import type { AppMode } from '../types/interaction'
import { Icon } from './ui'
import ReadingBuddy from './ReadingBuddy'

export const pageNames: Record<Page, string> = {
  home: '首页与书架',
  import: '导入图书',
  review: '页序与文字校对',
  classification: '图书类型确认',
  progress: '分析与生成进度',
  reader: '互动阅读',
  history: '阅读历史',
  notes: '笔记与主人审核',
  sharing: '分享设置',
  shared: '只读分享预览',
  settings: '接口与演示设置',
}

const navLinks: { page: Page; icon: string; label: string }[] = [
  { page: 'home', icon: 'home', label: '首页与书架' },
  { page: 'import', icon: 'upload', label: '导入图书' },
  { page: 'review', icon: 'check', label: '书页校对' },
  { page: 'progress', icon: 'spark', label: '生成工作台' },
  { page: 'reader', icon: 'book', label: '互动阅读' },
  { page: 'notes', icon: 'note', label: '阅读笔记' },
  { page: 'history', icon: 'clock', label: '阅读历史' },
  { page: 'sharing', icon: 'lock', label: '分享管理' },
]

export default function WorkspaceShell({
  page,
  focusMode = false,
  navigate,
  appMode = 'live',
  bookOrigin,
  children,
}: {
  page: Page
  focusMode?: boolean
  state: PreviewState
  setState: (s: PreviewState) => void
  navigate: Navigate
  appMode?: AppMode
  bookOrigin?: 'mock' | 'real'
  children: ReactNode
}) {
  const current = (value: Page) => value === page || (value === 'review' && page === 'classification') || (value === 'sharing' && page === 'shared')
  const isLive = appMode === 'live'
  return (
    <div className={`app-layout full-workspace${focusMode ? ' workspace-focus' : ''}`}>
      <a className="skip-link" href="#main">跳到主要内容</a>

      {!focusMode && <aside className="sidebar">
        <a className="brand" href="#/" onClick={event => { event.preventDefault(); navigate('home') }}>
          <span className="brand-icon"><Icon name="book" size={24} /></span>
          <span>开卷有灵<small>KAIJUAN YOULING</small></span>
        </a>
        <span className="nav-caption">我的阅读空间</span>
        <nav aria-label="主要导航">
          {navLinks.map(link => (
            <a
              key={link.page}
              href={`#/${link.page === 'home' ? '' : link.page}`}
              className={`nav-item ${current(link.page) ? 'active' : ''}`}
              aria-current={current(link.page) ? 'page' : undefined}
              onClick={event => { event.preventDefault(); navigate(link.page) }}
            >
              <Icon name={link.icon} size={18} />
              {link.label}
              <span className="nav-dot" />
            </a>
          ))}
        </nav>
        <div className="workspace-sidebar-note">
          <Icon name="lock" size={16} />
          <div>笔记默认私密<small>审核确认，再分享</small></div>
        </div>
        <button className={`settings-link ${page === 'settings' ? 'selected' : ''}`} onClick={() => navigate('settings')}>
          <Icon name="settings" size={17} />接口与演示设置
        </button>
      </aside>}

      <div className="main-shell">
        {!focusMode && <header className="topbar">
          <div className="breadcrumb">
            我的阅读空间<span>/</span>
            <strong>{pageNames[page]}</strong>
          </div>
          <div className="topbar-right">
            <span className="prototype-label">
              <span style={{ backgroundColor: isLive ? 'var(--state-success)' : 'var(--amber-500)' }} />
              {isLive ? '真实接口模式 · 示例仍模拟' : '本地演示 · 模拟结果'}
            </span>
            <span className="avatar">阅</span>
          </div>
        </header>}

        {!focusMode && (!isLive ? (
          <div className="demo-mode-banner" role="note">
            <strong>演示模式</strong>
            <span>导入、生成、阅读、笔记和分享为本地模拟，未接通真实模型服务。</span>
            <button onClick={() => navigate('settings')}>打开独立后端联调</button>
          </div>
        ) : (
          <div className="demo-mode-banner live-banner" role="note">
            <strong>Live 模式</strong>
            <span>
              新导入图书可请求真实接口；书架示例仍为模拟，分析、视频、笔记须逐项核验。当前图书：
              {bookOrigin === 'mock' ? '模拟内容' : bookOrigin === 'real' ? '真实建档' : '未选择'}。
            </span>
            <button onClick={() => navigate('settings')}>查看连接设置</button>
          </div>
        ))}

        <main id="main" tabIndex={-1}>{children}</main>

        {!focusMode && <footer className="footer">
          <span>每一个发现，都有来源。<span className="session-label"> · 本页面会话仅在当前浏览器保存</span></span>
          <span>{isLive ? '接口状态以前端实际请求结果为准' : '演示数据不代表真实模型结果'} · 开卷有灵 · Wonderland in Paper</span>
        </footer>}
      </div>

      {!focusMode && <ReadingBuddy page={page} />}
    </div>
  )
}
