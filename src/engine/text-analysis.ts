import * as mupdf from 'mupdf'
import type { Matrix, PageText, Point, Rect, TextRegion } from '../model/document'
import { contains, intersects, quadBounds, samePoint } from '../geometry/affine'

export type Glyph = { unicode: number; origin: Point; bounds: Rect; matrix: Matrix; font: string; safe: boolean; order: number }
export type AnalyzedRegion = TextRegion & { glyphIndices: number[] }
export type Analysis = { view: PageText; regions: AnalyzedRegion[]; glyphs: Glyph[]; pdfToPage: Matrix }
const near = (a: number, b: number) => Math.abs(a - b) < 0.02
export const basicLatin = (value: string) => /^[\x20-\x7e]*$/.test(value)
export const rgbHex = (color: number[]) => '#' + (color.length === 1 ? [color[0], color[0], color[0]] : color.slice(0, 3)).map(n => Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, '0')).join('')

// Device callbacks give the painted glyphs, independently of the structured-text
// grouping. Their wrappers are retained by MuPDF; release callback arguments we own.
export function paintedGlyphs(page: mupdf.PDFPage): { glyphs: Glyph[]; reason?: string; obstacles: { bounds: Rect; order: number; background: boolean }[] } {
  const glyphs: Glyph[] = []
  const obstacles: { bounds: Rect; order: number; background: boolean }[] = []
  let reason: string | undefined
  let order = 0
  const clips: (Rect | null)[] = []
  const unsafe = () => { reason ??= 'This page uses clipping, transparency, layers, or a complex text appearance. It is view-only.' }
  const device = new mupdf.Device({
    fillText(text, ctm, space, _color, alpha) {
      const paintOrder = order++
      try {
        text.walk({ showGlyph(font, trm, glyph, unicode, wmode, bidi) {
          const matrix = mupdf.Matrix.concat(trm, ctm)
          const single = new mupdf.Text()
          try {
            if (glyph >= 0) single.showGlyph(font, matrix, glyph, unicode, wmode)
            const bounds = glyph < 0 ? [matrix[4], matrix[5], matrix[4], matrix[5]] as Rect : single.getBounds(null as unknown as mupdf.StrokeState, mupdf.Matrix.identity)
            glyphs.push({ unicode, origin: [matrix[4], matrix[5]], bounds, matrix, font: font.getName(), safe: alpha === 1 && wmode === 0 && bidi === 0 && glyph >= 0 && unicode >= 32 && unicode <= 126 && clips.every(clip => clip && contains(clip, bounds)), order: paintOrder })
          } finally { single.destroy() }
          // Text.walk supplies a shared cached font wrapper. Do not destroy it.
        } })
      } finally { text.destroy(); space.destroy() }
    },
    strokeText(text, stroke, _ctm, space) { unsafe(); text.destroy(); stroke.destroy(); space.destroy() },
    ignoreText(text) { unsafe(); text.destroy() },
    clipText(text) { unsafe(); text.destroy() },
    clipStrokeText(text, stroke) { unsafe(); text.destroy(); stroke.destroy() },
    clipPath(path, _evenOdd, ctm) {
      try {
        const points: Point[] = []; let curved = false
        path.walk({ moveTo(x, y) { points.push([x * ctm[0] + y * ctm[2] + ctm[4], x * ctm[1] + y * ctm[3] + ctm[5]]) }, lineTo(x, y) { points.push([x * ctm[0] + y * ctm[2] + ctm[4], x * ctm[1] + y * ctm[3] + ctm[5]]) }, curveTo() { curved = true } })
        const rect = !curved && points.length === 4 && points.every((point, i) => near(point[0], points[(i + 1) % 4][0]) || near(point[1], points[(i + 1) % 4][1]))
        clips.push(rect ? path.getBounds(null as unknown as mupdf.StrokeState, ctm) : null)
      } finally { path.destroy() }
    },
    popClip() { clips.pop() },
    clipStrokePath(path, stroke) { unsafe(); clips.push(null); path.destroy(); stroke.destroy() },
    clipImageMask(image) { unsafe(); image.destroy() },
    beginMask(_area, _luminosity, space) { unsafe(); space.destroy() },
    beginGroup(_area, space) { unsafe(); space.destroy() },
    beginLayer() { unsafe() },
    beginTile() { unsafe(); return 0 },
    fillImage(image, ctm) { try { obstacles.push({ bounds: mupdf.Rect.transform([0, 0, 1, 1], ctm), order: order++, background: false }) } finally { image.destroy() } },
    fillImageMask(image, ctm, space) { unsafe(); image.destroy(); space.destroy(); obstacles.push({ bounds: mupdf.Rect.transform([0, 0, 1, 1], ctm), order: order++, background: false }) },
    fillShade(_shade) { unsafe() },
    fillPath(path, _evenOdd, ctm, space, _color, alpha) {
      try {
        const points: Point[] = []; let curved = false
        path.walk({ moveTo(x, y) { points.push([x, y]) }, lineTo(x, y) { points.push([x, y]) }, curveTo() { curved = true } })
        const bounds = path.getBounds(null as unknown as mupdf.StrokeState, ctm)
        const rectangle = !curved && points.length === 4 && points.every((point, i) => near(point[0], points[(i + 1) % 4][0]) || near(point[1], points[(i + 1) % 4][1]))
        obstacles.push({ bounds, order: order++, background: rectangle && alpha === 1 })
      } finally { path.destroy(); space.destroy() }
    },
    strokePath(path, stroke, ctm, space) { try { obstacles.push({ bounds: path.getBounds(stroke, ctm), order: order++, background: false }) } finally { path.destroy(); stroke.destroy(); space.destroy() } },
  })
  try { page.run(device, mupdf.Matrix.identity); device.close() }
  finally { device.destroy() }
  return { glyphs, reason, obstacles }
}

