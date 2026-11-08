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

test('utility worker failures offer recovery within page tools without discarding the editor', async () => {
  const originalWorker = globalThis.Worker
  let instance: { onerror?: () => void; terminate(): void }
  class FailedWorker {
    onmessage?: (event: {data:unknown}) => void
    onerror?: () => void
    constructor() { instance = this }
    postMessage() {}
    terminate() {}
  }
  globalThis.Worker = FailedWorker as unknown as typeof Worker
  try {
    const client = new PdfWorkerClient(undefined, 'tools')
    const pending = client.request({ type:'tool-build', spec:{kind:'pages',pages:[],acceptFlattening:true} })
    instance!.onerror?.()
    await assert.rejects(pending, /Close and reopen Page tools.*editor is unchanged/)
    await assert.rejects(client.request({type:'tool-release',id:'source'}), /Close and reopen Page tools/)
    client.dispose()
  } finally { globalThis.Worker = originalWorker }
})

test('failed buffer transfer releases activity and leaves the worker available for recovery', async () => {
 const originalWorker=globalThis.Worker
 const {activeJobCount}=await import('../src/offline/activity')
 let instance:{onmessage?: (event:{data:unknown})=>void}
 class CloneFailure {
  onmessage?: (event:{data:unknown})=>void
  onerror?:()=>void
  constructor(){instance=this}
  postMessage(){throw new Error('Synthetic transfer failure')}
  terminate(){}
 }
 globalThis.Worker=CloneFailure as unknown as typeof Worker
 try{const client=new PdfWorkerClient();instance!.onmessage?.({data:{ready:true}});await assert.rejects(client.request({type:'sample'}),/transfer failure/);assert.equal(activeJobCount(),0);client.dispose()}finally{globalThis.Worker=originalWorker}
})
