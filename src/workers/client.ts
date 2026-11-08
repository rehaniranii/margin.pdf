import type { Command, Progress, Response, Result } from './protocol'

export class PdfWorkerClient {
  private worker = new Worker(new URL('./pdf.worker.ts', import.meta.url), { type: 'module' })
  private sequence = 0
  private ready = false
  private stopped = false
  private outbox: { id: number; command: Command }[] = []
  private pending = new Map<number, { resolve: (value: Result) => void; reject: (error: Error) => void }>()
  constructor(private onProgress?: (label: string) => void) {
    this.worker.onmessage = (event: MessageEvent<Response | Progress | { ready: true }>) => {
      if ('ready' in event.data) {
        this.ready = true
        for (const request of this.outbox) this.send(request)
        this.outbox = []
        return
      }
      if ('progress' in event.data) { if (this.pending.has(event.data.id)) this.onProgress?.(event.data.progress); return }
      const { id, result, error } = event.data
      const request = this.pending.get(id)
      this.pending.delete(id)
      if (error) request?.reject(new Error(error))
      else if (result !== undefined) request?.resolve(result)
    }
    this.worker.onerror = () => this.fail(new Error('The PDF worker stopped. Choose Recover workspace to restore your last applied changes, or clear the workspace and reopen your file.'))
  }
  request<T extends Result>(command: Command): Promise<T> {
    if (this.stopped) return Promise.reject(new Error('The PDF engine stopped. Clear the workspace and reopen your file.'))
    const id = ++this.sequence
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: value => resolve(value as T), reject })
      if (this.ready) this.send({ id, command })
      else this.outbox.push({ id, command })
    })
  }
  private send(request: { id: number; command: Command }) {
    const command = request.command
    const transfer = command.type === 'open' ? [command.bytes] : command.type === 'import-image' ? [command.asset.bytes] : command.type === 'restore' ? [command.source, command.checkpoint.pdf, ...command.assets.map(asset => asset.bytes)] : []
    this.worker.postMessage(request, transfer)
  }
  private fail(error: Error) { this.stopped = true; this.outbox = []; this.pending.forEach(request => request.reject(error)); this.pending.clear() }
  dispose() { this.worker.terminate(); this.fail(new Error('Operation cancelled.')) }
}
