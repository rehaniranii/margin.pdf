import * as mupdf from 'mupdf'
import type { Rect, ReplacementFont, TextEdit } from '../model/document'
import { contains, intersects, union } from '../geometry/affine'
import { openPdf } from './mupdf-adapter'
import { analyzePage, assertGlyphs, paintedGlyphs, safeBackdrop } from './text-analysis'
import { pdfLiteral as literal, supportedText, unsupportedMessage } from '../model/text-encoding'
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

export function prepareEdit(analysis: Analysis, edit: TextEdit, fontKey = 'F'): PreparedEdit {
  const region = analysis.regions.find(line => line.id === edit.regionId)
  if (!region || edit.page !== analysis.view.page) throw new Error('This text selection is no longer valid. Select a line again.')
  if (region.unsupported) throw new Error(region.unsupported)
  if (!REPLACEMENT_FONTS.includes(edit.font)) throw new Error('Choose one of the available replacement fonts.')
  if (!Number.isFinite(edit.size) || edit.size < 4 || edit.size > 144) throw new Error('Enter a font size from 4 to 144 points.')
  if (!/^#[\da-f]{6}$/i.test(edit.color)) throw new Error('Choose a valid text color.')
  if (!supportedText(edit.text)) throw new Error(`${unsupportedMessage} Line breaks are not supported. No changes were applied.`)
  if (edit.text && !edit.text.trim()) throw new Error('Use an empty value to remove the line, or enter visible text.')
  const font = new mupdf.Font(edit.font)
  const text = new mupdf.Text()
  try {
    const [ux, uy] = region.direction
    const [x, y] = region.origin
    const capacity = Math.abs(ux) * (region.bounds[2] - region.bounds[0]) + Math.abs(uy) * (region.bounds[3] - region.bounds[1])
    const measure = (value: string) => [...value].reduce((sum, c) => sum + font.advanceGlyph(font.encodeCharacter(c)) * edit.size, 0)
    // A paragraph wraps word by word into at most its original number of lines, at its original spacing.
    const maxLines = region.lines ?? 1, gap = region.lineGap ?? edit.size * 1.2
    const lines = maxLines > 1 ? wrap(edit.text, capacity, measure) : [edit.text]
    if (lines.length > maxLines) throw new Error(`The replacement needs ${lines.length} lines but this paragraph has room for ${maxLines}. Shorten it or reduce the font size. The layout has not changed.`)
    let widest = 0
    lines.forEach((line, i) => {
      const lx = x - uy * gap * i, ly = y + ux * gap * i
      const end = text.showString(font, [ux * edit.size, uy * edit.size, uy * edit.size, -ux * edit.size, lx, ly], line)
      widest = Math.max(widest, Math.hypot(end[4] - lx, end[5] - ly))
    })
    const ink = edit.text ? text.getBounds(null as unknown as mupdf.StrokeState, mupdf.Matrix.identity) : region.bounds
    if (widest > capacity + 0.05 || (edit.text && !contains(region.bounds, ink, 1))) throw new Error(`The replacement does not fit the original ${maxLines > 1 ? 'paragraph' : 'line’s width or height'}. Shorten it or reduce the font size. The layout has not changed.`)
    if (!contains(analysis.view.bounds, ink)) throw new Error('The replacement would extend beyond the visible page. Reduce its size.')
    const selected = new Set(region.glyphIndices)
    const selectedGlyphs = region.glyphIndices.map(index => analysis.glyphs[index])
    if (selectedGlyphs.some(glyph => glyph.clips.some(clip => !contains(clip, ink)))) throw new Error('The replacement would cross the original clipping boundary. Reduce its size.')
    const textOrder = selectedGlyphs.reduce((order, glyph) => Math.min(order, glyph.order), Infinity)
    const removal = region.removal ?? region.bounds
    const footprint = union(ink, removal)
    if (analysis.graphics.some(graphic => intersects(graphic.bounds, footprint) && !safeBackdrop(graphic, footprint, textOrder))) throw new Error('The replacement would touch a neighboring graphic. Reduce its size or use a shorter line.')
    if (analysis.glyphs.some((glyph, index) => !selected.has(index) && intersects(footprint, glyph.bounds))) throw new Error('The replacement would touch neighboring text. Reduce its size or use a shorter line.')
    const glyphs: Pick<Glyph, 'unicode' | 'origin'>[] = []
    text.walk({ showGlyph(_font, matrix, _glyph, unicode) { glyphs.push({ unicode, origin: [matrix[4], matrix[5]] }) } })
    const color = [1, 3, 5].map(offset => parseInt(edit.color.slice(offset, offset + 2), 16) / 255)
    const shows = lines.map((line, i) => `${[ux, uy, uy, -ux, x - uy * gap * i, y + ux * gap * i].map(number).join(' ')} Tm ${literal(line)} Tj`).join(' ')
    return { edit, region, ink, glyphs, lines, command: `q BT /${fontKey} ${number(edit.size)} Tf ${color.map(number).join(' ')} rg ${shows} ET Q` }
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
    for (const [index, pageEdits] of groups) {
      const analysis = analyze ? analyze(index) : analyzePage(doc, index)
      const prepared = pageEdits.map((edit, i) => prepareEdit(analysis, edit, `F${i}`))
      for (let i = 0; i < prepared.length; i++) for (let j = i + 1; j < prepared.length; j++) {
        if (intersects(union(prepared[i].ink, prepared[i].region.removal ?? prepared[i].region.bounds), union(prepared[j].ink, prepared[j].region.removal ?? prepared[j].region.bounds))) throw new Error('These edits overlap. No changes were applied.')
      }
      const removed = new Set(prepared.flatMap(p => p.region.glyphIndices))
      const remaining = analysis.glyphs.filter((_, i) => !removed.has(i))
      const page = doc.loadPage(index)
      try {
        for (const { region } of prepared) {
          const annotation = page.createAnnotation('Redact')
          try { annotation.setRect(region.removal ?? region.bounds) } finally { annotation.destroy() }
        }
        page.applyRedactions(false, mupdf.PDFPage.REDACT_IMAGE_NONE, mupdf.PDFPage.REDACT_LINE_ART_NONE, mupdf.PDFPage.REDACT_TEXT_REMOVE)
        // Verify the removal in isolation, even when replacement == original wording.
        assertGlyphs(paintedGlyphs(page).glyphs, remaining)
        insertReplacements(doc, page, analysis, prepared)
        expected.set(index, [...remaining, ...prepared.flatMap(p => p.glyphs)])
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
          try { assertGlyphs(paintedGlyphs(page).glyphs, glyphs) } finally { page.destroy() }
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
