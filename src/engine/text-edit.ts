import * as mupdf from 'mupdf'
import type { Rect, ReplacementFont, TextEdit } from '../model/document'
import { contains, coverage, overlaps, samePoint, union } from '../geometry/affine'
import { openPdf } from './mupdf-adapter'
import { analyzePage, assertGlyphs, glyphDot, paintedGlyphs, safeBackdrop } from './text-analysis'
import { pdfLiteral as literal, supportedText, unsupportedMessage, webAddress } from '../model/text-encoding'
import type { Analysis, AnalyzedRegion, Glyph } from './text-analysis'

export const REPLACEMENT_FONTS: readonly ReplacementFont[] = ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique', 'Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic', 'Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique']
export type PreparedEdit = { edit: TextEdit; region: AnalyzedRegion; ink: Rect; glyphs: Pick<Glyph, 'unicode' | 'origin'>[]; lines: string[]; command: string }

/** Greedy word wrap. A single word wider than the line cannot be placed. */
export function wrap(value: string, width: number, measure: (text: string) => number) {
  const lines: string[] = []
  let line = ''
  for (const word of value.split(/ +/)) {
    const candidate = line ? `${line} ${word}` : word
    if (measure(candidate) <= width + 0.05 || !line) { line = candidate; continue }
    lines.push(line); line = word
  }
  lines.push(line)
  if (lines.some(entry => measure(entry) > width + 0.05)) throw new Error('A word in the replacement is wider than the paragraph. Shorten it or reduce the font size. The layout has not changed.')
  return lines
}
const number = (value: number) => Number(value.toFixed(6)).toString()
const near = (a: number, b: number) => Math.abs(a - b) < 0.01

