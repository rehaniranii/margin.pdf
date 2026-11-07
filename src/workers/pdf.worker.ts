/// <reference lib="webworker" />
import { createSample } from '../engine/sample'
import { EditorSession } from '../engine/editor-session'
import type { Request, Response, Result } from './protocol'

let session: EditorSession | undefined

function execute({ command }: Request): Result {
  if (command.type === 'sample' || command.type === 'open') {
    const source = command.type === 'sample' ? createSample() : new Uint8Array(command.bytes)
    const candidate = new EditorSession(source)
    try {
      const bounds = candidate.bounds(0)
      const scale = Math.max(0.1, Math.min(0.9, (command.width ?? 552) / (bounds[2] - bounds[0])))
      const view = candidate.view(0, scale, command.dpr ?? 1)
      session?.dispose(); session = candidate
      return { info: { pageCount: candidate.count, bounds, text: view.text.regions.map(region => region.text).join('\n') }, source: candidate.source.slice().buffer, view, scale }
    } catch (error) { candidate.dispose(); throw error }
  }
  if (!session) throw new Error('Open a PDF first.')
  if (command.type === 'export') return session.export()
  if (command.type === 'view') return session.view(command.page, command.scale, command.dpr)
  if (command.type === 'edit') return session.apply(command.edit, command.scale, command.dpr)
  return session[command.type](command.page, command.scale, command.dpr)
}

self.onmessage = (event: MessageEvent<Request>) => {
  const response: Response = { id: event.data.id }
  try {
    const result = execute(event.data)
    response.result = result
    const transfer: Transferable[] = result instanceof ArrayBuffer ? [result] : 'source' in result ? [result.source, result.view.image.png] : [result.image.png]
    self.postMessage(response, transfer)
  } catch (error) {
    response.error = error instanceof Error ? error.message : 'The PDF could not be processed. No changes were applied.'
    self.postMessage(response)
  }
}

// WASM initialization uses top-level await. Queue commands until this handshake.
self.postMessage({ ready: true })
