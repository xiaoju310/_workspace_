import { describe, it, expect } from 'vitest';
import { calculateVideoTouchCoordinates } from '../VideoCoordinateMapper';

describe('VideoCoordinateMapper (触控坐标换算与黑边拦截算法)', () => {
  // 构造模拟的 HTMLVideoElement
  function createMockVideoElement(options: {
    videoWidth: number;
    videoHeight: number;
    containerWidth: number;
    containerHeight: number;
  }): HTMLVideoElement {
    return {
      videoWidth: options.videoWidth,
      videoHeight: options.videoHeight,
      getBoundingClientRect: () => ({
        left: 100,
        top: 100,
        width: options.containerWidth,
        height: options.containerHeight,
        right: 100 + options.containerWidth,
        bottom: 100 + options.containerHeight,
        x: 100,
        y: 100,
        toJSON: () => {},
      }),
    } as unknown as HTMLVideoElement;
  }

  it('用例 1: 视频宽高比与容器完全一致 (1280x720 视频在 640x360 容器)', () => {
    const videoEl = createMockVideoElement({
      videoWidth: 1280,
      videoHeight: 720,
      containerWidth: 640,
      containerHeight: 360,
    });

    // 模拟点击容器正中心 (clientX=100+320, clientY=100+180)
    const event = { clientX: 420, clientY: 280 } as MouseEvent;
    const res = calculateVideoTouchCoordinates(event, videoEl);

    expect(res.isInsideVideo).toBe(true);
    expect(res.touchPoint?.norm_x).toBeCloseTo(0.5, 2);
    expect(res.touchPoint?.norm_y).toBeCloseTo(0.5, 2);
    expect(res.touchPoint?.video_pixel_x).toBe(640);
    expect(res.touchPoint?.video_pixel_y).toBe(360);
  });

  it('用例 2: 容器偏高产生上下黑边 (Letterbox) - 有效区域点击与黑边拦截', () => {
    // 16:9 视频 (1920x1080) 放在 16:10 容器 (800x600)
    // 渲染宽度 800, 渲染高度 800 * (9/16) = 450
    // 上下各留黑 (600 - 450) / 2 = 75px
    const videoEl = createMockVideoElement({
      videoWidth: 1920,
      videoHeight: 1080,
      containerWidth: 800,
      containerHeight: 600,
    });

    // 2.1 模拟点击顶部黑边 (clientY 在 0 ~ 74px 之间，即 clientY=130)
    const topBlackEvent = { clientX: 500, clientY: 130 } as MouseEvent;
    const topRes = calculateVideoTouchCoordinates(topBlackEvent, videoEl);
    expect(topRes.isInsideVideo).toBe(false);
    expect(topRes.reason).toContain('Letterbox');

    // 2.2 模拟点击底部黑边 (clientY 在 526 ~ 600px 之间，即 clientY=680)
    const bottomBlackEvent = { clientX: 500, clientY: 680 } as MouseEvent;
    const bottomRes = calculateVideoTouchCoordinates(bottomBlackEvent, videoEl);
    expect(bottomRes.isInsideVideo).toBe(false);

    // 2.3 模拟点击有效画面正中 (offsetY=75, 画面中点 Y=75+225=300，即 clientY=400)
    const validEvent = { clientX: 500, clientY: 400 } as MouseEvent;
    const validRes = calculateVideoTouchCoordinates(validEvent, videoEl);
    expect(validRes.isInsideVideo).toBe(true);
    expect(validRes.touchPoint?.norm_x).toBeCloseTo(0.5, 2);
    expect(validRes.touchPoint?.norm_y).toBeCloseTo(0.5, 2);
    expect(validRes.touchPoint?.video_pixel_x).toBe(960);
    expect(validRes.touchPoint?.video_pixel_y).toBe(540);
  });

  it('用例 3: 容器偏宽产生左右黑边 (Pillarbox) - 有效区域点击与黑边拦截', () => {
    // 4:3 绘本视频 (1200x900) 放在 16:9 容器 (960x540)
    // 渲染高度 540, 渲染宽度 540 * (4/3) = 720
    // 左右各留黑 (960 - 720) / 2 = 120px
    const videoEl = createMockVideoElement({
      videoWidth: 1200,
      videoHeight: 900,
      containerWidth: 960,
      containerHeight: 540,
    });

    // 3.1 模拟点击左侧黑边 (clientX 在 0~119px 之间，即 clientX=150)
    const leftBlackEvent = { clientX: 150, clientY: 370 } as MouseEvent;
    const leftRes = calculateVideoTouchCoordinates(leftBlackEvent, videoEl);
    expect(leftRes.isInsideVideo).toBe(false);
    expect(leftRes.reason).toContain('Pillarbox');

    // 3.2 模拟点击有效画面区域
    const validEvent = { clientX: 100 + 120 + 360, clientY: 100 + 270 } as MouseEvent;
    const validRes = calculateVideoTouchCoordinates(validEvent, videoEl);
    expect(validRes.isInsideVideo).toBe(true);
    expect(validRes.touchPoint?.norm_x).toBeCloseTo(0.5, 2);
    expect(validRes.touchPoint?.norm_y).toBeCloseTo(0.5, 2);
  });
});
