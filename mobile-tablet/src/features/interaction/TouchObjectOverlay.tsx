import type { Interaction } from '../../app/types'
import type { TouchPoint } from '../../types/interaction'
import { validatedObjectBox } from './objectBounds'

/** The SVG shares the media's contain viewport, including letterboxing and responsive resizing. */
export function TouchObjectOverlay({ item, point, active }: { item: Interaction | null; point?: TouchPoint; active: boolean }) {
  if (!active || !point || !item || item.kind !== 'touch' || item.origin !== 'real' || item.uncertain || !item.recognized || !item.target_name?.trim()) return null
  const box = validatedObjectBox(item.bounding_box, point)
  const width = point.video_width, height = point.video_height
  if (!box || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  const [left, top, right, bottom] = box
  const fontSize = Math.max(width, height) / 45
  return <svg className="touch-object-overlay" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`识别物体边界：${item.target_name}`}>
    <title>{item.target_name}（模型定位，尚需实际核验）</title>
    <rect x={left * width} y={top * height} width={(right - left) * width} height={(bottom - top) * height}
      fill="rgba(56,189,248,.12)" stroke="#38bdf8" strokeWidth="3" vectorEffect="non-scaling-stroke" />
    <text x={left * width + fontSize / 4} y={Math.min(height - fontSize / 4, top * height + fontSize * 1.2)} fontSize={fontSize}
      fill="white" stroke="#17393d" strokeWidth={fontSize / 6} paintOrder="stroke" fontWeight="bold">{item.target_name}</text>
  </svg>
}
