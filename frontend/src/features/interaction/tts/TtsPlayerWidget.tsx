import React, { useEffect, useRef, useState } from 'react';
import { ttsManager } from './TtsProvider';

interface TtsPlayerWidgetProps {
  textToSpeak: string;
  onAudioFirstByte?: (ms: number) => void;
}

/**
 * 答案朗读按钮。
 * 整改点（D6）：
 *  - 换答案或离开页面时必须停止朗读：旧实现卸载后浏览器继续念上一条答案，首音延迟也残留在新答案上；
 *  - 朗读失败要告诉用户（文字答案仍在上方显示），而不是按钮悄悄复位；
 *  - 只在本组件发起的那一次朗读里更新状态，避免旧回调覆盖新状态。
 */
export const TtsPlayerWidget: React.FC<TtsPlayerWidgetProps> = ({ textToSpeak, onAudioFirstByte }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1.0);
  const [firstByteMs, setFirstByteMs] = useState<number | null>(null);
  const [ttsError, setTtsError] = useState<string | null>(null);
  const session = useRef(0);

  useEffect(() => {
    // 新答案：作废进行中的朗读与旧指标
    session.current += 1;
    ttsManager.stop();
    setIsPlaying(false);
    setFirstByteMs(null);
    setTtsError(null);
  }, [textToSpeak]);

  useEffect(
    () => () => {
      session.current += 1;
      ttsManager.stop();
    },
    []
  );

  const handlePlay = async () => {
    if (isPlaying) {
      session.current += 1;
      ttsManager.stop();
      setIsPlaying(false);
      return;
    }
    const mine = ++session.current;
    const alive = () => session.current === mine;
    setTtsError(null);
    if (!(await ttsManager.isAvailable())) {
      setTtsError('当前浏览器不支持语音朗读，请阅读上方文字答案。');
      return;
    }
    setIsPlaying(true);
    await ttsManager.speak(textToSpeak, {
      rate: speed,
      pitch: 1.15,
      onStart: () => alive() && setIsPlaying(true),
      onEnd: () => alive() && setIsPlaying(false),
      onError: (err: any) => {
        if (!alive()) return;
        setIsPlaying(false);
        const reason = err?.message || err?.error || '未知原因';
        setTtsError(`语音朗读失败（${reason}），文字答案不受影响。`);
      },
      onFirstAudioByte: (ms) => {
        if (!alive()) return;
        setFirstByteMs(ms);
        onAudioFirstByte?.(ms);
      },
    });
  };

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', gap: '4px' }}>
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          backgroundColor: isPlaying ? '#f0fdf4' : '#f8fafc',
          border: `1px solid ${isPlaying ? '#86efac' : '#e2e8f0'}`,
          borderRadius: '20px',
          padding: '4px 10px',
          fontSize: '12px',
          color: isPlaying ? '#166534' : '#475569',
        }}
      >
        <button
          type="button"
          onClick={handlePlay}
          style={{
            border: 'none',
            backgroundColor: 'transparent',
            cursor: 'pointer',
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            fontWeight: 600,
            color: isPlaying ? '#16a34a' : '#2563eb',
          }}
        >
          <span>{isPlaying ? '⏸️ 暂停朗读' : '🔊 语音播报'}</span>
        </button>

        {isPlaying && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '2px', height: '14px' }}>
            {[8, 14, 10, 16, 6].map((h, i) => (
              <span
                key={i}
                style={{
                  width: '2px',
                  height: `${h}px`,
                  backgroundColor: '#16a34a',
                  borderRadius: '1px',
                  animation: 'ping 0.8s ease-in-out infinite alternate',
                }}
              />
            ))}
          </div>
        )}

        <select
          value={speed}
          onChange={(e) => setSpeed(parseFloat(e.target.value))}
          aria-label="朗读语速"
          style={{
            fontSize: '11px',
            border: 'none',
            backgroundColor: 'transparent',
            color: '#64748b',
            outline: 'none',
            cursor: 'pointer',
          }}
        >
          <option value="0.85">0.85x 慢速</option>
          <option value="1">1.0x 标准</option>
          <option value="1.2">1.2x 快速</option>
        </select>

        {firstByteMs !== null && <span style={{ fontSize: '10px', color: '#94a3b8' }}>首音频: {firstByteMs}ms</span>}
      </div>
      {ttsError && (
        <span role="alert" style={{ fontSize: '11px', color: '#b91c1c' }}>
          {ttsError}
        </span>
      )}
    </div>
  );
};
