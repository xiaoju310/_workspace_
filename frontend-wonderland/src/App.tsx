import React, { useState } from 'react';
import WorkspaceApp, { readSessionInteractions } from './app/WorkspaceApp';
import { BenchmarkRunner } from './features/interaction/BenchmarkRunner';
import { LatencyMetricsDashboard } from './features/interaction/metrics/LatencyMetricsDashboard';
import { AppMode } from './types/interaction';
import { apiClient } from './lib/api';
import { Icon } from './components/ui';

const tabs = [
  { id: 'workspace', label: '全功能工作台', icon: 'book' },
  { id: 'benchmark', label: '夹具回归', icon: 'spark' },
  { id: 'metrics', label: '延迟看板', icon: 'chart' },
] as const;

export const App: React.FC = () => {
  const [viewMode, setViewMode] = useState<'workspace' | 'benchmark' | 'metrics'>('workspace');
  const [appMode, setAppMode] = useState<AppMode>(import.meta.env.VITE_DEFAULT_MODE === 'demo' ? 'demo' : 'live');
  const [readerFocus, setReaderFocus] = useState(false);
  const [savedToken, setSavedToken] = useState(apiClient.getToken());
  const [account, setAccount] = useState<{ id: string; username: string; role: string } | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authError, setAuthError] = useState('');
  const [busy, setBusy] = useState(false);

  React.useEffect(() => {
    if (savedToken) apiClient.me().then(setAccount).catch(() => { apiClient.setToken(''); setSavedToken(''); });
  }, []);

  const handleModeChange = (newMode: AppMode) => {
    setAppMode(newMode);
  };

  const submitAuth = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setAuthError('');
    try {
      const result = authMode === 'register' ? await apiClient.register(username, password) : await apiClient.login(username, password);
      apiClient.setToken(result.access_token);
      setSavedToken(result.access_token);
      setAccount(result.user);
      setPassword('');
    } catch (error) { setAuthError(error instanceof Error ? error.message : '登录失败'); }
    finally { setBusy(false); }
  };

  const logout = async () => {
    try { await apiClient.logout(); } catch { /* 网络中断仍清除浏览器会话 */ }
    apiClient.setToken(''); setSavedToken(''); setAccount(null);
  };

  return (
    <div className="studio">
      {/* 顶层工作室导航：保留原有跨模块切换与真实/演示隔离 */}
      <div className="studio-bar" hidden={readerFocus}>
        <div className="studio-brand">
          <span className="studio-brand-mark"><Icon name="book" size={20} /></span>
          <span className="studio-brand-text">
            开卷有灵<small>Wonderland in Paper</small>
          </span>
        </div>

        <div className="studio-tabs" role="tablist" aria-label="视图切换">
          {tabs.map(tab => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={viewMode === tab.id}
              className={`studio-tab ${viewMode === tab.id ? 'is-active' : ''}`}
              onClick={() => setViewMode(tab.id)}
            >
              <Icon name={tab.icon} size={15} />
              {tab.label}
            </button>
          ))}
        </div>

        <div className="studio-right">
          <label className={`studio-mode ${appMode === 'live' ? 'is-live' : 'is-demo'}`}>
            <span className="studio-mode-dot" aria-hidden="true" />
            <span className="studio-mode-label">模式</span>
            <select aria-label="运行模式" value={appMode} onChange={e => handleModeChange(e.target.value as AppMode)}>
              <option value="live">真实接口 Live（示例仍模拟）</option>
              <option value="demo">本地演示 Demo</option>
            </select>
          </label>
          <div className="studio-account">
            {account ? (
              <>
                <span className="studio-account-name">
                  <Icon name="user" size={14} />
                  {account.username}（{account.role === 'admin' ? '管理员' : '用户'}）
                </span>
                <button type="button" className="studio-logout" onClick={() => void logout()}>
                  <Icon name="logout" size={14} />退出
                </button>
              </>
            ) : (
              <span className="studio-account-name studio-account-name--muted">
                <Icon name="lock" size={14} />未登录 · 真实接口需先登录
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="studio-body">
        {viewMode === 'workspace' && appMode === 'live' && !account ? (
          <div className="auth-gate">
            <div className="auth-art" aria-hidden="true">
              <span className="auth-art-sun" />
              <span className="auth-art-hill" />
              <span className="auth-art-book" />
              <span className="auth-art-star auth-art-star--a" />
              <span className="auth-art-star auth-art-star--b" />
              <span className="auth-art-star auth-art-star--c" />
            </div>
            <form className="auth-card" onSubmit={e => void submitAuth(e)}>
              <p className="eyebrow">A KEY TO YOUR PAPER WORLD</p>
              <h1>{authMode === 'login' ? '回到你的绘本世界' : '创建你的阅读空间'}</h1>
              <p className="auth-lead">
                {authMode === 'login'
                  ? '登录后可以导入真实图书、发起分析与生成，并保留你的阅读笔记。'
                  : '注册一个普通账号即可开始。管理员账号需要在本机单独创建。'}
              </p>
              <label className="field">
                用户名
                <input
                  aria-label="用户名"
                  autoComplete="username"
                  placeholder="3–32 位，字母开头"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  required
                  minLength={3}
                  maxLength={32}
                />
              </label>
              <label className="field">
                密码
                <input
                  aria-label="密码"
                  type="password"
                  autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
                  placeholder="至少 12 位"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  minLength={12}
                />
              </label>
              {authError && <p className="auth-error" role="alert"><Icon name="alert" size={16} />{authError}</p>}
              <button className="button button-primary button--block" disabled={busy} type="submit">
                {busy ? '请稍候…' : authMode === 'login' ? '登录' : '注册'}
                {!busy && <Icon name="arrow" size={17} />}
              </button>
              <button
                className="auth-switch"
                type="button"
                onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setAuthError(''); }}
              >
                {authMode === 'login' ? '没有账号？创建一个' : '已有账号？去登录'}
              </button>
              <p className="auth-note">
                <Icon name="lock" size={13} /> 令牌只保存在当前浏览器会话，不会写入本地文件。
              </p>
            </form>
          </div>
        ) : viewMode === 'workspace' ? (
          <WorkspaceApp key={`${appMode}-${account?.username ?? 'demo'}`} appMode={appMode} backendToken={savedToken} accountId={account?.id ?? ''} onFocusModeChange={setReaderFocus} />
        ) : viewMode === 'benchmark' ? (
          <div className="page-content studio-stage">
            <div className="page-heading">
              <div>
                <p className="eyebrow">FIXTURE REGRESSION</p>
                <h1>夹具回归：把每一次回答都跑一遍。</h1>
                <p className="page-description">使用固定书目与问题集回归文本问答链路，结果只代表夹具，不代表真实 ASR 或官方评测。</p>
              </div>
            </div>
            <div className="paper-card paper-card--lg">
              <BenchmarkRunner bookId="book-auth-sample-01" runId="run-20261104-001" />
            </div>
          </div>
        ) : (
          <div className="page-content studio-stage">
            <div className="page-heading">
              <div>
                <p className="eyebrow">LATENCY &amp; METRICS</p>
                <h1>延迟与指标看板。</h1>
                <p className="page-description">读取当前浏览器会话中的真实交互记录，未测得的阶段保持为空，不填常数冒充。</p>
              </div>
            </div>
            <div className="paper-card paper-card--lg">
              <LatencyMetricsDashboard
                {...(() => { const r = readSessionInteractions(appMode, account?.id ?? ''); return { interactions: r.interactions, loadError: r.error }; })()}
                sourceLabel={`当前浏览器会话 · ${appMode === 'live' ? 'Live 模式' : 'Demo 模式'}（关闭标签页后清空）`}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
