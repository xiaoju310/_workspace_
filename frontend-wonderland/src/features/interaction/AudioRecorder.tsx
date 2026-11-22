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
  TRANSCRIPTION_TIMEOUT: '语音识别没有按时结束，已强制停止。请重试或直接打字提问。',
};

export interface RecordingMeta {
  durationMs: number;
  recordingStoppedAt?: number;
  asrCompletedAt?: number;
  /** 识别结果是否全部定稿；false 时调用方必须让用户确认 */
  transcriptIsFinal: boolean;
  /** 识别失败的错误码（例如 TRANSCRIPTION_NETWORK_ERROR）；成功为 undefined */
  asrErrorCode?: AsrErrorCode;
  asrProvider?: string;
  audioStorage?: string;
}

interface AudioRecorderProps {
  onRecordingComplete: (audioBlob: Blob, mimeType: string, realTranscript: string, meta: RecordingMeta) => void;
  /** 录音开始/结束时通知父组件（用于禁用提交按钮） */
  onRecordingChange?: (recording: boolean) => void;
  disabled?: boolean;
  language?: 'zh-CN' | 'en-US';
  maxDurationSec?: number;
  serverFallback?: (audio:Blob,signal:AbortSignal)=>Promise<{text:string;is_final:boolean;provider:string;audio_storage:string}>;
}

