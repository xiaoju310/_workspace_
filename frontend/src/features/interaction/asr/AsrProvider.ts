import { AsrErrorCode } from '../../../types/interaction';

export interface AsrResult {
  text: string;
  confidence: number;
  latencyMs: number;
  provider: 'browser_web_speech' | 'backend' | 'demo_mock';
  errorCode?: AsrErrorCode;
}

/**
 * 真实浏览器原生 Web Speech API 监听识别器 (Chrome / Edge / Safari 原生支持)
 * 实时捕获麦克风语音流并转为真实文本
 */
export class RealBrowserSpeechRecognition {
  private recognition: any = null;
  private isListening = false;
  private transcript = '';

  constructor() {
    const SpeechRec =
      typeof window !== 'undefined'
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : null;

    if (SpeechRec) {
      this.recognition = new SpeechRec();
      this.recognition.lang = 'zh-CN'; // 普通话
      this.recognition.continuous = true;
      this.recognition.interimResults = true;

      this.recognition.onresult = (event: any) => {
        let currentText = '';
        for (let i = 0; i < event.results.length; i++) {
          currentText += event.results[i][0].transcript;
        }
        this.transcript = currentText;
      };

      this.recognition.onerror = (e: any) => {
        console.warn('SpeechRecognition error:', e);
      };
    }
  }

  isSupported(): boolean {
    return Boolean(this.recognition);
  }

  start() {
    if (!this.recognition || this.isListening) return;
    this.transcript = '';
    this.isListening = true;
    try {
      this.recognition.start();
    } catch {}
  }

  stop(): Promise<string> {
    return new Promise((resolve) => {
      if (!this.recognition || !this.isListening) {
        resolve(this.transcript.trim());
        return;
      }
      this.isListening = false;
      this.recognition.onend = () => {
        resolve(this.transcript.trim());
      };
      try {
        this.recognition.stop();
      } catch {
        resolve(this.transcript.trim());
      }
    });
  }

  getCurrentTranscript(): string {
    return this.transcript.trim();
  }
}

export const realSpeechRecognizer = new RealBrowserSpeechRecognition();

/**
 * ASR 统一管理器：严格拒绝空转写伪造
 */
export class AsrManager {
  /**
   * 转写音频或获取实时语音识别文本
   * 严格准则：识别不到文字时返回明确错误，绝不替用户编造一句话
   */
  async processSpeechRecognition(
    recognizedText: string,
    mode: 'live' | 'demo'
  ): Promise<AsrResult> {
    const start = performance.now();
    const cleanText = recognizedText.trim();

    if (!cleanText) {
      // 严格按照队长意见：空转写直接报错，提示用户重试，绝不自动替换成默认问题
      return {
        text: '',
        confidence: 0,
        latencyMs: Math.round(performance.now() - start),
        provider: 'browser_web_speech',
        errorCode: 'NO_SPEECH_DETECTED',
      };
    }

    return {
      text: cleanText,
      confidence: 0.95,
      latencyMs: Math.round(performance.now() - start),
      provider: mode === 'demo' ? 'demo_mock' : 'browser_web_speech',
    };
  }
}

export const asrManager = new AsrManager();
