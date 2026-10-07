import { expect, it, vi } from 'vitest'
import { NodeDocumentSource } from '@/node/NodeFilesModel'
import { NodeClientStore } from '@/node/NodeClientStore'
import { IDBFactory } from 'fake-indexeddb'
import { NodeClient, type FileWrite } from '@abele/node-client'
const hash = async (text: string) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))),
    (b) => b.toString(16).padStart(2, '0')
  ).join('')
async function setup() {
  const factory = new IDBFactory(),
    namespace = 'editing-' + crypto.randomUUID()
  const store = new NodeClientStore(namespace, factory)
  await store.transaction((s) => {
    s.node_id = 'fixture'
    s.installation_id = 'fixture'
  })
  const client = new NodeClient(
    { url: 'ws://127.0.0.1:7777/channel', profile: 'local-token-v1', token: 'a'.repeat(64) },
    store
  )
  let current = 'before'
  client.readFile = vi.fn(async (workspace_id, path) => ({
    workspace_id,
    path,
    content_id: await hash(current),
    size: current.length,
    binary: false,
    large: false,
    too_large: false,
  }))
  client.readContent = vi.fn(async () => ({
    offset: 0,
    total: current.length,
    base64: btoa(current),
  }))
  return {
    factory,
    namespace,
    store,
    client,
    source: new NodeDocumentSource(client, 'workspace'),
    setCurrent: (text: string) => {
      current = text
    },
  }
}
it('persists unsent edits and their original version across source/store recreation', async () => {
  const s = await setup(),
    doc = await s.source.read('sample.txt')
  await s.source.edit('sample.txt', doc, 'draft')
  s.store.close()
  const store = new NodeClientStore(s.namespace, s.factory)
  const client = new NodeClient(s.client.target, store)
  const restored = new NodeDocumentSource(client, 'workspace')
  expect(await restored.draft('sample.txt')).toMatchObject({
    text: 'draft',
    baseText: 'before',
    baseContentId: await hash('before'),
  })
  store.close()
})
it('holds an immutable save identity before outbox admission and never makes a second save for an unknown outcome', async () => {
  const s = await setup(),
    doc = await s.source.read('sample.txt')
  await s.source.edit('sample.txt', doc, 'draft')
  const realWrite = s.client.writeFile.bind(s.client)
  s.client.writeFile = vi.fn(async () => {
    throw new Error('admission interrupted')
  })
  await expect(s.source.save('sample.txt')).rejects.toThrow('admission interrupted')
  const pending = (await s.source.draft('sample.txt'))!.pending!
  expect(pending.params).toMatchObject({ expected_content_id: doc.contentId, text: 'draft' })
  s.client.writeFile = vi.fn(realWrite)
  await s.source.check('sample.txt')
  await s.source.save('sample.txt')
  expect((await s.client.pending()).map((e) => e.operation_id)).toEqual([pending.operationId])
  await expect(s.source.edit('sample.txt', doc, 'changed')).rejects.toThrow('unresolved')
  await expect(s.source.discard('sample.txt')).rejects.toThrow('unresolved')
  s.store.close()
})
it('retains conflicts and only changes the precondition on an explicit current-version rebase', async () => {
  const s = await setup(),
    doc = await s.source.read('sample.txt')
  await s.source.edit('sample.txt', doc, 'draft')
  const save = await s.source.save('sample.txt'),
    pending = save!.pending!
  const receipt = {
    operation_id: pending.operationId,
    workspace_id: 'workspace',
    path: 'sample.txt',
    state: 'conflict',
    expected_content_id: doc.contentId,
    predecessor_content_id: await hash('external'),
    content_id: await hash('draft'),
    recovery_path: null,
  }
  await s.store.transaction((state) => {
    state.results[pending.operationId] = { result: receipt }
    state.outbox = []
  })
  expect(await s.source.check('sample.txt')).toMatchObject({
    status: 'conflict',
    text: 'draft',
    baseContentId: doc.contentId,
  })
  s.setCurrent('external')
  const fresh = await s.source.read('sample.txt')
  await s.source.rebase('sample.txt', fresh)
  expect(await s.source.draft('sample.txt')).toMatchObject({
    status: 'draft',
    baseText: 'external',
    baseContentId: fresh.contentId,
    text: 'draft',
  })
  const next = await s.source.save('sample.txt')
  expect(next!.pending!.operationId).not.toBe(pending.operationId)
  s.store.close()
})
it('a durable unknown result keeps draft and recovery evidence and does not permit blind rebase/replay', async () => {
  const s = await setup(),
    doc = await s.source.read('sample.txt')
  await s.source.edit('sample.txt', doc, 'draft')
  const save = await s.source.save('sample.txt'),
    pending = save!.pending!
  await s.store.transaction(async (state) => {
    state.outbox = []
    state.results[pending.operationId] = {
      result: {
        operation_id: pending.operationId,
        workspace_id: 'workspace',
        path: 'sample.txt',
        state: 'outcome_unknown',
        expected_content_id: doc.contentId,
        predecessor_content_id: doc.contentId,
        content_id: await hash('draft'),
        recovery_path: '.abele-fixture-predecessor',
      },
    }
  })
  expect(await s.source.check('sample.txt')).toMatchObject({
    status: 'outcome_unknown',
    text: 'draft',
    result: { recovery_path: '.abele-fixture-predecessor' },
  })
  await expect(s.source.rebase('sample.txt', doc)).rejects.toThrow('unresolved')
  await s.source.save('sample.txt')
  expect(await s.client.pending()).toEqual([])
  s.store.close()
})
it('retains an oversized unsent edit locally even though bounded save admission rejects it', async () => {
  const s = await setup(),
    doc = await s.source.read('sample.txt'),
    text = 'x'.repeat(32769)
  await s.source.edit('sample.txt', doc, text)
  await expect(s.source.save('sample.txt')).rejects.toThrow('save limit')
  expect(await s.source.draft('sample.txt')).toMatchObject({ text, status: 'draft' })
  expect(await s.client.pending()).toEqual([])
  s.store.close()
})
it('known saved and rejected receipts keep local text; failed local settlement retains the original pending identity', async () => {
  const s = await setup(),
    doc = await s.source.read('sample.txt')
  await s.source.edit('sample.txt', doc, 'draft')
  const saved = await s.source.save('sample.txt'),
    pending = saved!.pending!
  const receipt = {
    operation_id: pending.operationId,
    workspace_id: 'workspace',
    path: 'sample.txt',
    state: 'saved',
    expected_content_id: doc.contentId,
    predecessor_content_id: doc.contentId,
    content_id: await hash('draft'),
    recovery_path: null,
  }
  await s.store.transaction((state) => {
    state.results[pending.operationId] = { result: receipt }
    state.outbox = []
  })
  expect(await s.source.check('sample.txt')).toMatchObject({
    status: 'saved',
    baseContentId: receipt.content_id,
    text: 'draft',
    baseText: 'draft',
  })
  await s.source.edit('sample.txt', doc, 'new draft')
  const next = await s.source.save('sample.txt'),
    nextPending = next!.pending!
  await s.store.transaction((state) => {
    state.results[nextPending.operationId] = {
      error: 'unsafe_path',
      request: { method: 'workspace.write', params: nextPending.params as FileWrite },
    }
    state.outbox = []
  })
  expect(await s.source.check('sample.txt')).toMatchObject({
    status: 'rejected',
    text: 'new draft',
    error: 'unsafe_path',
  })
  s.store.close()
})
