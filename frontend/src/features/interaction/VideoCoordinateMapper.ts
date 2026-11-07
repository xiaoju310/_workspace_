import type { TouchPoint, ViewportInfo } from '../../types/interaction';

/**
 * 触控坐标映射：把 DOM 点击换算成"内容(视频/图片)自身"的归一化坐标与原始像素，
 * 并拦截 `object-fit: contain` 产生的黑边(Letterbox / Pillarbox)。
 *
 * 设计约束（审查整改）：
 * 1. 纯数学核心 `mapClickToContent` 与 DOM 解耦，可被单测直接覆盖；
 * 2. 内容区(content box)需扣除 border/padding，因为 object-fit 作用在 content box 上；
 * 3. 元数据未就绪 / 容器零尺寸 → 一律拒绝(isInsideVideo=false)，不得退化成"整个容器都有效"；
 * 4. 像素坐标夹到 [0, 原始宽高-1]，不得越界；
 * 5. 默认假设 object-position 为 center(CSS 默认值)。
 */

export interface VideoViewportCalculation {
  isInsideVideo: boolean;
  touchPoint?: TouchPoint;
  /** 与 TouchRecognitionRequest.viewport_info 同构，调用方应原样透传，不要自行重算 */
  viewport?: ViewportInfo;
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

export interface ContainViewport {
  renderWidth: number;
  renderHeight: number;
  offsetX: number;
  offsetY: number;
  /** true: 上下黑边(容器偏高)；false: 左右黑边或无黑边 */
  isLetterbox: boolean;
}

/** 计算 object-fit: contain 的实际渲染矩形。要求四个参数均为正有限数。 */
export function computeContainViewport(
  containerW: number,
  containerH: number,
  origW: number,
  origH: number
): ContainViewport {
  const scale = Math.min(containerW / origW, containerH / origH);
  const renderWidth = origW * scale;
  const renderHeight = origH * scale;
  return {
    renderWidth,
    renderHeight,
    offsetX: (containerW - renderWidth) / 2,
    offsetY: (containerH - renderHeight) / 2,
    isLetterbox: (containerH - renderHeight) / 2 > 1e-6,
  };
}

export interface MapInput {
  /** 相对内容区左上角的点击坐标 */
  clickX: number;
  clickY: number;
  containerW: number;
  containerH: number;
  origW: number;
  origH: number;
}

const EPS = 1e-6;

function invalid(input: MapInput, reason: string): VideoViewportCalculation {
  return {
    isInsideVideo: false,
    reason,
    debugInfo: {
      containerWidth: Math.round(input.containerW) || 0,
      containerHeight: Math.round(input.containerH) || 0,
      renderWidth: 0,
      renderHeight: 0,
      offsetX: 0,
      offsetY: 0,
      isLetterbox: false,
      clickX: Math.round(input.clickX) || 0,
      clickY: Math.round(input.clickY) || 0,
    },
  };
}

export function mapClickToContent(input: MapInput): VideoViewportCalculation {
  const { clickX, clickY, containerW, containerH, origW, origH } = input;
  const finitePositive = (n: number) => Number.isFinite(n) && n > 0;

  if (!finitePositive(origW) || !finitePositive(origH)) {
    return invalid(input, '画面尺寸尚未就绪（视频元数据未加载），已拒绝本次点击');
  }
  if (!finitePositive(containerW) || !finitePositive(containerH)) {
    return invalid(input, '播放器容器尺寸为 0，已拒绝本次点击');
  }
  if (!Number.isFinite(clickX) || !Number.isFinite(clickY)) {
    return invalid(input, '点击坐标无效，已拒绝本次点击');
  }

  const v = computeContainViewport(containerW, containerH, origW, origH);
  const isLetterbox = v.offsetY > EPS; // 上下有留白
  const isPillarbox = v.offsetX > EPS; // 左右有留白

  const inside =
    clickX >= v.offsetX - EPS &&
    clickX <= v.offsetX + v.renderWidth + EPS &&
    clickY >= v.offsetY - EPS &&
    clickY <= v.offsetY + v.renderHeight + EPS;

  const debugInfo = {
    containerWidth: Math.round(containerW),
    containerHeight: Math.round(containerH),
    renderWidth: Math.round(v.renderWidth),
    renderHeight: Math.round(v.renderHeight),
    offsetX: Math.round(v.offsetX),
    offsetY: Math.round(v.offsetY),
    isLetterbox,
    clickX: Math.round(clickX),
    clickY: Math.round(clickY),
  };

  if (!inside) {
    const outsideVertically = clickY < v.offsetY || clickY > v.offsetY + v.renderHeight;
    return {
      isInsideVideo: false,
      debugInfo,
      reason: outsideVertically && isLetterbox
        ? '点击落在上下黑边区域 (Letterbox)，已拦截上报'
        : isPillarbox
          ? '点击落在左右黑边区域 (Pillarbox)，已拦截上报'
          : '点击落在画面之外，已拦截上报',
    };
  }

  const normX = Math.min(Math.max((clickX - v.offsetX) / v.renderWidth, 0), 1);
  const normY = Math.min(Math.max((clickY - v.offsetY) / v.renderHeight, 0), 1);
  const touchPoint: TouchPoint = {
    norm_x: Number(normX.toFixed(4)),
    norm_y: Number(normY.toFixed(4)),
    // 原始分辨率像素下标，合法范围 [0, 尺寸-1]。用 floor：像素 i 覆盖 [i, i+1)；
    // 旧的 round 会让 norm=0.0003 落到像素 1、并把最右一列的一半点击挤到同一像素
    video_pixel_x: Math.min(origW - 1, Math.floor(normX * origW)),
    video_pixel_y: Math.min(origH - 1, Math.floor(normY * origH)),
    video_width: origW,
    video_height: origH,
  };

  return {
    isInsideVideo: true,
    touchPoint,
    viewport: {
      container_width: debugInfo.containerWidth,
      container_height: debugInfo.containerHeight,
      render_width: debugInfo.renderWidth,
      render_height: debugInfo.renderHeight,
      offset_x: debugInfo.offsetX,
      offset_y: debugInfo.offsetY,
      is_letterbox: isLetterbox,
    },
    debugInfo,
  };
}

type PointerLike = { clientX: number; clientY: number };

/**
 * 读取元素 content box（扣除 border/padding），坐标系为屏幕像素。测试环境无 getComputedStyle 时回退为整个 rect。
 *
 * CSS transform（缩放播放器、页面局部放大）下：getBoundingClientRect 返回的是缩放后的尺寸，
 * 而 getComputedStyle 的 border/padding 是缩放前的 CSS 像素。旧实现直接相减，scale≠1 时内容区算错，
 * 黑边判定和归一化坐标全部偏移。这里按 rect / offset 尺寸求出缩放比，把 border/padding 换算到屏幕像素。
 * （仅支持缩放/平移；旋转、倾斜下 getBoundingClientRect 本身已不是内容矩形，属已知不支持。）
 */
export function contentBox(el: HTMLElement): { left: number; top: number; width: number; height: number } {
  const rect = el.getBoundingClientRect();
  const ow = (el as HTMLElement).offsetWidth;
  const oh = (el as HTMLElement).offsetHeight;
  const sx = ow > 0 && rect.width > 0 ? rect.width / ow : 1;
  const sy = oh > 0 && rect.height > 0 ? rect.height / oh : 1;
  let bl = 0, bt = 0, br = 0, bb = 0, pl = 0, pt = 0, pr = 0, pb = 0;
  if (typeof getComputedStyle === 'function') {
    try {
      const cs = getComputedStyle(el);
      const n = (v: string) => Number.parseFloat(v) || 0;
      bl = n(cs.borderLeftWidth); bt = n(cs.borderTopWidth); br = n(cs.borderRightWidth); bb = n(cs.borderBottomWidth);
      pl = n(cs.paddingLeft); pt = n(cs.paddingTop); pr = n(cs.paddingRight); pb = n(cs.paddingBottom);
    } catch {
      /* 保持 0 */
    }
  }
  return {
    left: rect.left + (bl + pl) * sx,
    top: rect.top + (bt + pt) * sy,
    width: rect.width - (bl + br + pl + pr) * sx,
    height: rect.height - (bt + bb + pt + pb) * sy,
  };
}

function mapElement(event: PointerLike, el: HTMLElement, origW: number, origH: number): VideoViewportCalculation {
  const box = contentBox(el);
  // 算法只对 object-fit: contain + 居中成立；样式被改成 cover/fill 时宁可拒绝，也不能悄悄算错像素
  if (typeof getComputedStyle === 'function') {
    try {
      const cs = getComputedStyle(el);
      const fit = cs.objectFit;
      const pos = (cs.objectPosition || '').replace(/\s+/g, ' ').trim();
      if (fit && fit !== 'contain') {
        return invalid({ clickX: event.clientX - box.left, clickY: event.clientY - box.top, containerW: box.width, containerH: box.height, origW, origH }, `画面缩放方式为 object-fit: ${fit}，坐标映射只支持 contain，已拒绝本次点击`);
      }
      if (pos && pos !== '50% 50%' && pos !== 'center' && pos !== 'center center') {
        return invalid({ clickX: event.clientX - box.left, clickY: event.clientY - box.top, containerW: box.width, containerH: box.height, origW, origH }, `画面对齐方式为 object-position: ${pos}，坐标映射只支持居中，已拒绝本次点击`);
      }
    } catch {
      /* 读不到样式时按 CSS 默认值（contain 由调用方内联保证）继续 */
    }
  }
  return mapClickToContent({
    clickX: event.clientX - box.left,
    clickY: event.clientY - box.top,
    containerW: box.width,
    containerH: box.height,
    origW,
    origH,
  });
}

/** 视频：使用 videoWidth/videoHeight（元数据未就绪时拒绝）。 */
export function calculateVideoTouchCoordinates(
  event: PointerLike,
  videoEl: HTMLVideoElement
): VideoViewportCalculation {
  return mapElement(event, videoEl, videoEl.videoWidth, videoEl.videoHeight);
}

/** 静态书页图片：使用 naturalWidth/naturalHeight，同样剔除 contain 黑边。 */
export function calculateImageTouchCoordinates(
  event: PointerLike,
  imgEl: HTMLImageElement
): VideoViewportCalculation {
  return mapElement(event, imgEl, imgEl.naturalWidth, imgEl.naturalHeight);
}
