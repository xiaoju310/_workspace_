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
  speak(text: string, options?: TtsPlaybackOptions): Promise<{ audioUrl?: string; firstAudioMs: number }>;
  stop(): void;
}

/**
 * 1. 浏览器原生 SpeechSynthesis 离线适配器 (零网络依赖，现场演练金牌兜底)
 */
export class BrowserSpeechSynthesisTts implements ITtsProvider {
  name = 'Browser SpeechSynthesis (离线童声)';

  async isAvailable(): Promise<boolean> {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  speak(text: string, options?: TtsPlaybackOptions): Promise<{ audioUrl?: string; firstAudioMs: number }> {
    return new Promise((resolve) => {
      const start = performance.now();
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
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

      utterance.onerror = (e) => {
        options?.onError?.(e);
        resolve({ firstAudioMs: Math.round(performance.now() - start) });
      };

      window.speechSynthesis.speak(utterance);
    });
  }

  stop(): void {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }
}

/**
 * 2. 后端真实 TTS 接口适配器 (CosyVoice / Edge-TTS)
 */
export class BackendTtsProvider implements ITtsProvider {
  name = 'Backend CosyVoice TTS';
  private endpoint: string;

  constructor(endpoint: string = '/api/v1/interaction/tts') {
    this.endpoint = endpoint;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.endpoint}/health`, { method: 'GET', signal: AbortSignal.timeout(800) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async speak(text: string, options?: TtsPlaybackOptions): Promise<{ audioUrl?: string; firstAudioMs: number }> {
    const start = performance.now();
    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: 'child_friendly' }),
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) throw new Error('Backend TTS HTTP Error');
      const blob = await res.blob();
      const firstAudioMs = Math.round(performance.now() - start);
      options?.onFirstAudioByte?.(firstAudioMs);

      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      options?.onStart?.();
      audio.onended = () => options?.onEnd?.();
      audio.onerror = (e) => options?.onError?.(e);
      await audio.play();

      return { audioUrl: url, firstAudioMs };
    } catch (err) {
      console.warn('Backend TTS failed, falling back to Browser SpeechSynthesis:', err);
      return new BrowserSpeechSynthesisTts().speak(text, options);
    }
  }

  stop(): void {
    new BrowserSpeechSynthesisTts().stop();
  }
}

export const ttsManager = new BrowserSpeechSynthesisTts();
