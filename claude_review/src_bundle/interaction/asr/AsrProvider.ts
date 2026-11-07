import type { AsrErrorCode } from '../../../types/interaction';

export interface AsrResult {
  text: string;
  /** 识别引擎给出的置信度；引擎没给就是 null，严禁写死数字 */
  confidence: number | null;
  latencyMs: number;
  provider: 'browser_web_speech' | 'backend' | 'demo_mock';
  errorCode?: AsrErrorCode;
}

export interface SpeechStopResult {
  /** 最终识别文本（已 trim）；没有识别到则为空串 */
  text: string;
  confidence: number | null;
  /** 文本是否全部为 final 结果；false 表示包含未定稿的临时结果，调用方应让用户确认后再提交 */
  isFinal: boolean;
  errorCode?: AsrErrorCode;
}

type RecognitionCtor = new () => any;

/** 浏览器错误名 → 项目错误码 */
export function mapSpeechError(name: string | undefined): AsrErrorCode {
  switch (name) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'MICROPHONE_DENIED';
    case 'no-speech':
      return 'NO_SPEECH_DETECTED';
    case 'audio-capture':
      return 'AUDIO_RECORD_FAILED';
    case 'network':
      return 'TRANSCRIPTION_NETWORK_ERROR';
    case 'language-not-supported':
      return 'FORMAT_UNSUPPORTED';
    default:
      return 'AUDIO_RECORD_FAILED';
  }
}

const STOP_TIMEOUT_MS = 2500;

/**
 * 浏览器原生 Web Speech API 普通话识别（zh-CN）。
 *
 * 已知部署风险：Chrome 的该 API 依赖 Google 在线服务，国内网络可能报 `network`
 * （此时会返回 TRANSCRIPTION_NETWORK_ERROR，界面应引导键盘输入或换 Edge/Safari）。
 * 当前后端 A 没有 ASR 接口，因此没有服务端兜底；这是待与 A/B 确认的开放项。
 */
export class RealBrowserSpeechRecognition {
  private recognition: any = null;
  private listening = false;
  private finalText = '';
  private interimText = '';
  private confidence: number | null = null;
  private lastError: AsrErrorCode | undefined;
  private endWaiters: Array<() => void> = [];

  constructor(ctor?: RecognitionCtor | null) {
    const Ctor: RecognitionCtor | null | undefined =
      ctor !== undefined
        ? ctor
        : typeof window !== 'undefined'
          ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
          : null;
    if (!Ctor) return;

    const rec = new Ctor();
    rec.lang = 'zh-CN';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (event: any) => {
      let fin = '';
      let interim = '';
      let confSum = 0;
      let confN = 0;
      for (let i = 0; i < event.results.length; i++) {
        const res = event.results[i];
        const alt = res[0];
        if (!alt) continue;
        if (res.isFinal) {
          fin += alt.transcript;
          if (typeof alt.confidence === 'number' && alt.confidence > 0) {
            confSum += alt.confidence;
            confN += 1;
          }
        } else {
          interim += alt.transcript;
        }
      }
      this.finalText = fin;
      this.interimText = interim;
      this.confidence = confN ? confSum / confN : null;
    };

    rec.onerror = (e: any) => {
      this.lastError = mapSpeechError(e?.error);
    };

    // 浏览器可能因静音/网络自行结束：必须同步复位，否则 stop() 会永远等不到 onend
    rec.onend = () => {
      this.listening = false;
      const waiters = this.endWaiters;
      this.endWaiters = [];
      waiters.forEach((w) => w());
    };

    this.recognition = rec;
  }

  isSupported(): boolean {
    return Boolean(this.recognition);
  }

  isListening(): boolean {
    return this.listening;
  }

  /** 启动成功返回 true；失败返回错误码（不再吞异常） */
  start(): true | AsrErrorCode {
    if (!this.recognition) return 'FORMAT_UNSUPPORTED';
    if (this.listening) return true;
    this.finalText = '';
    this.interimText = '';
    this.confidence = null;
    this.lastError = undefined;
    try {
      this.recognition.start();
      this.listening = true;
      return true;
    } catch {
      this.listening = false;
      return 'AUDIO_RECORD_FAILED';
    }
  }

  getCurrentTranscript(): string {
    return (this.finalText + this.interimText).trim();
  }

  /** 停止并返回详细结果；带超时，保证 Promise 一定会结束。 */
  async stopDetailed(): Promise<SpeechStopResult> {
    if (this.recognition && this.listening) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, STOP_TIMEOUT_MS);
        this.endWaiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
        try {
          this.recognition.stop();
        } catch {
          clearTimeout(timer);
          resolve();
        }
      });
      this.listening = false;
    }
    const text = (this.finalText + this.interimText).trim();
    const isFinal = this.interimText.trim().length === 0;
    if (!text) {
      return { text: '', confidence: null, isFinal: true, errorCode: this.lastError ?? 'NO_SPEECH_DETECTED' };
    }
    return { text, confidence: this.confidence, isFinal, errorCode: this.lastError && this.lastError !== 'NO_SPEECH_DETECTED' ? this.lastError : undefined };
  }

  /** 兼容旧接口：只返回文本 */
  async stop(): Promise<string> {
    return (await this.stopDetailed()).text;
  }
}

let singleton: RealBrowserSpeechRecognition | null = null;
/** 全局唯一识别器，避免多个实例同时抢麦克风 */
export function getSpeechRecognizer(): RealBrowserSpeechRecognition {
  if (!singleton) singleton = new RealBrowserSpeechRecognition();
  return singleton;
}

/**
 * ASR 统一管理器：把识别结果规整为 AsrResult。
 * 空转写 → NO_SPEECH_DETECTED，绝不替用户造句；置信度只透传识别引擎给出的值。
 */
export class AsrManager {
  async processSpeechRecognition(
    recognizedText: string,
    mode: 'live' | 'demo',
    meta: { confidence?: number | null; errorCode?: AsrErrorCode } = {}
  ): Promise<AsrResult> {
    const start = performance.now();
    const clean = (recognizedText ?? '').trim();
    const provider: AsrResult['provider'] = mode === 'demo' ? 'demo_mock' : 'browser_web_speech';

    if (!clean) {
      return {
        text: '',
        confidence: null,
        latencyMs: Math.round(performance.now() - start),
        provider,
        errorCode: meta.errorCode ?? 'NO_SPEECH_DETECTED',
      };
    }
    return {
      text: clean,
      confidence: meta.confidence ?? null,
      latencyMs: Math.round(performance.now() - start),
      provider,
      errorCode: meta.errorCode,
    };
  }
}

export const asrManager = new AsrManager();