export function analyzePage(doc: mupdf.PDFDocument, index: number): Analysis {
  const page = doc.loadPage(index)
  try {
    const pdfToPage = page.getTransform()
    const inverse = mupdf.Matrix.invert(pdfToPage)
    const bounds = page.getBounds()
    const paint = paintedGlyphs(page)
    let pageReason = paint.reason
    if (doc.wasRepaired()) pageReason = 'This PDF needed repair when opened. Text editing is disabled to protect its contents.'
    const annotations = [...page.getAnnotations(), ...page.getWidgets()]
    const annotationBounds: Rect[] = []
    for (const link of page.getLinks()) { try { annotationBounds.push(link.getBounds()) } finally { link.destroy() } }
    for (const annotation of annotations) {
      try {
        if (annotation.getType() === 'Redact') pageReason = 'This page has pending redactions. Editing it could apply unrelated removals, so it is view-only.'
        annotationBounds.push(annotation.getBounds())
      } finally { annotation.destroy() }
    }
    const regions: AnalyzedRegion[] = []
    const glyphMap = new Map<string, number[]>()
    const key = (unicode: number, origin: Point) => `${unicode}:${origin[0].toFixed(2)}:${origin[1].toFixed(2)}`
    paint.glyphs.forEach((glyph, i) => { const k = key(glyph.unicode, glyph.origin); const values = glyphMap.get(k) ?? []; values.push(i); glyphMap.set(k, values) })
    const structured = page.toStructuredText('preserve-spans,preserve-whitespace')
    let current: AnalyzedRegion | undefined
    let previous: Point | undefined
    try {
      structured.walk({
        beginLine(rect, wmode, direction) {
          current = { id: `${index}:${regions.length}`, text: '', bounds: rect, origin: [0, 0], direction, fontName: '', fontSize: 0, color: '#000000', glyphIndices: [], unsupported: pageReason }
          previous = undefined
          if (wmode !== 0) current.unsupported = 'Vertical writing is not supported.'
        },
        onChar(char, origin, font, size, quad, color, bidi) {
          try {
            if (!current) return
            const name = font.getName()
            if (!current.text) { current.origin = origin; current.fontName = name; current.fontSize = size; current.color = rgbHex(color) }
            else if (name !== current.fontName || !near(size, current.fontSize) || rgbHex(color) !== current.color) current.unsupported ??= 'This line mixes fonts, sizes, or colors. Mixed-style lines are view-only.'
            if (bidi !== 0 || !basicLatin(char)) current.unsupported ??= 'Only left-to-right basic Latin text is supported in this release.'
            const matches = glyphMap.get(key(char.charCodeAt(0), origin)) ?? []
            if (matches.length !== 1) current.unsupported ??= 'These characters cannot be matched to unique painted glyphs. The line may overlap other text or use a special encoding.'
            else {
              const id = matches[0]; const glyph = paint.glyphs[id]
              current.glyphIndices.push(id)
              const raw = mupdf.Matrix.concat(glyph.matrix, inverse)
              if (!glyph.safe || !near(raw[1], 0) || !near(raw[2], 0) || raw[0] <= 0 || raw[3] <= 0 || !near(raw[0], raw[3])) current.unsupported ??= 'This line uses an unsupported appearance or transformation. Only simple horizontal source text can be edited.'
              // The quad must agree with the source baseline; reject skew or stretching.
              const u: Point = [quad[2] - quad[0], quad[3] - quad[1]]
              const v: Point = [quad[4] - quad[0], quad[5] - quad[1]]
              if (Math.abs(u[0] * v[0] + u[1] * v[1]) > 0.05) current.unsupported ??= 'Skewed text is not supported.'
            }
            if (previous && Math.hypot(origin[0] - previous[0], origin[1] - previous[1]) > size * 2) current.unsupported ??= 'This line contains large positioning gaps. Edit a simpler line instead.'
            if (!contains(bounds, quadBounds(quad))) current.unsupported ??= 'This line extends beyond the visible crop area.'
            current.text += char; previous = origin
          } finally { font.destroy() }
        },
        endLine() { if (current?.text.trim()) regions.push(current); current = undefined },
      })
    } finally { structured.destroy() }
    for (const region of regions) {
      if (!contains(bounds, region.bounds)) region.unsupported ??= 'This line extends beyond the visible crop area.'
      const selected = new Set(region.glyphIndices)
      if (paint.glyphs.some((glyph, i) => !selected.has(i) && intersects(region.bounds, glyph.bounds))) region.unsupported ??= 'Other text overlaps this line’s removal area. Editing it could remove neighboring content.'
      if (annotationBounds.some(rect => intersects(rect, region.bounds))) region.unsupported ??= 'A link, annotation, or form overlaps this line. It is view-only.'
      const firstOrder = region.glyphIndices.reduce((order, i) => Math.min(order, paint.glyphs[i].order), Infinity)
      for (const obstacle of paint.obstacles) if (intersects(obstacle.bounds, region.bounds)) {
        const backdrop = obstacle.background && obstacle.order < firstOrder && contains(obstacle.bounds, region.bounds, -0.1)
        if (!backdrop) region.unsupported ??= 'An image or graphic intersects this line. It is view-only to preserve overlapping content.'
      }
      if (!region.glyphIndices.length) region.unsupported ??= 'No editable glyphs were found in this line.'
    }
    return { view: { page: index, bounds, regions: regions.map(({ glyphIndices: _, ...region }) => region), message: !regions.length ? 'No editable text was found. This may be a scanned page; OCR is outside this release.' : pageReason }, regions, glyphs: paint.glyphs, pdfToPage }
  } finally { page.destroy() }
}

