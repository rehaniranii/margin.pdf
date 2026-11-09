import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as mupdf from 'mupdf'
import { fixture } from './fixtures'
import { openPdf, render } from '../src/engine/mupdf-adapter'
import { analyzePage, paintedGlyphs } from '../src/engine/text-analysis'
import { compileTextEdits } from '../src/engine/text-edit'
import { EditorSession } from '../src/engine/editor-session'
import { transformPoint, contains } from '../src/geometry/affine'
import type { TextEdit } from '../src/model/document'

const edit: TextEdit = { type: 'replace-text', page: 0, regionId: '0:0', text: 'Revised line', font: 'Helvetica', size: 20, color: '#2859cf' }

test('the selected original is absent from rewritten decoded PDF streams, rather than hidden under an overlay', () => {
  const doc = openPdf(compileTextEdits(fixture(), [edit]))
  try {
    let streams = ''
    for (let index = 1; index < doc.countObjects(); index++) {
      const object = doc.newIndirect(index)
      try { if (object.isStream()) { const buffer = object.readStream(); try { streams += buffer.asString() } finally { buffer.destroy() } } }
      finally { object.destroy() }
    }
    assert.ok(!streams.includes('Original editable line'))
    assert.ok(streams.includes('Revised line'))
    assert.ok(streams.includes('Nearby content stays.'))
  } finally { doc.destroy() }
})

function changedPixels(source: Uint8Array, output: Uint8Array, pageIndex: number, allowed?: mupdf.Rect) {
  const before = openPdf(source); const after = openPdf(output)
  const p1 = before.loadPage(pageIndex); const p2 = after.loadPage(pageIndex)
  const a = p1.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false)
  const b = p2.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false)
  try {
    assert.equal(a.getWidth(), b.getWidth()); assert.equal(a.getHeight(), b.getHeight())
    const left = a.getPixels(); const right = b.getPixels(); let changes = 0
    for (let y = 0; y < a.getHeight(); y++) for (let x = 0; x < a.getWidth(); x++) for (let c = 0; c < 3; c++) {
      const offset = (y * a.getWidth() + x) * 3 + c
      if (left[offset] !== right[offset]) {
        changes++
        assert.ok(allowed && x >= allowed[0] - 2 && x <= allowed[2] + 2 && y >= allowed[1] - 2 && y <= allowed[3] + 2, `Unexpected pixel change: ${x},${y}`)
      }
    }
    return changes
  } finally { a.destroy(); b.destroy(); p1.destroy(); p2.destroy(); before.destroy(); after.destroy() }
}

for (const rotation of [0, 90, 180, 270] as const) for (const userUnit of [1, 2]) {
  test(`edits rotated ${rotation}°, cropped, UserUnit ${userUnit} page at the correct position without changing nearby pixels`, () => {
    const source = fixture({ rotation, crop: [40, 50, 380, 470], userUnit })
    const snapshot = source.slice()
    const before = openPdf(source)
    const analysis = analyzePage(before, 0)
    const region = analysis.view.regions[0]
    assert.equal(region.unsupported, undefined)
    const expected = transformPoint([80, 360], analysis.pdfToPage)
    assert.deepEqual(region.origin, expected, 'getTransform maps PDF user coordinates into displayed page points')
    const output = compileTextEdits(source, [{ ...edit, size: region.fontSize }])
    assert.deepEqual(source, snapshot)
    const after = openPdf(output)
    try {
      const page = after.loadPage(0); const text = page.toStructuredText('')
      try {
        assert.ok(!text.asText().includes('Original editable line'))
        assert.ok(text.asText().includes('Nearby content stays.'))
        assert.ok(text.search('Revised line', {}).length)
      } finally { text.destroy(); page.destroy() }
      const newRegion = analyzePage(after, 0).view.regions.find(line => line.text === 'Revised line')!
      assert.ok(Math.hypot(newRegion.origin[0] - expected[0], newRegion.origin[1] - expected[1]) < 0.04)
      assert.ok(contains(region.bounds, newRegion.bounds, 0.1))
      assert.equal(newRegion.color, '#2859cf')
      assert.ok(changedPixels(source, output, 0, region.bounds) > 0)
    } finally { before.destroy(); after.destroy() }
  })
}

