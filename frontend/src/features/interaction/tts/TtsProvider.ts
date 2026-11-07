export interface TtsPlaybackOptions {
  rate?: number; // 语速 (默认 1.0)
  pitch?: number; // 音调 (默认 1.1 偏亲切童声)
  volume?: number;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (err: any) => void;
  onFirstAudioByte?: (latencyMs: number) => void;
}

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

  async isAvailable(): Promise<boolean> {
    return getSpeechSynthesis() !== null && getUtteranceClass() !== null;
  }

  speak(text: string, options?: TtsPlaybackOptions): Promise<{ audioUrl?: string; firstAudioMs: number | null }> {
    return new Promise((resolve) => {
      const synth = getSpeechSynthesis();
      const Utterance = getUtteranceClass();
      if (!synth || !Utterance) {
        options?.onError?.(new Error('SpeechSynthesis not supported in current environment'));
        resolve({ firstAudioMs: null });
        return;
      }

      const start = performance.now();
      synth.cancel();

      const utterance = new Utterance(text);
      utterance.lang = 'zh-CN';
      utterance.rate = options?.rate ?? 0.95; // 稍慢，适合儿童
      utterance.pitch = options?.pitch ?? 1.15; // 稍高，亲和力更强
      utterance.volume = options?.volume ?? 1.0;

      let firstByteRecorded = false;

      utterance.onstart = () => {
        if (!firstByteRecorded) {
          firstByteRecorded = true;
          const latency = Math.round(performance.now() - start);
          options?.onFirstAudioByte?.(latency);
          options?.onStart?.();
          resolve({ firstAudioMs: latency });
        }
      };

      utterance.onend = () => {
        options?.onEnd?.();
      };

      utterance.onerror = (e: any) => {
        options?.onError?.(e);
        // 出错未发音时首音延迟为 null，不假造数字
        resolve({ firstAudioMs: firstByteRecorded ? Math.round(performance.now() - start) : null });
      };

      synth.speak(utterance);
    });
  }

  stop(): void {
    const synth = getSpeechSynthesis();
    if (synth) {
      synth.cancel();
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