// Compare glyph identity and positions, rather than a global substring search:
// the same wording may legitimately occur elsewhere in the document.
export function assertGlyphs(actual: Glyph[], expected: Pick<Glyph, 'unicode' | 'origin'>[]) {
  if (actual.length !== expected.length) throw new Error('PDF verification failed: unexpected text was removed or added. No changes were applied.')
  const grouped = new Map<string, Point[]>()
  const cell = 0.04
  const key = (unicode: number, x: number, y: number) => `${unicode}:${x}:${y}`
  for (const glyph of actual) {
    const k = key(glyph.unicode, Math.floor(glyph.origin[0] / cell), Math.floor(glyph.origin[1] / cell))
    const values = grouped.get(k) ?? []; values.push(glyph.origin); grouped.set(k, values)
  }
  for (const glyph of expected) {
    const x = Math.floor(glyph.origin[0] / cell), y = Math.floor(glyph.origin[1] / cell)
    let found = false
    for (let dx = -1; dx <= 1 && !found; dx++) for (let dy = -1; dy <= 1 && !found; dy++) {
      const candidates = grouped.get(key(glyph.unicode, x + dx, y + dy)) ?? []
      const index = candidates.findIndex(origin => samePoint(origin, glyph.origin))
      if (index >= 0) { candidates[index] = candidates[candidates.length - 1]; candidates.pop(); found = true }
    }
    if (!found) throw new Error('PDF verification failed: text positions changed. No changes were applied.')
  }
}
