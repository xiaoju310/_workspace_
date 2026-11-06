import React, { useState, useRef, useEffect } from 'react';
import { TouchPoint, TouchRecognitionRequest, TouchRecognitionResponse } from '../../types/interaction';
import { calculateVideoTouchCoordinates, computeContainViewport } from './VideoCoordinateMapper';

interface TouchOverlayProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  bookId: string;
  runId: string;
  onTouchRecognize: (req: TouchRecognitionRequest) => void;
  activeResult?: TouchRecognitionResponse | null;
  disabled?: boolean;
}

interface ClickFeedback {
  x: number; // 容器内 clientX
  y: number; // 容器内 clientY
  timestamp: number;
}

export const TouchOverlay: React.FC<TouchOverlayProps> = ({
  videoRef,
  bookId,
  runId,
  onTouchRecognize,
  activeResult,
  disabled = false,
}) => {
  const [clickPoint, setClickPoint] = useState<ClickFeedback | null>(null);
  const [warningTip, setWarningTip] = useState<string | null>(null);
  const tipTimeoutRef = useRef<any>(null);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || !videoRef.current) return;
    const videoEl = videoRef.current;

    // 获取点击坐标并计算黑边
    const result = calculateVideoTouchCoordinates(e as any, videoEl);

    const rect = videoEl.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;

    if (!result.isInsideVideo || !result.touchPoint || !result.viewport) {
      if (tipTimeoutRef.current) clearTimeout(tipTimeoutRef.current);
      setWarningTip(result.reason || '点击在画面留黑区域，已忽略');
      tipTimeoutRef.current = setTimeout(() => setWarningTip(null), 2000);
      return;
    }

    setWarningTip(null);
    setClickPoint({ x: localX, y: localY, timestamp: Date.now() });

    const currentVideoMs = Math.round(videoEl.currentTime * 1000);
    const touchPoint: TouchPoint = result.touchPoint!;

    const req: TouchRecognitionRequest = {
      book_id: bookId,
      run_id: runId,
      video_ms: currentVideoMs,
      touch_point: touchPoint,
      viewport_info: result.viewport,
    };

    onTouchRecognize(req);
  };

  useEffect(() => {
    return () => {
      if (tipTimeoutRef.current) clearTimeout(tipTimeoutRef.current);
    };
  }, []);

  return (
    <div
      onPointerDown={handlePointerDown}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        cursor: disabled ? 'default' : 'crosshair',
        pointerEvents: disabled ? 'none' : 'auto',
        userSelect: 'none',
        zIndex: 10,
      }}
    >
      {/* 点击波纹动画 */}
      {clickPoint && (
        <div
          style={{
            position: 'absolute',
            left: clickPoint.x,
            top: clickPoint.y,
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              width: '24px',
              height: '24px',
              borderRadius: '50%',
              border: '2px solid #3b82f6',
              backgroundColor: 'rgba(59, 130, 246, 0.3)',
              boxShadow: '0 0 10px rgba(59, 130, 246, 0.8)',
              animation: 'ping 1s cubic-bezier(0, 0, 0.2, 1) infinite',
            }}
          />
        </div>
      )}

      {/* 识别成功物体框 (Bounding Box) */}
      {activeResult && activeResult.bounding_box && videoRef.current && (
        <BoundingBoxRenderer
          box={activeResult.bounding_box}
          videoEl={videoRef.current}
          label={activeResult.target_name}
        />
      )}

      {/* 黑边阻断提示条 */}
      {warningTip && (
        <div
          style={{
            position: 'absolute',
            bottom: '16px',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'rgba(15, 23, 42, 0.85)',
            color: '#f87171',
            padding: '6px 14px',
            borderRadius: '20px',
            fontSize: '13px',
            backdropFilter: 'blur(4px)',
            pointerEvents: 'none',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          }}
        >
          ⚠️ {warningTip}
        </div>
      )}
    </div>
  );
};

/** 渲染归一化 Bounding Box 到容器坐标 */
const BoundingBoxRenderer: React.FC<{
  box: [number, number, number, number];
  videoEl: HTMLVideoElement;
  label: string;
}> = ({ box, videoEl, label }) => {
  const [xMin, yMin, xMax, yMax] = box;
  const rect = videoEl.getBoundingClientRect();
  const origW = videoEl.videoWidth || rect.width;
  const origH = videoEl.videoHeight || rect.height;

  const vp = computeContainViewport(rect.width, rect.height, origW, origH);
  const { renderWidth: renderW, renderHeight: renderH, offsetX, offsetY } = vp;

  const left = offsetX + xMin * renderW;
  const top = offsetY + yMin * renderH;
  const width = (xMax - xMin) * renderW;
  const height = (yMax - yMin) * renderH;

  return (
    <div
      style={{
        position: 'absolute',
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
        border: '2px solid #10b981',
        backgroundColor: 'rgba(16, 185, 129, 0.15)',
        borderRadius: '4px',
        pointerEvents: 'none',
        boxShadow: '0 0 12px rgba(16, 185, 129, 0.5)',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: '-24px',
          left: 0,
          backgroundColor: '#10b981',
          color: '#fff',
          fontSize: '12px',
          fontWeight: 'bold',
          padding: '2px 6px',
          borderRadius: '3px',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
    </div>
  );
};
