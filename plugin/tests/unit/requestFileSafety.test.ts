import { expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { NodeClient, MemoryClientStore } from '@abele/node-client'
import { NodeClientStore } from '@/node/NodeClientStore'
import { NodeDocumentSource } from '@/node/NodeFilesModel'
import { NodeRequestFiles } from '@/requests/nodeFiles'

const identity = {
  nodeId: 'sample-node',
  registrationId: 'sample-registration',
  projectId: 'sample-project',
}
const path = 'http-client.env.json'
const base = {
  contentId: 'a'.repeat(64),
  text: '{"dev":{"token":"sample-token","password":"sample-password"}}',
}
const next = '{"dev":{"token":"${abele_key:sample-key}","password":"sample-password"}}'

it.each(['pending', 'conflict', 'saved'])(
  'keeps every secret out of IndexedDB for a %s sensitive write',
  async (outcome) => {
    const store = new NodeClientStore('sensitive-' + crypto.randomUUID(), new IDBFactory())
    const target = {
      url: 'ws://127.0.0.1:7777/channel',
      profile: 'local-token-v1' as const,
      token: 'a'.repeat(64),
    }
    const durable = new NodeClient(target, store)
    durable.repository.worktrees = vi.fn(async () => ({
      entries: [{ kind: 'root', worktree_id: 'sample-copy' }],
      cursor: null,
    })) as typeof durable.repository.worktrees
    await store.transaction((state) => {
      state.node_id = 'sample-node'
      state.installation_id = 'sample-installation'
    })
    const memory = new MemoryClientStore()
    await memory.transaction((state) => {
      state.node_id = 'sample-node'
      state.installation_id = 'sample-installation'
    })
    const transient = new NodeClient(target, memory)
    transient.connect = vi.fn(async () => {})
    transient.disconnect = vi.fn(async () => {})
    if (outcome !== 'pending') {
      Object.defineProperty(transient, 'connected', { get: () => true })
      transient.repository.write = vi.fn(async (params, operation_id) => {
        await memory.transaction((state) => {
          state.results[operation_id!] = {
            result: {
              operation_id,
              worktree_id: 'sample-copy',
              path,
              state: outcome,
              expected_content_id: params.expected_content_id,
              predecessor_content_id: base.contentId,
              content_id: 'b'.repeat(64),
              recovery_path: null,
            },
          }
        })
        return { operation_id: operation_id! }
      })
    }
    const files = new NodeRequestFiles(
      durable,
      identity,
      async () => {},
      undefined,
      () => transient
    )
    try {
      const write = files.write(path, base, next)
      if (outcome === 'saved') await write
      else await expect(write).rejects.toThrow(/conflicted|pending/)
      const persisted = await store.transaction((state) => JSON.stringify(state))
      expect(persisted).not.toContain('sample-token')
      expect(persisted).not.toContain('sample-password')
      expect(await new NodeDocumentSource(durable, 'sample-copy', true).draft(path)).toBeUndefined()
      expect(transient.disconnect).toHaveBeenCalledOnce()
      if (outcome === 'pending') {
        expect(await files.resolved(path)).toBe(false)
        const operation = (await transient.pending())[0]
        expect(operation.params).toMatchObject({ text: next, expected_content_id: base.contentId })
        await expect(files.writeSensitive(path, base, next)).rejects.toThrow(/previous secret move/)
        expect((await transient.pending()).map((entry) => entry.operation_id)).toEqual([
          operation.operation_id,
        ])
        expect(transient.disconnect).toHaveBeenCalledTimes(2)
      }
    } finally {
      store.close()
    }
  }
)

it.each(['save', 'discard'])(
  'requires an explicit source editor %s to settle a retained request conflict',
  async (action) => {
    const client = new NodeClient(
      { url: 'ws://127.0.0.1:7777/channel', profile: 'local-token-v1', token: 'a'.repeat(64) },
      new MemoryClientStore()
    )
    client.repository.worktrees = vi.fn(async () => ({
      entries: [{ kind: 'root', worktree_id: 'sample-copy' }],
      cursor: null,
    })) as typeof client.repository.worktrees
    await client.store.transaction((state) => {
      state.node_id = 'sample-node'
      state.installation_id = 'sample-installation'
    })
    const files = new NodeRequestFiles(client, identity, async () => {})
    files.open = vi.fn(async () => {})
    const doc = { contentId: base.contentId, text: 'GET https://example.test' }
    await expect(
      files.conflict('sample.http', doc, 'GET https://example.test/new')
    ).rejects.toThrow(/pending/)
    expect(await files.resolved('sample.http')).toBe(false)
    const source = new NodeDocumentSource(client, 'sample-copy', true)
    await client.store.transaction((state) => {
      const drafts = (
        state as unknown as {
          fileDrafts: Record<string, { status: string; revision: string; pending?: unknown }>
        }
      ).fileDrafts
      const draft = Object.values(drafts)[0]
      draft.status = 'draft'
      draft.revision = crypto.randomUUID()
      delete draft.pending
    })
    expect(await files.resolved('sample.http')).toBe(false)
    await source.draft('sample.http')
    if (action === 'discard') await source.discard('sample.http')
    else
      await client.store.transaction((state) => {
        const drafts = (
          state as unknown as { fileDrafts: Record<string, { status: string; revision: string }> }
        ).fileDrafts
        const draft = Object.values(drafts)[0]
        draft.status = 'saved'
        draft.revision = crypto.randomUUID()
      })
    expect(await files.resolved('sample.http')).toBe(true)
    expect(await files.resolved('sample.http')).toBe(false)
  }
)

it.each([
  ['sample.http', '@token = sample-token\nGET https://example.test'],
  ['sample.http', 'GET https://example.test\nAuthorization: Bearer sample-token'],
  [
    'sample.bru',
    'get {\n  url: https://example.test\n}\nheaders {\n  Authorization: Bearer sample-token\n}',
  ],
])('isolates existing literal secrets in %s request files too', async (path, text) => {
  const files = new NodeRequestFiles({} as NodeClient, identity, async () => {})
  const sensitive = vi.spyOn(files, 'writeSensitive').mockRejectedValue(new Error('memory-only'))
  await expect(files.write(path, { text, contentId: base.contentId }, text + '\n')).rejects.toThrow(
    'memory-only'
  )
  expect(sensitive).toHaveBeenCalledOnce()
})

it('retries a sensitive conflict from refreshed source without creating another stored key', async () => {
  const { FileCollections } = await import('@/requests/FileCollections')
  const target = {
    url: 'ws://127.0.0.1:7777/channel',
    profile: 'local-token-v1' as const,
    token: 'a'.repeat(64),
  }
  const durable = new NodeClient(target, new MemoryClientStore())
  durable.repository.worktrees = vi.fn(async () => ({
    entries: [{ kind: 'root', worktree_id: 'sample-copy' }],
    cursor: null,
  })) as typeof durable.repository.worktrees
  const memory = new MemoryClientStore()
  const transient = new NodeClient(target, memory)
  transient.connect = vi.fn(async () => {})
  transient.disconnect = vi.fn(async () => {})
  Object.defineProperty(transient, 'connected', { get: () => true })
  let current = { ...base }
  let first = true
  const writes: { expected_content_id: string | null; text: string }[] = []
  transient.repository.write = vi.fn(async (params, operation_id) => {
    writes.push(params)
    if (first) {
      current = {
        contentId: 'b'.repeat(64),
        text: JSON.stringify({
          dev: {
            token: 'sample-token',
            password: 'sample-password',
            base: 'https://example.test/changed',
          },
        }),
      }
      first = false
    }
    const state = params.expected_content_id === current.contentId ? 'saved' : 'conflict'
    const predecessor = current.contentId
    if (state === 'saved') current = { text: params.text, contentId: 'c'.repeat(64) }
    await memory.transaction((store) => {
      store.results[operation_id!] = {
        result: {
          operation_id,
          worktree_id: 'sample-copy',
          path,
          state,
          expected_content_id: params.expected_content_id,
          predecessor_content_id: predecessor,
          content_id: current.contentId,
          recovery_path: null,
        },
      }
    })
    return { operation_id: operation_id! }
  })
  const port = new NodeRequestFiles(
    durable,
    identity,
    async () => {},
    undefined,
    () => transient
  )
  port.list = async () => ['sample.http', path]
  port.read = async (file) =>
    file === path ? { ...current } : { contentId: 'd'.repeat(64), text: 'GET https://example.test' }
  const files = new FileCollections(port)
  const put = vi.fn(async () => 'sample-key')
  await files.refresh()
  const id = files.environments[0].id
  await expect(files.moveSecret(id, 'token', put)).rejects.toThrow(/conflicted/)
  await files.moveSecret(id, 'token', put)
  expect(put).toHaveBeenCalledOnce()
  expect(writes).toHaveLength(2)
  expect(writes[1].expected_content_id).toBe('b'.repeat(64))
  expect(JSON.parse(current.text).dev).toEqual({
    token: '${abele_key:sample-key}',
    password: 'sample-password',
    base: 'https://example.test/changed',
  })
  expect(await durable.store.transaction((state) => JSON.stringify(state))).not.toContain(
    'sample-token'
  )
  expect(transient.disconnect).toHaveBeenCalledTimes(2)
})