test('removal is complete even if the same words occur elsewhere; shared Form/resources and other pages survive', () => {
  const source = fixture({ pages: 2, sharedForm: true })
  const output = compileTextEdits(source, [edit])
  const doc = openPdf(output)
  try {
    const first = analyzePage(doc, 0).view
    const second = analyzePage(doc, 1).view
    assert.ok(first.regions.some(region => region.text === edit.text))
    assert.ok(!first.regions.some(region => region.text === 'Original editable line'))
    assert.ok(second.regions.some(region => region.text === 'Original editable line'))
    assert.equal(changedPixels(source, output, 1), 0)
  } finally { doc.destroy() }
})

test('rejects unsupported characters, unfit text, invalid styles and overlapping source without changing the document', () => {
  const source = fixture()
  for (const invalid of [{ text: 'Łódź' }, { text: 'नमस्ते' }, { text: '😀' }, { text: 'two\nlines' }, { text: 'W'.repeat(100) }, { size: 80 }, { size: NaN }, { color: 'red' }, { font: 'Imaginary' }]) {
    assert.throws(() => compileTextEdits(source, [{ ...edit, ...invalid } as TextEdit]))
  }
  const overlap = fixture({ extra: 'BT /F 15 Tf 1 0 0 1 100 355 Tm (Overlapping) Tj ET' })
  const doc = openPdf(overlap)
  try {
    const analysis = analyzePage(doc, 0)
    assert.ok(analysis.view.regions[0].unsupported)
    assert.throws(() => compileTextEdits(overlap, [edit]))
  } finally { doc.destroy() }
})

for (const [name, content] of [
  ['skewed', 'BT /F 20 Tf 1 0.2 0 1 80 360 Tm (Skewed line) Tj ET'],
  ['vertical source', 'BT /F 20 Tf 0 1 -1 0 80 100 Tm (Vertical line) Tj ET'],
  ['clipped', 'q 80 350 100 40 re W n BT /F 20 Tf 1 0 0 1 80 360 Tm (Clipped line) Tj ET Q'],
  ['typographic area crossing a clip', 'q 70 350 250 28 re W n BT /F 20 Tf 1 0 0 1 80 360 Tm (Original editable line) Tj ET Q'],
  ['invisible', 'BT /F 20 Tf 3 Tr 1 0 0 1 80 360 Tm (Hidden line) Tj ET'],
] as const) test(`${name} content cannot be silently replaced`, () => {
  const source = fixture({ content })
  const doc = openPdf(source)
  try { assert.ok(analyzePage(doc, 0).view.regions.every(region => region.unsupported)) }
  finally { doc.destroy() }
})

test('mixed-style text is split into separate positioned spans, never silently unified', () => {
  const source = fixture({ content: 'BT /F 20 Tf 1 0 0 1 80 360 Tm (Mixed ) Tj /F 12 Tf (sizes) Tj ET' })
  const doc = openPdf(source)
  try { const regions = analyzePage(doc, 0).view.regions; assert.equal(regions.length, 2); assert.equal(regions[0].fontSize, 20); assert.equal(regions[1].fontSize, 12) }
  finally { doc.destroy() }
})

test('empty/scanned-like pages and overlapping annotations have explicit unsupported states', () => {
  const empty = openPdf(fixture({ content: 'q 0.9 g 20 20 300 400 re f Q' }))
  try { const result = analyzePage(empty, 0).view; assert.equal(result.regions.length, 0); assert.match(result.message!, /scanned/) } finally { empty.destroy() }
  for (const annotation of ['Link', 'Redact'] as const) {
    const doc = openPdf(fixture({ annotation }))
    try { assert.ok(analyzePage(doc, 0).view.regions[0].unsupported) } finally { doc.destroy() }
  }
})

test('each replacement font is searchable, PDF delimiters are escaped, and empty text deletes the line', () => {
  const source = fixture()
  for (const font of ['Helvetica', 'Times-Roman', 'Courier'] as const) {
    const output = compileTextEdits(source, [{ ...edit, text: '(Draft) \\ 2', font, size: 15 }])
    const doc = openPdf(output)
    try { assert.ok(analyzePage(doc, 0).view.regions.some(region => region.text === '(Draft) \\ 2')) } finally { doc.destroy() }
  }
  const doc = openPdf(compileTextEdits(source, [{ ...edit, text: '' }]))
  try { assert.equal(analyzePage(doc, 0).view.regions.length, 1) } finally { doc.destroy() }
})

