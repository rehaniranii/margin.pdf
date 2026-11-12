import type { Matrix, Point, Rect } from '../model/document'

export function transformPoint([x, y]: Point, m: Matrix): Point {
  return [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]]
}
export function intersects(a: Rect, b: Rect, tolerance = 0.01) {
  return Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > tolerance && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > tolerance
}
export function contains(outer: Rect, inner: Rect, tolerance = 0.05) {
  return inner[0] >= outer[0] - tolerance && inner[1] >= outer[1] - tolerance && inner[2] <= outer[2] + tolerance && inner[3] <= outer[3] + tolerance
}
export function union(a: Rect, b: Rect): Rect { return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])] }
export function quadBounds(q: number[]): Rect {
  return [Math.min(q[0], q[2], q[4], q[6]), Math.min(q[1], q[3], q[5], q[7]), Math.max(q[0], q[2], q[4], q[6]), Math.max(q[1], q[3], q[5], q[7])]
}
export function samePoint(a: Point, b: Point, epsilon = 0.04) { return Math.abs(a[0] - b[0]) < epsilon && Math.abs(a[1] - b[1]) < epsilon }
// Boxes overlap by more than a hairline: edges grazing by under 1pt (or under 30% of the smaller box) do not count.
// Glyph boxes are generous, so neighbouring letters and lines routinely graze without any visible contact.
export function overlaps(a: Rect, b: Rect, tolerance = 1) {
  const t = Math.min(tolerance, 0.3 * Math.min(a[2] - a[0], a[3] - a[1], b[2] - b[0], b[3] - b[1]))
  return Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > t && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > t
}
// Share of `target`'s area that `cover` hides (0..1).
export function coverage(cover: Rect, target: Rect) {
  const w = Math.min(cover[2], target[2]) - Math.max(cover[0], target[0]), h = Math.min(cover[3], target[3]) - Math.max(cover[1], target[1])
  const area = (target[2] - target[0]) * (target[3] - target[1])
  return w > 0 && h > 0 && area > 0 ? (w * h) / area : 0
}
