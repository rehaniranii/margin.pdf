import * as mupdf from 'mupdf'
import type { ReplacementFont } from '../model/document'
import { isMatched } from '../model/fonts'
import type { Matrix, Point, Rect } from '../model/document'
import { pdfLiteral as literal, winAnsiCode } from '../model/text-encoding'
import { union } from '../geometry/affine'
import { paintedGlyphs } from './text-analysis'

// Bytes of the bundled matched fonts (Carlito, Caladea, Latin Modern), registered once by the PDF worker or by tests.
const files = new Map<string, Uint8Array>()

export function registerFontFile(name: ReplacementFont, bytes: Uint8Array) {
  if (!isMatched(name)) throw new Error(`${name} is not a bundled font.`)
  const font = new mupdf.Font(name, bytes)
  try { if (font.encodeCharacter('A') <= 0) throw new Error(`The ${name} font could not be read.`) } finally { font.destroy() }
  files.set(name, bytes)
}

export function openFont(name: ReplacementFont): mupdf.Font {
  if (!isMatched(name)) return new mupdf.Font(name)
  const bytes = files.get(name)
  if (!bytes) throw new Error(`The ${name.replace(/-.*/, '').replace('LatinModern', 'Latin Modern')} font is not available. Choose another font.`)
  return new mupdf.Font(name, bytes)
}

/** Embeds only the glyphs `text` uses, so a bundled font adds kilobytes, not megabytes, to the PDF. */
export function subsetFont(doc: mupdf.PDFDocument, font: mupdf.Font, text: string) {
  const scratch = new mupdf.PDFDocument()
  try {
    const ref = scratch.addSimpleFont(font), page = scratch.addPage([0, 0, 10, 10], 0, { Font: { F: ref } }, `BT /F 1 Tf ${literal(text)} Tj ET`)
    try { scratch.insertPage(-1, page); scratch.subsetFonts(); return doc.graftObject(ref) } finally { page.destroy(); ref.destroy() }
  } finally { scratch.destroy() }
}

/** A font resource for `text`: the standard fonts are referenced by name, bundled fonts are embedded as a subset. */
export function fontResource(doc: mupdf.PDFDocument, name: ReplacementFont, font: mupdf.Font, text: string) {
  return isMatched(name) ? subsetFont(doc, font, text) : doc.addSimpleFont(font)
}

// MuPDF only knows exact per-letter outlines for fonts it reads from a PDF; a font opened from a file reports its
// whole bounding box for every letter (11pt too wide for Carlito at 20pt). So measure each drawable letter of a
// bundled font once, by drawing it at 1000pt on a scratch page and reading the painted glyphs back.
const letterBoxes = new Map<string, Map<number, Rect>>()
const drawable = Array.from({ length: 0x180 }, (_, code) => String.fromCodePoint(code)).concat([...'€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ']).filter(char => char.trim() && winAnsiCode(char) !== undefined)
function boxesOf(name: ReplacementFont, font: mupdf.Font) {
  const cached = letterBoxes.get(name)
  if (cached) return cached
  const table = new Map<number, Rect>(), scratch = new mupdf.PDFDocument(), origin = (i: number): Point => [2000 + (i % 20) * 2000, 2000 + Math.floor(i / 20) * 2000]
  try {
    const ref = scratch.addSimpleFont(font), height = 2000 * (Math.ceil(drawable.length / 20) + 2)
    // Content in page coordinates (y down), as the editor uses them.
    const shows = drawable.map((char, i) => `1000 0 0 -1000 ${origin(i)[0]} ${origin(i)[1]} Tm ${literal(char)} Tj`).join(' ')
    const object = scratch.addPage([0, 0, 44000, height], 0, { Font: { F: ref } }, `1 0 0 -1 0 ${height} cm BT /F 1 Tf ${shows} ET`)
    try {
      scratch.insertPage(-1, object)
      const page = scratch.loadPage(0)
      try {
        for (const glyph of paintedGlyphs(page).glyphs) {
          const index = drawable.indexOf(String.fromCodePoint(glyph.unicode)), [x0, y0, x1, y1] = glyph.bounds
          if (index < 0 || x1 <= x0 || y1 <= y0) continue
          const [ox, oy] = origin(index)
          // Glyph space: 1 unit = 1 em, y up.
          table.set(glyph.unicode, [(x0 - ox) / 1000, -(y1 - oy) / 1000, (x1 - ox) / 1000, -(y0 - oy) / 1000])
        }
      } finally { page.destroy() }
    } finally { object.destroy(); ref.destroy() }
  } finally { scratch.destroy() }
  letterBoxes.set(name, table)
  return table
}

