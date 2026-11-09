import * as mupdf from 'mupdf'
import { boundedScale } from '../geometry/page'
import type { DocumentInfo, ProofReport, RenderedPage } from '../model/document'
import { NEIGHBORS, ORIGINAL_TEXT, SAMPLE_RECT, pdfString } from './sample'

export function openPdf(bytes: ArrayBuffer | Uint8Array): mupdf.PDFDocument {
  const document = new mupdf.PDFDocument(bytes)
  try {
    document.disableJS()
    if (document.needsPassword()) throw new Error('This PDF is password-protected. Remove the password with the Unlock tool first.')
    if (!document.countPages()) throw new Error('This PDF has no pages to display.')
    return document
  } catch (error) { document.destroy(); throw error }
}

export function inspect(document: mupdf.PDFDocument, index = 0): DocumentInfo {
  const page = document.loadPage(index)
  try {
    const text = page.toStructuredText('')
    try { return { pageCount: document.countPages(), bounds: page.getBounds(), text: text.asText() } }
    finally { text.destroy() }
  } finally { page.destroy() }
}

export function render(document: mupdf.PDFDocument, index: number, scale: number, dpr: number): RenderedPage {
  const page = document.loadPage(index)
  try {
    const bounds = page.getBounds()
    const factor = boundedScale(bounds, scale, dpr)
    const pixmap = page.toPixmap(mupdf.Matrix.scale(factor, factor), mupdf.ColorSpace.DeviceRGB, false, true)
    try { return { png: pixmap.asPNG().slice().buffer, width: pixmap.getWidth(), height: pixmap.getHeight(), bounds, rasterScale: factor, pixelOrigin: [pixmap.getX(), pixmap.getY()] } }
    finally { pixmap.destroy() }
  } finally { page.destroy() }
}

// This intentionally proves one controlled line only. General selection and overlap
// analysis belong to Phase 2. Callers may only pass our freshly generated sample.
export function replaceSampleText(source: Uint8Array, replacement: string): { bytes: Uint8Array<ArrayBuffer>; report: ProofReport } {
  const literal = pdfString(replacement)
  if (replacement.includes(ORIGINAL_TEXT)) throw new Error('Use different text so removal can be verified.')
  const font = new mupdf.Font('Helvetica')
  try {
    const width = [...replacement].reduce((sum, char) => sum + font.advanceGlyph(font.encodeCharacter(char)) * 21, 0)
    if (width > 424) throw new Error('This text is too long for the sample line. Shorten it to keep the fixed layout.')
    const doc = openPdf(source)
    try {
      const page = doc.loadPage(0)
      try {
        const annotation = page.createAnnotation('Redact')
        try {
          annotation.setRect(SAMPLE_RECT)
          // No opaque cover; leave images and vectors untouched, remove intersecting text.
          page.applyRedactions(false, mupdf.PDFPage.REDACT_IMAGE_NONE, mupdf.PDFPage.REDACT_LINE_ART_NONE, mupdf.PDFPage.REDACT_TEXT_REMOVE)
        } finally { annotation.destroy() }
        const object = page.getObject()
        const resources = object.getInheritable('Resources')
        const fonts = resources.get('Font')
        const fontRef = doc.addSimpleFont(font)
        fonts.put('MarginReplacement', fontRef)
        const contents = object.get('Contents')
        const streams = doc.newArray()
        if (contents.isArray()) contents.forEach(stream => streams.push(stream))
        else if (!contents.isNull()) streams.push(contents)
        const extra = doc.addStream(`q BT /MarginReplacement 21 Tf 0.13 0.18 0.28 rg 1 0 0 1 56 534 Tm ${literal} Tj ET Q`, {})
        streams.push(extra)
        object.put('Contents', streams)
        extra.destroy(); streams.destroy(); contents.destroy(); fontRef.destroy(); fonts.destroy(); resources.destroy(); object.destroy()
      } finally { page.destroy() }
      const output = doc.saveToBuffer('garbage=4,compress')
      try {
        const bytes = output.asUint8Array().slice()
        const reopened = openPdf(bytes)
        try {
          const actual = inspect(reopened).text
          const report = { originalRemoved: !actual.includes(ORIGINAL_TEXT), replacementExtractable: actual.includes(replacement), neighborsPreserved: NEIGHBORS.every(text => actual.includes(text)) }
          if (!Object.values(report).every(Boolean)) throw new Error('Output verification failed. The sample was not changed.')
          return { bytes, report }
        } finally { reopened.destroy() }
      } finally { output.destroy() }
    } finally { doc.destroy() }
  } finally { font.destroy() }
}
