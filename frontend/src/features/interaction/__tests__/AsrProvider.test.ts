import { describe, it, expect, vi } from 'vitest';
import { RealBrowserSpeechRecognition, asrManager, mapSpeechError } from '../asr/AsrProvider';

/** 可编程的假 SpeechRecognition：真实走 RealBrowserSpeechRecognition 的事件处理 */
class FakeRec {
  static last: FakeRec;
  lang = ''; continuous = false; interimResults = false; maxAlternatives = 0;
  onresult: any; onerror: any; onend: any;
  started = false; autoEnd = true; throwOnStart = false;
  constructor() { FakeRec.last = this; }
  start() { if (this.throwOnStart) throw new Error('already started'); this.started = true; }
  stop() { if (this.autoEnd) queueMicrotask(() => this.onend?.()); }
  emit(parts: Array<{ t: string; final: boolean; c?: number }>) {
    const results = parts.map((p) => Object.assign([{ transcript: p.t, confidence: p.c ?? 0 }], { isFinal: p.final }));
    this.onresult?.({ results });
  }
}

describe('RealBrowserSpeechRecognition（走真实事件处理）', () => {
  it('配置为普通话 zh-CN，且不支持时 isSupported=false / start 返回错误码', () => {
    const none = new RealBrowserSpeechRecognition(null);
    expect(none.isSupported()).toBe(false);
    expect(none.start()).toBe('FORMAT_UNSUPPORTED');
    const r = new RealBrowserSpeechRecognition(FakeRec as any);
    expect(FakeRec.last.lang).toBe('zh-CN');
    expect(r.start()).toBe(true);
  });

  it('只返回识别到的文本与引擎给出的置信度', async () => {
    const r = new RealBrowserSpeechRecognition(FakeRec as any);
    r.start();
    FakeRec.last.emit([{ t: '小狐狸是谁', final: true, c: 0.8 }]);
    const res = await r.stopDetailed();
    expect(res).toMatchObject({ text: '小狐狸是谁', confidence: 0.8, isFinal: true });
  });

  it('含未定稿的临时结果 → isFinal=false，调用方必须让用户确认', async () => {
    const r = new RealBrowserSpeechRecognition(FakeRec as any);
    r.start();
    FakeRec.last.emit([{ t: '小狐', final: false }]);
    expect((await r.stopDetailed()).isFinal).toBe(false);
  });

  it('静音：返回空文本 + NO_SPEECH_DETECTED，不造句', async () => {
    const r = new RealBrowserSpeechRecognition(FakeRec as any);
    r.start();
    const res = await r.stopDetailed();
    expect(res.text).toBe('');
    expect(res.errorCode).toBe('NO_SPEECH_DETECTED');
  });

  it('浏览器自行结束后 stop 不会挂起（onend 复位）', async () => {
    const r = new RealBrowserSpeechRecognition(FakeRec as any);
    r.start();
    FakeRec.last.onend(); // 浏览器因静音自行结束
    expect(r.isListening()).toBe(false);
    await expect(r.stopDetailed()).resolves.toBeDefined();
  });

  it('onend 永不触发时 stop 也会超时返回', async () => {
    vi.useFakeTimers();
    const r = new RealBrowserSpeechRecognition(FakeRec as any);
    r.start();
    FakeRec.last.autoEnd = false;
    const p = r.stopDetailed();
    await vi.advanceTimersByTimeAsync(3000);
    await expect(p).resolves.toMatchObject({ text: '' });
    vi.useRealTimers();
  });

  it('start 抛异常 → 返回错误码且不处于 listening', () => {
    const r = new RealBrowserSpeechRecognition(FakeRec as any);
    FakeRec.last.throwOnStart = true;
    expect(r.start()).toBe('AUDIO_RECORD_FAILED');
    expect(r.isListening()).toBe(false);
  });

  it('浏览器错误名映射为项目错误码，并在 stop 时带出', async () => {
    expect(mapSpeechError('not-allowed')).toBe('MICROPHONE_DENIED');
    expect(mapSpeechError('network')).toBe('TRANSCRIPTION_NETWORK_ERROR');
    expect(mapSpeechError('no-speech')).toBe('NO_SPEECH_DETECTED');
    const r = new RealBrowserSpeechRecognition(FakeRec as any);
    r.start();
    FakeRec.last.onerror({ error: 'network' });
    expect((await r.stopDetailed()).errorCode).toBe('TRANSCRIPTION_NETWORK_ERROR');
  });
});

describe('asrManager', () => {
  it('空/纯空格 → NO_SPEECH_DETECTED，confidence 为 null（不写死数字）', async () => {
    for (const t of ['', '   ']) {
      const r = await asrManager.processSpeechRecognition(t, 'live');
      expect(r).toMatchObject({ text: '', confidence: null, errorCode: 'NO_SPEECH_DETECTED' });
    }
  });
  it('有文本：透传引擎置信度；没有则 null；demo 模式标 demo_mock', async () => {
    expect((await asrManager.processSpeechRecognition('你好', 'live', { confidence: 0.7 })).confidence).toBe(0.7);
    expect((await asrManager.processSpeechRecognition('你好', 'live')).confidence).toBeNull();
    expect((await asrManager.processSpeechRecognition('你好', 'demo')).provider).toBe('demo_mock');
  });
});