export function prepareEdit(analysis: Analysis, edit: TextEdit, fontKey = 'F'): PreparedEdit {
  const region = analysis.regions.find(line => line.id === edit.regionId)
  if (!region || edit.page !== analysis.view.page) throw new Error('This text selection is no longer valid. Select a line again.')
  if (region.unsupported) throw new Error(region.unsupported)
  if (!REPLACEMENT_FONTS.includes(edit.font)) throw new Error('Choose one of the available replacement fonts.')
  if (!Number.isFinite(edit.size) || edit.size < 4 || edit.size > 144) throw new Error('Enter a font size from 4 to 144 points.')
  if (!/^#[\da-f]{6}$/i.test(edit.color)) throw new Error('Choose a valid text color.')
  if (!supportedText(edit.text)) throw new Error(`${unsupportedMessage} Line breaks are not supported. No changes were applied.`)
  if (edit.text && !edit.text.trim()) throw new Error('Use an empty value to remove the line, or enter visible text.')
  if (edit.link !== undefined && (!region.link || !webAddress(edit.link))) throw new Error(region.link ? 'Enter a link that starts with https://, http://, mailto: or tel:.' : 'This text has no link to change.')
  const font = new mupdf.Font(edit.font)
  let text = new mupdf.Text()
  try {
    const [ux, uy] = region.direction
    const [x, y] = region.origin
    const capacity = Math.abs(ux) * (region.bounds[2] - region.bounds[0]) + Math.abs(uy) * (region.bounds[3] - region.bounds[1])
    const measure = (value: string) => [...value].reduce((sum, c) => sum + font.advanceGlyph(font.encodeCharacter(c)) * edit.size, 0)
    // A paragraph wraps word by word into at most its original number of lines, at its original spacing.
    const maxLines = region.lines ?? 1, gap = region.lineGap ?? edit.size * 1.2
    const removal = region.removal ?? region.bounds
    // Vertical room is the original line band (1 em above each baseline, 0.35 em below the last), not the old font's exact letter boxes:
    // fonts with short descenders (e.g. LaTeX's Computer Modern) would otherwise reject identical text. The original ink counts as
    // room too: ink boxes are padded and may reach past the character boxes.
    const down: [number, number] = [-uy, ux], at = (k: number): Rect => [x + down[0] * k, y + down[1] * k, x + down[0] * k, y + down[1] * k]
    const room = union(union(union(region.bounds, removal), at(-region.fontSize)), at(gap * (maxLines - 1) + region.fontSize * 0.35))
    const selected = new Set(region.glyphIndices)
    const selectedGlyphs = region.glyphIndices.map(index => analysis.glyphs[index])
    // Text clipped by rectangles (text boxes, table cells) is replaced inside the same rectangles, so it is cut off exactly as before.
    // Each glyph's clip is the intersection of its rectangles; the line's clip is the union of those (no clip if any glyph is unclipped).
    const clipped = selectedGlyphs.every(glyph => glyph.clips.length)
    const clips = clipped ? selectedGlyphs.map(glyph => glyph.clips.reduce((a, b) => [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])])).filter((clip, i, all) => all.findIndex(other => other.every((v, k) => near(v, clip[k]))) === i) : []
    const textOrder = selectedGlyphs.reduce((order, glyph) => Math.min(order, glyph.order), Infinity)
    // Neighbours the original text already touched (overhanging italics, tightly kerned runs) are not new collisions.
    const neighbours = analysis.glyphs.filter((glyph, index) => !selected.has(index) && !overlaps(removal, glyph.bounds))
    const graphics = analysis.graphics.filter(graphic => !overlaps(removal, graphic.bounds))
    const placementError = (ink: Rect) => {
      if (edit.text && !contains(room, ink, 1)) return 'The replacement does not fit the original line’s space. Reduce the font size. The layout has not changed.'
      if (!contains(analysis.view.bounds, ink)) return 'The replacement would extend beyond the visible page. Reduce its size.'
      // Spilling past the clip is fine where the original already did: that part is hidden the same way.
      if (clipped && !contains(union(clips.reduce(union), removal), ink, 2)) return 'The replacement would extend past the original text box and be cut off. Shorten it or reduce its size.'
      const footprint = union(ink, removal)
      if (graphics.some(graphic => overlaps(graphic.bounds, footprint) && !safeBackdrop(graphic, footprint, textOrder) && coverage(graphic.bounds, footprint) >= 0.15)) return 'The replacement would touch a neighboring graphic. Reduce its size or use a shorter line.'
      if (neighbours.some(glyph => overlaps(footprint, glyph.bounds))) return 'The replacement would touch neighboring text. Reduce its size or use a shorter line.'
      return ''
    }
    // The standard fonts often run wider than the original (e.g. Times vs LaTeX's Computer Modern), so identical text would
    // not fit or would touch the next word. Narrow the letters, up to 25%, before giving up; height and position are unchanged.
    const fitError = `The replacement does not fit the original ${maxLines > 1 ? 'paragraph' : 'line’s width'}, even with narrowed letters. Shorten it or reduce the font size. The layout has not changed.`
    let lines: string[] = [], squeeze = 1, problem = '', ink: Rect = region.bounds
    for (squeeze of [1, 0.97, 0.94, 0.91, 0.88, 0.85, 0.82, 0.79, 0.75]) {
      text.destroy(); text = new mupdf.Text()
      try { lines = maxLines > 1 ? wrap(edit.text, capacity, value => measure(value) * squeeze) : [edit.text] } catch (error) { problem = (error as Error).message; continue }
      if (lines.length > maxLines) { problem = `The replacement needs ${lines.length} lines but this paragraph has room for ${maxLines}. Shorten it or reduce the font size. The layout has not changed.`; continue }
      let widest = 0
      lines.forEach((line, i) => {
        const lx = x - uy * gap * i, ly = y + ux * gap * i
        const end = text.showString(font, [ux * edit.size * squeeze, uy * edit.size * squeeze, uy * edit.size, -ux * edit.size, lx, ly], line)
        widest = Math.max(widest, Math.hypot(end[4] - lx, end[5] - ly))
      })
      ink = edit.text ? text.getBounds(null as unknown as mupdf.StrokeState, mupdf.Matrix.identity) : region.bounds
      problem = widest > capacity + 0.05 ? fitError : placementError(ink)
      if (!problem) break
    }
    if (problem) throw new Error(problem)
    const glyphs: Pick<Glyph, 'unicode' | 'origin'>[] = []
    text.walk({ showGlyph(_font, matrix, _glyph, unicode) { glyphs.push({ unicode, origin: [matrix[4], matrix[5]] }) } })
    const color = [1, 3, 5].map(offset => parseInt(edit.color.slice(offset, offset + 2), 16) / 255)
    const shows = lines.map((line, i) => `${[ux * squeeze, uy * squeeze, uy, -ux, x - uy * gap * i, y + ux * gap * i].map(number).join(' ')} Tm ${literal(line)} Tj`).join(' ')
    const clip = clips.length ? `${clips.map(([x0, y0, x1, y1]) => [x0, y0, x1 - x0, y1 - y0].map(number).join(' ') + ' re').join(' ')} W n ` : ''
    // Faux-bold originals (filled and outlined) keep their outline: same width and colour, render mode 2.
    const stroke = selectedGlyphs.every(glyph => glyph.stroke) ? selectedGlyphs[0].stroke : undefined
    const outline = stroke ? `2 Tr ${number(stroke.width)} w ${[1, 3, 5].map(offset => number(parseInt(stroke.color.slice(offset, offset + 2), 16) / 255)).join(' ')} RG ` : ''
    return { edit, region, ink, glyphs, lines, command: `q ${clip}BT /${fontKey} ${number(edit.size)} Tf ${color.map(number).join(' ')} rg ${outline}${shows} ET Q` }
  } finally { text.destroy(); font.destroy() }
}

