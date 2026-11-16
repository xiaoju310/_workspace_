import { describe, it, expect } from 'vitest';
import { calculateRMS, encodeAudioBufferToWav } from '../AudioRecorderHelper';

describe('AudioRecorderHelper 核心音频处理测试', () => {
  it('calculateRMS 能正确计算静音与音量', () => {
    // 纯静音
    const silence = new Float32Array(100).fill(0);
    expect(calculateRMS(silence)).toBe(0);

    // 常量信号
    const constantSignal = new Float32Array(100).fill(0.2);
    const rms = calculateRMS(constantSignal);
    expect(rms).toBeGreaterThan(0);
    expect(rms).toBeLessThanOrEqual(1.0);
  });

  it('encodeAudioBufferToWav 能生成符合规范的 16kHz 16-bit 单声道 WAV Blob', async () => {
    const sampleRate = 48000;
    const durationSec = 0.1; // 100ms
    const length = Math.round(sampleRate * durationSec);
    const channelData = new Float32Array(length);

    // 填充一个 440Hz 正弦波
    for (let i = 0; i < length; i++) {
      channelData[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate);
    }

    const mockAudioBuffer = {
      sampleRate,
      length,
      duration: durationSec,
      numberOfChannels: 1,
      getChannelData: (_channel: number) => channelData,
    } as unknown as AudioBuffer;

    const wavBlob = encodeAudioBufferToWav(mockAudioBuffer);
    expect(wavBlob).toBeDefined();
    expect(wavBlob.type).toBe('audio/wav');

    const arrayBuffer = await wavBlob.arrayBuffer();
    const view = new DataView(arrayBuffer);

    // 验证 RIFF 头部
    const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    expect(riff).toBe('RIFF');

    // 验证 WAVE 格式
    const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
    expect(wave).toBe('WAVE');

    // 验证 fmt 块
    const fmt = String.fromCharCode(view.getUint8(12), view.getUint8(13), view.getUint8(14), view.getUint8(15));
    expect(fmt).toBe('fmt ');

    // 单声道 (1)
    expect(view.getUint16(22, true)).toBe(1);
    // 重采样目标 16000Hz
    expect(view.getUint32(24, true)).toBe(16000);
    // 16 位深 (16-bit)
    expect(view.getUint16(34, true)).toBe(16);

    // 验证 data 块
    const dataTag = String.fromCharCode(view.getUint8(36), view.getUint8(37), view.getUint8(38), view.getUint8(39));
    expect(dataTag).toBe('data');
  });
});
