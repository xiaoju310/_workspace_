export interface TtsPlaybackOptions {
  language?: 'zh-CN' | 'en-US';
  rate?: number; // 语速 (默认 1.0)
  pitch?: number; // 音调 (默认 1.1 偏亲切童声)
  volume?: number;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (err: any) => void;
  onFirstAudioByte?: (latencyMs: number) => void;
  /** 等待开始发音的上限；超时视为失败（Chrome 无中文语音包/语音列表未加载时会静默不发音） */
  startTimeoutMs?: number;
}

export const TTS_START_TIMEOUT_MS = 5000;

export interface ITtsProvider {
  name: string;
  isAvailable(): Promise<boolean>;
  speak(text: string, options?: TtsPlaybackOptions): Promise<{ audioUrl?: string; firstAudioMs: number | null }>;
  stop(): void;
}

function getSpeechSynthesis(): any {
  if (typeof window !== 'undefined' && (window as any).speechSynthesis) return (window as any).speechSynthesis;
  if (typeof globalThis !== 'undefined' && (globalThis as any).speechSynthesis) return (globalThis as any).speechSynthesis;
  return null;
}

function getUtteranceClass(): any {
  if (typeof window !== 'undefined' && (window as any).SpeechSynthesisUtterance) return (window as any).SpeechSynthesisUtterance;
  if (typeof globalThis !== 'undefined' && (globalThis as any).SpeechSynthesisUtterance) return (globalThis as any).SpeechSynthesisUtterance;
  return null;
}

/**
 * 1. 浏览器原生 SpeechSynthesis 离线适配器 (零网络依赖，现场演练金牌兜底)
 */
export class BrowserSpeechSynthesisTts implements ITtsProvider {
  name = 'Browser SpeechSynthesis (离线童声)';
  private cancelPlayback: (() => void) | null = null;

  async isAvailable(): Promise<boolean> {
    return getSpeechSynthesis() !== null && getUtteranceClass() !== null;
  }

  speak(text: string, options?: TtsPlaybackOptions): Promise<{ audioUrl?: string; firstAudioMs: number | null }> {
    this.stop();
    return new Promise((resolve) => {
      const synth = getSpeechSynthesis();
      const Utterance = getUtteranceClass();
      if (!synth || !Utterance) {
        options?.onError?.(new Error('SpeechSynthesis not supported in current environment'));
        resolve({ firstAudioMs: null });
        return;
      }

      const start = performance.now();
      let firstAudioMs: number | null = null;
      let finished = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      // 浏览器可能不回报取消；由适配器自己结束等待并作废迟到事件。
      const finish = (error?: unknown, cancelNative = false) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (this.cancelPlayback === cancelPlayback) this.cancelPlayback = null;
        // 先作废本次事件，再取消浏览器，避免同步 canceled 事件重入。
        if (cancelNative) {
          try { synth.cancel(); } catch { /* 取消失败也必须释放等待 */ }
        }
        resolve({ firstAudioMs });
        if (error !== undefined) options?.onError?.(error);
        else options?.onEnd?.();
      };
      const cancelPlayback = () => finish(undefined, true);
      this.cancelPlayback = cancelPlayback;

      try {
        const utterance = new Utterance(text);
        utterance.lang = options?.language ?? (/[\u3400-\u9fff]/.test(text) ? 'zh-CN' : 'en-US');
        utterance.rate = options?.rate ?? 0.95;
        utterance.pitch = options?.pitch ?? 1.15;
        utterance.volume = options?.volume ?? 1.0;

        timer = setTimeout(() => {
          finish(new Error(`语音合成 ${options?.startTimeoutMs ?? TTS_START_TIMEOUT_MS}ms 内没有开始发音（可能缺少语音包）`), true);
        }, options?.startTimeoutMs ?? TTS_START_TIMEOUT_MS);

        utterance.onstart = () => {
          if (finished || firstAudioMs !== null) return;
          clearTimeout(timer);
          firstAudioMs = Math.round(performance.now() - start);
          resolve({ firstAudioMs });
          options?.onFirstAudioByte?.(firstAudioMs);
          options?.onStart?.();
        };
        utterance.onend = () => finish();
        utterance.onerror = (event: any) => {
          if (event?.error === 'interrupted' || event?.error === 'canceled') finish();
          else finish(event);
        };
        synth.speak(utterance);
      } catch (error: unknown) {
        finish(error, true);
      }
    });
  }

  stop(): void {
    if (this.cancelPlayback) this.cancelPlayback();
    else {
      try { getSpeechSynthesis()?.cancel(); } catch { /* 无活动会话时取消失败无需回报 */ }
    }
  }
}

/**
 * 2. 后端 TTS 适配器占位
 * 注意：后端 A 契约速查明确指出无服务端 TTS 接口（已知契约空白），
 * 不得向不存在的 /api/v1/interaction/tts 发请求或做假兜底。
 */
export class BackendTtsProvider implements ITtsProvider {
  name = 'Backend TTS (契约空白，尚未提供)';

  async isAvailable(): Promise<boolean> {
    return false;
  }

  async speak(_text: string, options?: TtsPlaybackOptions): Promise<{ audioUrl?: string; firstAudioMs: number | null }> {
    const err = new Error('后端 A 尚未提供 TTS 接口（见 contract-cheatsheet 已知契约空白 #1），请使用浏览器本地语音合成。');
    options?.onError?.(err);
    throw err;
  }

  stop(): void {
    // 无远程播放需要停止
  }
}

export const ttsManager = new BrowserSpeechSynthesisTts();
