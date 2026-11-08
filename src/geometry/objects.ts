import type { ObjectBox, Point, Rect, RenderedPage } from '../model/document'
import { contains } from './affine'

export const boxRect = (b: ObjectBox): Rect => [b.x, b.y, b.x + b.width, b.y + b.height]
export function boxBetween(a: Point, b: Point): ObjectBox { return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(b[0] - a[0]), height: Math.abs(b[1] - a[1]) } }
export function validBox(box: ObjectBox, page: Rect) {
  return Object.values(box).every(Number.isFinite) && box.width >= 2 && box.height >= 2 && contains(page, boxRect(box), 0.001)
}
export function clampBox(box: ObjectBox, page: Rect): ObjectBox {
  const width = Math.min(box.width, page[2] - page[0]), height = Math.min(box.height, page[3] - page[1])
  return { width, height, x: Math.min(Math.max(box.x, page[0]), page[2] - width), y: Math.min(Math.max(box.y, page[1]), page[3] - height) }
}
export type Corner = 'nw' | 'ne' | 'sw' | 'se'
export function resizeBox(original: ObjectBox, corner: Corner, point: Point, page: Rect, lockAspect = false): ObjectBox {
  const left = corner.includes('w'), top = corner.includes('n')
  const anchor: Point = [left ? original.x + original.width : original.x, top ? original.y + original.height : original.y]
  const maxWidth = left ? anchor[0] - page[0] : page[2] - anchor[0]
  const maxHeight = top ? anchor[1] - page[1] : page[3] - anchor[1]
  let width = Math.min(maxWidth, Math.max(2, left ? anchor[0] - point[0] : point[0] - anchor[0]))
  let height = Math.min(maxHeight, Math.max(2, top ? anchor[1] - point[1] : point[1] - anchor[1]))
  if (lockAspect) {
    const factor = Math.min(Math.max(width / original.width, height / original.height), maxWidth / original.width, maxHeight / original.height)
    width = original.width * factor; height = original.height * factor
  }
  return { x: left ? anchor[0] - width : anchor[0], y: top ? anchor[1] - height : anchor[1], width, height }
}
export function pointerToPage(point: Point, display: { left: number; top: number; width: number; height: number }, image: RenderedPage): Point {
  return [(image.pixelOrigin[0] + (point[0] - display.left) / display.width * image.width) / image.rasterScale,
    (image.pixelOrigin[1] + (point[1] - display.top) / display.height * image.height) / image.rasterScale]
}
export function inkFromPoints(points: Point[], lineWidth: number, page: Rect) {
  const extrema = points.reduce((r, p) => [Math.min(r[0],p[0]),Math.min(r[1],p[1]),Math.max(r[2],p[0]),Math.max(r[3],p[1])] as Rect, [Infinity,Infinity,-Infinity,-Infinity] as Rect)
  const margin = lineWidth / 2 + 1
  const raw = { x: extrema[0] - margin, y: extrema[1] - margin, width: Math.max(2 * margin, extrema[2] - extrema[0] + 2 * margin), height: Math.max(2 * margin, extrema[3] - extrema[1] + 2 * margin) }
  const box = clampBox(raw, page)
  const half = lineWidth / 2
  return { box, points: points.map(([x, y]): Point => [Math.max(0, Math.min(1, (x - box.x - half) / (box.width-2*half))), Math.max(0, Math.min(1, (y - box.y - half) / (box.height-2*half)))]) }
}