test('exported replacement text can be reopened and edited again', () => {
  const first = compileTextEdits(fixture(), [edit])
  const doc = openPdf(first)
  let regionId: string
  try { const region = analyzePage(doc, 0).view.regions.find(region => region.text === edit.text)!; assert.equal(region.unsupported, undefined); regionId = region.id }
  finally { doc.destroy() }
  const second = openPdf(compileTextEdits(first, [{ ...edit, regionId, text: 'Again' }]))
  try { const text = analyzePage(second, 0).view.regions.map(region => region.text).join(' '); assert.ok(text.includes('Again')); assert.ok(!text.includes('Revised line')) }
  finally { second.destroy() }
})

test('style-only changes replace rather than duplicate the original wording', () => {
  const output = compileTextEdits(fixture(), [{ ...edit, text: 'Original editable line', font: 'Courier', size: 10 }])
  const doc = openPdf(output)
  try {
    const analysis = analyzePage(doc, 0).view
    const matching = analysis.regions.filter(region => region.text === 'Original editable line')
    assert.equal(matching.length, 1)
    assert.equal(matching[0].fontName, 'Courier'); assert.equal(matching[0].fontSize, 10); assert.equal(matching[0].color, '#2859cf')
  } finally { doc.destroy() }
})

test('a foreground graphic intersecting the text is view-only', () => {
  const doc = openPdf(fixture({ extra: 'q 0.5 g 80 356 200 4 re f Q' }))
  try { assert.match(analyzePage(doc, 0).view.regions[0].unsupported!, /graphic/) }
  finally { doc.destroy() }
})

test('history is transactional, branches after undo, and preview/export agree byte for byte', () => {
  const session = new EditorSession(fixture({ pages: 2 }))
  try {
    const initial = session.view(0, 1, 1)
    const sourceBytes = session.export()
    assert.throws(() => session.apply(edit, 0, 1), /dimensions/)
    assert.deepEqual(session.export(), sourceBytes, 'a render failure after compilation must not commit the PDF')
    assert.equal(session.view(0, 1, 1).canUndo, false)
    const changed = session.apply(edit, 1, 1)
    assert.equal(changed.canUndo, true); assert.equal(changed.revision, 1)
    const download = session.export()
    const exported = openPdf(download)
    try { assert.deepEqual(render(exported, 0, 1, 1).png, changed.image.png) } finally { exported.destroy() }
    assert.throws(() => session.apply({ ...edit, text: '😀' }, 1, 1))
    assert.deepEqual(session.export(), download, 'a failed edit never changes export')
    const undone = session.undo(0, 1, 1)
    assert.deepEqual(undone.image.png, initial.image.png); assert.equal(undone.canRedo, true)
    const redone = session.redo(0, 1, 1)
    assert.deepEqual(redone.image.png, changed.image.png)
    session.undo(0, 1, 1)
    const branch = session.apply({ ...edit, text: 'Branch' }, 1, 1)
    assert.equal(branch.canRedo, false)
    assert.throws(() => session.redo(0, 1, 1))
    const multiple = session.apply({ ...edit, page: 1, regionId: '1:0', text: 'Second page' }, 1, 1)
    assert.equal(multiple.edits.length, 2)
    const doc = openPdf(session.export())
    try { assert.ok(analyzePage(doc, 0).view.regions.some(region => region.text === 'Branch')); assert.ok(analyzePage(doc, 1).view.regions.some(region => region.text === 'Second page')) } finally { doc.destroy() }
  } finally { session.dispose() }
})

test('accented Latin replacements are written in WinAnsi, extract back exactly, and editing an accented original works', () => {
  const accented = 'Café “déjà” – €5 ñØ'
  const doc = openPdf(compileTextEdits(fixture(), [{ ...edit, text: accented, size: 14 }]))
  try { assert.ok(analyzePage(doc, 0).view.regions.some(region => region.text === accented)) } finally { doc.destroy() }
  // Every WinAnsi character has a glyph in each of the 12 replacement fonts, so nothing renders as a blank.
  for (const name of ['Helvetica', 'Helvetica-BoldOblique', 'Times-Roman', 'Times-BoldItalic', 'Courier', 'Courier-Bold']) {
    const font = new mupdf.Font(name)
    try { for (const char of 'éüñçøßÀÆ€“”‘’–—…™Œœ') assert.ok(font.encodeCharacter(char) > 0, `${name} ${char}`) } finally { font.destroy() }
  }
  const second = openPdf(compileTextEdits(fixture({ content: 'BT /F 20 Tf 1 0 0 1 80 360 Tm (Caf\\351 cr\\350me) Tj ET' }), [{ ...edit, text: 'Thé noir' }]))
  try { assert.ok(analyzePage(second, 0).view.regions.some(region => region.text === 'Thé noir')) } finally { second.destroy() }
})