/** Ink bounds of `text` drawn in `font`: exact for the standard fonts and, via measured letters, for bundled ones. */
export function inkBounds(name: ReplacementFont, font: mupdf.Font, text: mupdf.Text): Rect {
  const exact = text.getBounds(null as unknown as mupdf.StrokeState, mupdf.Matrix.identity) as Rect
  if (!isMatched(name)) return exact
  const table = boxesOf(name, font)
  let ink: Rect | undefined
  text.walk({ showGlyph(_font, trm, _glyph, unicode) {
    const unit = table.get(unicode)
    if (unit) { const rect = mupdf.Rect.transform(unit, trm) as Rect; ink = ink ? union(ink, rect) : rect }
  } })
  return ink ?? exact
}

// Advance of a character as the PDF will place it. Standard fonts are not embedded, so viewers use their built-in
// metrics, which the font reports as is. For embedded fonts MuPDF writes /Widths as (int)(advance * 1000) in 32-bit
// floats: Carlito's 2048-unit widths lose their fractions, and Latin Modern Italic's 0.511 (0.51099998) becomes 510.
// Lay text out with exactly those widths, or glyphs drift from their planned positions along the line.
export function pdfAdvance(name: ReplacementFont, font: mupdf.Font, char: string) {
  const advance = font.advanceGlyph(font.encodeCharacter(char))
  return isMatched(name) ? Math.trunc(Math.fround(Math.fround(advance) * 1000)) / 1000 : advance
}


/**
 * Text laid out in several fonts (bold and italic parts of one line): one mupdf.Text per font, glyph by glyph with
 * the PDF's own widths. Call reset() between layout attempts and dispose() when done.
 */
export class StyledText {
  private texts = new Map<ReplacementFont, mupdf.Text>()
  private fonts = new Map<ReplacementFont, mupdf.Font>()
  font(name: ReplacementFont) { let font = this.fonts.get(name); if (!font) { font = openFont(name); this.fonts.set(name, font) } return font }
  advance(name: ReplacementFont, char: string) { return pdfAdvance(name, this.font(name), char) }
  /** Shows the segments from the matrix origin; returns the pen position after the last glyph. */
  show(matrix: Matrix, segments: { text: string; font: ReplacementFont }[]): Point {
    let pen = 0
    for (const segment of segments) {
      let text = this.texts.get(segment.font)
      if (!text) { text = new mupdf.Text(); this.texts.set(segment.font, text) }
      const font = this.font(segment.font)
      for (const char of segment.text) {
        text.showGlyph(font, [matrix[0], matrix[1], matrix[2], matrix[3], matrix[4] + pen * matrix[0], matrix[5] + pen * matrix[1]], font.encodeCharacter(char), char.codePointAt(0)!)
        pen += pdfAdvance(segment.font, font, char)
      }
    }
    return [matrix[4] + pen * matrix[0], matrix[5] + pen * matrix[1]]
  }
  ink(): Rect | undefined {
    let ink: Rect | undefined
    for (const [name, text] of this.texts) { const rect = inkBounds(name, this.font(name), text); if (rect[2] > rect[0]) ink = ink ? union(ink, rect) : rect }
    return ink
  }
  glyphs() {
    const glyphs: { unicode: number; origin: Point }[] = []
    for (const text of this.texts.values()) text.walk({ showGlyph(_font, matrix, _glyph, unicode) { glyphs.push({ unicode, origin: [matrix[4], matrix[5]] }) } })
    return glyphs
  }
  reset() { for (const text of this.texts.values()) text.destroy(); this.texts.clear() }
  dispose() { this.reset(); for (const font of this.fonts.values()) font.destroy(); this.fonts.clear() }
}

/** Consecutive characters of `text[start, end)` grouped by font. */
export function segmentsOf(text: string, fonts: ReplacementFont[], start: number, end: number) {
  const segments: { text: string; font: ReplacementFont }[] = []
  for (let i = start; i < end; i++) {
    const last = segments[segments.length - 1]
    if (last && last.font === fonts[i]) last.text += text[i]; else segments.push({ text: text[i], font: fonts[i] })
  }
  return segments
}
