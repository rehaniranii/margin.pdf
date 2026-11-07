import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as mupdf from 'mupdf'
import { createSample, ORIGINAL_TEXT, DEFAULT_REPLACEMENT } from '../src/engine/sample'
import { inspect, openPdf, render, replaceSampleText } from '../src/engine/mupdf-adapter'

function decodedStreams(bytes: Uint8Array) {
  const doc = openPdf(bytes)
  const streams: string[] = []
  try {
    for (let index = 1; index < doc.countObjects(); index++) {
      const obj = doc.newIndirect(index)
      try {
        if (obj.isStream()) {
          const buffer = obj.readStream()
          try { streams.push(buffer.asString()) } finally { buffer.destroy() }
        }
      } finally { obj.destroy() }
    }
    return streams.join('\n')
  } finally { doc.destroy() }
}

test('removes the selected original from decoded content and inserts extractable PDF text', () => {
  const source = createSample()
  const snapshot = source.slice()
  assert.ok(decodedStreams(source).includes(ORIGINAL_TEXT))
  const result = replaceSampleText(source, DEFAULT_REPLACEMENT)
  assert.deepEqual(source, snapshot, 'source bytes remain unchanged')
  assert.deepEqual(result.report, { originalRemoved: true, replacementExtractable: true, neighborsPreserved: true })
  const streams = decodedStreams(result.bytes)
  assert.ok(!streams.includes(ORIGINAL_TEXT), 'removed even from decoded, garbage-collected streams')
  assert.ok(streams.includes(DEFAULT_REPLACEMENT))
  const doc = openPdf(result.bytes)
  try {
    assert.equal(doc.countPages(), 2)
    assert.ok(inspect(doc).text.includes(DEFAULT_REPLACEMENT))
    const page = doc.loadPage(0)
    const text = page.toStructuredText('')
    try { assert.ok(text.search(DEFAULT_REPLACEMENT, {}).length > 0, 'replacement is searchable') }
    finally { text.destroy(); page.destroy() }
  } finally { doc.destroy() }
})

test('preserves every rendered pixel outside the target line, including its background and the second page', () => {
  const source = createSample()
  const result = replaceSampleText(source, DEFAULT_REPLACEMENT)
  const before = openPdf(source)
  const after = openPdf(result.bytes)
  try {
    for (let index = 0; index < 2; index++) {
      const p1 = before.loadPage(index); const p2 = after.loadPage(index)
      const a = p1.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false)
      const b = p2.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false)
      try {
        const left = a.getPixels(); const right = b.getPixels()
        assert.equal(left.length, right.length)
        let changed = 0
        for (let y = 0; y < a.getHeight(); y++) for (let x = 0; x < a.getWidth(); x++) {
          const offset = (y * a.getWidth() + x) * 3
          for (let c = 0; c < 3; c++) {
            if (left[offset + c] !== right[offset + c]) {
              changed++
              assert.ok(index === 0 && x >= 55 && x <= 481 && y >= 233 && y <= 267, `unexpected change at page ${index}, ${x}, ${y}`)
            }
          }
        }
        assert.equal(changed > 0, index === 0)
      } finally { a.destroy(); b.destroy(); p1.destroy(); p2.destroy() }
    }
  } finally { before.destroy(); after.destroy() }
})

test('rejects unsupported characters and overflow before mutation', () => {
  const sample = createSample()
  for (const text of ['Café', 'नमस्ते', '😀', 'line\nbreak', '', 'W'.repeat(100)]) {
    assert.throws(() => replaceSampleText(sample, text))
  }
  const doc = openPdf(sample)
  try { assert.ok(inspect(doc).text.includes(ORIGINAL_TEXT)) } finally { doc.destroy() }
})

test('escapes PDF delimiters and renders the exported result', () => {
  const result = replaceSampleText(createSample(), 'Ideas (revised) \\ draft')
  const doc = openPdf(result.bytes)
  try {
    assert.ok(inspect(doc).text.includes('Ideas (revised) \\ draft'))
    const image = render(doc, 0, 1, 2)
    assert.equal(image.width, 1224)
    assert.deepEqual([...new Uint8Array(image.png).slice(0, 4)], [137, 80, 78, 71])
  } finally { doc.destroy() }
})
