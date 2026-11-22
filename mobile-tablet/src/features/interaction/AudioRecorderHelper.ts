/**
 * 录音与音频处理工具库
 * 支持：
 * 1. 跨浏览器 MediaRecorder 最佳 MIME 类型探测
 * 2. Web Audio API 实时音频音量分析 (RMS)
 * 3. 前端轻量转写为标准 16kHz 16-bit 单声道 WAV Blob (可无损送入 ASR，省去后端转码开销)
 */

export interface RecordingResult {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  sizeBytes: number;
}

/** 检测浏览器最佳支持的音频录制格式 */
export function getSupportedAudioMimeType(): string {
  const candidateTypes = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
    'audio/aac',
    'audio/wav',
  ];

  for (const type of candidateTypes) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }

  return ''; // 浏览器不支持指定类型时使用默认
}

/**
 * 将 AudioBuffer 编码为 16kHz 16-bit PCM WAV 格式
 * 保证输入 ASR 模型的音频统一、稳定、免转码
 */
export function encodeAudioBufferToWav(audioBuffer: AudioBuffer): Blob {
  const numChannels = 1; // 单声道
  const sampleRate = 16000; // ASR 最佳采样率 16kHz
  
  // 重采样至 16000Hz (如果原始采样率不同)
  const sourceRate = audioBuffer.sampleRate;
  const sourceChannel = audioBuffer.getChannelData(0); // 取第一声道
  
  let targetData: Float32Array;
  if (sourceRate === sampleRate) {
    targetData = sourceChannel;
  } else {
    // 线性插值重采样
    const ratio = sourceRate / sampleRate;
    const targetLength = Math.round(sourceChannel.length / ratio);
    targetData = new Float32Array(targetLength);
    for (let i = 0; i < targetLength; i++) {
      const srcIndex = i * ratio;
      const indexFloor = Math.floor(srcIndex);
      const indexCeil = Math.min(indexFloor + 1, sourceChannel.length - 1);
      const weight = srcIndex - indexFloor;
      targetData[i] = (1 - weight) * sourceChannel[indexFloor] + weight * sourceChannel[indexCeil];
    }
  }

  const bytesPerSample = 2; // 16-bit
  const dataByteLength = targetData.length * bytesPerSample;
  const headerByteLength = 44;
  const buffer = new ArrayBuffer(headerByteLength + dataByteLength);
  const view = new DataView(buffer);

  // 1. RIFF 标识
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataByteLength, true); // 文件总大小 - 8
  writeString(view, 8, 'WAVE');

  // 2. fmt 子块
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // fmt 块大小 16
  view.setUint16(20, 1, true); // 编码格式: 1 = PCM
  view.setUint16(22, numChannels, true); // 声道数: 1
  view.setUint32(24, sampleRate, true); // 采样率: 16000
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true); // 字节率
  view.setUint16(32, numChannels * bytesPerSample, true); // 块对齐
  view.setUint16(34, bytesPerSample * 8, true); // 位深: 16

  // 3. data 子块
  writeString(view, 36, 'data');
  view.setUint32(40, dataByteLength, true);

  // 写入 PCM 16-bit 数据
  let offset = 44;
  for (let i = 0; i < targetData.length; i++, offset += 2) {
    // 裁剪幅度 [-1.0, 1.0]
    const s = Math.max(-1, Math.min(1, targetData[i]));
    // 转换为 16 位有符号整数
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * 计算 PCM Float32Array 的实时均方根音量 (RMS, 0.0 ~ 1.0)
 */
export function calculateRMS(data: Float32Array): number {
  // 空缓冲区：旧实现 0/0 得到 NaN，会把 NaN 写进音量状态和阴影样式
  if (!data || data.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i] * data[i];
  }
  const rms = Math.sqrt(sum / data.length);
  return Math.min(Math.max(rms * 4, 0), 1); // 放大并钳位至 0~1
}
