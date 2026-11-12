import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fixture } from './fixtures'
import { openPdf } from '../src/engine/mupdf-adapter'
import { analyzePage } from '../src/engine/text-analysis'
import { compileTextEdits } from '../src/engine/text-edit'
import { compileObjects } from '../src/engine/added-objects'
import { ImageAssets } from '../src/engine/image-assets'
import { openFont, registerFontFile } from '../src/engine/fonts'
import { closestFont, MATCHED_FONTS } from '../src/model/fonts'
import type { MatchedFont, TextEdit } from '../src/model/document'

// The same files the PDF worker registers at startup.
const files: Record<MatchedFont, string> = {
  'Carlito-Regular': 'Carlito-Regular.ttf', 'Carlito-Bold': 'Carlito-Bold.ttf', 'Carlito-Italic': 'Carlito-Italic.ttf', 'Carlito-BoldItalic': 'Carlito-BoldItalic.ttf',
  'Caladea-Regular': 'Caladea-Regular.ttf', 'Caladea-Bold': 'Caladea-Bold.ttf', 'Caladea-Italic': 'Caladea-Italic.ttf', 'Caladea-BoldItalic': 'Caladea-BoldItalic.ttf',
  'LatinModern-Regular': 'lmroman10-regular.otf', 'LatinModern-Bold': 'lmroman10-bold.otf', 'LatinModern-Italic': 'lmroman10-italic.otf', 'LatinModern-BoldItalic': 'lmroman10-bolditalic.otf',
}
for (const [name, file] of Object.entries(files)) registerFontFile(name as MatchedFont, new Uint8Array(readFileSync(`src/assets/fonts/${file}`)))

test('every matched font is bundled and readable', () => {
  assert.deepEqual(Object.keys(files).sort(), [...MATCHED_FONTS].sort())
  for (const name of MATCHED_FONTS) { const font = openFont(name); try { assert.ok(font.encodeCharacter('é') > 0) } finally { font.destroy() } }
})

test('original fonts map to the font with the same letter widths', () => {
  const cases: [string, string][] = [
    ['ABCDEE+Calibri', 'Carlito-Regular'], ['ABCDEE+Calibri,Bold', 'Carlito-Bold'], ['Calibri-BoldItalic', 'Carlito-BoldItalic'],
    ['Cambria-Italic', 'Caladea-Italic'], ['Cambria Math', 'Times-Roman'],
    ['LHAVGT+CMR10', 'LatinModern-Regular'], ['MCMYWK+CMBX12', 'LatinModern-Bold'], ['CMTI10', 'LatinModern-Italic'], ['CMBXTI10', 'LatinModern-BoldItalic'],
    ['LMRoman10-Bold', 'LatinModern-Bold'], ['CMTT10', 'Courier'], ['CMSY10', 'Helvetica'],
    ['ArialMT', 'Helvetica'], ['TimesNewRomanPS-BoldMT', 'Times-Bold'],
  ]
  for (const [original, expected] of cases) assert.equal(closestFont(original), expected, original)
})

const edit: TextEdit = { type: 'replace-text', page: 0, regionId: '0:0', text: 'Replaced in Carlito é', font: 'Carlito-Regular', size: 20, color: '#000000' }

test('text replaced in a bundled font is embedded as a small subset and stays searchable', () => {
  const source = fixture()
  for (const [font, embedded] of [['Carlito-Bold', /Carlito-Bold/], ['Caladea-Italic', /Caladea-Italic/], ['LatinModern-Regular', /LMRoman10-Regular/]] as const) {
    const output = compileTextEdits(source, [{ ...edit, font }])
    // Carlito alone is 600KB+; a subset of a few letters must add far less.
    assert.ok(output.byteLength - source.byteLength < 60_000, `${font} added ${output.byteLength - source.byteLength} bytes`)
    const doc = openPdf(output)
    try { assert.ok(analyzePage(doc, 0).view.regions.some(region => region.text === edit.text && embedded.test(region.fontName))) } finally { doc.destroy() }
  }
})

test('added text can use a bundled font', () => {
  const assets = new ImageAssets()
  try {
    const output = compileObjects(fixture(), [{ id: 'note', page: 0, kind: 'text', box: { x: 20, y: 190, width: 200, height: 40 }, text: 'Added in Latin Modern', font: 'LatinModern-Bold', size: 16, color: '#000000' }], assets)
    const doc = openPdf(output)
    try { assert.ok(analyzePage(doc, 0).view.regions.some(region => region.text === 'Added in Latin Modern')) } finally { doc.destroy() }
  } finally { assets.dispose() }
})

