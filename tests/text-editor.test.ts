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
  ['mirrored', 'BT /F 20 Tf -1 0 0 1 300 360 Tm (Mirrored line) Tj ET'],
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
  for (const annotation of ['Redact'] as const) {
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

test('a bold run followed by a normal run that starts with a space can be edited (Chrome/Word style mixed lines)', () => {
  // The normal run's leading space starts exactly where the bold text ends, inside the removal area.
  const doc = new mupdf.PDFDocument(), bold = new mupdf.Font('Helvetica-Bold'), regular = new mupdf.Font('Helvetica')
  const width = [...'Bold heading line'].reduce((sum, c) => sum + bold.advanceGlyph(bold.encodeCharacter(c)) * 12, 0)
  const page = doc.addPage([0, 0, 400, 200], 0, { Font: { B: doc.addSimpleFont(bold), R: doc.addSimpleFont(regular) } },
    `BT /B 12 Tf 1 0 0 1 40 120 Tm (Bold heading line) Tj ET BT /R 12 Tf 1 0 0 1 ${40 + width} 120 Tm ( followed by normal text.) Tj ET`)
  doc.insertPage(-1, page)
  const buffer = doc.saveToBuffer('compress'), source = buffer.asUint8Array().slice()
  const original = openPdf(source), region = analyzePage(original, 0).view.regions.find(r => r.text === 'Bold heading line')!
  assert.ok(region && !region.unsupported, 'the bold run is its own editable region')
  const output = openPdf(compileTextEdits(source, [{ ...edit, regionId: region.id, text: 'Bold title', size: 12, font: 'Helvetica-Bold' }]))
  try {
    const text = analyzePage(output, 0).view.regions.map(r => r.text).join(' | ')
    assert.match(text, /Bold title/); assert.match(text, /followed by normal text\./)
    // The neighbouring run is pixel-identical: compare the area right of the edited text.
    const crop = (d: mupdf.PDFDocument) => { const pix = d.loadPage(0).toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false, true); const p = pix.getPixels(), w = pix.getWidth(), out: number[] = []; for (let y = 60; y < 95; y++) for (let x = Math.ceil(40 + width) + 2; x < 390; x++) out.push(p[(y * w + x) * 3]); return out }
    assert.deepEqual(crop(output), crop(original))
  } finally { output.destroy(); original.destroy(); buffer.destroy() }
})

