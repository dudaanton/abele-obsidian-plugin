import { expect, it, vi } from 'vitest'
import { tokenUiFixture } from '@/testing/tokenUiFixture'
import { V2Client } from '@/sync/v2/client'
import { TokenUi, SCOPE_DELETED } from '@/sync/tokenUi'

it('advertises permission support when inspecting deletion authority', async () => {
  const transport = vi.fn<typeof fetch>(async (_input, init) => {
    expect(new Headers(init?.headers).get('abele-client-capabilities')).toBe('read-only')
    return Response.json({
      protocol: 2,
      token_id: 'token-a',
      space_id: 'space-a',
      scope: { kind: 'folder', id: 'root', path: '/' },
      status: 'active',
      read_only: false,
      limits: { max_file_bytes: 1024, quota_bytes: null },
    })
  })
  const client = new V2Client(
    {
      v: 1,
      address: 'https://sync.example',
      key: 'a'.repeat(43),
      scope: { kind: 'folder', id: 'root', path: '/' },
    },
    transport
  )
  await expect(client.connection()).resolves.toMatchObject({ read_only: false })
})

it('recovers a committed deletion after a lost response and process restart without reading revoked inventory', async () => {
  const ui = tokenUiFixture(),
    id = ui.rows.value[0].id
  const facts = { files: 2, bytes: 42, access: [], canWrite: true }
  ui.registry
    .storage(id)
    .saveLocalStorage('abele-sync-token-state:server-delete', { key: 'saved-attempt', facts })
  let committed = false,
    effects = 0,
    requests = 0
  const transport: typeof fetch = async (input, init) => {
    expect(String(input)).toBe('https://sync.example/v2/connection/delete')
    expect(new Headers(init?.headers).get('Idempotency-Key')).toBe('saved-attempt')
    expect(init?.body).toBe('{}')
    requests++
    if (!committed) {
      committed = true
      effects++
      throw new Error('response lost')
    }
    return Response.json({ cursor: 2, files: 2, revoked_tokens: ['token-a'] })
  }
  const removed = new Set<string>()
  const secrets = {
    get: (reference: string) => (removed.has(reference) ? null : 'a'.repeat(43)),
    set: () => {},
    remove: (reference: string) => {
      removed.add(reference)
    },
  }
  const first = new TokenUi(ui.registry, secrets, transport)
  await expect(first.deleteFromServer(id)).rejects.toMatchObject({ code: 'unreachable' })
  const restarted = new TokenUi(ui.registry, secrets, transport)
  expect(await restarted.serverDeleteFacts(id)).toEqual(facts)
  expect(requests).toBe(1)
  await expect(restarted.sync(id)).rejects.toThrow('awaiting confirmation')
  await restarted.deleteFromServer(id)
  expect(effects).toBe(1)
  expect(restarted.rows.value.some((one) => one.id === id)).toBe(false)
})

it('keeps a deleted connection stopped after restart and refuses resume and sync', async () => {
  const ui = tokenUiFixture(),
    id = ui.rows.value[0].id
  ui.registry.storage(id).saveLocalStorage('abele-sync-token-state:scope-deleted', true)
  ui.registry.setStatus(id, 'error')
  const transport = vi.fn<typeof fetch>()
  const restarted = new TokenUi(
    ui.registry,
    { get: () => 'a'.repeat(43), set: () => {}, remove: () => {} },
    transport
  )
  expect(restarted.activity.value[id].error).toBe(SCOPE_DELETED)
  await expect(restarted.sync(id)).rejects.toThrow(SCOPE_DELETED)
  await expect(restarted.pause(id, false)).rejects.toThrow('stopped')
  expect(transport).not.toHaveBeenCalled()
})

// TODO: Run this contract against the provenance-checked deletion server fixture when released.
it('sends only an empty scope deletion request and explains an older server', async () => {
  const transport = vi.fn<typeof fetch>(async () => Response.json({}, { status: 404 }))
  const client = new V2Client(
    {
      v: 1,
      address: 'https://sync.example',
      key: 'a'.repeat(43),
      scope: { kind: 'folder', id: 'root', path: '/' },
    },
    transport
  )
  await expect(client.deleteScope('attempt-a')).rejects.toThrow('server is too old')
  expect(transport.mock.calls[0][0]).toBe('https://sync.example/v2/connection/delete')
  expect(transport.mock.calls[0][1]).toMatchObject({ method: 'POST', body: '{}' })
  expect(new Headers(transport.mock.calls[0][1]?.headers).get('Idempotency-Key')).toBe('attempt-a')
})

