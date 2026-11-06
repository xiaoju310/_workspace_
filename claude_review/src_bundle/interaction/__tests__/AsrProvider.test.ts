import { describe, it, expect } from 'vitest';
import { RealBrowserSpeechRecognition, asrManager } from '../asr/AsrProvider';

describe('AsrProvider 真实识别与空转写拦截测试', () => {
  it('RealBrowserSpeechRecognition 正确初始化与方法定义', () => {
    const recognizer = new RealBrowserSpeechRecognition();
    expect(typeof recognizer.isSupported).toBe('function');
    expect(typeof recognizer.start).toBe('function');
    expect(typeof recognizer.stop).toBe('function');
    expect(typeof recognizer.getCurrentTranscript).toBe('function');
  });

  it('asrManager.processSpeechRecognition 在空文本或纯空格时明确拒绝，返回 NO_SPEECH_DETECTED，绝不造句', async () => {
    const emptyResult = await asrManager.processSpeechRecognition('', 'live');
    expect(emptyResult.text).toBe('');
    expect(emptyResult.errorCode).toBe('NO_SPEECH_DETECTED');
    expect(emptyResult.confidence).toBe(0);

    const spaceResult = await asrManager.processSpeechRecognition('   ', 'live');
    expect(spaceResult.text).toBe('');
    expect(spaceResult.errorCode).toBe('NO_SPEECH_DETECTED');
  });

  it('asrManager.processSpeechRecognition 正确处理普通话识别文本', async () => {
    const validResult = await asrManager.processSpeechRecognition('这只小动物是谁？', 'live');
    expect(validResult.text).toBe('这只小动物是谁？');
    expect(validResult.confidence).toBeGreaterThan(0.9);
    expect(validResult.errorCode).toBeUndefined();
    expect(validResult.provider).toBe('browser_web_speech');
  });
});
