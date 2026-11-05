import React, { useState } from 'react';
import {
  AskQuestionResponse,
  TouchRecognitionResponse,
  InteractionStatus,
  AskQuestionRequest,
  TouchRecognitionRequest,
  InteractionHistoryItem,
  AppMode,
} from '../../types/interaction';
import { AudioRecorder } from './AudioRecorder';
import { apiClient } from '../../lib/api';
import { TtsPlayerWidget } from './tts/TtsPlayerWidget';

interface InteractionPanelProps {
  bookId: string;
  runId: string;
  appMode: AppMode;
  getCurrentVideoMs: () => number;
  seekVideoToMs?: (ms: number) => void;
  onActiveTouchResultChange?: (result: TouchRecognitionResponse | null) => void;
  onNewHistoryItem?: (item: InteractionHistoryItem) => void;
}

export const InteractionPanel: React.FC<InteractionPanelProps> = ({
  bookId,
  runId,
  appMode,
  getCurrentVideoMs,
  seekVideoToMs,
  onActiveTouchResultChange,
  onNewHistoryItem,
}) => {
  const [status, setStatus] = useState<InteractionStatus>('idle');
  const [qaResult, setQaResult] = useState<AskQuestionResponse | null>(null);
  const [touchResult, setTouchResult] = useState<TouchRecognitionResponse | null>(null);
  const [textInput, setTextInput] = useState('');
  const [lastError, setLastError] = useState<string | null>(null);

  // 1. 处理录音完毕
  const handleRecordingComplete = async (audioBlob: Blob, mimeType: string, realTranscript: string) => {
    setLastError(null);

    // 队长阻断项严格落实：严禁替用户说一句话，空转写直接报错并引导用户打字或重录
    if (!realTranscript || !realTranscript.trim()) {
      setStatus('idle');
      setLastError('⚠️ 未检测到清晰语音转写。请对准麦克风清晰提问，或直接在下方输入框打字提问。');
      return;
    }

    setTextInput(realTranscript);
    await executeAskQuestion(realTranscript, audioBlob, mimeType);
  };

  // 2. 处理文字输入测试
  const handleTextSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!textInput.trim() || status === 'processing') return;
    await executeAskQuestion(textInput.trim());
  };

  // 统一提问执行器
  const executeAskQuestion = async (query: string, audioBlob?: Blob, mimeType?: string) => {
    setStatus('processing');
    setLastError(null);
    const videoMs = getCurrentVideoMs();

    const req: AskQuestionRequest = {
      book_id: bookId,
      run_id: runId,
      video_ms: videoMs,
      query_text: query,
      audio_mime: mimeType,
      stream: false,
    };

    try {
      const resp = await apiClient.askQuestion(req, appMode, audioBlob);
      setQaResult(resp);
      setStatus(resp.status === 'no_evidence' ? 'no_evidence' : 'success');

      if (onNewHistoryItem) {
        onNewHistoryItem({
          id: `hist-${Date.now()}`,
          timestamp: Date.now(),
          type: 'voice',
          video_ms: videoMs,
          query: resp.question,
          response_text: resp.answer,
          status: resp.status,
          evidence: resp.evidence,
          latency_ms: resp.latency.total_roundtrip_ms,
          cache_hit: resp.cache_hit,
          is_demo_mock: resp.is_demo_mock,
        });
      }
    } catch (err: any) {
      setStatus('error');
      setLastError(err.message);
      setQaResult(null);
    }
  };

  // 3. 触控识别测试入口
  const handleTouchRecognize = async (touchReq: TouchRecognitionRequest) => {
    setStatus('processing');
    setLastError(null);
    try {
      const resp = await apiClient.recognizeTouch(touchReq, appMode);
      setTouchResult(resp);
      setStatus(resp.status === 'success' ? 'success' : 'error');
      if (onActiveTouchResultChange) {
        onActiveTouchResultChange(resp);
      }
      if (onNewHistoryItem) {
        onNewHistoryItem({
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
        });
      }
    } catch (err: any) {
      setStatus('error');
      setLastError(err.message);
      setTouchResult(null);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        background: '#ffffff',
        borderRadius: '12px',
        padding: '16px',
        border: '1px solid #e2e8f0',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
      }}
    >
      {/* 顶部控制栏：录音与输入 */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '16px',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid #f1f5f9',
          paddingBottom: '12px',
        }}
      >
        <AudioRecorder
          onRecordingComplete={handleRecordingComplete}
          disabled={status === 'processing'}
        />

        {/* 用户真实输入提问与调试触控 */}
        <form onSubmit={handleTextSubmit} style={{ display: 'flex', gap: '8px', flex: 1, minWidth: '240px' }}>
          <input
            type="text"
            placeholder="输入您要向伴读助手提问的问题..."
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            disabled={status === 'processing'}
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: '20px',
              border: '1px solid #cbd5e1',
              fontSize: '14px',
              outline: 'none',
            }}
          />
          <button
            type="submit"
            disabled={!textInput.trim() || status === 'processing'}
            style={{
              padding: '8px 16px',
              borderRadius: '20px',
              border: 'none',
              backgroundColor: '#0284c7',
              color: '#fff',
              fontSize: '14px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            发送
          </button>
          <button
            type="button"
            disabled={status === 'processing'}
            onClick={() => {
              handleTouchRecognize({
                book_id: bookId,
                run_id: runId,
                video_ms: getCurrentVideoMs(),
                touch_point: {
                  norm_x: 0.35,
                  norm_y: 0.42,
                  video_pixel_x: 448,
                  video_pixel_y: 302,
                  video_width: 1280,
                  video_height: 720,
                },
                viewport_info: {
                  container_width: 640,
                  container_height: 360,
                  render_width: 640,
                  render_height: 360,
                  offset_x: 0,
                  offset_y: 0,
                  is_letterbox: false,
                },
              });
            }}
            style={{
              padding: '8px 12px',
              borderRadius: '20px',
              border: '1px solid #cbd5e1',
              backgroundColor: '#f8fafc',
              color: '#475569',
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            触控测试
          </button>
        </form>
      </div>

      {/* 错误提示栏 (对齐队长要求：真实模式报错直白呈现，绝不造假) */}
      {lastError && (
        <div
          style={{
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#dc2626',
            padding: '10px 14px',
            borderRadius: '8px',
            fontSize: '13px',
            lineHeight: 1.5,
          }}
        >
          {lastError}
        </div>
      )}

      {/* 处理中加载动效 */}
      {status === 'processing' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#64748b', fontSize: '14px' }}>
          <span
            style={{
              display: 'inline-block',
              width: '16px',
              height: '16px',
              border: '2px solid #3b82f6',
              borderTopColor: 'transparent',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }}
          />
          {appMode === 'live' ? '正在请求真实后端交互服务...' : '正在执行本地离线基准演算...'}
        </div>
      )}

      {/* 问答反馈展示区 */}
      {qaResult && (
        <div
          style={{
            backgroundColor: qaResult.status === 'no_evidence' ? '#fffbeb' : '#f8fafc',
            border: `1px solid ${qaResult.status === 'no_evidence' ? '#fde68a' : '#e2e8f0'}`,
            borderRadius: '8px',
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#475569' }}>
              ❓ 问：{qaResult.question}
            </span>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              {qaResult.is_demo_mock ? (
                <span
                  style={{
                    fontSize: '11px',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    backgroundColor: '#fef3c7',
                    color: '#92400e',
                    border: '1px solid #fde68a',
                  }}
                >
                  ⚠️ 离线演示数据
                </span>
              ) : (
                <span
                  style={{
                    fontSize: '11px',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    backgroundColor: qaResult.cache_hit ? '#e0e7ff' : '#f0fdf4',
                    color: qaResult.cache_hit ? '#4338ca' : '#15803d',
                  }}
                >
                  {qaResult.cache_hit ? '⚡ 缓存命中' : '🟢 真实后端响应'}
                </span>
              )}
              <span
                style={{
                  fontSize: '11px',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  backgroundColor: qaResult.confidence >= 0.8 ? '#dcfce7' : '#fef9c3',
                  color: qaResult.confidence >= 0.8 ? '#15803d' : '#854d0e',
                }}
              >
                置信度: {(qaResult.confidence * 100).toFixed(0)}%
              </span>
            </div>
          </div>

          <div style={{ fontSize: '15px', color: '#1e293b', lineHeight: 1.5, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
            <div>
              💬 <strong>答：</strong>{qaResult.answer}
            </div>
            <TtsPlayerWidget textToSpeak={qaResult.answer} />
          </div>

          {/* 结构化证据卡片 */}
          {qaResult.evidence && qaResult.evidence.length > 0 && (
            <div style={{ marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>📖 判定依据：</div>
              {qaResult.evidence.map((ev, idx) => (
                <div
                  key={idx}
                  style={{
                    fontSize: '12px',
                    color: '#334155',
                    backgroundColor: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: '6px',
                    padding: '6px 10px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span>
                    第 <strong>{ev.page_no}</strong> 页 ｜ 视频{' '}
                    <strong>{(ev.video_start_ms / 1000).toFixed(1)}s</strong> -{' '}
                    <strong>{(ev.video_end_ms / 1000).toFixed(1)}s</strong> ｜ {ev.snippet}
                  </span>
                  {seekVideoToMs && (
                    <button
                      type="button"
                      onClick={() => seekVideoToMs(ev.video_start_ms)}
                      style={{
                        padding: '2px 8px',
                        fontSize: '11px',
                        borderRadius: '4px',
                        border: '1px solid #94a3b8',
                        background: '#f8fafc',
                        cursor: 'pointer',
                      }}
                    >
                      ▶️ 跳转证据
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* 性能开销指标 */}
          <div
            style={{
              fontSize: '11px',
              color: '#94a3b8',
              borderTop: '1px dashed #e2e8f0',
              paddingTop: '6px',
              display: 'flex',
              gap: '12px',
              flexWrap: 'wrap',
            }}
          >
            <span>端到端总耗时: {qaResult.latency.total_roundtrip_ms}ms</span>
            {qaResult.latency.retrieval_ms > 0 && <span>检索: {qaResult.latency.retrieval_ms}ms</span>}
            {qaResult.latency.llm_total_ms > 0 && <span>短答: {qaResult.latency.llm_total_ms}ms</span>}
          </div>
        </div>
      )}

      {/* 触控识别结果反馈 */}
      {touchResult && (
        <div
          style={{
            backgroundColor: touchResult.is_demo_mock ? '#fffbeb' : '#ecfdf5',
            border: `1px solid ${touchResult.is_demo_mock ? '#fde68a' : '#a7f3d0'}`,
            borderRadius: '8px',
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '14px', fontWeight: 'bold', color: touchResult.is_demo_mock ? '#92400e' : '#065f46' }}>
              🎯 触控识别结果：{touchResult.target_name}
            </span>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              {touchResult.is_demo_mock && (
                <span style={{ fontSize: '10px', backgroundColor: '#fef3c7', color: '#92400e', padding: '1px 5px', borderRadius: '3px' }}>
                  离线演示数据
                </span>
              )}
              <span style={{ fontSize: '11px', color: '#059669' }}>耗时: {touchResult.latency_ms}ms</span>
            </div>
          </div>
          <div style={{ fontSize: '13px', color: touchResult.is_demo_mock ? '#78350f' : '#047857' }}>
            {touchResult.explanation}
          </div>
        </div>
      )}
    </div>
  );
};