test('glyph positions follow the embedded widths, including 32-bit rounding (Latin Modern Italic "o" is 0.510, not 0.511)', () => {
  // Eight "o"s drift 0.16pt at 20pt if laid out with the font's own 0.511; verification rejects anything over 0.04.
  const output = compileTextEdits(fixture(), [{ ...edit, text: 'oo good books too', font: 'LatinModern-Italic' }])
  const doc = openPdf(output)
  try { assert.ok(analyzePage(doc, 0).view.regions.some(region => region.text === 'oo good books too')) } finally { doc.destroy() }
})

test('bold and italic toggle within the same family', async () => {
  const { toggleStyle, isBold, isItalic } = await import('../src/model/fonts')
  assert.equal(toggleStyle('Helvetica', 'bold'), 'Helvetica-Bold')
  assert.equal(toggleStyle('Helvetica-Bold', 'italic'), 'Helvetica-BoldOblique')
  assert.equal(toggleStyle('Times-BoldItalic', 'bold'), 'Times-Italic')
  assert.equal(toggleStyle('Carlito-Italic', 'italic'), 'Carlito-Regular')
  assert.equal(toggleStyle('LatinModern-Regular', 'bold'), 'LatinModern-Bold')
  assert.ok(isBold('Courier-BoldOblique') && isItalic('Courier-BoldOblique') && !isBold('Courier-Oblique'))
})

test('bold/italic on a selected range only: spans are split, merged and dropped when uniform', async () => {
  const { toggleRange, styledRuns } = await import('../src/model/fonts')
  // "Hello world": bold "world" only.
  const bold = toggleRange('Hello world', 'Helvetica', undefined, 6, 11, 'bold')
  assert.deepEqual(bold, { font: 'Helvetica', spans: [{ text: 'Hello ', bold: false, italic: false }, { text: 'world', bold: true, italic: false }] })
  // Italic across part of each: "lo wo".
  const both = toggleRange('Hello world', bold.font, bold.spans, 3, 8, 'italic')
  assert.deepEqual(styledRuns('Hello world', both.font, both.spans).map(run => [run.text, run.font]), [['Hel', 'Helvetica'], ['lo ', 'Helvetica-Oblique'], ['wo', 'Helvetica-BoldOblique'], ['rld', 'Helvetica-Bold']])
  // Bold again over everything that is already bold → off there; bolding the rest makes it uniform, stored as the font.
  assert.deepEqual(toggleRange('Hello world', bold.font, bold.spans, 6, 11, 'bold'), { font: 'Helvetica' })
  assert.deepEqual(toggleRange('Hello world', bold.font, bold.spans, 0, 6, 'bold'), { font: 'Helvetica-Bold' })
  // Nothing selected: the whole text.
  assert.deepEqual(toggleRange('Hi', 'Carlito-Regular', undefined, 1, 1, 'italic'), { font: 'Carlito-Italic' })
  assert.throws(() => styledRuns('Hello', 'Helvetica', [{ text: 'Help', bold: true, italic: false }]), /do not match/)
})

test('a replacement with a bold word writes that word in the bold font only', () => {
  const output = compileTextEdits(fixture(), [{ ...edit, font: 'Helvetica', text: 'Revised bold line', spans: [{ text: 'Revised ', bold: false, italic: false }, { text: 'bold', bold: true, italic: false }, { text: ' line', bold: false, italic: false }] }])
  const doc = openPdf(output)
  try {
    const regions = analyzePage(doc, 0).view.regions.map(region => [region.text.trim(), region.fontName])
    assert.deepEqual(regions.filter(([text]) => text !== 'Nearby content stays.'), [['Revised', 'Helvetica'], ['bold', 'Helvetica-Bold'], ['line', 'Helvetica']])
  } finally { doc.destroy() }
})

test('an added text box can mix bold and italic across lines', () => {
  const assets = new ImageAssets()
  try {
    const spans = [{ text: 'Plain ', bold: false, italic: false }, { text: 'bold\nitalic', bold: true, italic: true }, { text: ' end', bold: false, italic: false }]
    const output = compileObjects(fixture(), [{ id: 'note', page: 0, kind: 'text', box: { x: 20, y: 190, width: 200, height: 50 }, text: 'Plain bold\nitalic end', spans, font: 'Carlito-Regular', size: 14, color: '#000000' }], assets)
    const doc = openPdf(output)
    try {
      const found = analyzePage(doc, 0).view.regions.map(region => [region.text.trim(), region.fontName.replace(/^[A-Z]{6}\+/, '')])
      for (const expected of [['Plain', 'Carlito-Regular'], ['bold', 'Carlito-BoldItalic'], ['italic', 'Carlito-BoldItalic'], ['end', 'Carlito-Regular']]) assert.ok(found.some(([text, font]) => text === expected[0] && font === expected[1]), JSON.stringify(found))
    } finally { doc.destroy() }
  } finally { assets.dispose() }
})
