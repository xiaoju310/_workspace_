import React, { useState } from 'react';
import WorkspaceApp from './app/WorkspaceApp';
import { BenchmarkRunner } from './features/interaction/BenchmarkRunner';
import { LatencyMetricsDashboard } from './features/interaction/metrics/LatencyMetricsDashboard';
import { AppMode } from './types/interaction';
import { apiClient } from './lib/api';

export const App: React.FC = () => {
  const [viewMode, setViewMode] = useState<'workspace' | 'benchmark' | 'metrics'>('workspace');
  const [appMode, setAppMode] = useState<AppMode>(import.meta.env.VITE_DEFAULT_MODE === 'demo' ? 'demo' : 'live');
  const [bearerToken, setBearerToken] = useState(apiClient.getToken());
  const [tokenMsg, setTokenMsg] = useState<string | null>(null);

  const handleModeChange = (newMode: AppMode) => {
    setAppMode(newMode);
  };

  const handleTokenSave = () => {
    apiClient.setToken(bearerToken.trim());
    setTokenMsg('Token 已更新');
    setTimeout(() => setTokenMsg(null), 3000);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', width: '100%' }}>
      {/* 顶层跨模块模式与测试切换栏 */}
      <div
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <strong style={{ color: '#38bdf8', letterSpacing: '0.5px' }}>
            纸书智伴 · 交互与全链路系统
          </strong>
          <div style={{ display: 'flex', gap: '4px', backgroundColor: '#0f172a', padding: '2px', borderRadius: '4px' }}>
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
              🧪 自动化验收跑测 (15用例)
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

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* 队长要求：显式隔离真实与演示模式 */}
          <div
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
              当前模式:
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
                🟢 真实服务模式 (Live - 严格报错/禁止伪造)
              </option>
              <option value="demo" style={{ background: '#1e293b' }}>
                🟠 演示模式 (Demo - 本地可信模拟)
              </option>
            </select>
          </div>

          {/* Bearer Token */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>Token:</span>
            <input
              type="text"
              value={bearerToken}
              onChange={(e) => setBearerToken(e.target.value)}
              placeholder="粘贴 A 配置的 Bearer 令牌"
              style={{
                backgroundColor: '#0f172a',
                border: '1px solid #475569',
                color: '#f8fafc',
                padding: '2px 6px',
                borderRadius: '3px',
                fontSize: '11px',
                width: '120px',
              }}
            />
            <button
              type="button"
              onClick={handleTokenSave}
              style={{
                backgroundColor: '#475569',
                border: 'none',
                color: '#fff',
                padding: '2px 8px',
                borderRadius: '3px',
                cursor: 'pointer',
                fontSize: '11px',
              }}
            >
              保存
            </button>
            {tokenMsg && <span style={{ fontSize: '11px', color: '#38bdf8' }}>{tokenMsg}</span>}
          </div>
        </div>
      </div>

      {/* 主视图内容 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {viewMode === 'workspace' && <WorkspaceApp appMode={appMode} />}
        {viewMode === 'benchmark' && (
          <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto', width: '100%' }}>
            <BenchmarkRunner bookId="book-auth-sample-01" runId="run-20261104-001" />
          </div>
        )}
        {viewMode === 'metrics' && (
          <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto', width: '100%' }}>
            <LatencyMetricsDashboard history={[]} />
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
