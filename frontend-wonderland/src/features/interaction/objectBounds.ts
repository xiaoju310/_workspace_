import type { TouchPoint, TouchRecognitionResponse } from '../../types/interaction'

export type ObjectBox = [number, number, number, number]

/** Full-image normalized [left, top, right, bottom]; never repair or invent model geometry. */
export function validatedObjectBox(value: unknown, point?: Pick<TouchPoint, 'norm_x' | 'norm_y'>): ObjectBox | undefined {
  if (!Array.isArray(value) || value.length !== 4 || value.some(v => typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1)) return undefined
  const [left, top, right, bottom] = value
  if (left >= right || top >= bottom) return undefined
  if (point && (!Number.isFinite(point.norm_x) || !Number.isFinite(point.norm_y) || point.norm_x < left || point.norm_x > right || point.norm_y < top || point.norm_y > bottom)) return undefined
  return [left, top, right, bottom]
}

export function sanitizeTouchBox(data: TouchRecognitionResponse, point: TouchPoint): void {
  data.bounding_box = data.status === 'success' && !data.is_demo_mock && data.confidence >= .6 && Boolean(data.target_name?.trim())
    ? validatedObjectBox(data.bounding_box, point) : undefined
}