export const AudioRecorder: React.FC<AudioRecorderProps> = ({
  onRecordingComplete,
  onRecordingChange,
  disabled = false,
  language = 'zh-CN',
  maxDurationSec = 15,
  serverFallback,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [processing,setProcessing] = useState(false);
  const fallbackAbort = useRef<AbortController|null>(null);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastAudioUrl, setLastAudioUrl] = useState<string | null>(null);
  const [lastAudioInfo, setLastAudioInfo] = useState<string | null>(null);

  const stoppedAtRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const timerRef = useRef<any>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);
  const startingRef = useRef(false);
  const audioUrlRef = useRef<string | null>(null);
  const startedAtRef = useRef(0);
  const [lastAudioName, setLastAudioName] = useState('recording.wav');
  const onChangeRef = useRef(onRecordingChange);
  onChangeRef.current = onRecordingChange;
  useEffect(() => {
    onChangeRef.current?.(isRecording || processing);
  }, [isRecording,processing]);

  /** 替换回放地址时释放旧的 Blob URL；旧实现每录一次泄漏一段音频内存 */
  const replaceAudioUrl = useCallback((blob: Blob) => {
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    const url = URL.createObjectURL(blob);
    audioUrlRef.current = url;
    setLastAudioUrl(url);
  }, []);

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
    mountedRef.current = true;
    return () => {
      // 卸载时：先摘掉 onstop，避免录音器停止后在已卸载组件上 setState、并把录音交给已离开的页面
      mountedRef.current = false;
      fallbackAbort.current?.abort();
      const rec = mediaRecorderRef.current;
      if (rec) {
        rec.onstop = null;
        rec.ondataavailable = null;
        if (rec.state !== 'inactive') {
          try {
            rec.stop();
          } catch {
            /* 已停止 */
          }
        }
      }
      if (realSpeechRecognizer.isListening()) void realSpeechRecognizer.stopDetailed();
      cleanup();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, [cleanup]);

  // 开始录音
  const startRecording = async () => {
    // 防重入：getUserMedia 等待授权期间连点会申请两路麦克风，第一路永远不会被释放
    if (startingRef.current || isRecording || processing) return;
    startingRef.current = true;
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
      if (!mountedRef.current) { stream.getTracks().forEach(track => track.stop()); return; }
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
        const started = realSpeechRecognizer.start(language);
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
        if (!mountedRef.current) return;
        const recordingStoppedAt = stoppedAtRef.current ?? performance.now();
        stoppedAtRef.current = null;
        setProcessing(true);
        setIsRecording(false);
        try {
          const durationMs = Math.max(0, recordingStoppedAt - startedAtRef.current);
          // 获取最终识别的文本
          let finalTranscript = '';
          let transcriptIsFinal = true;
          let asrErrorCode: AsrErrorCode | undefined = realSpeechRecognizer.isSupported() ? undefined : 'FORMAT_UNSUPPORTED';
          if (realSpeechRecognizer.isSupported()) {
            const stopped = await realSpeechRecognizer.stopDetailed();
            finalTranscript = stopped.text;
            transcriptIsFinal = stopped.isFinal;
            asrErrorCode = stopped.errorCode;
            if (!stopped.text && stopped.errorCode && stopped.errorCode !== 'NO_SPEECH_DETECTED') {
              setErrorMsg(ASR_ERROR_TEXT[stopped.errorCode] ?? null);
            }
          }
          if (!mountedRef.current) return;
          const meta: RecordingMeta = { durationMs, recordingStoppedAt, asrCompletedAt: performance.now(), transcriptIsFinal, asrErrorCode, asrProvider:"browser_web_speech", audioStorage:"not_uploaded" };

          if (audioChunksRef.current.length === 0) {
            setErrorMsg('未采集到有效音频数据，请对准麦克风重试');
            onRecordingComplete(new Blob([]), recorder.mimeType || 'audio/webm', '', {...meta, transcriptIsFinal: false, asrErrorCode: 'AUDIO_RECORD_FAILED'});
            return;
          }

          const rawBlob = new Blob(audioChunksRef.current, {
            type: recorder.mimeType || 'audio/webm',
          });

          // 尝试转写为 16kHz WAV。解码上下文必须在 finally 里关闭：
          // 旧实现解码失败时直接进 catch，AudioContext 永不释放（Chrome 同页上限约 6 个，之后录音全挂）
          let decodeCtx: AudioContext | null = null;
          let wavBlob: Blob | null = null;
          let decodeError: string | null = null;
          try {
            decodeCtx = new AudioCtx();
            const arrayBuf = await rawBlob.arrayBuffer();
            const audioBuf = await decodeCtx.decodeAudioData(arrayBuf);
            wavBlob = encodeAudioBufferToWav(audioBuf);
          } catch (e: any) {
            decodeError = e?.message ?? String(e);
          } finally {
            if (decodeCtx && decodeCtx.state !== 'closed') decodeCtx.close().catch(() => undefined);
          }
          if (!mountedRef.current) return;
          if (serverFallback && (!finalTranscript.trim() || !transcriptIsFinal || asrErrorCode)) {
            fallbackAbort.current = new AbortController();
            meta.audioStorage = 'server_upload_attempted';
            try {
              const result = await serverFallback(wavBlob ?? rawBlob,fallbackAbort.current.signal);
              if (!mountedRef.current) return;
              meta.audioStorage = result.audio_storage;
              if(result.text.trim()) {
                finalTranscript=result.text.trim();meta.transcriptIsFinal=result.is_final;
                meta.asrErrorCode=undefined;meta.asrProvider=result.provider;setErrorMsg(null);
              } else { setErrorMsg('本机兜底未识别出有效文字，请核对浏览器结果或直接打字。'); }
            } catch(error:unknown) {
              if(!mountedRef.current)return;
              setErrorMsg(error instanceof Error ? error.message : '本机识别未完成，请直接打字。');
            } finally { fallbackAbort.current=null; meta.asrCompletedAt = performance.now(); }
          }
          if (!mountedRef.current) return;
          if (wavBlob) {
            replaceAudioUrl(wavBlob);
            setLastAudioName(`recording-${Date.now()}.wav`);
            setLastAudioInfo(`标准 WAV (16kHz, ${(wavBlob.size / 1024).toFixed(1)} KB)`);
            onRecordingComplete(wavBlob, 'audio/wav', finalTranscript, meta);
          } else {
            replaceAudioUrl(rawBlob);
            setLastAudioName(`recording-${Date.now()}.${(recorder.mimeType || 'audio/webm').includes('mp4') ? 'm4a' : 'webm'}`);
            setLastAudioInfo(`原始录音 (${(rawBlob.size / 1024).toFixed(1)} KB，WAV 转码失败：${decodeError})`);
            onRecordingComplete(rawBlob, recorder.mimeType || 'audio/webm', finalTranscript, meta);
          }
        } finally { if(mountedRef.current)setProcessing(false); }
      };

      recorder.start(250);
      startedAtRef.current = performance.now();
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
      // MediaRecorder 构造失败时识别器可能已启动，必须一并停掉，否则浏览器麦克风指示灯一直亮
      if (realSpeechRecognizer.isListening()) void realSpeechRecognizer.stopDetailed();
      setIsRecording(false);
      let message = '无法访问麦克风：' + (err?.message ?? String(err));
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        message = '麦克风权限被拒绝。请在浏览器地址栏允许麦克风权限后重试。';
      } else if (err.name === 'NotFoundError') {
        message = '未检测到可用麦克风设备，请检查硬件输入设置。';
      }
      setErrorMsg(message);
    } finally {
      startingRef.current = false;
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      stoppedAtRef.current = performance.now();
      mediaRecorderRef.current.stop();
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button
          type="button"
          disabled={disabled || processing}
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
          {processing ? '正在整理录音和识别文字…' : isRecording ? `结束录音 (${duration}s / ${maxDurationSec}s)` : '🎤 点击录音提问'}
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
          {/* 后端没有音频上传接口：原始录音只在本机，需要交给 E 验收时从这里保存 */}
          <a href={lastAudioUrl} download={lastAudioName} style={{ color: '#2563eb' }}>
            保存录音文件
          </a>
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
