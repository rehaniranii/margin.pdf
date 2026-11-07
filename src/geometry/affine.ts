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
