import type { OcrWord } from '../engine/ocr'

export class OcrClient {
  private worker = new Worker(new URL('./ocr.worker.ts', import.meta.url), { type: 'module' })
  private sequence = 0
  private pending = new Map<number, { resolve: (words: OcrWord[]) => void; reject: (error: Error) => void }>()
  constructor() {
    this.worker.onmessage = (event: MessageEvent<{ id: number; words?: OcrWord[]; error?: string }>) => {
      const request = this.pending.get(event.data.id); this.pending.delete(event.data.id)
      if (event.data.error || !event.data.words) request?.reject(new Error(event.data.error ?? 'Text recognition failed.')); else request?.resolve(event.data.words)
    }
    this.worker.onerror = () => this.fail('The text recognition engine stopped unexpectedly.')
  }
  /** Words in image pixels for a PNG or JPEG page image. */
  recognize(image: ArrayBuffer) {
    return new Promise<OcrWord[]>((resolve, reject) => { const id = ++this.sequence; this.pending.set(id, { resolve, reject }); this.worker.postMessage({ id, image }, [image]) })
  }
  private fail(message: string) { for (const request of this.pending.values()) request.reject(new Error(message)); this.pending.clear() }
  dispose() { this.worker.terminate(); this.fail('Text recognition was cancelled.') }
}
