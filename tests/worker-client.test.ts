import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PdfWorkerClient } from '../src/workers/client'

test('waits for WASM readiness, transfers source ownership, correlates replies, and rejects cancellation', async () => {
  const originalWorker = globalThis.Worker
  let mock: MockWorker
  class MockWorker {
    onmessage?: (event: { data: unknown }) => void
    onerror?: () => void
    messages: { message: { id: number }; transfer: Transferable[] }[] = []
    terminated = false
    constructor() { mock = this }
    postMessage(message: { id: number }, transfer: Transferable[]) { this.messages.push({ message, transfer }) }
    terminate() { this.terminated = true }
  }
  globalThis.Worker = MockWorker as unknown as typeof Worker
  try {
    const client = new PdfWorkerClient()
    const bytes = new ArrayBuffer(4)
    const opening = client.request({ type: 'open', bytes })
    assert.equal(mock!.messages.length, 0, 'request must not be lost during WASM initialization')
    mock!.onmessage?.({ data: { ready: true } })
    assert.equal(mock!.messages.length, 1)
    assert.equal(mock!.messages[0].transfer[0], bytes)
    mock!.onmessage?.({ data: { id: mock!.messages[0].message.id, result: bytes } })
    assert.equal(await opening, bytes)
    const pending = client.request({ type: 'sample' })
    client.dispose()
    await assert.rejects(pending, /cancelled/)
    assert.ok(mock!.terminated)
    await assert.rejects(client.request({ type: 'sample' }), /Clear the workspace/)
  } finally { globalThis.Worker = originalWorker }
})
