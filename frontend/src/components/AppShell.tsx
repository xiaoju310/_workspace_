import type { ReactNode } from 'react'
import type { PreviewState } from '../features/books/types'
import { Icon } from './ui'

export function AppShell({ page, state, setState, navigate, children }: { page: 'home' | 'import'; state: PreviewState; setState: (state: PreviewState) => void; navigate: (page: 'home' | 'import') => void; children: ReactNode }) {
  return <div className="app-layout">
    <a className="skip-link" href="#main">跳到主要内容</a>
    <aside className="sidebar" aria-label="主要导航">
      <a href="#/" className="brand" onClick={() => navigate('home')}><span className="brand-icon"><Icon name="book" size={25}/></span><span>纸书智伴<small>PAPER COMPANION</small></span></a>
      <span className="nav-caption">我的阅读空间</span>
      <nav><a href="#/" className={`nav-item ${page === 'home' ? 'active' : ''}`} aria-current={page === 'home' ? 'page' : undefined} onClick={() => navigate('home')}><Icon name="home"/>首页<span className="nav-dot"/></a><a href="#/import" className={`nav-item ${page === 'import' ? 'active' : ''}`} aria-current={page === 'import' ? 'page' : undefined} onClick={() => navigate('import')}><Icon name="upload"/>导入图书</a></nav>
      <div className="sidebar-reading"><span className="tiny-stars">✦ &nbsp; ✧</span><p>一本纸书，<br/>一个会回应的世界。</p><span className="little-book"><Icon name="book" size={44}/></span></div>
      <div className="sidebar-bottom"><span className="privacy-icon"><Icon name="lock" size={16}/></span><div>安心阅读<small>笔记默认私密</small></div><span className="version">D1</span></div>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb">我的阅读空间 <span>/</span> <strong>{page === 'home' ? '首页' : '导入图书'}</strong></div><div className="topbar-right"><span className="prototype-label"><span/>交互原型 · 模拟数据</span><span className="avatar" aria-label="阅读工作台">阅</span></div></header>
      <main id="main" tabIndex={-1}>{children}</main>
      <footer className="footer"><span>让每一次翻页，都有新的发现。</span><label className="state-control">原型状态<select aria-label="原型状态" value={state} onChange={e => setState(e.target.value as PreviewState)}><option value="success">正常 / 成功</option><option value="loading">加载中</option><option value="empty">空数据</option><option value="error">失败</option></select></label></footer>
    </div>
  </div>
}
