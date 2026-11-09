// Thin wrapper over tesseract.js-core (Tesseract compiled to WASM). Runs wherever the core
// module was loaded: the OCR worker in the browser, or Node in tests.
export type OcrWord = { text: string; left: number; top: number; width: number; height: number; confidence: number }
type Core = { FS: { writeFile(path: string, data: Uint8Array | string): void }; TessBaseAPI: new () => Api }
type Api = { Init(path: string | null, lang: string): number; SetImageFile(exif: number, angle: number): number; Recognize(monitor: null): number; GetTSVText(page: number): string; End(): void }

// TSV columns: level page block par line word left top width height conf text. Level 5 = word.
export function parseTsv(tsv: string): OcrWord[] {
  return tsv.split('\n').flatMap(line => {
    const cells = line.split('\t')
    if (cells[0] !== '5' || cells.length < 12) return []
    const [left, top, width, height, confidence] = cells.slice(6, 11).map(Number), text = cells.slice(11).join('\t').trim()
    return text && confidence >= 0 && width > 0 && height > 0 ? [{ text, left, top, width, height, confidence }] : []
  })
}

export class Ocr {
  private api: Api
  constructor(private core: Core, englishData: Uint8Array) {
    core.FS.writeFile('eng.traineddata', englishData)
    this.api = new core.TessBaseAPI()
    if (this.api.Init(null, 'eng') !== 0) throw new Error('The text recognition engine could not start.')
  }
  /** Words in image pixels, for a PNG or JPEG. */
  recognize(image: Uint8Array): OcrWord[] {
    this.core.FS.writeFile('/input', image)
    if (this.api.SetImageFile(1, 0) !== 0) throw new Error('The page image could not be read for text recognition.')
    this.api.Recognize(null)
    return parseTsv(this.api.GetTSVText(0))
  }
  dispose() { this.api.End() }
}
