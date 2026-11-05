import React, { useState, useRef, useEffect } from 'react';
import { TouchOverlay } from './features/interaction/TouchOverlay';
import { InteractionPanel } from './features/interaction/InteractionPanel';
import { BenchmarkRunner } from './features/interaction/BenchmarkRunner';
import { ReadingNotesDrawer } from './features/interaction/ReadingNotesDrawer';
import { InteractionHistoryPanel } from './features/interaction/history/InteractionHistoryPanel';
import { LatencyMetricsDashboard } from './features/interaction/metrics/LatencyMetricsDashboard';
import {
  TouchRecognitionResponse,
  BookType,
  InteractionHistoryItem,
  AppMode,
} from './types/interaction';
import { apiClient } from './lib/api';

export const App: React.FC = () => {
  // 队长要求：系统运行模式显式隔离，默认真实模式
  const [appMode, setAppMode] = useState<AppMode>('live');

  // 图书与生成任务动态配置 (解决按 book_id / run_id 隔离)
  const [bookId, setBookId] = useState('book-auth-sample-01');
  const [runId, setRunId] = useState('run-20261104-001');
  const [videoUrl, setVideoUrl] = useState('https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4');

  // 认证 Token (对齐 A 后端安全机制)
  const [bearerToken, setBearerToken] = useState(apiClient.getToken());
  const [tokenNotice, setTokenNotice] = useState<string | null>(null);

  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [activeTouchResult, setActiveTouchResult] = useState<TouchRecognitionResponse | null>(null);
  const [activeTab, setActiveTab] = useState<'interactive' | 'benchmark' | 'metrics'>('interactive');

  // 图书分类状态 (严格对接 A 后端 PATCH /api/books/{id}/classification)
  const [confirmedType, setConfirmedType] = useState<BookType>('picture_book');
  const [categoryStatusMsg, setCategoryStatusMsg] = useState<{ text: string; isError: boolean } | null>(null);

  // 会话历史记录
  const [history, setHistory] = useState<InteractionHistoryItem[]>([]);

  const videoRef = useRef<HTMLVideoElement>(null);

  // 当 runId 变化时，尝试从后端加载真实视频资产与时间轴
  useEffect(() => {
    if (appMode === 'live') {
      apiClient.getRunAssets(runId).then((assets) => {
        if (assets && assets.length > 0 && assets[0].download_url) {
          setVideoUrl(assets[0].download_url);
        }
      });
    }
  }, [runId, appMode]);

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTimeMs(Math.round(videoRef.current.currentTime * 1000));
    }
  };

  const seekVideoToMs = (ms: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = ms / 1000;
      videoRef.current.play().catch(() => {});
    }
  };

  const handleTouchRecognize = async (touchReq: any) => {
    try {
      const resp = await apiClient.recognizeTouch(touchReq, appMode);
      setActiveTouchResult(resp);
      setHistory((prev) => [
        {
          id: `hist-${Date.now()}`,
          timestamp: Date.now(),
          type: 'touch',
          video_ms: touchReq.video_ms,
          query: `点击画面 [${touchReq.touch_point.norm_x}, ${touchReq.touch_point.norm_y}]`,
          response_text: `识别目标：${resp.target_name} (${resp.explanation})`,
          status: 'success',
          evidence: [resp.evidence],
          latency_ms: resp.latency_ms,
          cache_hit: resp.cache_hit,
          is_demo_mock: resp.is_demo_mock,
        },
        ...prev,
      ]);
    } catch (e: any) {
      alert(`触控识别失败: ${e.message}`);
    }
  };

  const handleNewHistoryItem = (item: InteractionHistoryItem) => {
    setHistory((prev) => [item, ...prev]);
  };

  // 分类修改处理 (真实调用 A 后端，绝不假冒成功)
  const handleConfirmTypeChange = async (newType: BookType) => {
    setCategoryStatusMsg(null);
    try {
      if (appMode === 'live') {
        const res = await apiClient.confirmCategory(bookId, newType);
        setConfirmedType(res.confirmed_type as BookType || newType);
        setCategoryStatusMsg({ text: `✅ 服务端已成功确认图书类型为: ${res.confirmed_type}`, isError: false });
      } else {
        setConfirmedType(newType);
        setCategoryStatusMsg({ text: `⚠️ [演示模式] 本地更新类别为: ${newType}`, isError: false });
      }
    } catch (err: any) {
      // 队长要求：保存失败必须真实显示，不能伪造成功！
      setCategoryStatusMsg({ text: `❌ 分类保存失败: ${err.message}`, isError: true });
    }
  };

  const handleUpdateToken = () => {
    apiClient.setToken(bearerToken.trim());
    setTokenNotice('✅ Bearer Token 已保存并生效');
    setTimeout(() => setTokenNotice(null), 2500);
  };

  return (
    <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '20px' }}>
      {/* 队长要求：离线演示模式显式通告横幅 */}
      {appMode === 'demo' && (
        <div
          style={{
            backgroundColor: '#fef3c7',
            border: '1px solid #f59e0b',
            color: '#92400e',
            padding: '10px 16px',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 600,
            marginBottom: '16px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>⚠️ 当前处于【本地离线演示模式 (Demo)】：未连接真实后端与 AI 模型，展示数据均为静态样例。</span>
          <button
            type="button"
            onClick={() => setAppMode('live')}
            style={{
              padding: '4px 10px',
              backgroundColor: '#d97706',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            切换到真实联调模式 (Live)
          </button>
        </div>
      )}

      {/* 顶部 Header */}
      <header
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          backgroundColor: '#ffffff',
          padding: '16px 24px',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          marginBottom: '20px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '20px', color: '#0f172a' }}>
              📖 纸书智伴 · 交互与联调工作台
            </h1>
            <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#64748b' }}>
              角色: <strong>任务 C (语音/触控/联调)</strong> ｜ 对齐接口: <code style={{ color: '#2563eb' }}>/api/... (docs/api-contract.md)</code>
            </p>
          </div>

          {/* 模式切换器 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', color: '#475569', fontWeight: 600 }}>运行模式:</span>
            <button
              type="button"
              onClick={() => setAppMode('live')}
              style={{
                padding: '4px 12px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                backgroundColor: appMode === 'live' ? '#22c55e' : '#f8fafc',
                color: appMode === 'live' ? '#ffffff' : '#475569',
              }}
            >
              🟢 真实模式 (Live)
            </button>
            <button
              type="button"
              onClick={() => setAppMode('demo')}
              style={{
                padding: '4px 12px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                backgroundColor: appMode === 'demo' ? '#f59e0b' : '#f8fafc',
                color: appMode === 'demo' ? '#ffffff' : '#475569',
              }}
            >
              🟡 演示模式 (Demo)
            </button>
          </div>
        </div>

        {/* 动态配置栏 (按 book_id / run_id 隔离) */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '12px',
            alignItems: 'center',
            backgroundColor: '#f8fafc',
            padding: '10px 14px',
            borderRadius: '8px',
            fontSize: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ color: '#64748b' }}>图书 ID:</span>
            <input
              type="text"
              value={bookId}
              onChange={(e) => setBookId(e.target.value)}
              style={{ padding: '3px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', width: '150px' }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ color: '#64748b' }}>运行 Run ID:</span>
            <input
              type="text"
              value={runId}
              onChange={(e) => setRunId(e.target.value)}
              style={{ padding: '3px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', width: '150px' }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ color: '#64748b' }}>Bearer 令牌:</span>
            <input
              type="text"
              value={bearerToken}
              onChange={(e) => setBearerToken(e.target.value)}
              style={{ padding: '3px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', width: '130px' }}
            />
            <button
              type="button"
              onClick={handleUpdateToken}
              style={{ padding: '3px 8px', borderRadius: '4px', border: 'none', backgroundColor: '#3b82f6', color: '#fff', cursor: 'pointer' }}
            >
              保存
            </button>
            {tokenNotice && <span style={{ color: '#16a34a' }}>{tokenNotice}</span>}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: '220px' }}>
            <span style={{ color: '#64748b' }}>视频源 URL:</span>
            <input
              type="text"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              placeholder="输入当前 run 生成的成片视频链接或演示视频"
              style={{ flex: 1, padding: '3px 8px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
            />
          </div>
        </div>

        {categoryStatusMsg && (
          <div
            style={{
              fontSize: '12px',
              padding: '6px 12px',
              backgroundColor: categoryStatusMsg.isError ? '#fef2f2' : '#f0fdf4',
              color: categoryStatusMsg.isError ? '#dc2626' : '#15803d',
              borderRadius: '4px',
            }}
          >
            {categoryStatusMsg.text}
          </div>
        )}
      </header>

      {/* 顶部 Tab 切换 */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
        <button
          type="button"
          onClick={() => setActiveTab('interactive')}
          style={{
            padding: '8px 18px',
            borderRadius: '8px',
            border: 'none',
            fontWeight: 600,
            fontSize: '14px',
            cursor: 'pointer',
            backgroundColor: activeTab === 'interactive' ? '#2563eb' : '#e2e8f0',
            color: activeTab === 'interactive' ? '#ffffff' : '#475569',
          }}
        >
          🎯 伴读视频与语音触控体验
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('benchmark')}
          style={{
            padding: '8px 18px',
            borderRadius: '8px',
            border: 'none',
            fontWeight: 600,
            fontSize: '14px',
            cursor: 'pointer',
            backgroundColor: activeTab === 'benchmark' ? '#2563eb' : '#e2e8f0',
            color: activeTab === 'benchmark' ? '#ffffff' : '#475569',
          }}
        >
          🧪 自动化基准测试与报告导出 (15项用例)
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('metrics')}
          style={{
            padding: '8px 18px',
            borderRadius: '8px',
            border: 'none',
            fontWeight: 600,
            fontSize: '14px',
            cursor: 'pointer',
            backgroundColor: activeTab === 'metrics' ? '#2563eb' : '#e2e8f0',
            color: activeTab === 'metrics' ? '#ffffff' : '#475569',
          }}
        >
          📊 交互历史与延迟看板 ({history.length} 条记录)
        </button>
      </div>

      {activeTab === 'benchmark' && <BenchmarkRunner bookId={bookId} runId={runId} />}

      {activeTab === 'metrics' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <LatencyMetricsDashboard history={history} />
          <InteractionHistoryPanel
            history={history}
            onSeekToMs={seekVideoToMs}
            onClearHistory={() => setHistory([])}
          />
        </div>
      )}

      {activeTab === 'interactive' && (
        /* 核心工作区：双栏布局 */
        <main style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '20px' }}>
          {/* 左栏：视频播放器与触控万物识别层 */}
          <section
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '12px',
              border: '1px solid #e2e8f0',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: '16px', color: '#1e293b' }}>
                🎥 伴读视频与触控感知区
              </h2>
              <span style={{ fontSize: '12px', color: '#64748b' }}>
                当前时间: <strong>{(currentTimeMs / 1000).toFixed(2)}s</strong> ({currentTimeMs}ms)
              </span>
            </div>

            {/* 视频容器 */}
            <div
              style={{
                position: 'relative',
                width: '100%',
                backgroundColor: '#000000',
                borderRadius: '8px',
                overflow: 'hidden',
                aspectRatio: '16 / 9',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <video
                ref={videoRef}
                src={videoUrl}
                controls
                onTimeUpdate={handleTimeUpdate}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                }}
              />

              {/* 触控万物识别覆盖层 */}
              <TouchOverlay
                videoRef={videoRef}
                bookId={bookId}
                runId={runId}
                onTouchRecognize={handleTouchRecognize}
                activeResult={activeTouchResult}
              />
            </div>

            <div
              style={{
                fontSize: '12px',
                color: '#64748b',
                backgroundColor: '#f8fafc',
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid #e2e8f0',
              }}
            >
              💡 <strong>触控提示</strong>：直接在上方视频中点击任何物体。系统已内置<strong>黑边 (Letterbox/Pillarbox) 过滤算法</strong>与<strong>归一化坐标换算</strong>，点黑边会自动拦截，点画面中物体将精确返回识别与定位。
            </div>
          </section>

          {/* 右栏：智能语音伴读问答面板 */}
          <section style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <InteractionPanel
              bookId={bookId}
              runId={runId}
              appMode={appMode}
              getCurrentVideoMs={() => currentTimeMs}
              seekVideoToMs={seekVideoToMs}
              onActiveTouchResultChange={setActiveTouchResult}
              onNewHistoryItem={handleNewHistoryItem}
            />
          </section>
        </main>
      )}

      {/* 底部：通用阅读扩展（分类确认与笔记抽屉） */}
      <footer style={{ marginTop: '20px' }}>
        <ReadingNotesDrawer
          bookId={bookId}
          confirmedType={confirmedType}
          onConfirmTypeChange={handleConfirmTypeChange}
          appMode={appMode}
        />
      </footer>
    </div>
  );
};

export default App;
