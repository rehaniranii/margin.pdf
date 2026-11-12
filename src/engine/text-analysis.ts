import * as mupdf from 'mupdf'
import type { Matrix, PageText, Point, Rect, TextRegion } from '../model/document'
import { contains, coverage, intersects, overlaps, quadBounds, samePoint, union } from '../geometry/affine'

// `stroke`: the glyph is also outlined (fill + stroke, a common faux bold); width is in page units.
export type Glyph = { unicode: number; origin: Point; bounds: Rect; matrix: Matrix; font: string; safe: boolean; order: number; clips: Rect[]; stroke?: { width: number; color: string } }
export type Graphic = { bounds: Rect; order: number; background: boolean; reason?: string }
// `removal` is the ink of the region's own glyphs: what redaction removes and what must not touch other content.
export type AnalyzedRegion = TextRegion & { glyphIndices: number[]; removal?: Rect; linkBounds?: Rect }
// A point inside a glyph that redaction can target: 0.3 em above the baseline, under the ink's centre (0.1 em
// along for letters without ink: spaces are narrow, and the extra letters of "fi" share the first letter's box). MuPDF judges glyphs by their line box,
// not their ink, so this point is inside even for "_" or ",". Redacting a tiny box here removes exactly that
// glyph; neighbours whose boxes merely graze it are untouched.
export function glyphDot(glyph: Glyph): Rect {
  const [x0, y0, x1, y1] = glyph.bounds, m = glyph.matrix
  const along = x1 > x0 && y1 > y0 ? (((x0 + x1) / 2 - m[4]) * m[0] + ((y0 + y1) / 2 - m[5]) * m[1]) / (m[0] * m[0] + m[1] * m[1]) : 0.1
  const x = m[4] + along * m[0] + 0.3 * m[2], y = m[5] + along * m[1] + 0.3 * m[3]
  return [x - 0.1, y - 0.1, x + 0.1, y + 0.1]
}
export type Analysis = { view: PageText; regions: AnalyzedRegion[]; glyphs: Glyph[]; pdfToPage: Matrix; graphics: Graphic[] }
const near = (a: number, b: number) => Math.abs(a - b) < 0.02
import { supportedText, webAddress, winAnsiCode } from '../model/text-encoding'
// Typographic ligatures (ff, fi, fl, ffi, ffl, long-s t, st) are one painted glyph; edit them as their letters.
const ligatures: Record<number, string> = { 0xfb00: 'ff', 0xfb01: 'fi', 0xfb02: 'fl', 0xfb03: 'ffi', 0xfb04: 'ffl', 0xfb05: 'st', 0xfb06: 'st' }
const editableCode = (unicode: number) => winAnsiCode(String.fromCodePoint(unicode)) !== undefined || unicode in ligatures
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
            // glyph < 0 is an extra letter of the previous glyph (a ligature such as "fi" mapped to two letters); it is as safe as that glyph.
            const base = glyph >= 0 || glyphs[glyphs.length - 1]?.safe === true
            glyphs.push({ unicode, origin: [matrix[4], matrix[5]], bounds, matrix, font: font.getName(), safe: plain && wmode === 0 && bidi === 0 && base && editableCode(unicode) && clips.every(clip => clip !== null), order: paintOrder, clips: activeClips })
          } finally { single.destroy() }
          // Text.walk supplies a shared cached font wrapper. Do not destroy it.
        } })
      } finally { text.destroy(); space.destroy() }
    },
    // Outlined or invisible text is not editable itself; it only blocks lines it overlaps.
    // Outlined text exactly over the same filled glyphs is one faux-bold line: record the outline on those glyphs so the
    // replacement can repeat it. Any other outlined text only blocks the lines it overlaps.
    strokeText(text, stroke, ctm, space, color, alpha) {
      try {
        const outlined: Glyph[] = []; let alone = alpha !== 1
        text.walk({ showGlyph(_font, trm, _glyph, unicode) {
          const m = mupdf.Matrix.concat(trm, ctm)
          const filled = glyphs.find(g => !g.stroke && !outlined.includes(g) && g.unicode === unicode && samePoint(g.origin, [m[4], m[5]], 0.01))
          if (filled) outlined.push(filled); else alone = true
        } })
        const expansion = Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]))
        if (alone || !outlined.length) obstacle(text.getBounds(stroke, ctm), 'Outlined text overlaps this line. It is view-only.')
        else for (const glyph of outlined) glyph.stroke = { width: stroke.getLineWidth() * expansion, color: rgbHex(color.length === 1 || color.length === 3 ? [...color] : [0]) }
      } finally { text.destroy(); stroke.destroy(); space.destroy() }
    },
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
    // Links never block editing: an edit restores any link it disturbs. A web link that covers exactly one line moves with it.
    const links: { bounds: Rect; uri: string; web: boolean }[] = []
    for (const link of page.getLinks()) { try { const uri = link.getURI(); links.push({ bounds: link.getBounds(), uri, web: link.isExternal() && webAddress(uri) }) } finally { link.destroy() } }
    for (const annotation of annotations) {
      try {
        if (annotation.getType() === 'Redact') pageReason = 'This page has pending redactions. Editing it could apply unrelated removals, so it is view-only.'
        annotationBounds.push(annotation.getBounds())
      } finally { annotation.destroy() }
    }
    const regions: AnalyzedRegion[] = []
    // Painted glyphs by letter and position. Extraction and painting report the same position in different
    // float precision (721.22498 vs 721.22501), so match within a tolerance rather than by rounded keys.
    const glyphMap = new Map<string, number[]>()
    const key = (unicode: number, x: number, y: number) => `${unicode}:${x}:${y}`
    paint.glyphs.forEach((glyph, i) => { const k = key(glyph.unicode, Math.floor(glyph.origin[0]), Math.floor(glyph.origin[1])); const values = glyphMap.get(k) ?? []; values.push(i); glyphMap.set(k, values) })
    // Each painted glyph belongs to at most one extracted letter.
    const claimed = new Set<number>()
    const find = (unicode: number, origin: Point) => {
      const found: number[] = []
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const i of glyphMap.get(key(unicode, Math.floor(origin[0]) + dx, Math.floor(origin[1]) + dy)) ?? []) if (!claimed.has(i) && samePoint(paint.glyphs[i].origin, origin, 0.01)) found.push(i)
      return found.sort((a, b) => a - b)
    }
    // Origin of the last matched glyph: the extra letters of a multi-letter glyph ("fi", "ffi") are painted there.
    let glyphOrigin: Point | undefined
    let afterSymbol = false
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
    const blank = (direction: Point): AnalyzedRegion => ({ id: '', text: '', bounds: [0, 0, 0, 0], origin: [0, 0], direction, fontName: '', fontSize: 0, color: '#000000', glyphIndices: [], unsupported: pageReason })
    const grow = (region: AnalyzedRegion, rect: Rect) => { region.bounds = region.text ? union(region.bounds, rect) : rect }
    try {
      structured.walk({
        beginLine(_rect, wmode, direction) {
          current = blank(direction)
          fresh = true
          if (wmode !== 0) current.unsupported = 'Vertical writing is not supported.'
        },
        onChar(char, origin, font, size, quad, color, bidi) {
          try {
            if (!current) return
            // Zero-width spaces and joiners (common in Google Docs and Word exports) paint nothing; leave them out of the text.
            if (/[\u200b-\u200d\u2060\ufeff]/.test(char)) return
            const code = char.charCodeAt(0)
            let matches = find(code, origin)
            // Extraction may place the later letters of a multi-letter glyph at the next glyph's position; they are painted at that glyph's.
            if (!matches.length && glyphOrigin) matches = find(code, glyphOrigin)
            let ligature = ''
            if (!matches.length) for (const [lig, letters] of Object.entries(ligatures)) if (letters.startsWith(char)) {
              const found = find(Number(lig), origin)
              if (found.length) { matches = found; ligature = letters; break }
            }
            if (fresh) {
              fresh = false
              // Continue the previous line when this one starts inside or right after one of its ligatures.
              const sameBaseline = finished && Math.abs((origin[0] - finished.origin[0]) * finished.direction[1] - (origin[1] - finished.origin[1]) * finished.direction[0]) < 0.5
              if (finished && sameBaseline && (ligatureTail || joinNext || ligature)) { current = finished; finished = undefined }
              else { flush(); previous = undefined; glyphOrigin = undefined; ligatureTail = ''; joinNext = false }
            }
            if (ligatureTail && char === ligatureTail[0]) { ligatureTail = ligatureTail.slice(1); joinNext = !ligatureTail; return }
            joinNext = false
            const name = font.getName()
            // Extraction inserts spaces between separately positioned runs; they are not painted. Spaces right after a
            // split-off symbol are not part of the following text either.
            if (char === ' ' && (!matches.length || (afterSymbol && !current.text))) { if (current.text) current.text += char; return }
            afterSymbol = false
            if (bidi === 0 && !(supportedText(char) || code in ligatures) && !current.unsupported?.startsWith('Vertical')) {
              // A symbol the standard fonts cannot draw (●, ▪, ₹, math letters) becomes its own piece: it can be removed or
              // replaced with drawable text (• or -), and the text before and after it stays editable on its own.
              const wasFinished = finished === current
              flush()
              if (!wasFinished && current.text.trim()) { current.text = current.text.trimEnd(); regions.push(current) }
              const piece = blank(current.direction)
              Object.assign(piece, { text: char, bounds: quadBounds(quad), origin, fontName: name, fontSize: size, color: rgbHex(color) })
              if (matches.length) { piece.glyphIndices.push(matches[0]); claimed.add(matches[0]); glyphOrigin = paint.glyphs[matches[0]].origin }
              regions.push(piece)
              current = blank(current.direction); previous = origin; afterSymbol = true
              return
            }
            if (!current.text) { current.origin = origin; current.fontName = name; current.fontSize = size; current.color = rgbHex(color) }
            else if (name !== current.fontName || !near(size, current.fontSize) || rgbHex(color) !== current.color) current.unsupported ??= 'This line mixes fonts, sizes, or colors. Mixed-style lines are view-only.'
            if (bidi !== 0) current.unsupported ??= 'Only left-to-right Latin text (including accents like é ü ñ) is supported in this release.'
            let area = quadBounds(quad)
            // Several candidates are identical glyphs at one spot (the letters of "ffi", or text painted twice); take the first.
            // A leftover duplicate sits inside this line's glyphs and is caught by the overlap check below.
            if (!matches.length) current.unsupported ??= 'These characters cannot be matched to painted glyphs. The font may use a special encoding.'
            else {
              const id = matches[0]; const glyph = paint.glyphs[id]
              current.glyphIndices.push(id); claimed.add(id); glyphOrigin = glyph.origin
              if (ligature) { ligatureTail = ligature.slice(1); area = union(area, glyph.bounds) }
              if (!glyph.safe && editableCode(glyph.unicode)) current.unsupported ??= 'This line is drawn with an effect (transparency, a blend mode, a mask, a pattern or a shaped clip). Replacing it would change how it looks, so it is view-only.'
              const raw = mupdf.Matrix.concat(glyph.matrix, inverse)
              // Upright text or text turned by a quarter turn (sideways footers, vertical labels), evenly scaled and not mirrored.
              const quarterTurn = near(raw[0], raw[3]) && near(raw[1], -raw[2]) && (near(raw[0], 0) || near(raw[1], 0)) && raw[0] * raw[3] - raw[1] * raw[2] > 0
              if (!glyph.safe || !quarterTurn) current.unsupported ??= 'This line uses an unsupported appearance or transformation. Only straight text (upright or turned by 90°) can be edited.'
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
      const selected = new Set(region.glyphIndices)
      const dots = region.glyphIndices.map(i => glyphDot(paint.glyphs[i]))
      // Only text this line's redaction points actually land on is at risk (genuinely overlapping or duplicated text).
      // Ink boxes are padded by about 1pt, so look at each neighbour's core: a dot that only reaches the padding leaves it alone.
      const core = ([x0, y0, x1, y1]: Rect): Rect => { const dx = Math.min(1, (x1 - x0) / 4), dy = Math.min(1, (y1 - y0) / 4); return [x0 + dx, y0 + dy, x1 - dx, y1 - dy] }
      if (paint.glyphs.some((glyph, i) => !selected.has(i) && dots.some(dot => intersects(dot, core(glyph.bounds))))) region.unsupported ??= 'Other text is printed on top of this line. Editing it could remove that text too.'
      if (annotationBounds.some(rect => dots.some(dot => intersects(rect, dot)))) region.unsupported ??= 'A comment, highlight or form field sits on this text. It is view-only.'
      const inside = (link: Rect, glyph: Glyph) => intersects(link, glyphDot(glyph))
      const owner = links.filter(link => region.glyphIndices.some(i => inside(link.bounds, paint.glyphs[i])))
      region.link = region.linkBounds = undefined
      if (owner.length === 1 && owner[0].web && region.glyphIndices.every(i => inside(owner[0].bounds, paint.glyphs[i])) && paint.glyphs.every((glyph, i) => selected.has(i) || !inside(owner[0].bounds, glyph))) { region.link = owner[0].uri; region.linkBounds = owner[0].bounds }
      const firstOrder = region.glyphIndices.reduce((order, i) => Math.min(order, paint.glyphs[i].order), Infinity)
      for (const obstacle of paint.obstacles) if (overlaps(obstacle.bounds, removal)) {
        // A graphic painted over the text is kept on top only when it hides a real part of it (a box over hidden text).
        // Thin rules and underlines that cross a sliver of the letters are fine for the replacement to sit over.
        const backdrop = safeBackdrop(obstacle, removal, firstOrder) || coverage(obstacle.bounds, removal) < 0.15
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
      // Another glyph between the two pieces (inline math, a symbol from another font) keeps them apart:
      // joined, the replacement would be drawn over it.
      const members = new Set([...a.glyphIndices, ...b.glyphIndices])
      if (paint.glyphs.some((glyph, i) => !members.has(i) && glyph.bounds[2] > glyph.bounds[0] && glyph.bounds[3] > glyph.bounds[1] && intersects(glyphDot(glyph), area))) return true
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
    return { view: { page: index, bounds, regions: paragraphs.map(({ glyphIndices: _, removal: _r, linkBounds: _l, ...region }) => region), message: !paragraphs.length ? 'No editable text was found. This may be a scanned page; OCR is outside this release.' : pageReason }, regions: paragraphs, glyphs: paint.glyphs, pdfToPage, graphics: paint.obstacles }
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
    const sameStyle = previous && !previous.unsupported && !region.unsupported && supportedText(previous.text) && supportedText(region.text) && previous.fontName === region.fontName && near(previous.fontSize, region.fontSize) && previous.color === region.color && samePoint(previous.direction, region.direction, 0.01)
    const join = sameStyle && !previous.link && !region.link ? joinable(previous, region) : undefined
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
