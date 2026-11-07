import { mkdir, writeFile } from 'node:fs/promises'
import { createSample, DEFAULT_REPLACEMENT } from '../src/engine/sample'
import { openPdf, render, replaceSampleText } from '../src/engine/mupdf-adapter'

await mkdir('output/proof', { recursive: true })
const sample = createSample()
const result = replaceSampleText(sample, DEFAULT_REPLACEMENT)
await writeFile('output/proof/sample.pdf', sample)
await writeFile('output/proof/replaced.pdf', result.bytes)
for (const [name, bytes] of [['before', sample], ['after', result.bytes]] as const) {
  const doc = openPdf(bytes)
  try { await writeFile(`output/proof/${name}.png`, new Uint8Array(render(doc, 0, 1, 1).png)) }
  finally { doc.destroy() }
}
await writeFile('output/proof/report.json', JSON.stringify(result.report, null, 2))
console.log('Saved sample, replacement, page images, and verification report to output/proof/.', result.report)
