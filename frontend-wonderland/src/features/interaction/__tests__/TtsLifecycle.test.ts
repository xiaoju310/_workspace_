import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserSpeechSynthesisTts } from '../tts/TtsProvider';

describe('朗读取消与异常事件回归', () => {
  let synth: { speak: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    vi.useFakeTimers();
    synth = { speak: vi.fn(), cancel: vi.fn() };
    vi.stubGlobal('speechSynthesis', synth);
    vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
  });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('浏览器同步抛错只报告一次并清除启动超时', async () => {
    const error = new Error('device unavailable');
    synth.speak.mockImplementation(() => { throw error; });
    const onError = vi.fn();
    await expect(new BrowserSpeechSynthesisTts().speak('hello', { onError })).resolves.toEqual({ firstAudioMs: null });
    expect(onError).toHaveBeenCalledExactlyOnceWith(error);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(6000);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('停止时浏览器不回调也结束等待，迟到事件不再回报', async () => {
    const tts = new BrowserSpeechSynthesisTts();
    const onStart = vi.fn(), onEnd = vi.fn(), onError = vi.fn();
    const result = tts.speak('hello', { onStart, onEnd, onError });
    const utterance = synth.speak.mock.calls[0][0];
    tts.stop();
    expect(vi.getTimerCount()).toBe(0);
    await expect(result).resolves.toEqual({ firstAudioMs: null });
    utterance.onstart?.(); utterance.onerror?.({ error: 'audio-busy' }); utterance.onend?.();
    expect(onStart).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('下一条替换上一条后旧计时器不能取消新朗读', async () => {
    const tts = new BrowserSpeechSynthesisTts();
    const onError = vi.fn();
    const first = tts.speak('first', { startTimeoutMs: 100, onError });
    const second = tts.speak('second', { startTimeoutMs: 1000 });
    const utterance = synth.speak.mock.calls[1][0];
    utterance.onstart();
    const cancels = synth.cancel.mock.calls.length;
    await vi.advanceTimersByTimeAsync(200);
    expect(synth.cancel).toHaveBeenCalledTimes(cancels);
    expect(onError).not.toHaveBeenCalled();
    await expect(first).resolves.toEqual({ firstAudioMs: null });
    expect((await second).firstAudioMs).not.toBeNull();
    tts.stop();
  });

  it('结束事件早于开始事件不伪造首音，且不再超时失败', async () => {
    const onStart = vi.fn(), onEnd = vi.fn(), onError = vi.fn();
    const result = new BrowserSpeechSynthesisTts().speak('hello', { onStart, onEnd, onError });
    const utterance = synth.speak.mock.calls[0][0];
    utterance.onend();
    expect(vi.getTimerCount()).toBe(0);
    await expect(result).resolves.toEqual({ firstAudioMs: null });
    utterance.onstart(); utterance.onend();
    expect(onStart).not.toHaveBeenCalled(); expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('启动失败后迟到的结束和错误不能重复通知', async () => {
    const onEnd = vi.fn(), onError = vi.fn();
    const result = new BrowserSpeechSynthesisTts().speak('hello', { onEnd, onError });
    const utterance = synth.speak.mock.calls[0][0];
    utterance.onerror({ error: 'audio-busy' });
    utterance.onerror({ error: 'audio-busy' }); utterance.onend();
    expect(onError).toHaveBeenCalledTimes(1); expect(onEnd).not.toHaveBeenCalled();
    await expect(result).resolves.toEqual({ firstAudioMs: null });
  });

  it('浏览器完全静默时仍超时失败，取消触发的同步事件不重复报告', async () => {
    const onStart = vi.fn(), onEnd = vi.fn(), onError = vi.fn();
    const result = new BrowserSpeechSynthesisTts().speak('hello', { startTimeoutMs: 100, onStart, onEnd, onError });
    const utterance = synth.speak.mock.calls[0][0];
    synth.cancel.mockImplementation(() => utterance.onerror?.({ error: 'canceled' }));
    await vi.advanceTimersByTimeAsync(100);
    await expect(result).resolves.toEqual({ firstAudioMs: null });
    utterance.onstart?.();
    expect(onError).toHaveBeenCalledTimes(1); expect(onStart).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
});
