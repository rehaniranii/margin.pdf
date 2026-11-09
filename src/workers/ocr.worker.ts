/// <reference lib="webworker" />
// Text recognition in its own worker, started only when the OCR tool runs. Everything is
// self-hosted (the content policy allows no other origins) and cached for offline use.
import createCore from 'tesseract.js-core/tesseract-core-simd-lstm.js'
import wasmUrl from 'tesseract.js-core/tesseract-core-simd-lstm.wasm?url'
import englishUrl from '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz?url'
import { Ocr } from '../engine/ocr'

let engine: Promise<Ocr> | undefined
async function english() {
  const response = await fetch(englishUrl)
  if (!response.ok) throw new Error('The English text data could not be loaded. Reconnect and try again.')
  const bytes = new Uint8Array(await response.arrayBuffer())
  // A server may already have decoded the gzip (Content-Encoding); only inflate real gzip bytes.
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer())
}
async function start() { const [core, data] = await Promise.all([createCore({ locateFile: () => wasmUrl }), english()]); return new Ocr(core, data) }

self.onmessage = async (event: MessageEvent<{ id: number; image: ArrayBuffer }>) => {
  const { id, image } = event.data
  try {
    engine ??= start()
    const ocr = await engine
    self.postMessage({ id, words: ocr.recognize(new Uint8Array(image)) })
  } catch (error) {
    engine = undefined // a failed start may be retried
    self.postMessage({ id, error: error instanceof Error ? error.message : 'Text recognition failed.' })
  }
}