function cloneDictionary(doc: mupdf.PDFDocument, source: mupdf.PDFObject): mupdf.PDFObject {
  const clone = doc.newDictionary()
  if (source.isDictionary()) source.forEach((value, key) => { try { clone.put(key, value) } finally { value.destroy() } })
  return clone
}

function insertReplacements(doc: mupdf.PDFDocument, page: mupdf.PDFPage, analysis: Analysis, prepared: PreparedEdit[]) {
  // Use a Form XObject with its own font resources. Clone page resources/XObjects
  // before adding our entry: inherited/shared dictionaries must never be mutated.
  const owned: { destroy(): void }[] = []
  const keep = <T extends { destroy(): void }>(object: T): T => { owned.push(object); return object }
  try {
    const object = keep(page.getObject())
    const inherited = keep(object.getInheritable('Resources'))
    const resources = keep(cloneDictionary(doc, inherited))
    const oldXObjects = keep(resources.get('XObject'))
    const xObjects = keep(cloneDictionary(doc, oldXObjects))
    const fonts: Record<string, mupdf.PDFObject> = {}
    prepared.forEach(({ edit }, index) => { const font = keep(new mupdf.Font(edit.font)); fonts[`F${index}`] = keep(doc.addSimpleFont(font)) })
    const form = keep(doc.addStream(prepared.map(p => p.command).join('\n'), {
      Type: 'XObject', Subtype: 'Form', BBox: analysis.view.bounds,
      Matrix: mupdf.Matrix.invert(analysis.pdfToPage), Resources: { Font: fonts },
    }))
    let name = 'MarginText'
    for (let suffix = 0; ; suffix++) {
      const value = xObjects.get(name)
      const available = value.isNull(); value.destroy()
      if (available) break
      name = `MarginText${suffix}`
    }
    xObjects.put(name, form); resources.put('XObject', xObjects); object.put('Resources', resources)
    const contents = keep(object.get('Contents'))
    const streams = keep(doc.newArray())
    streams.push(keep(doc.addStream('q\n', {})))
    if (contents.isArray()) contents.forEach(value => { try { streams.push(value) } finally { value.destroy() } })
    else if (!contents.isNull()) streams.push(contents)
    streams.push(keep(doc.addStream(`\nQ\nq /${name} Do Q\n`, {})))
    object.put('Contents', streams)
  } finally { for (const object of owned.reverse()) object.destroy() }
}

