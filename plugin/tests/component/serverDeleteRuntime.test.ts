import { expect, it, vi } from 'vitest'
import { tokenUiFixture } from '@/testing/tokenUiFixture'
import { V2Client } from '@/sync/v2/client'
import { TokenUi, SCOPE_DELETED, type TokenUiRuntime } from '@/sync/tokenUi'
import { serverDeleteFailure } from '@/components/sync/serverDelete'

it('distinguishes failure before sending from an uncertain request or an earlier pending attempt', async () => {
  const ui = tokenUiFixture(),
    id = ui.rows.value[0].id
  const remove = vi.fn().mockRejectedValue(new Error('offline'))
  vi.spyOn(ui, 'client').mockReturnValue({ deleteScope: remove } as unknown as V2Client)
  ui.connectionChangeGuard = async () => {
    throw new Error('offline')
  }
  await expect(ui.deleteFromServer(id)).rejects.toMatchObject({ deletionOutcome: 'not-deleted' })
  expect(remove).not.toHaveBeenCalled()
  ui.connectionChangeGuard = async () => {}
  await expect(ui.deleteFromServer(id)).rejects.toMatchObject({ deletionOutcome: 'unknown' })
  ui.connectionChangeGuard = async () => {
    throw new Error('offline')
  }
  await expect(ui.deleteFromServer(id)).rejects.toMatchObject({ deletionOutcome: 'unknown' })
})

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

function runningRuntime(overrides: Partial<TokenUiRuntime>): TokenUiRuntime {
  return {
    sync: async () => {},
    pause: async () => {},
    disconnect: async () => {},
    opened: async () => [],
    apply: async () => {},
    ...overrides,
  } as TokenUiRuntime
}

it('stops a connection that can no longer pause and deletes on the first attempt, without a restart', async () => {
  const ui = tokenUiFixture(),
    id = ui.rows.value[0].id
  const remove = vi.fn().mockResolvedValue({ cursor: 1, files: 2, revoked_tokens: [] })
  vi.spyOn(ui, 'client').mockReturnValue({ deleteScope: remove } as unknown as V2Client)
  const stopped = vi.fn(async () => {})
  ui.bind(
    id,
    runningRuntime({
      pause: async () => {
        throw new Error('Connection stopped')
      },
      disconnect: stopped,
    })
  )
  await ui.deleteFromServer(id)
  expect(stopped).toHaveBeenCalled()
  expect(remove).toHaveBeenCalledTimes(1)
  expect(ui.rows.value.some((one) => one.id === id)).toBe(false)
})

it('returns a retryable failure without deleting or forgetting a connection that never drains', async () => {
  const ui = tokenUiFixture(),
    id = ui.rows.value[0].id
  ui.runtimeStopLimitMs = 20
  const remove = vi.fn().mockResolvedValue({ cursor: 1, files: 2, revoked_tokens: [] })
  vi.spyOn(ui, 'client').mockReturnValue({ deleteScope: remove } as unknown as V2Client)
  const never = () => new Promise<void>(() => {})
  ui.bind(id, runningRuntime({ pause: never, disconnect: never }))
  const failure = await ui.deleteFromServer(id).catch((error: unknown) => error)
  expect(String(failure)).toContain('still stopping')
  expect(serverDeleteFailure('sync.example', failure)).toContain('still stopping')
  await expect(ui.deleteFromServer(id)).rejects.toThrow('still stopping')
  expect(remove).not.toHaveBeenCalled()
  expect(ui.rows.value.some((one) => one.id === id)).toBe(true)
})

it('bounds a stuck lifecycle inspection and Retry joins it before sending', async () => {
  const ui = tokenUiFixture(),
    id = ui.rows.value[0].id
  ui.runtimeStopLimitMs = 20
  const remove = vi.fn().mockResolvedValue({ cursor: 1, files: 2, revoked_tokens: [] })
  vi.spyOn(ui, 'client').mockReturnValue({ deleteScope: remove } as unknown as V2Client)
  let release!: () => void
  const guard = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          release = done
        })
    )
    .mockResolvedValue(undefined)
  ui.connectionChangeGuard = guard
  await expect(ui.deleteFromServer(id)).rejects.toThrow('Safety check is still running')
  await expect(ui.deleteFromServer(id)).rejects.toThrow('Safety check is still running')
  expect(guard).toHaveBeenCalledTimes(1)
  expect(remove).not.toHaveBeenCalled()
  release()
  await ui.deleteFromServer(id)
  expect(remove).toHaveBeenCalledOnce()
})

it('does not treat a failed stop as drained and can retry the stop', async () => {
  const ui = tokenUiFixture(),
    id = ui.rows.value[0].id
  const remove = vi.fn().mockResolvedValue({ cursor: 1, files: 2, revoked_tokens: [] })
  vi.spyOn(ui, 'client').mockReturnValue({ deleteScope: remove } as unknown as V2Client)
  ui.stopRuntime = vi
    .fn()
    .mockRejectedValueOnce(new Error('Drain failed'))
    .mockResolvedValue(undefined)
  await expect(ui.deleteFromServer(id)).rejects.toThrow('Drain failed')
  expect(remove).not.toHaveBeenCalled()
  await ui.deleteFromServer(id)
  expect(ui.stopRuntime).toHaveBeenCalledTimes(2)
  expect(remove).toHaveBeenCalledOnce()
})

it('bounds post-receipt disconnect and Retry joins it without sending the deletion again', async () => {
  const ui = tokenUiFixture(),
    id = ui.rows.value[0].id
  ui.runtimeStopLimitMs = 20
  const remove = vi.fn().mockResolvedValue({ cursor: 1, files: 2, revoked_tokens: [] })
  vi.spyOn(ui, 'client').mockReturnValue({ deleteScope: remove } as unknown as V2Client)
  let release!: () => void
  ui.connectionChangeGuard = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          release = done
        })
    )
  await expect(ui.deleteFromServer(id)).rejects.toMatchObject({ deletionOutcome: 'unknown' })
  const retry = ui.deleteFromServer(id)
  release()
  await retry
  expect(remove).toHaveBeenCalledOnce()
  expect(ui.registry.records().some((one) => one.id === id)).toBe(false)
})

it('stops the connection before sending and retries a lost answer with the same key, never a second deletion', async () => {
  const ui = tokenUiFixture(),
    id = ui.rows.value[0].id
  const order: string[] = []
  const remove = vi
    .fn()
    .mockImplementationOnce(async () => {
      order.push('request')
      throw Object.assign(new Error('Sync connection: unreachable'), { code: 'unreachable' })
    })
    .mockImplementation(async () => {
      order.push('request')
      return { cursor: 1, files: 2, revoked_tokens: [] }
    })
  vi.spyOn(ui, 'client').mockReturnValue({ deleteScope: remove } as unknown as V2Client)
  ui.bind(
    id,
    runningRuntime({
      disconnect: async () => {
        order.push('stopped')
      },
    })
  )
  await expect(ui.deleteFromServer(id)).rejects.toMatchObject({ deletionOutcome: 'unknown' })
  expect(order).toEqual(['stopped', 'request'])
  await expect(ui.sync(id)).rejects.toThrow('awaiting confirmation')
  await expect(ui.pause(id, false)).rejects.toThrow('stopped')
  await ui.deleteFromServer(id)
  expect(remove).toHaveBeenCalledTimes(2)
  expect(remove.mock.calls[0][0]).toBe(remove.mock.calls[1][0])
  expect(ui.rows.value.some((one) => one.id === id)).toBe(false)
})
