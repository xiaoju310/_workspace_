import { describe, it, expect } from 'vitest';
import {
  calculateVideoTouchCoordinates,
  calculateImageTouchCoordinates,
  mapClickToContent,
  computeContainViewport,
} from '../VideoCoordinateMapper';

function el(opts: { w: number; h: number; cw: number; ch: number; nat?: 'video' | 'image' }) {
  const rect = { left: 100, top: 100, width: opts.cw, height: opts.ch, right: 100 + opts.cw, bottom: 100 + opts.ch, x: 100, y: 100, toJSON: () => {} };
  return { videoWidth: opts.w, videoHeight: opts.h, naturalWidth: opts.w, naturalHeight: opts.h, getBoundingClientRect: () => rect } as any;
}

describe('VideoCoordinateMapper', () => {
  it('宽高比一致：中心点 → 0.5/0.5，像素为原始分辨率', () => {
    const r = calculateVideoTouchCoordinates({ clientX: 420, clientY: 280 }, el({ w: 1280, h: 720, cw: 640, ch: 360 }));
    expect(r.isInsideVideo).toBe(true);
    expect(r.touchPoint).toMatchObject({ norm_x: 0.5, norm_y: 0.5, video_pixel_x: 640, video_pixel_y: 360, video_width: 1280, video_height: 720 });
    expect(r.viewport).toMatchObject({ offset_x: 0, offset_y: 0, is_letterbox: false });
  });

  it('Letterbox(800x600 容器/16:9)：上下 75px 黑边被拦截，画面中心 → 960/540', () => {
    const v = el({ w: 1920, h: 1080, cw: 800, ch: 600 });
    const top = calculateVideoTouchCoordinates({ clientX: 500, clientY: 130 }, v);
    expect(top.isInsideVideo).toBe(false);
    expect(top.reason).toContain('Letterbox');
    expect(calculateVideoTouchCoordinates({ clientX: 500, clientY: 680 }, v).isInsideVideo).toBe(false);
    const mid = calculateVideoTouchCoordinates({ clientX: 500, clientY: 400 }, v);
    expect(mid.touchPoint).toMatchObject({ video_pixel_x: 960, video_pixel_y: 540 });
    expect(mid.viewport).toMatchObject({ offset_y: 75, render_height: 450, is_letterbox: true });
  });

  it('Pillarbox(960x540 容器/4:3)：左右 120px 黑边被拦截', () => {
    const v = el({ w: 1200, h: 900, cw: 960, ch: 540 });
    const left = calculateVideoTouchCoordinates({ clientX: 150, clientY: 370 }, v);
    expect(left.isInsideVideo).toBe(false);
    expect(left.reason).toContain('Pillarbox');
    const ok = calculateVideoTouchCoordinates({ clientX: 100 + 120 + 360, clientY: 100 + 270 }, v);
    expect(ok.touchPoint).toMatchObject({ norm_x: 0.5, norm_y: 0.5 });
  });

  it('恰好落在画面边缘：算内部，像素夹在 [0, 尺寸-1]', () => {
    const r = mapClickToContent({ clickX: 800, clickY: 75 + 450, containerW: 800, containerH: 600, origW: 1920, origH: 1080 });
    expect(r.isInsideVideo).toBe(true);
    expect(r.touchPoint!.video_pixel_x).toBe(1919);
    expect(r.touchPoint!.video_pixel_y).toBe(1079);
    const justOutside = mapClickToContent({ clickX: 400, clickY: 74, containerW: 800, containerH: 600, origW: 1920, origH: 1080 });
    expect(justOutside.isInsideVideo).toBe(false);
  });

  it('视频元数据未就绪(videoWidth=0)：拒绝，不得退化成整个容器有效', () => {
    const r = calculateVideoTouchCoordinates({ clientX: 300, clientY: 300 }, el({ w: 0, h: 0, cw: 640, ch: 360 }));
    expect(r.isInsideVideo).toBe(false);
    expect(r.reason).toContain('尚未就绪');
  });

  it('容器零尺寸 / NaN 坐标：拒绝且不产生 NaN', () => {
    expect(mapClickToContent({ clickX: 1, clickY: 1, containerW: 0, containerH: 0, origW: 100, origH: 100 }).isInsideVideo).toBe(false);
    expect(mapClickToContent({ clickX: NaN, clickY: 1, containerW: 100, containerH: 100, origW: 100, origH: 100 }).isInsideVideo).toBe(false);
  });

  it('静态书页图片使用 naturalWidth/Height，同样剔除黑边', () => {
    const img = el({ w: 600, h: 800, cw: 800, ch: 600 }); // 3:4 图在 4:3 容器 → 左右黑边
    const vp = computeContainViewport(800, 600, 600, 800);
    expect(vp.renderWidth).toBeCloseTo(450);
    expect(calculateImageTouchCoordinates({ clientX: 100 + 10, clientY: 300 }, img).isInsideVideo).toBe(false);
    expect(calculateImageTouchCoordinates({ clientX: 100 + 400, clientY: 100 + 300 }, img).touchPoint).toMatchObject({ norm_x: 0.5, norm_y: 0.5 });
  });
});