test('text under a web link is editable; the link follows the new text and can point somewhere new', () => {
  const linked = (rect: mupdf.Rect, uri = 'https://old.example/profile') => {
    const doc = openPdf(fixture())
    try { const page = doc.loadPage(0); try { page.createLink(rect, uri).destroy() } finally { page.destroy() }; const out = doc.saveToBuffer(''); try { return out.asUint8Array().slice() } finally { out.destroy() } } finally { doc.destroy() }
  }
  const source = linked([75, 115, 330, 150])
  const doc = openPdf(source)
  try { const region = analyzePage(doc, 0).view.regions[0]; assert.equal(region.unsupported, undefined); assert.equal(region.link, 'https://old.example/profile') } finally { doc.destroy() }
  const output = openPdf(compileTextEdits(source, [{ ...edit, text: 'new.example/me', link: 'https://new.example/me' }]))
  try {
    const page = output.loadPage(0)
    try {
      const links = page.getLinks()
      assert.deepEqual(links.map(link => link.getURI()), ['https://new.example/me'])
      const region = analyzePage(output, 0).view.regions.find(r => r.text === 'new.example/me')!
      assert.ok(contains(region.bounds, links[0].getBounds(), 1))
      links.forEach(link => link.destroy())
    } finally { page.destroy() }
  } finally { output.destroy() }
  // Keeping the text but dropping it removes the link; unsafe targets and partial links are refused.
  const removed = openPdf(compileTextEdits(source, [{ ...edit, text: '' }]))
  try { const page = removed.loadPage(0); try { assert.equal(page.getLinks().length, 0) } finally { page.destroy() } } finally { removed.destroy() }
  assert.throws(() => compileTextEdits(source, [{ ...edit, link: 'javascript:alert(1)' }]), /https:\/\//)
  // A link over only part of the line does not block editing; it stays exactly where it was.
  const partialSource = linked([75, 115, 150, 150])
  const partial = openPdf(compileTextEdits(partialSource, [edit]))
  try {
    const page = partial.loadPage(0)
    try { const links = page.getLinks(); assert.deepEqual(links.map(link => [link.getURI(), link.getBounds()]), [['https://old.example/profile', [75, 115, 150, 150]]]); links.forEach(link => link.destroy()) } finally { page.destroy() }
  } finally { partial.destroy() }
})

// One-page PDF with a single Helvetica line, built from a custom font dictionary.
function customFontPdf(font: Record<string, unknown>, content: string, extra: (doc: mupdf.PDFDocument) => Record<string, unknown> = () => ({})) {
  const doc = new mupdf.PDFDocument()
  try {
    const ref = doc.addObject({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', ...font, ...extra(doc) })
    const page = doc.addPage([0, 0, 400, 500], 0, { Font: { F: ref } }, content)
    doc.insertPage(-1, page); page.destroy()
    const out = doc.saveToBuffer(''); try { return out.asUint8Array().slice() } finally { out.destroy() }
  } finally { doc.destroy() }
}

test('a single glyph mapped to two letters (an "fi" ligature, as LaTeX writes it) stays editable', () => {
  const source = customFontPdf({ Encoding: { Type: 'Encoding', Differences: [1, 'fi'] } }, 'BT /F 20 Tf 1 0 0 1 80 360 Tm (pro\\001le) Tj ET',
    doc => ({ ToUnicode: doc.addStream('/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /X def 1 begincodespacerange <00> <FF> endcodespacerange 1 beginbfchar <01> <00660069> endbfchar endcmap CMapName currentdict /CMap defineresource pop end end', {}) }))
  const doc = openPdf(source)
  try { const region = analyzePage(doc, 0).view.regions[0]; assert.equal(region.text, 'profile'); assert.equal(region.unsupported, undefined) } finally { doc.destroy() }
  const output = openPdf(compileTextEdits(source, [{ ...edit, text: 'prose', size: 20 }]))
  try { assert.deepEqual(analyzePage(output, 0).view.regions.map(r => r.text), ['prose']) } finally { output.destroy() }
})

test('identical text fits even when the original font declares short descenders (Computer Modern-like)', () => {
  const source = customFontPdf({ Encoding: 'WinAnsiEncoding' }, 'BT /F 20 Tf 1 0 0 1 80 360 Tm (codeforces profile) Tj ET',
    doc => ({ FontDescriptor: doc.addObject({ Type: 'FontDescriptor', FontName: 'Helvetica', Flags: 32, FontBBox: [0, -60, 1000, 700], ItalicAngle: 0, Ascent: 700, Descent: -60, CapHeight: 700, StemV: 80 }) }))
  const output = openPdf(compileTextEdits(source, [{ ...edit, text: 'codeforces profile', font: 'Times-Roman', size: 20 }]))
  try { assert.ok(analyzePage(output, 0).view.regions.some(r => r.text === 'codeforces profile')) } finally { output.destroy() }
})

for (const [name, content, text, clip] of [
  ['clipped', 'q 80 350 100 40 re W n BT /F 20 Tf 1 0 0 1 80 360 Tm (Clipped line) Tj ET Q', 'Clipped line', [80, 110, 180, 150]],
  ['a text box clip that letter tails cross', 'q 70 350 250 28 re W n BT /F 20 Tf 1 0 0 1 80 360 Tm (Original editable line) Tj ET Q', 'Original editable line', [70, 122, 320, 150]],
] as const) test(`${name}: the replacement is clipped by the same rectangle`, () => {
  const source = fixture({ content })
  const doc = openPdf(source)
  let region
  try { region = analyzePage(doc, 0).view.regions.find(r => r.text.startsWith(text.slice(0, 7)))! } finally { doc.destroy() }
  assert.equal(region.unsupported, undefined)
  // A recoloured replacement changes pixels only inside the original clip (page coordinates), never outside it.
  const output = compileTextEdits(source, [{ ...edit, regionId: region.id, text: region.text }])
  assert.ok(changedPixels(source, output, 0, [...clip] as mupdf.Rect) > 0)
})

test('text turned by 90° inside the page is edited in place, along its own direction', () => {
  const source = fixture({ content: 'BT /F 20 Tf 0 1 -1 0 80 100 Tm (Vertical line) Tj ET' })
  const doc = openPdf(source)
  let region
  try { region = analyzePage(doc, 0).view.regions[0] } finally { doc.destroy() }
  assert.equal(region.text, 'Vertical line'); assert.equal(region.unsupported, undefined)
  const output = compileTextEdits(source, [{ ...edit, regionId: region.id, text: 'Turned line' }])
  // Every changed pixel stays inside the original line's area (page coordinates, ±2px).
  assert.ok(changedPixels(source, output, 0, region.bounds) > 0)
  const after = openPdf(output)
  try { assert.ok(analyzePage(after, 0).view.regions.some(r => r.text === 'Turned line')) } finally { after.destroy() }
})

const regionsOf = (bytes: Uint8Array) => { const doc = openPdf(bytes); try { return analyzePage(doc, 0).view.regions } finally { doc.destroy() } }
const toUnicode = (doc: mupdf.PDFDocument, hex: string) => doc.addStream(`/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /X def 1 begincodespacerange <00> <FF> endcodespacerange 2 beginbfchar <01> <${hex}> <20> <0020> endbfchar endcmap CMapName currentdict /CMap defineresource pop end end`, {})

test('lines whose letter boxes graze the next line stay editable, and editing one leaves the other intact', () => {
  // 14pt text 12pt apart: the descenders of "gyp" touch the ascenders of "fifth hold".
  const source = fixture({ content: 'BT /F 14 Tf 1 0 0 1 80 360 Tm (gyp gyp) Tj ET BT /F 14 Tf 1 0 0 1 80 348 Tm (fifth hold) Tj ET' })
  const regions = regionsOf(source)
  assert.deepEqual(regions.map(r => [r.text, r.unsupported]), [['gyp gyp', undefined], ['fifth hold', undefined]])
  // compileTextEdits verifies every other glyph survived; the edit must not throw.
  const output = compileTextEdits(source, [{ ...edit, regionId: regions[1].id, text: 'tenth hold', size: 14 }])
  assert.deepEqual(regionsOf(output).map(r => r.text).sort(), ['gyp gyp', 'tenth hold'])
})

test('a thin rule drawn over the letters does not block editing; a box hiding the text does', () => {
  const line = 'BT /F 20 Tf 1 0 0 1 80 360 Tm (Original editable line) Tj ET'
  assert.equal(regionsOf(fixture({ content: `${line} 0 g 80 355 200 1 re f` }))[0].unsupported, undefined)
  assert.ok(regionsOf(fixture({ content: `${line} 1 g 75 350 250 40 re f` }))[0].unsupported)
})

test('faux-bold text (filled and outlined) is editable and the replacement keeps the outline', () => {
  const source = fixture({ content: 'BT /F 20 Tf 2 Tr 0.8 w 1 0 0 1 80 360 Tm (Bold looking) Tj ET' })
  const [region] = regionsOf(source)
  assert.equal(region.unsupported, undefined)
  const doc = openPdf(compileTextEdits(source, [{ ...edit, regionId: region.id, text: 'Bold again' }]))
  try {
    const page = doc.loadPage(0)
    try { const glyphs = paintedGlyphs(page).glyphs; assert.ok(glyphs.length && glyphs.every(g => g.stroke && Math.abs(g.stroke.width - 0.8) < 0.01)) } finally { page.destroy() }
  } finally { doc.destroy() }
})

test('a replacement slightly wider than the original is narrowed to fit instead of refused', () => {
  const source = fixture()
  const output = openPdf(compileTextEdits(source, [{ ...edit, text: 'Original editable lines' }]))
  try { assert.ok(analyzePage(output, 0).view.regions.some(r => r.text === 'Original editable lines')) } finally { output.destroy() }
  assert.throws(() => compileTextEdits(source, [{ ...edit, text: 'Original editable line, now twice as long' }]), /free space around the line and narrowed letters/)
})

test('zero-width spaces (Google Docs, Word exports) are ignored instead of blocking the line', () => {
  const source = customFontPdf({ Encoding: 'WinAnsiEncoding' }, 'BT /F 20 Tf 1 0 0 1 80 360 Tm (Hello\\001World) Tj ET', doc => ({ ToUnicode: toUnicode(doc, '200B') }))
  const [region] = regionsOf(source)
  assert.deepEqual([region.text, region.unsupported], ['HelloWorld', undefined])
})

test('a symbol the standard fonts cannot draw is split off: the text stays editable and the symbol can be replaced', () => {
  const source = customFontPdf({ Encoding: 'WinAnsiEncoding' }, 'BT /F 20 Tf 1 0 0 1 80 360 Tm (\\001 Item one) Tj ET', doc => ({ ToUnicode: toUnicode(doc, '25CF') }))
  const regions = regionsOf(source)
  const symbol = regions.find(r => r.text === '●')!, text = regions.find(r => r.text === 'Item one')!
  assert.equal(symbol.unsupported, undefined); assert.equal(text.unsupported, undefined)
  compileTextEdits(source, [{ ...edit, regionId: text.id, text: 'Item two' }])
  compileTextEdits(source, [{ ...edit, regionId: symbol.id, text: '•' }])
  assert.throws(() => compileTextEdits(source, [{ ...edit, regionId: symbol.id, text: '●' }]), /Latin letters/)
})

test('a line grows into the empty space to its right, but never into the next text on that row', () => {
  // "Short" at x 80; "Right side" further along the same baseline; a long line above sets the page's text margin.
  const source = fixture({ content: 'BT /F 14 Tf 1 0 0 1 80 400 Tm (A long line that sets the right margin of the page text) Tj ET BT /F 14 Tf 1 0 0 1 80 360 Tm (Short) Tj ET BT /F 14 Tf 1 0 0 1 300 360 Tm (Right side) Tj ET' })
  const short = regionsOf(source).find(r => r.text === 'Short')!
  assert.ok(short.space && short.space[2] > short.bounds[2] + 150 && short.space[2] < 300, JSON.stringify(short.space))
  const output = compileTextEdits(source, [{ ...edit, regionId: short.id, text: 'Short, now quite a bit longer', size: 14 }])
  assert.ok(regionsOf(output).some(r => r.text === 'Short, now quite a bit longer'))
  assert.throws(() => compileTextEdits(source, [{ ...edit, regionId: short.id, text: 'Short, now so much longer that it would run into the right side', size: 14 }]), /free space/)
})

test('right-aligned text grows to the left and keeps its right edge', () => {
  const source = fixture({ content: 'BT /F 14 Tf 1 0 0 1 80 400 Tm (A long line that sets the right margin) Tj ET BT /F 14 Tf 1 0 0 1 80 360 Tm (Role) Tj ET BT /F 14 Tf 1 0 0 1 280.3 360 Tm (2024) Tj ET' })
  const regions = regionsOf(source), date = regions.find(r => r.text === '2024')!
  const output = regionsOf(compileTextEdits(source, [{ ...edit, regionId: date.id, text: 'May 2024 - Present', size: 14 }]))
  const moved = output.find(r => r.text === 'May 2024 - Present')!
  assert.ok(Math.abs(moved.bounds[2] - date.bounds[2]) < 1, `right edge ${moved.bounds[2]} vs ${date.bounds[2]}`)
  assert.ok(moved.bounds[0] < date.bounds[0] - 50)
})

test('a paragraph gains extra lines only where the space below it is empty', () => {
  const paragraph = 'BT /F 12 Tf 1 0 0 1 80 400 Tm (First line of a short paragraph here) Tj ET BT /F 12 Tf 1 0 0 1 80 386 Tm (and its second line) Tj ET'
  const longer = 'First line of a short paragraph here and its second line, followed by a good deal more text that needs a third line'
  const open = fixture({ content: paragraph })
  const [region] = regionsOf(open)
  assert.equal(region.lines, 2)
  const grown = regionsOf(compileTextEdits(open, [{ ...edit, regionId: region.id, text: longer, size: 12 }]))
  assert.equal(grown.length, 1); assert.equal(grown[0].text, longer); assert.ok(grown[0].lines! > 2)
  const crowded = fixture({ content: `${paragraph} BT /F 12 Tf 1 0 0 1 80 368 Tm (Next paragraph starts right here) Tj ET` })
  const blocked = regionsOf(crowded).find(r => r.text.startsWith('First line'))!
  assert.throws(() => compileTextEdits(crowded, [{ ...edit, regionId: blocked.id, text: longer, size: 12 }]))
})

test('invisible text with nothing visible underneath stays view-only and says why', () => {
  const doc = openPdf(fixture({ content: 'BT /F 20 Tf 3 Tr 1 0 0 1 80 360 Tm (Hidden words) Tj ET' }))
  try { assert.ok(analyzePage(doc, 0).view.regions.every(region => /invisible text layer/.test(region.unsupported ?? ''))) } finally { doc.destroy() }
})

// A phone-scanner style page: a full-page photo (cream paper, a dark block where the words are) under invisible OCR text.
function scanFixture(ocr = 'BT /F 20 Tf 3 Tr 1 0 0 1 80 360 Tm (Scanned words) Tj ET') {
  const doc = new mupdf.PDFDocument(), font = new mupdf.Font('Helvetica')
  const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 400, 500], false)
  try {
    const pixels = pixmap.getPixels(), stride = pixmap.getStride()
    for (let y = 0; y < 500; y++) for (let x = 0; x < 400; x++) {
      const ink = x >= 80 && x < 230 && y >= 126 && y < 141, o = y * stride + x * 3
      pixels[o] = ink ? 30 : 240; pixels[o + 1] = ink ? 30 : 235; pixels[o + 2] = ink ? 40 : 220
    }
    const image = new mupdf.Image(pixmap), imageRef = doc.addImage(image), fontRef = doc.addSimpleFont(font)
    const page = doc.addPage([0, 0, 400, 500], 0, { XObject: { Im: imageRef }, Font: { F: fontRef } }, `q 400 0 0 500 0 0 cm /Im Do Q ${ocr}`)
    doc.insertPage(-1, page); page.destroy(); image.destroy()
    const out = doc.saveToBuffer('compress'); try { return out.asUint8Array().slice() } finally { out.destroy() }
  } finally { pixmap.destroy(); font.destroy(); doc.destroy() }
}

test('text on a scan is edited by covering the old words in the paper colour and drawing the new text', () => {
  const source = scanFixture()
  const [region] = regionsOf(source)
  assert.equal(region.text, 'Scanned words'); assert.equal(region.unsupported, undefined); assert.equal(region.scan, true)
  assert.match(region.color, /^#[0-3]/, `ink colour ${region.color}`)
  const output = compileTextEdits(source, [{ ...edit, regionId: region.id, text: 'New', color: region.color }])
  const doc = openPdf(output)
  try {
    assert.deepEqual(analyzePage(doc, 0).view.regions.map(r => r.text), ['New'])
    // Where the old words were and the new text is not, the page now shows the paper colour, not the dark block.
    const page = doc.loadPage(0), pixmap = page.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false)
    try { const o = 133 * pixmap.getStride() + 200 * 3, pixels = pixmap.getPixels(); assert.ok(pixels[o] > 200 && pixels[o + 1] > 200, `pixel ${pixels[o]},${pixels[o + 1]},${pixels[o + 2]}`) } finally { pixmap.destroy(); page.destroy() }
  } finally { doc.destroy() }
})

test('words attached to a drawing (ActualText, e.g. WordArt) are explained as not being text', () => {
  // The letters inside only clip (render mode 7) and the visible result is a shape; the words come from ActualText.
  const doc = openPdf(fixture({ content: '/Span <</ActualText (Module 1)>> BDC q BT /F 20 Tf 7 Tr 1 0 0 1 80 360 Tm (ABCDEFGH) Tj ET 0 g 80 350 100 20 re f Q EMC BT /F 12 Tf 1 0 0 1 80 300 Tm (Real text) Tj ET' }))
  try {
    const regions = analyzePage(doc, 0).view.regions
    assert.match(regions.find(region => region.text.includes('Module'))?.unsupported ?? '', /not drawn as text/)
    assert.equal(regions.find(region => region.text === 'Real text')?.unsupported, undefined)
  } finally { doc.destroy() }
})

test('on a scan, OCR letters of a tightly packed neighbouring line that the erase takes along are put back', () => {
  // The second OCR line sits 0.6 em below: its letter boxes reach up into the first line, its ink does not.
  const source = scanFixture('BT /F 20 Tf 3 Tr 1 0 0 1 80 360 Tm (Alpha) Tj ET BT /F 20 Tf 3 Tr 1 0 0 1 80 348 Tm (aaaa) Tj ET')
  const regions = regionsOf(source), alpha = regions.find(r => r.text === 'Alpha')!
  assert.ok(alpha && !alpha.unsupported, JSON.stringify(regions.map(r => [r.text, r.unsupported])))
  const output = regionsOf(compileTextEdits(source, [{ ...edit, regionId: alpha.id, text: 'Omega', color: '#000000' }]))
  assert.ok(output.some(r => r.text === 'Omega') && output.some(r => r.text === 'aaaa'), JSON.stringify(output.map(r => r.text)))
})
