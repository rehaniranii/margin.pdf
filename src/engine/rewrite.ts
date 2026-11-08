import * as mupdf from 'mupdf'
import type { CompressLevel, RedactPattern } from '../model/utilities'

/* Operations that rewrite one PDF in place (keeping its bookmarks, links and forms),
   instead of copying pages into a new document. */

// shortcut: fixed size/quality per level; expose a custom DPI/quality if users ask for finer control.
export const compressLevels: Record<Exclude<CompressLevel, 'lossless'>, { maxEdge: number; quality: number }> = {
  balanced: { maxEdge: 2200, quality: 80 },
  small: { maxEdge: 1400, quality: 60 },
}
export const compressSaveOptions = 'garbage=4,compress,compress-fonts,compress-images,objstms'

const name = (object: mupdf.PDFObject, key: string) => { const value = object.get(key); try { return value.isName() ? value.asName() : '' } finally { value.destroy() } }
const present = (object: mupdf.PDFObject, key: string) => { const value = object.get(key); try { return !value.isNull() } finally { value.destroy() } }

/** Re-encodes large 8-bit gray/RGB images as JPEG. Masked, transparent, indexed and CMYK images are left alone. Returns how many were replaced. */
export function recompressImages(doc: mupdf.PDFDocument, level: { maxEdge: number; quality: number }, progress?: (label: string) => void) {
  let replaced = 0
  const count = doc.countObjects()
  for (let num = 1; num < count; num++) {
    const object = doc.newIndirect(num)
    try {
      if (!object.isStream() || name(object, 'Subtype') !== 'Image') continue
      // Image masks are 1-bit, so the 8-bit check below also skips them.
      if (present(object, 'SMask') || present(object, 'Mask')) continue
      const bits = object.get('BitsPerComponent')
      try { if (!bits.isNumber() || bits.asNumber() !== 8) continue } finally { bits.destroy() }
      progress?.(`Compressing images (object ${num} of ${count})…`)
      const image = doc.loadImage(object)
      try {
        const space = image.getColorSpace()
        if (!space || space.isIndexed() || !(space.isGray() || space.isRGB())) continue
        const width = image.getWidth(), height = image.getHeight(), scale = Math.min(1, level.maxEdge / Math.max(width, height))
        const original = image.toPixmap()
        let pixmap = original
        try {
          const target = space.isGray() ? mupdf.ColorSpace.DeviceGray : mupdf.ColorSpace.DeviceRGB
          if (pixmap.getAlpha() || pixmap.getColorSpace()?.getName() !== target.getName()) pixmap = pixmap.convertToColorSpace(target, false)
          const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale))
          if (scale < 1) { const warped = pixmap.warp([[0, 0], [width, 0], [width, height], [0, height]], w, h); if (pixmap !== original) pixmap.destroy(); pixmap = warped }
          const jpeg = pixmap.asJPEG(level.quality)
          const raw = object.readRawStream()
          const before = raw.getLength(); raw.destroy()
          // Only swap when it is clearly smaller; recompressing an already-small JPEG only loses quality.
          if (jpeg.byteLength >= before * 0.9) continue
          object.writeRawStream(jpeg)
          object.put('Filter', doc.newName('DCTDecode'))
          object.put('ColorSpace', doc.newName(space.isGray() ? 'DeviceGray' : 'DeviceRGB'))
          object.put('Width', w); object.put('Height', h); object.put('BitsPerComponent', 8)
          object.delete('DecodeParms'); object.delete('Decode')
          replaced++
        } finally { if (pixmap !== original) pixmap.destroy(); original.destroy() }
      } finally { image.destroy() }
    } finally { object.destroy() }
  }
  return replaced
}

const patterns: Record<RedactPattern, string> = {
  email: String.raw`[\w.+-]+@[\w-]+(?:\.[\w-]+)+`,
  phone: String.raw`\+?\d[\d ().-]{6,}\d`,
}

/** One regex for every term and pattern. Spaces in a term also match line breaks, so a wrapped name is still found. */
export function redactionPattern(terms: string[], kinds: RedactPattern[], matchCase: boolean) {
  const parts = [...terms.map(term => term.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')), ...kinds.map(kind => patterns[kind])]
  return new RegExp(parts.map(part => `(?:${part})`).join('|'), matchCase ? 'g' : 'gi')
}

/** Finds matches on a page as lists of character quads. */
export function findOnPage(page: mupdf.Page, pattern: RegExp) {
  const text = page.toStructuredText('preserve-whitespace')
  let value = ''
  const quads: (mupdf.Quad | null)[] = []
  try {
    text.walk({
      onChar(c, _origin, _font, _size, quad) { value += c; for (let i = 0; i < c.length; i++) quads.push(i ? null : quad) },
      endLine() { value += '\n'; quads.push(null) },
    })
  } finally { text.destroy() }
  const hits: mupdf.Quad[][] = []
  for (const match of value.matchAll(pattern)) {
    const found = quads.slice(match.index, match.index + match[0].length).filter((quad): quad is mupdf.Quad => !!quad)
    if (found.length) hits.push(found)
  }
  return hits
}

/** Removes matching text from page content (not just covering it) and draws black boxes. Returns matches and affected pages. */
export function redactText(doc: mupdf.PDFDocument, pattern: RegExp, progress?: (label: string) => void) {
  let matches = 0
  const pages: number[] = []
  for (let index = 0; index < doc.countPages(); index++) {
    progress?.(`Finding matches on page ${index + 1} of ${doc.countPages()}…`)
    const page = doc.loadPage(index)
    try {
      const existing = page.getAnnotations().filter(annotation => annotation.getType() === 'Redact')
      if (existing.length) throw new Error(`Page ${index + 1} already has redaction marks from another program. Apply or remove them there first, so nothing is redacted that you did not choose.`)
      const hits = findOnPage(page, pattern)
      if (!hits.length) continue
      for (const quads of hits) {
        const annotation = page.createAnnotation('Redact')
        try { annotation.setQuadPoints(quads) } finally { annotation.destroy() }
      }
      page.applyRedactions(true, mupdf.PDFPage.REDACT_IMAGE_PIXELS, mupdf.PDFPage.REDACT_LINE_ART_NONE, mupdf.PDFPage.REDACT_TEXT_REMOVE)
      matches += hits.length; pages.push(index)
    } finally { page.destroy() }
  }
  return { matches, pages }
}
