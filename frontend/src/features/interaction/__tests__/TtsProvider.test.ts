import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BrowserSpeechSynthesisTts, BackendTtsProvider } from '../tts/TtsProvider';

describe('BrowserSpeechSynthesisTts（离线原生童声朗读）', () => {
  let mockSpeak: any;
  let mockCancel: any;

  beforeEach(() => {
    mockSpeak = vi.fn((utterance: any) => {
      // 模拟真实浏览器事件延迟
      setTimeout(() => {
        utterance.onstart?.();
        setTimeout(() => utterance.onend?.(), 20);
      }, 15);
    });
    mockCancel = vi.fn();

    vi.stubGlobal('speechSynthesis', {
      speak: mockSpeak,
      cancel: mockCancel,
    });
    vi.stubGlobal('SpeechSynthesisUtterance', class {
      text: string;
      lang = '';
      rate = 1;
      pitch = 1;
      volume = 1;
      onstart: any;
      onend: any;
      onerror: any;
      constructor(text: string) {
        this.text = text;
      }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('检查 isAvailable 返回可用性', async () => {
    const tts = new BrowserSpeechSynthesisTts();
    expect(await tts.isAvailable()).toBe(true);
  });

  it('speak 配置 zh-CN 语言、儿童适度语速与音调，并实测正整数延迟', async () => {
    const tts = new BrowserSpeechSynthesisTts();
    let firstByteRecorded = -1;
    let started = false;
    let ended = false;

    const res = await tts.speak('小狐狸戴着红围巾', {
      rate: 0.95,
      pitch: 1.2,
      onStart: () => { started = true; },
      onEnd: () => { ended = true; },
      onFirstAudioByte: (ms) => { firstByteRecorded = ms; },
    });

    expect(mockCancel).toHaveBeenCalled();
    expect(mockSpeak).toHaveBeenCalled();
    const utterance = mockSpeak.mock.calls[0][0];
    expect(utterance.text).toBe('小狐狸戴着红围巾');
    expect(utterance.lang).toBe('zh-CN');
    expect(utterance.rate).toBe(0.95);
    expect(utterance.pitch).toBe(1.2);

    expect(started).toBe(true);
    expect(res.firstAudioMs).toBeGreaterThanOrEqual(0);
    expect(firstByteRecorded).toBeGreaterThanOrEqual(0);

    // 等待朗读结束
    await new Promise((r) => setTimeout(r, 30));
    expect(ended).toBe(true);
  });

  it('stop 能够取消正在播放的朗读', () => {
    const tts = new BrowserSpeechSynthesisTts();
    tts.stop();
    expect(mockCancel).toHaveBeenCalled();
  });

  it('onerror 时平稳处理并 resolve 耗时，不抛出未捕获异常', async () => {
    mockSpeak = vi.fn((utterance: any) => {
      setTimeout(() => utterance.onerror?.(new Error('audio hardware error')), 10);
    });
    vi.stubGlobal('speechSynthesis', { speak: mockSpeak, cancel: mockCancel });

    const tts = new BrowserSpeechSynthesisTts();
    let errCaught: any = null;
    const res = await tts.speak('测试失败', {
      onError: (err) => { errCaught = err; },
    });

    expect(errCaught).toBeDefined();
    // 出错且未发出声音时首音延迟应为 null，不虚构数字
    expect(res.firstAudioMs).toBeNull();
  });

  it('环境不支持 SpeechSynthesis 时，不返回 0ms 伪造首音延迟，而是返回 null', async () => {
    vi.stubGlobal('speechSynthesis', null);
    vi.stubGlobal('SpeechSynthesisUtterance', null);
    const tts = new BrowserSpeechSynthesisTts();
    const res = await tts.speak('不支持测试');
    expect(res.firstAudioMs).toBeNull();
  });
});

describe('BackendTtsProvider（已知契约空白守护）', () => {
  it('后端 A 尚未提供 TTS 服务，isAvailable 返回 false，speak 明确抛错不假造降级', async () => {
    const backendTts = new BackendTtsProvider();
    expect(await backendTts.isAvailable()).toBe(false);
    await expect(backendTts.speak('测试')).rejects.toThrow('后端 A 尚未提供 TTS 接口');
  });
});
