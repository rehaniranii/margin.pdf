import type { Point, Rect } from '../model/document'
import { contains, intersects, overlaps } from '../geometry/affine'
import type { AnalyzedRegion, Glyph, Graphic } from './text-analysis'

// How far an edited line may grow beyond its original box without touching anything else on the page.
// Measured along the line (`start`/`end`, distances in the reading direction) and in whole extra lines below a paragraph.
export type FreeSpace = { start: number; end: number; extraLines: number; rightAligned: boolean; area: Rect }

const dot = (p: Point, v: Point) => p[0] * v[0] + p[1] * v[1]
function spanOf(rect: Rect, v: Point): [number, number] {
  const values = [dot([rect[0], rect[1]], v), dot([rect[2], rect[1]], v), dot([rect[0], rect[3]], v), dot([rect[2], rect[3]], v)]
  return [Math.min(...values), Math.max(...values)]
}
const inked = (rect: Rect) => rect[2] > rect[0] && rect[3] > rect[1]

/**
 * Blockers are other text, graphics and other links. Content the original already touched (an underline under the
 * line, an overhanging italic) does not block. A background box the line sits in, and its clip, cap growth at their
 * edges, and so does the page's existing text margin: text never grows past the outermost text already on the page.
 */
// `blank`, on scanned pages: whether a page area is empty paper in the photo, so growth also stops at handwriting,
// stamps and lines the OCR layer does not know about.
export function freeSpace(region: AnalyzedRegion, glyphs: Glyph[], graphics: Graphic[], otherLinks: Rect[], page: Rect, blank?: (rect: Rect) => boolean): FreeSpace {
  const u = region.direction, d: Point = [-u[1], u[0]], size = region.fontSize
  const removal = region.removal ?? region.bounds, mine = new Set(region.glyphIndices)
  const [start, end] = spanOf(removal, u), [lineStart, lineEnd] = spanOf(region.bounds, u)
  const base = dot(region.origin, d), lines = region.lines ?? 1, gap = region.lineGap ?? size * 1.2
  const lastBase = base + gap * (lines - 1)
  const [top, bottom] = [base - size, lastBase + size * 0.35]

  const blockers: Rect[] = [
    ...glyphs.filter((glyph, i) => !mine.has(i) && inked(glyph.bounds) && !overlaps(removal, glyph.bounds)).map(glyph => glyph.bounds),
    ...graphics.filter(graphic => !overlaps(removal, graphic.bounds) && !(graphic.background && contains(graphic.bounds, removal))).map(graphic => graphic.bounds),
    ...otherLinks.filter(link => !intersects(link, removal)),
  ]
  // Limits: the page margins, a background the line sits in, the clip rectangles around it. The page's text margins
  // are where its outermost text is; on an open side (nothing further right, or below) the margin mirrors the
  // opposite one, so a last paragraph can still gain lines and a short line can still run on.
  const content = glyphs.filter(glyph => inked(glyph.bounds)).map(glyph => spanOf(glyph.bounds, u))
  const contentStart = Math.min(start, ...content.map(s => s[0])), contentEnd = Math.max(end, ...content.map(s => s[1]))
  const across = glyphs.filter(glyph => inked(glyph.bounds)).map(glyph => spanOf(glyph.bounds, d))
  const [pageAlongStart, pageAlongEnd] = spanOf(page, u), [pageTop, pageBottom] = spanOf(page, d)
  const contentTop = Math.min(top, ...across.map(s => s[0]))
  const marginEnd = Math.max(contentEnd, pageAlongEnd - (contentStart - pageAlongStart))
  const contentBottom = Math.max(bottom, ...across.map(s => s[1]), pageBottom - (contentTop - pageTop))
  const boxes = [page, ...graphics.filter(graphic => graphic.background && contains(graphic.bounds, removal)).map(graphic => graphic.bounds)]
  for (const i of region.glyphIndices) boxes.push(...glyphs[i].clips)
  const [pageStart, pageEnd] = boxes.map(box => spanOf(box, u)).reduce(([a, b], [c, e]) => [Math.max(a, c), Math.min(b, e)], [-Infinity, Infinity])
  const [, boxBottom] = boxes.map(box => spanOf(box, d)).reduce(([a, b], [c, e]) => [Math.max(a, c), Math.min(b, e)], [-Infinity, Infinity])

  const corner = (along: number, acr: number): Point => [along * u[0] + acr * d[0], along * u[1] + acr * d[1]]
  const areaOf = (a0: number, a1: number, c0: number, c1: number): Rect => {
    const points = [corner(a0, c0), corner(a1, c0), corner(a0, c1), corner(a1, c1)]
    return [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])), Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))]
  }

  // Along the line, within its own band (one em above the first baseline to just below the last).
  const inBand = (rect: Rect, from: number, to: number) => { const [a, b] = spanOf(rect, d); return b > from && a < to }
  const clearance = size * 0.25
  let growEnd = Math.min(pageEnd, Math.max(marginEnd, end)), growStart = Math.max(pageStart, Math.min(contentStart, start))
  for (const rect of blockers) {
    if (!inBand(rect, top, bottom)) continue
    const [a, b] = spanOf(rect, u)
    if (a >= end - 0.5) growEnd = Math.min(growEnd, a - clearance)
    else if (b <= start + 0.5) growStart = Math.max(growStart, b + clearance)
  }
  if (blank) {
    // Walk outwards in quarter-em strips; the first strip with ink in the photo ends the free space.
    const step = size * 0.25
    for (let at = end + size * 0.15; at < growEnd; at += step) if (!blank(areaOf(at, Math.min(at + step, growEnd), top, bottom))) { growEnd = Math.max(end, at - clearance); break }
    for (let at = start - size * 0.15; at > growStart; at -= step) if (!blank(areaOf(Math.max(at - step, growStart), at, top, bottom))) { growStart = Math.min(start, at + clearance); break }
  }
  // A single line that ends at the page's text margin but does not start at it (dates, page numbers) is right-aligned:
  // it grows to the left instead.
  // Ink edges along a right margin vary by letter shape ("H" vs "a"), so allow half an em.
  const rightAligned = lines === 1 && contentEnd - end < size * 0.5 && start - contentStart > size
  const startLimit = rightAligned ? Math.min(lineStart, growStart) : lineStart
  const endLimit = rightAligned ? lineEnd : Math.max(lineEnd, growEnd)

  // Below a paragraph: whole extra lines at its own spacing, while that band is empty across the paragraph's width.
  let extraLines = 0
  if (lines > 1) for (let k = 1; k <= 20; k++) {
    const kBase = lastBase + gap * k, from = kBase - size, to = kBase + size * 0.35
    if (to > Math.min(contentBottom, boxBottom) || (blank && !blank(areaOf(lineStart, lineEnd, from, to))) || blockers.some(rect => { const [a, b] = spanOf(rect, u); return inBand(rect, from, to) && b > lineStart && a < lineEnd })) break
    extraLines = k
  }

  // The area, back in page coordinates, for display and fit checks.
  const area = areaOf(startLimit, endLimit, top, bottom + gap * extraLines)
  return { start: startLimit, end: endLimit, extraLines, rightAligned, area }
}
