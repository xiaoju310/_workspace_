import React from 'react';
import { InteractionHistoryItem } from '../../../types/interaction';

interface InteractionHistoryPanelProps {
  history: InteractionHistoryItem[];
  onSeekToMs: (ms: number) => void;
  onClearHistory: () => void;
}

export const InteractionHistoryPanel: React.FC<InteractionHistoryPanelProps> = ({
  history,
  onSeekToMs,
  onClearHistory,
}) => {
  const exportJsonLog = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(history, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `interaction_log_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  return (
    <div
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <h3 style={{ margin: 0, fontSize: '15px', color: '#0f172a' }}>
            📜 多模态交互会话历史 ({history.length} 条)
          </h3>
          <span style={{ fontSize: '11px', color: '#94a3b8' }}>支持语音/触控全量留痕与回溯</span>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          {history.length > 0 && (
            <>
              <button
                type="button"
                onClick={exportJsonLog}
                style={{
                  fontSize: '11px',
                  padding: '4px 10px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  background: '#f8fafc',
                  cursor: 'pointer',
                  color: '#334155',
                }}
              >
                📥 导出日志 (JSON)
              </button>
              <button
                type="button"
                onClick={onClearHistory}
                style={{
                  fontSize: '11px',
                  padding: '4px 8px',
                  borderRadius: '6px',
                  border: '1px solid #fee2e2',
                  background: '#fef2f2',
                  cursor: 'pointer',
                  color: '#dc2626',
                }}
              >
                清空
              </button>
            </>
          )}
        </div>
      </div>

      {history.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '24px 0', color: '#94a3b8', fontSize: '13px' }}>
          暂无交互历史，试着在视频上点击认物，或按住说话提问吧！
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '360px', overflowY: 'auto' }}>
          {history.map((item) => (
            <div
              key={item.id}
              style={{
                backgroundColor: item.status === 'no_evidence' ? '#fffbeb' : '#f8fafc',
                border: `1px solid ${item.status === 'no_evidence' ? '#fef3c7' : '#e2e8f0'}`,
                borderRadius: '8px',
                padding: '10px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#334155' }}>
                  {item.type === 'voice' ? '🎤 语音问答' : '🎯 触控认物'} ｜ 视频 {(item.video_ms / 1000).toFixed(1)}s
                </span>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <span
                    style={{
                      fontSize: '10px',
                      padding: '1px 5px',
                      borderRadius: '3px',
                      backgroundColor: item.cache_hit ? '#e0e7ff' : '#f1f5f9',
                      color: item.cache_hit ? '#3730a3' : '#64748b',
                    }}
                  >
                    {item.cache_hit ? '缓存命中' : '实时'}
                  </span>
                  <span style={{ fontSize: '11px', color: '#64748b' }}>{typeof item.latency_ms === 'number' ? `耗时 ${item.latency_ms}ms` : '延迟未实测'}</span>
                </div>
              </div>

              {item.query && (
                <div style={{ fontSize: '13px', color: '#475569' }}>
                  <strong>问：</strong>{item.query}
                </div>
              )}

              <div style={{ fontSize: '13px', color: '#0f172a' }}>
                <strong>答：</strong>{item.response_text}
              </div>

              {item.evidence && item.evidence.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px' }}>
                  <span style={{ fontSize: '11px', color: '#64748b' }}>
                    依据：第 {item.evidence[0].page_no} 页 ｜ {item.evidence[0].snippet}
                  </span>
                  {/* 页级证据(evidence_type='page')的 video_start_ms 是 0 占位，不是视频时间，不能拿来跳转 */}
                  {item.evidence[0].evidence_type !== 'page' && (
                  <button
                    type="button"
                    onClick={() => onSeekToMs(item.evidence![0].video_start_ms)}
                    style={{
                      fontSize: '11px',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      border: '1px solid #cbd5e1',
                      background: '#ffffff',
                      color: '#2563eb',
                      cursor: 'pointer',
                    }}
                  >
                    ▶ 跳转片段
                  </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
