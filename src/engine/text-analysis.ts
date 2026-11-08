import * as mupdf from 'mupdf'
import type { Matrix, PageText, Point, Rect, TextRegion } from '../model/document'
import { contains, intersects, quadBounds, samePoint, union } from '../geometry/affine'

export type Glyph = { unicode: number; origin: Point; bounds: Rect; matrix: Matrix; font: string; safe: boolean; order: number; clips: Rect[] }
export type Graphic = { bounds: Rect; order: number; background: boolean; reason?: string }
// `removal` is the ink of the region's own glyphs: what redaction removes and what must not touch other content.
export type AnalyzedRegion = TextRegion & { glyphIndices: number[]; removal?: Rect }
export type Analysis = { view: PageText; regions: AnalyzedRegion[]; glyphs: Glyph[]; pdfToPage: Matrix; graphics: Graphic[] }
const near = (a: number, b: number) => Math.abs(a - b) < 0.02
export const basicLatin = (value: string) => /^[\x20-\x7e]*$/.test(value)
// Typographic ligatures (ff, fi, fl, ffi, ffl, long-s t, st) are one painted glyph; edit them as their letters.
const ligatures: Record<number, string> = { 0xfb00: 'ff', 0xfb01: 'fi', 0xfb02: 'fl', 0xfb03: 'ffi', 0xfb04: 'ffl', 0xfb05: 'st', 0xfb06: 'st' }
const editableCode = (unicode: number) => unicode >= 32 && unicode <= 126 || unicode in ligatures
export const rgbHex = (color: number[]) => '#' + (color.length === 1 ? [color[0], color[0], color[0]] : color.slice(0, 3)).map(n => Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, '0')).join('')
// Anything painted before the text is behind it. Removal leaves images and line art
// untouched and the replacement is drawn on top, so it stays behind the new text too.
export const safeBackdrop = (graphic: Graphic, _bounds: Rect, textOrder: number) => graphic.order < textOrder

// mupdf.js passes images and shades to device callbacks without taking a reference, yet
// registers them for release on garbage collection. Detach them instead of destroying, or
// the page's own object is freed (and dropping a shade crashes with a signature mismatch).
function borrowed(object: mupdf.Image | mupdf.Shade) {
  const owner = object.constructor as unknown as { _finalizer?: FinalizationRegistry<number> }
  owner._finalizer?.unregister(object)
  ;(object as unknown as { pointer: number }).pointer = 0
}

