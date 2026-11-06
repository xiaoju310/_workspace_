import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  getSupportedAudioMimeType,
  encodeAudioBufferToWav,
  calculateRMS,
} from './AudioRecorderHelper';
import { getSpeechRecognizer } from './asr/AsrProvider';
import type { AsrErrorCode } from '../../types/interaction';

const realSpeechRecognizer = getSpeechRecognizer();

const ASR_ERROR_TEXT: Partial<Record<AsrErrorCode, string>> = {
  MICROPHONE_DENIED: '麦克风或语音识别权限被拒绝，请在浏览器地址栏允许后重试，或直接打字提问。',
  TRANSCRIPTION_NETWORK_ERROR: '语音识别服务无法连接（Chrome 的识别依赖在线服务），请改用 Edge/Safari 或直接打字提问。',
  AUDIO_RECORD_FAILED: '语音识别未能启动，请重试或直接打字提问。',
  FORMAT_UNSUPPORTED: '当前浏览器不支持普通话语音识别，请使用 Chrome/Edge/Safari 或直接打字提问。',
};

interface AudioRecorderProps {
  onRecordingComplete: (audioBlob: Blob, mimeType: string, realTranscript: string) => void;
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
  const [liveTranscript, setLiveTranscript] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastAudioUrl, setLastAudioUrl] = useState<string | null>(null);
  const [lastAudioInfo, setLastAudioInfo] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const timerRef = useRef<any>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

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
    setLiveTranscript('');
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
        // 实时更新识别的文字预览
        if (realSpeechRecognizer.isSupported()) {
          const currentText = realSpeechRecognizer.getCurrentTranscript();
          if (currentText) setLiveTranscript(currentText);
        }
        animFrameRef.current = requestAnimationFrame(updateVolume);
      };
      updateVolume();

      // 2. 启动原生实时语音转写
      if (realSpeechRecognizer.isSupported()) {
        const started = realSpeechRecognizer.start();
        if (started !== true) setErrorMsg(ASR_ERROR_TEXT[started] ?? '语音识别未能启动，请直接打字提问。');
      } else {
        setErrorMsg(ASR_ERROR_TEXT.FORMAT_UNSUPPORTED ?? null);
      }

      // 3. 初始化 MediaRecorder
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

        // 获取最终识别的文本
        let finalTranscript = '';
        if (realSpeechRecognizer.isSupported()) {
          const stopped = await realSpeechRecognizer.stopDetailed();
          finalTranscript = stopped.text;
          if (!stopped.text && stopped.errorCode && stopped.errorCode !== 'NO_SPEECH_DETECTED') {
            setErrorMsg(ASR_ERROR_TEXT[stopped.errorCode] ?? null);
          }
        }

        if (audioChunksRef.current.length === 0) {
          setErrorMsg('未采集到有效音频数据，请对准麦克风重试');
          return;
        }

        const rawBlob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });

        // 尝试转写为 16kHz WAV
        try {
          const decodeCtx = new AudioCtx();
          const arrayBuf = await rawBlob.arrayBuffer();
          const audioBuf = await decodeCtx.decodeAudioData(arrayBuf);
          const wavBlob = encodeAudioBufferToWav(audioBuf);
          decodeCtx.close();
          const url = URL.createObjectURL(wavBlob);
          setLastAudioUrl(url);
          setLastAudioInfo(`标准 WAV (16kHz, ${(wavBlob.size / 1024).toFixed(1)} KB)`);
          onRecordingComplete(wavBlob, 'audio/wav', finalTranscript);
        } catch {
          const url = URL.createObjectURL(rawBlob);
          setLastAudioUrl(url);
          setLastAudioInfo(`原始录音 (${(rawBlob.size / 1024).toFixed(1)} KB)`);
          onRecordingComplete(rawBlob, recorder.mimeType || 'audio/webm', finalTranscript);
        }
      };

      recorder.start(250);
      setIsRecording(true);
      setDuration(0);

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
        message = '未检测到可用麦克风设备，请检查硬件输入设置。';
      }
      setErrorMsg(message);
    }
  };

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
          {isRecording ? `结束录音 (${duration}s / ${maxDurationSec}s)` : '🎤 按住说话 / 点击提问'}
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

      {isRecording && liveTranscript && (
        <div style={{ fontSize: '12px', color: '#dc2626', backgroundColor: '#fef2f2', padding: '4px 8px', borderRadius: '4px' }}>
          👂 正在实时听取: "{liveTranscript}"
        </div>
      )}

      {lastAudioUrl && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: '#64748b' }}>
          <span>🎧 刚才录音回放:</span>
          <audio src={lastAudioUrl} controls style={{ height: '26px', maxWidth: '200px' }} />
          <span>{lastAudioInfo}</span>
        </div>
      )}

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
          ⚠️ {errorMsg}
        </div>
      )}
    </div>
  );
};
