import * as mupdf from 'mupdf'
import type { Rect } from '../src/model/document'

export function fixture(options: { rotation?: mupdf.Rotate; crop?: Rect; userUnit?: number; extra?: string; content?: string; pages?: number; sharedForm?: boolean; annotation?: 'Link' | 'Redact' } = {}) {
  const doc = new mupdf.PDFDocument()
  const font = new mupdf.Font('Helvetica')
  try {
    const ref = doc.addSimpleFont(font)
    const content = options.content ?? `q 0.9 0.95 1 rg 70 345 230 45 re f Q
BT /F 20 Tf 1 0 0 1 80 360 Tm (Original editable line) Tj ET
BT /F 12 Tf 1 0 0 1 80 300 Tm (Nearby content stays.) Tj ET
${options.extra ?? ''}`
    const form = options.sharedForm ? doc.addStream(content, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 400, 500], Resources: { Font: { F: ref } } }) : undefined
    for (let i = 0; i < (options.pages ?? 1); i++) {
      const page = doc.addPage([0, 0, 400, 500], options.rotation ?? 0, form ? { XObject: { Shared: form } } : { Font: { F: ref } }, form ? 'q /Shared Do Q' : content)
      if (options.crop) page.put('CropBox', options.crop)
      if (options.userUnit) page.put('UserUnit', options.userUnit)
      doc.insertPage(-1, page); page.destroy()
    }
    if (options.annotation) {
      const page = doc.loadPage(0)
      if (options.annotation === 'Link') {
        const link = page.createLink([80, 120, 280, 150], 'https://example.invalid')
        link.destroy()
      } else {
        const annotation = page.createAnnotation('Redact'); annotation.setRect([10, 10, 20, 20]); annotation.destroy()
      }
      page.destroy()
    }
    const bytes = doc.saveToBuffer('garbage=4,compress')
    try { return bytes.asUint8Array().slice() } finally { bytes.destroy() }
  } finally { font.destroy(); doc.destroy() }
}