// Device callbacks give the painted glyphs, independently of the structured-text
// grouping. Their wrappers are retained by MuPDF; release callback arguments we own.
// Effects are judged per glyph, not per page: real-world exporters wrap almost
// everything in no-op transparency groups and clips, which must not lock the page.
export function paintedGlyphs(page: mupdf.PDFPage): { glyphs: Glyph[]; reason?: string; obstacles: Graphic[] } {
  const glyphs: Glyph[] = []
  const obstacles: Graphic[] = []
  let order = 0
  // null = a clip/mask we cannot model as a rectangle; text under it is view-only.
  const clips: (Rect | null)[] = []
  // true = a group that changes how its contents look (opacity, blend mode, knockout).
  const groups: boolean[] = []
  let tiles = 0
  const visibleArea = (bounds: Rect): Rect => clips.reduce<Rect>((area, clip) => clip ? [Math.max(area[0], clip[0]), Math.max(area[1], clip[1]), Math.min(area[2], clip[2]), Math.min(area[3], clip[3])] : area, bounds)
  const obstacle = (bounds: Rect, reason?: string) => { const area = visibleArea(bounds); if (area[2] > area[0] && area[3] > area[1]) obstacles.push({ bounds: area, order: order++, background: false, reason }) }
  const rectangle = (path: mupdf.Path, ctm: Matrix | null) => {
    const points: Point[] = []; let curved = false
    const at = (x: number, y: number): Point => ctm ? [x * ctm[0] + y * ctm[2] + ctm[4], x * ctm[1] + y * ctm[3] + ctm[5]] : [x, y]
    path.walk({ moveTo(x, y) { points.push(at(x, y)) }, lineTo(x, y) { points.push(at(x, y)) }, curveTo() { curved = true } })
    // Some exporters close a rectangle by repeating its first corner.
    if (points.length === 5 && samePoint(points[0], points[4])) points.pop()
    return !curved && points.length === 4 && points.every((point, i) => near(point[0], points[(i + 1) % 4][0]) || near(point[1], points[(i + 1) % 4][1]))
  }
  const device = new mupdf.Device({
    fillText(text, ctm, space, _color, alpha) {
      const paintOrder = order++
      const activeClips = clips.filter((clip): clip is Rect => clip !== null)
      const plain = alpha === 1 && !tiles && !groups.some(Boolean)
      try {
        text.walk({ showGlyph(font, trm, glyph, unicode, wmode, bidi) {
          const matrix = mupdf.Matrix.concat(trm, ctm)
          const single = new mupdf.Text()
          try {
            if (glyph >= 0) single.showGlyph(font, matrix, glyph, unicode, wmode)
            const bounds = glyph < 0 ? [matrix[4], matrix[5], matrix[4], matrix[5]] as Rect : single.getBounds(null as unknown as mupdf.StrokeState, mupdf.Matrix.identity)
            glyphs.push({ unicode, origin: [matrix[4], matrix[5]], bounds, matrix, font: font.getName(), safe: plain && wmode === 0 && bidi === 0 && glyph >= 0 && editableCode(unicode) && clips.every(clip => clip && contains(clip, bounds)), order: paintOrder, clips: activeClips })
          } finally { single.destroy() }
          // Text.walk supplies a shared cached font wrapper. Do not destroy it.
        } })
      } finally { text.destroy(); space.destroy() }
    },
    // Outlined or invisible text is not editable itself; it only blocks lines it overlaps.
    strokeText(text, stroke, ctm, space) { try { obstacle(text.getBounds(stroke, ctm), 'Outlined text overlaps this line. It is view-only.') } finally { text.destroy(); stroke.destroy(); space.destroy() } },
    ignoreText(text, ctm) { try { obstacle(text.getBounds(null as unknown as mupdf.StrokeState, ctm), 'Invisible text (such as an OCR layer) overlaps this line. It is view-only.') } finally { text.destroy() } },
    clipText(text) { clips.push(null); text.destroy() },
    clipStrokeText(text, stroke) { clips.push(null); text.destroy(); stroke.destroy() },
    clipPath(path, _evenOdd, ctm) {
      try { clips.push(rectangle(path, ctm) ? path.getBounds(null as unknown as mupdf.StrokeState, ctm) : null) }
      finally { path.destroy() }
    },
    clipStrokePath(path, stroke) { clips.push(null); path.destroy(); stroke.destroy() },
    clipImageMask(image) { clips.push(null); borrowed(image) },
    popClip() { clips.pop() },
    // A soft mask is popped with popClip; everything drawn under it may be partly hidden.
    beginMask(_area, _luminosity, space) { clips.push(null); space.destroy() },
    beginGroup(_area, space, _isolated, knockout, blendmode, alpha) { groups.push(alpha < 1 || blendmode !== 'Normal' || knockout); space?.destroy() },
    endGroup() { groups.pop() },
    beginTile() { tiles++; return 0 },
    endTile() { tiles-- },
    // Optional-content layers are allowed; the replacement is drawn outside the layer.
    fillImage(image, ctm) { try { obstacle(mupdf.Rect.transform([0, 0, 1, 1], ctm)) } finally { borrowed(image) } },
    fillImageMask(image, ctm, space) { try { obstacle(mupdf.Rect.transform([0, 0, 1, 1], ctm)) } finally { borrowed(image); space.destroy() } },
    fillShade(shade, ctm) { try { obstacle(mupdf.Rect.transform(shade.getBounds(), ctm)) } finally { borrowed(shade) } },
    fillPath(path, _evenOdd, ctm, space, _color, alpha) {
      try { const bounds = visibleArea(path.getBounds(null as unknown as mupdf.StrokeState, ctm)); obstacles.push({ bounds, order: order++, background: rectangle(path, null) && alpha === 1 }) }
      finally { path.destroy(); space.destroy() }
    },
    strokePath(path, stroke, ctm, space) { try { obstacle(path.getBounds(stroke, ctm)) } finally { path.destroy(); stroke.destroy(); space.destroy() } },
  })
  try { page.run(device, mupdf.Matrix.identity); device.close() }
  finally { device.destroy() }
  return { glyphs, obstacles }
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
    const structured = page.toStructuredText('preserve-spans,preserve-whitespace,preserve-ligatures')
    let current: AnalyzedRegion | undefined
    let previous: Point | undefined
    // A line is finished one step late: extraction splits a line wherever a ligature
    // glyph maps to several letters, and the next line may be the rest of it.
    let finished: AnalyzedRegion | undefined
    let ligatureTail = ''
    let joinNext = false
    let fresh = false
    const flush = () => { if (finished?.text.trim()) { finished.text = finished.text.trimEnd(); regions.push(finished) } finished = undefined }
    const grow = (region: AnalyzedRegion, rect: Rect) => { region.bounds = region.text ? union(region.bounds, rect) : rect }
    try {
      structured.walk({
        beginLine(_rect, wmode, direction) {
          current = { id: '', text: '', bounds: [0, 0, 0, 0], origin: [0, 0], direction, fontName: '', fontSize: 0, color: '#000000', glyphIndices: [], unsupported: pageReason }
          fresh = true
          if (wmode !== 0) current.unsupported = 'Vertical writing is not supported.'
        },
        onChar(char, origin, font, size, quad, color, bidi) {
          try {
            if (!current) return
            const code = char.charCodeAt(0)
            let matches = glyphMap.get(key(code, origin)) ?? []
            let ligature = ''
            if (!matches.length) for (const [lig, letters] of Object.entries(ligatures)) if (letters.startsWith(char)) {
              const found = glyphMap.get(key(Number(lig), origin)) ?? []
              if (found.length) { matches = found; ligature = letters; break }
            }
            if (fresh) {
              fresh = false
              // Continue the previous line when this one starts inside or right after one of its ligatures.
              const sameBaseline = finished && Math.abs((origin[0] - finished.origin[0]) * finished.direction[1] - (origin[1] - finished.origin[1]) * finished.direction[0]) < 0.5
              if (finished && sameBaseline && (ligatureTail || joinNext || ligature)) { current = finished; finished = undefined }
              else { flush(); previous = undefined; ligatureTail = ''; joinNext = false }
            }
            if (ligatureTail && char === ligatureTail[0]) { ligatureTail = ligatureTail.slice(1); joinNext = !ligatureTail; return }
            joinNext = false
            const name = font.getName()
            // Extraction inserts spaces between separately positioned runs; they are not painted.
            if (char === ' ' && !matches.length) { if (current.text) current.text += char; return }
            if (!current.text) { current.origin = origin; current.fontName = name; current.fontSize = size; current.color = rgbHex(color) }
            else if (name !== current.fontName || !near(size, current.fontSize) || rgbHex(color) !== current.color) current.unsupported ??= 'This line mixes fonts, sizes, or colors. Mixed-style lines are view-only.'
            if (bidi !== 0 || !(basicLatin(char) || code in ligatures)) current.unsupported ??= 'Only left-to-right basic Latin text is supported in this release.'
            let area = quadBounds(quad)
            if (matches.length !== 1) current.unsupported ??= 'These characters cannot be matched to unique painted glyphs. The line may overlap other text or use a special encoding.'
            else {
              const id = matches[0]; const glyph = paint.glyphs[id]
              current.glyphIndices.push(id)
              if (ligature) { ligatureTail = ligature.slice(1); area = union(area, glyph.bounds) }
              if (!glyph.safe && editableCode(glyph.unicode)) current.unsupported ??= 'This line is drawn with an effect (transparency, a blend mode, a mask, a pattern or a shaped clip). Replacing it would change how it looks, so it is view-only.'
              const raw = mupdf.Matrix.concat(glyph.matrix, inverse)
              if (!glyph.safe || !near(raw[1], 0) || !near(raw[2], 0) || raw[0] <= 0 || raw[3] <= 0 || !near(raw[0], raw[3])) current.unsupported ??= 'This line uses an unsupported appearance or transformation. Only simple horizontal source text can be edited.'
              // The quad must agree with the source baseline; reject skew or stretching.
              const u: Point = [quad[2] - quad[0], quad[3] - quad[1]]
              const v: Point = [quad[4] - quad[0], quad[5] - quad[1]]
              if (Math.abs(u[0] * v[0] + u[1] * v[1]) > 0.05) current.unsupported ??= 'Skewed text is not supported.'
            }
            if (previous && Math.hypot(origin[0] - previous[0], origin[1] - previous[1]) > size * 2) current.unsupported ??= 'This line contains large positioning gaps. Edit a simpler line instead.'
            if (!contains(bounds, quadBounds(quad))) current.unsupported ??= 'This line extends beyond the visible crop area.'
            grow(current, area)
            current.text += ligature ? ligature : ligatures[code] ?? char; previous = origin
          } finally { font.destroy() }
        },
        endLine() { if (current && current !== finished) { flush(); finished = current } current = undefined },
      })
      flush()
    } finally { structured.destroy() }
    const check = (region: AnalyzedRegion) => {
      // Character boxes are ~1.4 em tall and overlap neighbouring lines in ordinary leading; use real ink instead.
      const inked = region.glyphIndices.map(i => paint.glyphs[i].bounds).filter(rect => rect[2] > rect[0] && rect[3] > rect[1])
      const removal = region.removal = inked.length ? inked.reduce(union) : region.bounds
      if (!contains(bounds, region.bounds)) region.unsupported ??= 'This line extends beyond the visible crop area.'
      if (region.glyphIndices.some(i => paint.glyphs[i].clips.some(clip => !contains(clip, region.bounds)))) region.unsupported ??= 'This text area crosses a clipping boundary. It is view-only.'
      const selected = new Set(region.glyphIndices)
      if (paint.glyphs.some((glyph, i) => !selected.has(i) && intersects(removal, glyph.bounds))) region.unsupported ??= 'Other text overlaps this line’s removal area. Editing it could remove neighboring content.'
      if (annotationBounds.some(rect => intersects(rect, removal))) region.unsupported ??= 'A link, annotation, or form overlaps this line. It is view-only.'
      const firstOrder = region.glyphIndices.reduce((order, i) => Math.min(order, paint.glyphs[i].order), Infinity)
      for (const obstacle of paint.obstacles) if (intersects(obstacle.bounds, removal)) {
        const backdrop = safeBackdrop(obstacle, removal, firstOrder)
        if (!backdrop) region.unsupported ??= obstacle.reason ?? 'An image or graphic is drawn on top of this line. It is view-only to preserve that content.'
      }
      if (!region.glyphIndices.length) region.unsupported ??= 'No editable glyphs were found in this line.'
      return !region.unsupported
    }
    regions.forEach(check)
    // Exporters often place each word as its own span, and extraction keeps spans
    // apart. Join same-style pieces back into lines, then lines into paragraphs, so a
    // whole paragraph can be replaced. A merge is kept only if it passes every check.
    // A border or rule between two pieces (table cells, rows, columns) keeps them apart;
    // a background behind both does not.
    const divided = (a: AnalyzedRegion, b: AnalyzedRegion) => {
      const area = union(a.bounds, b.bounds)
      return paint.obstacles.some(o => intersects(o.bounds, area) && !contains(o.bounds, area, -0.1) && !intersects(o.bounds, a.removal ?? a.bounds) && !intersects(o.bounds, b.removal ?? b.bounds))
    }
    const lines = joinRegions(regions, check, (a, b) => {
      if (divided(a, b)) return undefined
      const along = span(b.bounds, a.direction)[0] - span(a.bounds, a.direction)[1]
      return Math.abs(across(a, b.origin)) < 0.5 && along > -0.5 && along <= a.fontSize * 1.2 ? { text: along > a.fontSize * 0.1 && !a.text.endsWith(' ') ? ' ' : '' } : undefined
    })
    const paragraphs = joinRegions(lines, check, (a, b) => {
      if (divided(a, b)) return undefined
      const gap = across(a, b.origin) - (a.lineGap ?? 0) * ((a.lines ?? 1) - 1)
      const steady = !a.lineGap || Math.abs(gap - a.lineGap) <= a.lineGap * 0.15
      return gap >= a.fontSize * 0.9 && gap <= a.fontSize * 2 && steady && Math.abs(span(b.bounds, a.direction)[0] - span(a.bounds, a.direction)[0]) <= a.fontSize * 0.6
        ? { text: ' ', lines: (a.lines ?? 1) + (b.lines ?? 1), lineGap: a.lineGap ?? gap } : undefined
    })
    paragraphs.forEach((region, i) => { region.id = `${index}:${i}` })
    return { view: { page: index, bounds, regions: paragraphs.map(({ glyphIndices: _, ...region }) => region), message: !paragraphs.length ? 'No editable text was found. This may be a scanned page; OCR is outside this release.' : pageReason }, regions: paragraphs, glyphs: paint.glyphs, pdfToPage, graphics: paint.obstacles }
  } finally { page.destroy() }
}

