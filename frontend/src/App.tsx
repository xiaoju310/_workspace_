import React, { useState, useRef } from 'react';
import { TouchOverlay } from './features/interaction/TouchOverlay';
import { InteractionPanel } from './features/interaction/InteractionPanel';
import { BenchmarkRunner } from './features/interaction/BenchmarkRunner';
import { ReadingNotesDrawer } from './features/interaction/ReadingNotesDrawer';
import { TouchRecognitionResponse, BookCategoryInfo } from './types/interaction';
import { apiClient } from './lib/api';

export const App: React.FC = () => {
  const [bookId] = useState('book-auth-sample-01');
  const [runId] = useState('run-20261104-001');
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [activeTouchResult, setActiveTouchResult] = useState<TouchRecognitionResponse | null>(null);
  const [activeTab, setActiveTab] = useState<'interactive' | 'benchmark'>('interactive');

  // 通用阅读扩展：分类与笔记状态
  const [categoryInfo, setCategoryInfo] = useState<BookCategoryInfo>({
    category: 'picture_book',
    confidence: 0.98,
    is_confirmed: true,
    confirmed_by: 'owner',
  });

  const videoRef = useRef<HTMLVideoElement>(null);

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
      const resp = await apiClient.recognizeTouch(touchReq);
      setActiveTouchResult(resp);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '20px' }}>
      {/* 顶部 Header */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: '#ffffff',
          padding: '16px 24px',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          marginBottom: '20px',
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: '20px', color: '#0f172a' }}>
            📖 纸书智伴 · 语音触控伴读与联调工作台
          </h1>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#64748b' }}>
            分支: <code style={{ color: '#2563eb' }}>team/c-interaction</code> ｜ 书籍: {bookId} ｜ 运行批次: {runId}
          </p>
        </div>

        {/* 通用阅读扩展标签与分类确认 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <select
            value={categoryInfo.category}
            onChange={(e) => {
              const cat = e.target.value as any;
              setCategoryInfo((prev) => ({ ...prev, category: cat }));
              apiClient.confirmCategory(bookId, cat);
            }}
            style={{
              fontSize: '12px',
              backgroundColor: '#eff6ff',
              color: '#1d4ed8',
              padding: '4px 8px',
              borderRadius: '16px',
              border: '1px solid #bfdbfe',
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            <option value="picture_book">儿童绘本 (赛事主场景)</option>
            <option value="textbook">通用教材</option>
            <option value="literature">文学名著</option>
            <option value="science">科普百科</option>
          </select>
          <span
            style={{
              fontSize: '12px',
              backgroundColor: '#f0fdf4',
              color: '#15803d',
              padding: '4px 10px',
              borderRadius: '16px',
              border: '1px solid #bbf7d0',
            }}
          >
            🔒 笔记隐私: 主人审核后可分享
          </span>
        </div>
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
            boxShadow: activeTab === 'interactive' ? '0 2px 6px rgba(37,99,235,0.3)' : 'none',
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
            boxShadow: activeTab === 'benchmark' ? '0 2px 6px rgba(37,99,235,0.3)' : 'none',
          }}
        >
          🧪 自动化基准测试与报告导出 (10条问答+5次点击)
        </button>
      </div>

      {activeTab === 'benchmark' ? (
        <BenchmarkRunner bookId={bookId} runId={runId} />
      ) : (
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

            {/* 视频容器（相对定位，包含 TouchOverlay） */}
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
                src="https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
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
              getCurrentVideoMs={() => currentTimeMs}
              seekVideoToMs={seekVideoToMs}
              onActiveTouchResultChange={setActiveTouchResult}
            />
          </section>
        </main>
      )}

      {/* 底部：通用阅读扩展（分类确认与笔记抽屉） */}
      <footer style={{ marginTop: '20px' }}>
        <ReadingNotesDrawer
          bookId={bookId}
          categoryInfo={categoryInfo}
          onUpdateCategory={setCategoryInfo}
        />
      </footer>
    </div>
  );
};

export default App;
