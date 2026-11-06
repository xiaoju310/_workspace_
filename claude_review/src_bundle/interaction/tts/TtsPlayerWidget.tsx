import React, { useState } from 'react';
import { ttsManager } from './TtsProvider';

interface TtsPlayerWidgetProps {
  textToSpeak: string;
  onAudioFirstByte?: (ms: number) => void;
}

export const TtsPlayerWidget: React.FC<TtsPlayerWidgetProps> = ({
  textToSpeak,
  onAudioFirstByte,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1.0);
  const [firstByteMs, setFirstByteMs] = useState<number | null>(null);

  const handlePlay = async () => {
    if (isPlaying) {
      ttsManager.stop();
      setIsPlaying(false);
      return;
    }

    setIsPlaying(true);
    await ttsManager.speak(textToSpeak, {
      rate: speed,
      pitch: 1.15,
      onStart: () => setIsPlaying(true),
      onEnd: () => setIsPlaying(false),
      onError: () => setIsPlaying(false),
      onFirstAudioByte: (ms) => {
        setFirstByteMs(ms);
        onAudioFirstByte?.(ms);
      },
    });
  };

  return (
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

      {/* 动态律动声波 */}
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

      {/* 语速调节 */}
      <select
        value={speed}
        onChange={(e) => setSpeed(parseFloat(e.target.value))}
        style={{
          fontSize: '11px',
          border: 'none',
          backgroundColor: 'transparent',
          color: '#64748b',
          outline: 'none',
          cursor: 'pointer',
        }}
      >
        <option value="0.85">0.8x 慢速</option>
        <option value="1.0">1.0x 标准</option>
        <option value="1.2">1.2x 快速</option>
      </select>

      {firstByteMs !== null && (
        <span style={{ fontSize: '10px', color: '#94a3b8' }}>
          首音频: {firstByteMs}ms
        </span>
      )}
    </div>
  );
};