// Extent of a rectangle along an axis-aligned reading direction.
function span(rect: Rect, [ux, uy]: Point): [number, number] {
  const values = [rect[0] * ux + rect[1] * uy, rect[2] * ux + rect[1] * uy, rect[0] * ux + rect[3] * uy, rect[2] * ux + rect[3] * uy]
  return [Math.min(...values), Math.max(...values)]
}
// Distance from a region's first baseline to a point, perpendicular to its reading direction (positive = next line).
const across = (region: TextRegion, point: Point) => (point[0] - region.origin[0]) * -region.direction[1] + (point[1] - region.origin[1]) * region.direction[0]

function joinRegions(regions: AnalyzedRegion[], check: (region: AnalyzedRegion) => boolean, joinable: (a: AnalyzedRegion, b: AnalyzedRegion) => { text: string; lines?: number; lineGap?: number } | undefined) {
  const out: AnalyzedRegion[] = []
  for (const region of regions) {
    const previous = out[out.length - 1]
    const sameStyle = previous && !previous.unsupported && !region.unsupported && previous.fontName === region.fontName && near(previous.fontSize, region.fontSize) && previous.color === region.color && samePoint(previous.direction, region.direction, 0.01)
    const join = sameStyle ? joinable(previous, region) : undefined
    if (join) {
      const merged: AnalyzedRegion = { ...previous, text: previous.text + join.text + region.text, bounds: union(previous.bounds, region.bounds), glyphIndices: [...previous.glyphIndices, ...region.glyphIndices], lines: join.lines ?? previous.lines, lineGap: join.lineGap ?? previous.lineGap, unsupported: undefined }
      if (check(merged)) { out[out.length - 1] = merged; continue }
    }
    out.push(region)
  }
  return out
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