it('counts manifest metadata without downloads and includes only affected active access', async () => {
  const ui = tokenUiFixture(),
    id = ui.rows.value[0].id
  const manifest = vi
    .fn()
    .mockResolvedValueOnce({
      items: [{ kind: 'note', file_id: 'note-a', size: 12 }],
      next: 'page-2',
    })
    .mockResolvedValueOnce({
      items: [
        { kind: 'directory', file_id: 'dir-a' },
        { kind: 'asset', file_id: 'asset-a', size: 30 },
      ],
      next: null,
    })
  vi.spyOn(ui, 'client').mockReturnValue({
    connection: async () => ({
      scope: { kind: 'folder', id: 'folder-a', path: 'Sample' },
      read_only: true,
    }),
    tokens: async () => ({
      items: [
        {
          id: 'one',
          label: 'Sample reader',
          scope: { kind: 'folder', id: 'folder-a', path: 'Sample' },
          revoked_at: null,
        },
        {
          id: 'two',
          label: 'Sibling',
          scope: { kind: 'folder', id: 'sibling', path: 'SampleExtra' },
          revoked_at: null,
        },
      ],
    }),
    manifest,
  } as unknown as V2Client)
  expect(await ui.serverDeleteFacts(id)).toMatchObject({
    files: 2,
    bytes: 42,
    canWrite: false,
    access: [{ label: 'Sample reader' }],
  })
  expect(manifest.mock.calls).toEqual([[null], ['page-2']])
})

it('retries an uncertain deletion with its persisted key and disconnects only after receipt', async () => {
  const ui = tokenUiFixture(),
    id = ui.rows.value[0].id
  const remove = vi
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ cursor: 1, files: 2, revoked_tokens: ['token-a'] })
  vi.spyOn(ui, 'client').mockReturnValue({ deleteScope: remove } as unknown as V2Client)
  const disconnect = vi.spyOn(ui, 'disconnect').mockResolvedValue()
  await expect(ui.deleteFromServer(id)).rejects.toThrow('offline')
  expect(disconnect).not.toHaveBeenCalled()
  await ui.deleteFromServer(id)
  expect(remove.mock.calls[0][0]).toBe(remove.mock.calls[1][0])
  expect(disconnect).toHaveBeenCalledWith(id)
})

it('refuses deletion if the connection changes while its local safety check waits', async () => {
  const ui = tokenUiFixture(),
    id = ui.rows.value[0].id
  const remove = vi.fn()
  vi.spyOn(ui, 'client').mockReturnValue({ deleteScope: remove } as unknown as V2Client)
  ui.connectionChangeGuard = async () => {
    ui.registry.setScopePath(id, 'Changed')
  }
  await expect(ui.deleteFromServer(id)).rejects.toThrow('Connection changed')
  expect(remove).not.toHaveBeenCalled()
})

it('deletes only the confirmed connection and leaves every other connection unchanged', async () => {
  const ui = tokenUiFixture(),
    id = ui.rows.value[0].id
  const others = ui.registry.records().filter((one) => one.id !== id)
  const client = vi.spyOn(ui, 'client').mockReturnValue({
    deleteScope: vi.fn().mockResolvedValue({ cursor: 1, files: 2, revoked_tokens: [] }),
  } as unknown as V2Client)
  await ui.deleteFromServer(id)
  expect(client.mock.calls.every(([selected]) => selected === id)).toBe(true)
  expect(ui.registry.records()).toEqual(others)
})

it('preserves scope_deleted even on a 401 from a newer server', async () => {
  const client = new V2Client(
    {
      v: 1,
      address: 'https://sync.example',
      key: 'a'.repeat(43),
      scope: { kind: 'folder', id: 'root', path: '/' },
    },
    async () => Response.json({ error: { code: 'scope_deleted' } }, { status: 401 })
  )
  await expect(client.connection()).rejects.toMatchObject({ code: 'scope_deleted' })
})
