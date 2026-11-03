import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  getSupportedAudioMimeType,
  encodeAudioBufferToWav,
  calculateRMS,
} from './AudioRecorderHelper';

interface AudioRecorderProps {
  onRecordingComplete: (audioBlob: Blob, mimeType: string) => void;
  disabled?: boolean;
  maxDurationSec?: number;
}

export const AudioRecorder: React.FC<AudioRecorderProps> = ({
  onRecordingComplete,
  disabled = false,
  maxDurationSec = 15,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const timerRef = useRef<any>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  // 清理资源
  const cleanup = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setVolume(0);
  }, []);

  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  // 开始录音
  const startRecording = async () => {
    setErrorMsg(null);
    audioChunksRef.current = [];

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('当前浏览器不支持音频录制 (getUserMedia 不可用)');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
          sampleRate: 16000,
        },
      });
      streamRef.current = stream;

      // 1. 初始化 Web Audio API 监听音量
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Float32Array(analyser.fftSize);
      const updateVolume = () => {
        if (analyserRef.current) {
          analyserRef.current.getFloatTimeDomainData(dataArray);
          const rms = calculateRMS(dataArray);
          setVolume(rms);
        }
        animFrameRef.current = requestAnimationFrame(updateVolume);
      };
      updateVolume();

      // 2. 初始化 MediaRecorder
      const mimeType = getSupportedAudioMimeType();
      const options = mimeType ? { mimeType } : undefined;
      const recorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        cleanup();
        setIsRecording(false);

        if (audioChunksRef.current.length === 0) {
          setErrorMsg('未采集到音频数据，请重试');
          return;
        }

        const rawBlob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });

        // 尝试转写为 16kHz WAV 保证兼容性
        try {
          const decodeCtx = new AudioCtx();
          const arrayBuf = await rawBlob.arrayBuffer();
          const audioBuf = await decodeCtx.decodeAudioData(arrayBuf);
          const wavBlob = encodeAudioBufferToWav(audioBuf);
          decodeCtx.close();
          onRecordingComplete(wavBlob, 'audio/wav');
        } catch (convErr) {
          console.warn('WAV 本地转换失败，回退使用原始录音格式:', convErr);
          onRecordingComplete(rawBlob, recorder.mimeType || 'audio/webm');
        }
      };

      recorder.start(250); // 每 250ms 切片
      setIsRecording(true);
      setDuration(0);

      // 倒计时计时器
      let sec = 0;
      timerRef.current = setInterval(() => {
        sec += 1;
        setDuration(sec);
        if (sec >= maxDurationSec) {
          stopRecording();
        }
      }, 1000);
    } catch (err: any) {
      cleanup();
      setIsRecording(false);
      let message = '无法访问麦克风：' + err.message;
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        message = '麦克风权限被拒绝。请在浏览器地址栏允许麦克风权限后重试。';
      } else if (err.name === 'NotFoundError') {
        message = '未检测到可用麦克风设备，请检查音频输入硬件。';
      }
      setErrorMsg(message);
    }
  };

  // 停止录音
  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button
          type="button"
          disabled={disabled}
          onClick={isRecording ? stopRecording : startRecording}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 20px',
            borderRadius: '24px',
            border: 'none',
            cursor: disabled ? 'not-allowed' : 'pointer',
            backgroundColor: isRecording ? '#ef4444' : '#3b82f6',
            color: '#fff',
            fontWeight: '600',
            fontSize: '15px',
            boxShadow: isRecording
              ? `0 0 ${12 + volume * 20}px rgba(239, 68, 68, 0.8)`
              : '0 2px 6px rgba(59, 130, 246, 0.3)',
            transition: 'all 0.2s ease',
          }}
        >
          <span
            style={{
              display: 'inline-block',
              width: '10px',
              height: '10px',
              borderRadius: isRecording ? '2px' : '50%',
              backgroundColor: '#fff',
            }}
          />
          {isRecording ? `松开/结束 (${duration}s / ${maxDurationSec}s)` : '按住说话 / 点击提问'}
        </button>

        {isRecording && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '3px', height: '24px' }}>
            {[0.2, 0.5, 0.9, 0.6, 0.3].map((scale, i) => (
              <span
                key={i}
                style={{
                  width: '4px',
                  backgroundColor: '#ef4444',
                  borderRadius: '2px',
                  height: `${Math.max(4, volume * 28 * scale)}px`,
                  transition: 'height 0.1s ease',
                }}
              />
            ))}
          </div>
        )}
      </div>

      {errorMsg && (
        <div
          style={{
            color: '#dc2626',
            fontSize: '13px',
            backgroundColor: '#fee2e2',
            padding: '6px 12px',
            borderRadius: '6px',
            maxWidth: '380px',
            textAlign: 'center',
          }}
        >
          {errorMsg}
        </div>
      )}
    </div>
  );
};
