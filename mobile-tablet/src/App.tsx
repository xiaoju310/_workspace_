import React, { useState } from 'react';
import WorkspaceApp, { readSessionInteractions } from './app/WorkspaceApp';
import { BenchmarkRunner } from './features/interaction/BenchmarkRunner';
import { LatencyMetricsDashboard } from './features/interaction/metrics/LatencyMetricsDashboard';
import { AppMode } from './types/interaction';
import { apiClient } from './lib/api';
import { loadMobileWorkspace } from './lib/mobileWorkspace';
import type { MobileWorkspace } from './lib/mobileWorkspace';

export const App: React.FC = () => {
  const [viewMode, setViewMode] = useState<'workspace' | 'benchmark' | 'metrics'>('workspace');
  const [appMode, setAppMode] = useState<AppMode>(import.meta.env.VITE_DEFAULT_MODE === 'demo' ? 'demo' : 'live');
  const [savedToken, setSavedToken] = useState(apiClient.getToken());
  const [account, setAccount] = useState<{id:string;username:string;role:string}|null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authMode, setAuthMode] = useState<'login'|'register'>('login');
  const [authError, setAuthError] = useState('');
  const [busy, setBusy] = useState(false);
  const [workspace, setWorkspace] = useState<MobileWorkspace|null>(null);
  const [workspaceError, setWorkspaceError] = useState('');
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);
  React.useEffect(() => {
    if (appMode !== 'live' || !account) return;
    let cancelled = false;
    setWorkspaceLoading(true); setWorkspaceLoaded(false); setWorkspaceError('');
    void loadMobileWorkspace().then(data => { if (!cancelled) setWorkspace(data); })
      .catch((error: Error) => { if (!cancelled) setWorkspaceError(error.message); })
      .finally(() => { if (!cancelled) { setWorkspaceLoading(false); setWorkspaceLoaded(true); } });
    return () => { cancelled = true; };
  }, [appMode, account?.id]);
  React.useEffect(() => {
    if (savedToken) apiClient.me().then(setAccount).catch(() => { apiClient.setToken(''); setSavedToken(''); });
  }, []);


  const handleModeChange = (newMode: AppMode) => {
    setAppMode(newMode);
  };

  const submitAuth = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setAuthError('');
    try {
      const result = authMode === 'register' ? await apiClient.register(username,password) : await apiClient.login(username,password);
      apiClient.setToken(result.access_token);
      setSavedToken(result.access_token);
      setAccount(result.user);
      setPassword('');
    } catch (error) { setAuthError(error instanceof Error ? error.message : '登录失败'); }
    finally { setBusy(false); }
  };

  const logout = async () => {
    try { await apiClient.logout(); } catch { /* 网络中断仍清除浏览器会话 */ }
    apiClient.setToken(''); setSavedToken(''); setAccount(null); setWorkspace(null); setWorkspaceLoaded(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', width: '100%' }}>
      {/* 顶层跨模块模式与测试切换栏 */}
      <div
        className="app-toolbar"
        style={{
          backgroundColor: '#1e293b',
          color: '#f8fafc',
          padding: '6px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '13px',
          borderBottom: '1px solid #334155',
          zIndex: 1000,
        }}
      >
        <div className="app-toolbar-main" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <strong style={{ color: '#38bdf8', letterSpacing: '0.5px' }}>
            开卷有灵 · 交互与全链路系统
          </strong>
          <div className="app-toolbar-tabs" style={{ display: 'flex', gap: '4px', backgroundColor: '#0f172a', padding: '2px', borderRadius: '4px' }}>
            <button
              type="button"
              onClick={() => setViewMode('workspace')}
              style={{
                background: viewMode === 'workspace' ? '#2563eb' : 'transparent',
                color: '#fff',
                border: 'none',
                padding: '4px 10px',
                borderRadius: '3px',
                cursor: 'pointer',
                fontWeight: viewMode === 'workspace' ? 600 : 400,
              }}
            >
              📖 全功能工作台
            </button>
            <button
              type="button"
              onClick={() => setViewMode('benchmark')}
              style={{
                background: viewMode === 'benchmark' ? '#0d9488' : 'transparent',
                color: '#fff',
                border: 'none',
                padding: '4px 10px',
                borderRadius: '3px',
                cursor: 'pointer',
                fontWeight: viewMode === 'benchmark' ? 600 : 400,
              }}
            >
              🧪 Demo 夹具回归 (15用例)
            </button>
            <button
              type="button"
              onClick={() => setViewMode('metrics')}
              style={{
                background: viewMode === 'metrics' ? '#9333ea' : 'transparent',
                color: '#fff',
                border: 'none',
                padding: '4px 10px',
                borderRadius: '3px',
                cursor: 'pointer',
                fontWeight: viewMode === 'metrics' ? 600 : 400,
              }}
            >
              📊 延迟与指标看板
            </button>
          </div>
        </div>

        <div className="app-toolbar-controls" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* 队长要求：显式隔离真实与演示模式 */}
          <div
            className="app-toolbar-mode"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '2px 8px',
              borderRadius: '4px',
              backgroundColor: appMode === 'live' ? '#064e3b' : '#78350f',
              border: `1px solid ${appMode === 'live' ? '#059669' : '#d97706'}`,
            }}
          >
            <span style={{ fontSize: '11px', color: appMode === 'live' ? '#6ee7b7' : '#fde68a' }}>
              模式:
            </span>
            <select
              value={appMode}
              onChange={(e) => handleModeChange(e.target.value as AppMode)}
              style={{
                backgroundColor: 'transparent',
                color: '#fff',
                border: 'none',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              <option value="live" style={{ background: '#1e293b' }}>
                🟢 真实接口 (Live，示例仍模拟)
              </option>
              <option value="demo" style={{ background: '#1e293b' }}>
                🟠 本地演示 (Demo)
              </option>
            </select>
          </div>

          <div className="app-toolbar-token" style={{ display:'flex', alignItems:'center', gap:8 }}>
            {account ? <><span>{account.username}（{account.role === 'admin' ? '管理员' : '用户'}）</span><button type="button" onClick={() => void logout()}>退出</button></> : <span>请登录后使用真实接口</span>}
          </div>
        </div>
      </div>

      {/* 主视图内容 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* key=appMode：切换模式时重建工作台，Live 与 Demo 的图书/交互记录互不混用 */}
        {viewMode === 'workspace' && appMode === 'live' && account && (!workspaceLoaded || workspaceLoading || workspaceError) ?
          <div role={workspaceError ? 'alert' : 'status'} style={{padding:24}}>{workspaceError ? `无法读取本机 MongoDB：${workspaceError}` : '正在加载本机 MongoDB 中的阅读记录…'}</div> : viewMode === 'workspace' && appMode === 'live' && !account ?
          <form onSubmit={e => void submitAuth(e)} style={{ maxWidth:360, margin:'64px auto', display:'grid', gap:12, padding:24, border:'1px solid #ddd', borderRadius:12 }}>
            <h2>{authMode === 'login' ? '登录开卷有灵' : '注册开卷有灵'}</h2>
            <input aria-label="用户名" autoComplete="username" placeholder="用户名（3-32位）" value={username} onChange={e => setUsername(e.target.value)} required minLength={3} maxLength={32} />
            <input aria-label="密码" type="password" autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} placeholder="密码（至少12位）" value={password} onChange={e => setPassword(e.target.value)} required minLength={12} />
            {authError && <p role="alert" style={{ color:'#b91c1c' }}>{authError}</p>}
            <button disabled={busy} type="submit">{busy ? '请稍候…' : authMode === 'login' ? '登录' : '注册'}</button>
            <button type="button" onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setAuthError(''); }}>{authMode === 'login' ? '没有账号？注册' : '已有账号？登录'}</button>
          </form> : viewMode === 'workspace' && <WorkspaceApp key={`${appMode}-${account?.username ?? 'demo'}`} appMode={appMode} backendToken={savedToken} accountId={account?.id ?? ''} initialWorkspace={workspace} />}
        {viewMode === 'benchmark' && (
          <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto', width: '100%' }}>
            <BenchmarkRunner bookId="book-auth-sample-01" runId="run-20261104-001" />
          </div>
        )}
        {viewMode === 'metrics' && (
          <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto', width: '100%' }}>
            {/* 旧代码写死 history={[]}，看板永远显示兜底常数；现在读取当前模式会话里的真实交互记录 */}
            <LatencyMetricsDashboard
              {...(() => appMode === 'live' ? { interactions: workspace?.interactions ?? [], loadError: workspaceError || null } : (() => { const r = readSessionInteractions(appMode, account?.id ?? ''); return { interactions: r.interactions, loadError: r.error }; })())()}
              sourceLabel={appMode === 'live' ? '本机 MongoDB · 真实模式' : '当前浏览器会话 · 演示模式（关闭标签页后清空）'}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
