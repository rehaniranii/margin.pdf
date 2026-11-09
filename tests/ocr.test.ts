import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import * as mupdf from 'mupdf'
import { Ocr, parseTsv } from '../src/engine/ocr'
import { PdfUtilities } from '../src/engine/pdf-utilities'
import { createSample } from '../src/engine/sample'
import { openPdf } from '../src/engine/mupdf-adapter'

const require = createRequire(import.meta.url)
const coreDir = require.resolve('tesseract.js-core/tesseract-core-simd-lstm.js').replace(/[^/]+$/, '')
const english = () => gunzipSync(readFileSync(require.resolve('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz')))

// A scan: the sample's first page rendered at 300 dpi and placed as an image-only page.
function scannedPdf() {
  const source = openPdf(createSample()), pix = source.loadPage(0).toPixmap(mupdf.Matrix.scale(300 / 72, 300 / 72), mupdf.ColorSpace.DeviceRGB, false, true)
  const doc = new mupdf.PDFDocument(), image = new mupdf.Image(pix), ref = doc.addImage(image)
  const page = doc.addPage([0, 0, 612, 792], 0, { XObject: { Scan: ref } }, 'q 612 0 0 792 0 0 cm /Scan Do Q'); doc.insertPage(-1, page)
  const buffer = doc.saveToBuffer('compress'); try { return { bytes: buffer.asUint8Array().slice(), png: pix.asPNG().slice() } } finally { buffer.destroy(); source.destroy() }
}

test('TSV parsing keeps only words with positive boxes and text', () => {
  assert.deepEqual(parseTsv('1\t1\t0\t0\t0\t0\t0\t0\t612\t792\t-1\t\n5\t1\t1\t1\t1\t1\t10\t20\t30\t40\t91.5\tHello\n5\t1\t1\t1\t1\t2\t0\t0\t0\t0\t95\t \n'), [{ text: 'Hello', left: 10, top: 20, width: 30, height: 40, confidence: 91.5 }])
})

test('OCR makes a scanned page searchable without changing how it looks, and redaction then blacks out the scanned word', async () => {
  const core = await require('tesseract.js-core/tesseract-core-simd-lstm.js')({ locateFile: (file: string) => coreDir + file })
  const ocr = new Ocr(core, english()), scan = scannedPdf(), tools = new PdfUtilities()
  try {
    tools.add('scan', 'pdf', scan.bytes.buffer)
    assert.deepEqual(tools.textless('scan'), [0])
    const scale = 72 / 300, words = ocr.recognize(scan.png).map(w => ({ text: w.text, box: [w.left * scale, w.top * scale, w.width * scale, w.height * scale] as [number, number, number, number] }))
    assert.ok(words.some(w => w.text === 'little'), JSON.stringify(words.slice(0, 8)))
    const result = tools.build({ kind: 'ocr', source: 'scan', pages: [{ page: 0, words }] })
    const before = openPdf(scan.bytes), after = openPdf(result.bytes)
    try {
      const hit = after.loadPage(0).search('little', {})[0]?.[0]
      assert.ok(hit, 'recognised word is searchable')
      const word = words.find(w => w.text === 'little')!.box
      assert.ok(Math.abs(hit[0] - word[0]) < 3 && Math.abs(hit[1] - word[1]) < 6, `search hit ${hit.slice(0, 2)} near the word ${word.slice(0, 2)}`)
      const look = (doc: mupdf.PDFDocument) => doc.loadPage(0).toPixmap(mupdf.Matrix.scale(.5, .5), mupdf.ColorSpace.DeviceRGB, false, true).getPixels()
      assert.deepEqual(look(after), look(before), 'the invisible text layer does not change the page')
    } finally { before.destroy(); after.destroy() }
    assert.deepEqual(tools.textless('scan'), [0], 'the source is untouched')
    assert.throws(() => tools.build({ kind: 'ocr', source: 'scan', pages: [{ page: 0, words: [{ text: 'x', box: [0, 0, -1, 5] }] }] }), /malformed/)

    tools.add('searchable', 'pdf', result.bytes.slice(0))
    assert.deepEqual(tools.textless('searchable'), [])
    const redacted = tools.build({ kind: 'redact', source: 'searchable', terms: ['little'], patterns: [], matchCase: true })
    const doc = openPdf(redacted.bytes)
    try {
      const word = words.find(w => w.text === 'little')!.box, page = doc.loadPage(0), pix = page.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false, true)
      const p = pix.getPixels(), at = (x: number, y: number) => { const i = (Math.round(y) * pix.getWidth() + Math.round(x)) * 3; return p[i] + p[i + 1] + p[i + 2] }
      assert.ok(at(word[0] + word[2] / 2, word[1] + word[3] / 2) < 60, 'scanned pixels under the redacted word are black')
      assert.equal(page.search('little', {}).length, 0)
    } finally { doc.destroy() }
  } finally { ocr.dispose(); tools.dispose() }
})