export function compileTextEdits(source: Uint8Array, edits: TextEdit[], analyze?: (page: number) => Analysis): Uint8Array<ArrayBuffer> {
  if (!edits.length) return source.slice()
  if (new Set(edits.map(edit => `${edit.page}/${edit.regionId}`)).size !== edits.length) throw new Error('The edit plan contains duplicate lines.')
  const doc = openPdf(source)
  try {
    const groups = new Map<number, TextEdit[]>()
    for (const edit of edits) groups.set(edit.page, [...groups.get(edit.page) ?? [], edit])
    const expected = new Map<number, Pick<Glyph, 'unicode' | 'origin'>[]>()
    const searchable = new Map<number, string[]>()
    const verifiable = new Map<number, (glyph: Pick<Glyph, 'unicode' | 'origin'>) => boolean>()
    for (const [index, pageEdits] of groups) {
      const analysis = analyze ? analyze(index) : analyzePage(doc, index)
      const prepared = pageEdits.map((edit, i) => prepareEdit(analysis, edit, `F${i}`))
      for (let i = 0; i < prepared.length; i++) for (let j = i + 1; j < prepared.length; j++) {
        if (overlaps(union(prepared[i].ink, prepared[i].region.removal ?? prepared[i].region.bounds), union(prepared[j].ink, prepared[j].region.removal ?? prepared[j].region.bounds))) throw new Error('These edits overlap. No changes were applied.')
      }
      const removed = new Set(prepared.flatMap(p => p.region.glyphIndices))
      // MuPDF's redaction removes glyphs by their character box, so a space in a neighbouring run whose
      // box reaches into the edited text (e.g. "Pay by |Friday| to") goes with it. Spaces paint nothing,
      // so verification ignores whitespace within one em of the replaced areas; inked glyphs stay exact.
      const areas = prepared.map(p => { const [x0, y0, x1, y1] = p.region.removal ?? p.region.bounds, em = p.region.fontSize; return [x0 - em, y0 - em, x1 + em, y1 + em] })
      const visible = (glyph: Pick<Glyph, 'unicode' | 'origin'>) => !(glyph.unicode === 32 || glyph.unicode === 160) || !areas.some(([x0, y0, x1, y1]) => glyph.origin[0] >= x0 && glyph.origin[0] <= x1 && glyph.origin[1] >= y0 && glyph.origin[1] <= y1)
      verifiable.set(index, visible)
      const remaining = analysis.glyphs.filter((glyph, i) => !removed.has(i) && visible(glyph))
      const page = doc.loadPage(index)
      try {
        const linksBefore = page.getLinks().map(link => { try { return { bounds: link.getBounds(), uri: link.getURI() } } finally { link.destroy() } })
        // Redact a tiny point inside each replaced glyph rather than the line's box: exactly those glyphs go, and
        // neighbouring text whose box grazes the line stays.
        for (const { region } of prepared) for (const i of region.glyphIndices) {
          const annotation = page.createAnnotation('Redact')
          try { annotation.setRect(glyphDot(analysis.glyphs[i])) } finally { annotation.destroy() }
        }
        page.applyRedactions(false, mupdf.PDFPage.REDACT_IMAGE_NONE, mupdf.PDFPage.REDACT_LINE_ART_NONE, mupdf.PDFPage.REDACT_TEXT_REMOVE)
        // Redaction deletes links it touches. Links that move with an edit are recreated below; put every other one back as it was.
        const sameRect = (a: Rect, b: Rect) => samePoint([a[0], a[1]], [b[0], b[1]], 0.5) && samePoint([a[2], a[3]], [b[2], b[3]], 0.5)
        const moving = prepared.flatMap(p => p.region.linkBounds ? [p.region.linkBounds] : [])
        const linksAfter = page.getLinks()
        try {
          const kept: { bounds: Rect; uri: string }[] = []
          for (const link of linksAfter) { const bounds = link.getBounds(); if (moving.some(rect => sameRect(rect, bounds))) page.deleteLink(link); else kept.push({ bounds, uri: link.getURI() }) }
          for (const link of linksBefore) if (!moving.some(rect => sameRect(rect, link.bounds)) && !kept.some(other => other.uri === link.uri && sameRect(other.bounds, link.bounds))) page.createLink(link.bounds, link.uri).destroy()
        } finally { linksAfter.forEach(link => link.destroy()) }
        // Verify the removal in isolation, even when replacement == original wording.
        assertGlyphs(paintedGlyphs(page).glyphs.filter(visible), remaining)
        insertReplacements(doc, page, analysis, prepared)
        // Redaction deleted the link with its text; put it back around the new text. Removing the text removes the link.
        for (const { edit, region, ink } of prepared) if (region.link && edit.text) page.createLink(ink, edit.link ?? region.link).destroy()
        expected.set(index, [...remaining, ...prepared.flatMap(p => p.glyphs).filter(visible)])
        searchable.set(index, prepared.flatMap(p => p.lines.map(line => line.trim()).filter(Boolean)))
      } finally { page.destroy() }
    }
    const buffer = doc.saveToBuffer('garbage=4,compress')
    try {
      const bytes = buffer.asUint8Array().slice()
      const reopened = openPdf(bytes)
      try {
        for (const [index, glyphs] of expected) {
          const page = reopened.loadPage(index)
          try { assertGlyphs(paintedGlyphs(page).glyphs.filter(verifiable.get(index)!), glyphs) } finally { page.destroy() }
          // Search uses structured extraction, separate from painted glyph checks.
          const textPage = reopened.loadPage(index)
          try {
            const text = textPage.toStructuredText('')
            try {
              for (const line of searchable.get(index)!) if (text.search(line, {}).length === 0) throw new Error('The replacement could not be verified as searchable PDF text. No changes were applied.')
            } finally { text.destroy() }
          } finally { textPage.destroy() }
        }
      } finally { reopened.destroy() }
      return bytes
    } finally { buffer.destroy() }
  } finally { doc.destroy() }
}
