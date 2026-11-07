import * as mupdf from 'mupdf'
export { DEFAULT_REPLACEMENT } from './sample-constants'

export const ORIGINAL_TEXT = 'Make room for a better idea.'
export const NEIGHBORS = ['A small document. A useful beginning.', 'Your original file stays unchanged.']
export const SAMPLE_RECT: mupdf.Rect = [56, 234, 480, 266]

export function pdfString(value: string): string {
  if (!/^[\x20-\x7e]+$/.test(value)) throw new Error('The sample proof supports printable English characters only. No characters were changed.')
  return `(${value.replace(/[\\()]/g, '\\$&')})`
}

export function createSample(): Uint8Array<ArrayBuffer> {
  const doc = new mupdf.PDFDocument()
  const font = new mupdf.Font('Helvetica')
  const bold = new mupdf.Font('Helvetica-Bold')
  try {
    const regularRef = doc.addSimpleFont(font)
    const boldRef = doc.addSimpleFont(bold)
    const resources = { Font: { F1: regularRef, F2: boldRef } }
    const text = (x: number, y: number, size: number, value: string, face = 'F1') => `BT /${face} ${size} Tf 1 0 0 1 ${x} ${792 - y} Tm ${pdfString(value)} Tj ET`
    const content = [
      'q 0.16 0.35 0.81 rg 56 718 30 4 re f Q',
      '0.13 0.18 0.28 rg', text(56, 104, 15, 'margin.pdf', 'F2'),
      text(56, 160, 34, 'A little room to edit.', 'F2'),
      '0.38 0.43 0.51 rg', text(56, 191, 12, NEIGHBORS[0]),
      // The tinted background must survive removal; a white cover would fail visually.
      'q 0.92 0.95 1 rg 48 512 516 60 re f Q',
      '0.13 0.18 0.28 rg', text(56, 258, 21, ORIGINAL_TEXT),
      text(56, 320, 12, 'This is real PDF text. Try replacing the blue-backed line.'),
      text(56, 341, 12, 'The preview is rendered from the resulting PDF.'),
      'q 0.79 0.83 0.88 RG 0.7 w 56 399 m 556 399 l S Q',
      text(56, 434, 15, 'A file that stays with you', 'F2'),
      '0.38 0.43 0.51 rg', text(56, 464, 12, NEIGHBORS[1]),
      text(56, 485, 12, 'Open, preview, and download on this device.'),
      text(56, 694, 10, 'Sample document / Generated locally / Page 1 of 2'),
    ].join('\n')
    const page = doc.addPage([0, 0, 612, 792], 0, resources, content)
    doc.insertPage(-1, page)
    page.destroy()
    const second = doc.addPage([0, 0, 612, 792], 0, resources, [
      '0.13 0.18 0.28 rg', text(56, 104, 15, 'margin.pdf', 'F2'),
      text(56, 170, 30, 'Space for what comes next.', 'F2'),
      text(56, 225, 12, 'This second page is here to test page navigation.'),
      text(56, 249, 12, 'Select a supported text region and make a small change.'),
      text(56, 694, 10, 'Sample document / Generated locally / Page 2 of 2'),
    ].join('\n'))
    doc.insertPage(-1, second)
    second.destroy()
    regularRef.destroy(); boldRef.destroy()
    const buffer = doc.saveToBuffer('garbage=4,compress')
    try { return buffer.asUint8Array().slice() } finally { buffer.destroy() }
  } finally { font.destroy(); bold.destroy(); doc.destroy() }
}
