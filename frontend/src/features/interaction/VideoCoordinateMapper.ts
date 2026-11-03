import { TouchPoint } from '../../types/interaction';

export interface VideoViewportCalculation {
  isInsideVideo: boolean;
  touchPoint?: TouchPoint;
  debugInfo: {
    containerWidth: number;
    containerHeight: number;
    renderWidth: number;
    renderHeight: number;
    offsetX: number;
    offsetY: number;
    isLetterbox: boolean;
    clickX: number;
    clickY: number;
  };
  reason?: string;
}

/**
 * 触控核心算法：将浏览器 DOM 点击事件的屏幕坐标精确换算为视频画面的归一化坐标与原始分辨率像素
 * 
 * 解决痛点：
 * 1. 播放器使用 CSS `object-fit: contain` 导致的横向黑边 (Letterbox) 或纵向黑边 (Pillarbox)。
 * 2. 避免点击在黑边时发送无效或错误请求。
 * 3. 严格计算缩放比例，保证无论是在桌面大屏还是平板触屏上，实体识别像素级对齐。
 * 
 * @param event 鼠标/触摸事件 (MouseEvent 或 PointerEvent 或 React.PointerEvent)
 * @param videoEl 对应的 HTMLVideoElement
 */
export function calculateVideoTouchCoordinates(
  event: React.PointerEvent<HTMLVideoElement> | PointerEvent | MouseEvent,
  videoEl: HTMLVideoElement
): VideoViewportCalculation {
  const rect = videoEl.getBoundingClientRect();
  const clickX = event.clientX - rect.left;
  const clickY = event.clientY - rect.top;

  // 视频原始固有尺寸
  const origW = videoEl.videoWidth;
  const origH = videoEl.videoHeight;

  // 容错处理：若视频尚未加载元数据，则使用容器自身尺寸
  if (!origW || !origH) {
    return {
      isInsideVideo: true,
      touchPoint: {
        norm_x: Math.min(Math.max(clickX / rect.width, 0), 1),
        norm_y: Math.min(Math.max(clickY / rect.height, 0), 1),
        video_pixel_x: Math.round(clickX),
        video_pixel_y: Math.round(clickY),
        video_width: Math.round(rect.width),
        video_height: Math.round(rect.height),
      },
      debugInfo: {
        containerWidth: rect.width,
        containerHeight: rect.height,
        renderWidth: rect.width,
        renderHeight: rect.height,
        offsetX: 0,
        offsetY: 0,
        isLetterbox: false,
        clickX,
        clickY,
      },
    };
  }

  const containerW = rect.width;
  const containerH = rect.height;

  const containerRatio = containerW / containerH;
  const videoRatio = origW / origH;

  let renderW = 0;
  let renderH = 0;
  let offsetX = 0;
  let offsetY = 0;
  let isLetterbox = false;

  // 比较宽高比，计算 object-fit: contain 的实际画面区域与黑边
  if (containerRatio > videoRatio) {
    // 容器偏宽：画面高度填满，左右出现垂直黑边 (Pillarbox)
    renderH = containerH;
    renderW = containerH * videoRatio;
    offsetX = (containerW - renderW) / 2;
    offsetY = 0;
    isLetterbox = false;
  } else {
    // 容器偏高：画面宽度填满，上下出现水平黑边 (Letterbox)
    renderW = containerW;
    renderH = containerW / videoRatio;
    offsetX = 0;
    offsetY = (containerH - renderH) / 2;
    isLetterbox = true;
  }

  // 判断点击是否落在黑边内
  const isInsideVideo =
    clickX >= offsetX &&
    clickX <= offsetX + renderW &&
    clickY >= offsetY &&
    clickY <= offsetY + renderH;

  const debugInfo = {
    containerWidth: Math.round(containerW),
    containerHeight: Math.round(containerH),
    renderWidth: Math.round(renderW),
    renderHeight: Math.round(renderH),
    offsetX: Math.round(offsetX),
    offsetY: Math.round(offsetY),
    isLetterbox,
    clickX: Math.round(clickX),
    clickY: Math.round(clickY),
  };

  if (!isInsideVideo) {
    return {
      isInsideVideo: false,
      debugInfo,
      reason: isLetterbox
        ? '点击落在上下黑边区域 (Letterbox)，已拦截上报'
        : '点击落在左右黑边区域 (Pillarbox)，已拦截上报',
    };
  }

  // 转换成有效视频画面内的像素与归一化比例
  const innerX = clickX - offsetX;
  const innerY = clickY - offsetY;

  const normX = Math.min(Math.max(innerX / renderW, 0), 1);
  const normY = Math.min(Math.max(innerY / renderH, 0), 1);

  const videoPixelX = Math.round(normX * origW);
  const videoPixelY = Math.round(normY * origH);

  return {
    isInsideVideo: true,
    touchPoint: {
      norm_x: Number(normX.toFixed(4)),
      norm_y: Number(normY.toFixed(4)),
      video_pixel_x: videoPixelX,
      video_pixel_y: videoPixelY,
      video_width: origW,
      video_height: origH,
    },
    debugInfo,
  };
}
