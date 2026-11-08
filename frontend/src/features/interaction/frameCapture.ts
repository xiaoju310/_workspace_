/**
 * D8「点击时截取当前画面」：把点击瞬间的视频帧/书页图按原始分辨率（长边上限 maxSide）画到 canvas，
 * 输出 JPEG Blob。用途：
 *  - 配置了视觉模型服务时，作为识别输入一起发送（frame_image_base64）；
 *  - 留痕里只写截图指纹与尺寸（A 没有截图上传接口，storage 如实写 browser_only），E 可据此核对。
 *
 * 失败（元素未就绪、跨域污染 canvas、浏览器不支持）一律返回 null 并给出原因，不能阻断触控本身。
 */

export interface FrameSnapshot {
  blob: Blob;
  width: number;
  height: number;
  mimeType: 'image/jpeg';
  /** 视频：drawImage 那一刻的 currentTime（毫秒，取整）。与点击时记录的 video_ms 一起留痕，便于核对是同一帧 */
  frameTimeMs: number | null;
}

export type CaptureResult = { ok: true; snapshot: FrameSnapshot } | { ok: false; reason: string };

/** 纯函数：按长边上限等比缩放，至少 1px */
export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
  if (!(width > 0 && height > 0)) return { width: 0, height: 0 };
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export async function captureFrame(element: HTMLVideoElement | HTMLImageElement, maxSide = 640): Promise<CaptureResult> {
  const isVideo = typeof HTMLVideoElement !== 'undefined' && element instanceof HTMLVideoElement;
  const srcW = isVideo ? (element as HTMLVideoElement).videoWidth : (element as HTMLImageElement).naturalWidth;
  const srcH = isVideo ? (element as HTMLVideoElement).videoHeight : (element as HTMLImageElement).naturalHeight;
  if (isVideo && (element as HTMLVideoElement).readyState < 2) return { ok: false, reason: '视频当前帧尚未解码' };
  const size = fitWithin(srcW, srcH, maxSide);
  // 绘制是同步的：与调用方读取 currentTime 处在同一个任务里，画面不会在两者之间换帧；之后只有 JPEG 编码是异步的
  const frameTimeMs = isVideo ? Math.round((element as HTMLVideoElement).currentTime * 1000) : null;
  if (!size.width) return { ok: false, reason: '画面尺寸未知' };
  try {
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { ok: false, reason: '浏览器不支持 canvas 2D' };
    ctx.drawImage(element, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob) return { ok: false, reason: '截图编码失败' };
    return { ok: true, snapshot: { blob, width: size.width, height: size.height, mimeType: 'image/jpeg', frameTimeMs } };
  } catch (e: any) {
    // 典型原因：跨域资源污染 canvas（SecurityError）
    return { ok: false, reason: `截图失败：${e?.name ?? ''} ${e?.message ?? e}`.trim() };
  }
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
