/// <reference lib="webworker" />
import { createSample } from '../engine/sample'
import { EditorSession } from '../engine/editor-session'
import type { Request, Response, Result } from './protocol'

let session: EditorSession | undefined
let activeId = 0
const progress = (label: string) => self.postMessage({ id: activeId, progress: label })

function execute({ command }: Request): Result {
  if (command.type === 'sample' || command.type === 'open') {
    const source = command.type === 'sample' ? createSample() : new Uint8Array(command.bytes)
    const candidate = new EditorSession(source, progress)
    try {
      const bounds = candidate.bounds(0)
      const scale = Math.max(0.1, Math.min(0.9, (command.width ?? 552) / (bounds[2] - bounds[0])))
      const view = candidate.view(0, scale, command.dpr ?? 1)
      session?.dispose(); session = candidate
      return { info: { pageCount: candidate.count, bounds, text: view.text.regions.map(region => region.text).join('\n') }, source: candidate.source.slice().buffer, view, scale }
    } catch (error) { candidate.dispose(); throw error }
  }
  if (command.type === 'restore') {
    const candidate = new EditorSession(new Uint8Array(command.source), progress)
    try {
      for (const asset of command.assets) candidate.importImage(asset)
      candidate.restore(command.checkpoint)
      const view = candidate.view(command.page, command.scale, command.dpr)
      session?.dispose(); session = candidate
      return view
    } catch (error) { candidate.dispose(); throw error }
  }
  if (!session) throw new Error('Open a PDF first.')
  if (command.type === 'export') return session.export()
  if (command.type === 'view') return session.view(command.page, command.scale, command.dpr)
  if (command.type === 'edit') return session.apply(command.edit, command.scale, command.dpr)
  if (command.type === 'object') return session.putObject(command.object, command.scale, command.dpr)
  if (command.type === 'delete-object') return session.deleteObject(command.id, command.page, command.scale, command.dpr)
  if (command.type === 'import-image') return session.importImage(command.asset)
  if (command.type === 'release-image') { session.releaseImage(command.id); return { released: true } }
  return session[command.type](command.page, command.scale, command.dpr)
}

self.onmessage = (event: MessageEvent<Request>) => {
  activeId = event.data.id
  const response: Response = { id: event.data.id }
  try {
    const result = execute(event.data)
    response.result = result
    const transfer: Transferable[] = result instanceof ArrayBuffer ? [result] : 'source' in result ? [result.source, result.view.image.png] : 'thumbnail' in result ? [result.thumbnail] : 'image' in result ? [result.image.png, ...(result.checkpointPdf ? [result.checkpointPdf] : [])] : []
    self.postMessage(response, transfer)
  } catch (error) {
    response.error = error instanceof Error ? error.message : 'The PDF could not be processed. No changes were applied.'
    self.postMessage(response)
  }
}

// WASM initialization uses top-level await. Queue commands until this handshake.
self.postMessage({ ready: true })
