import { expect, it, vi } from 'vitest'
import type { App } from 'obsidian'
import { IDBFactory } from 'fake-indexeddb'
import { MemoryStateStore, sha256, type EngineStatus, type SyncReport } from '@abele/sync-core'
import { encodeAccessToken } from '@abele/sync-protocol'
import { TokenEngines } from '@/sync/tokenEngines'
import { TokenUi, connectionError } from '@/sync/tokenUi'
import { TokenConnectionRegistry } from '@/sync/tokenConnectionRegistry'
import { ExecutableReview } from '@/sync/executableReview'
import { AttachmentConsent } from '@/sync/attachmentConsent'
import { buildFakeVault } from '../helpers/fakeVault'
import * as safety from '@/sync/external/pluginSafety'
import { JOURNAL_KEY, WriteJournal } from '@/sync/writeJournal'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { TokenSettingsPort } from '@/sync/tokenSettingsPort'

it.each([
  'sample recovery record is unreadable',
  'External files: sample recovery record is unreadable',
])('shows the actual local recovery failure in startup status: %s', async (reason) => {
  const fixture = inspectionFixture(false, 'Notes')
  const recover = vi
    .spyOn(ObsidianFileSystem.prototype, 'recover')
    .mockRejectedValueOnce(new Error(reason))
  try {
    fixture.release()
    await fixture.ui.connect(fixture.encoded)
    const id = fixture.registry.records()[0].id
    await vi.waitFor(() => expect(fixture.registry.records()[0].status).toBe('error'))
    expect(fixture.ui.activity.value[id].error).toContain(reason)
    expect(fixture.ui.activity.value[id].startup?.stage).toBe('Recovering local files')
  } finally {
    recover.mockRestore()
    fixture.probe.mockRestore()
    await fixture.host.close()
  }
})

it('surfaces a server size refusal by path and reason, keeps bytes pending and avoids repeated rejected uploads', async () => {
  const app = buildFakeVault([{ path: 'oversized.bin', content: 'too many bytes' }])
  const registry = TokenConnectionRegistry.open(app),
    keys = new Map<string, string>(),
    metadata = new MemoryStateStore()
  const secrets = {
    get: (id: string) => keys.get(id) ?? null,
    set: (id: string, key: string) => {
      keys.set(id, key)
    },
    remove: (id: string) => {
      keys.delete(id)
    },
  }
  const scope = { kind: 'folder' as const, id: 'root', path: '/' }
  const transport = vi.fn<typeof fetch>(async (input) => {
    const path = new URL(String(input)).pathname
    if (path === '/v2/connection')
      return Response.json({
        protocol: 2,
        token_id: 'token',
        space_id: 'space',
        scope,
        status: 'active',
        limits: { max_file_bytes: 4, quota_bytes: null },
      })
    if (path === '/v2/manifest' || path === '/v2/changes')
      return Response.json({ items: [], cursor: 0, next: null })
    if (path.startsWith('/v2/uploads/'))
      return Response.json(
        { error: { code: 'too_large', message: 'File exceeds the server size limit' } },
        { status: 413 }
      )
    throw new Error('Unexpected upload or commit: ' + path)
  })
  const ui = new TokenUi(registry, secrets, transport, {
    executables: new ExecutableReview(metadata),
    attachments: new AttachmentConsent(metadata),
    close: () => {},
  })
  const host = new TokenEngines(app as unknown as App, ui, secrets.get, {
    fetch: transport,
    indexedDB: new IDBFactory(),
    WebSocket: class {
      constructor() {
        throw new Error('No test socket')
      }
    } as unknown as typeof WebSocket,
  })
  try {
    await ui.connect(
      encodeAccessToken({ v: 1, address: 'https://size.example', key: 'a'.repeat(43), scope })
    )
    const id = registry.records()[0].id
    await vi.waitFor(() => expect(ui.runtimes.has(id)).toBe(true))
    await ui.sync(id)
    expect(ui.activity.value[id].refused).toContainEqual({
      path: 'oversized.bin',
      reason: 'This file is too large for the server. It stays on this device.',
    })
    expect(ui.activity.value[id].pending).toBeGreaterThan(0)
    expect(await app.vault.adapter.read('oversized.bin')).toBe('too many bytes')
    const uploads = () =>
      transport.mock.calls.filter(([input]) =>
        new URL(String(input)).pathname.startsWith('/v2/uploads/')
      ).length
    expect(uploads()).toBe(1)
    const approval = { at: Date.now(), text: 'Installed code from Whole vault: Scripts/sample.js' }
    ui.publish(id, { events: [approval] })
    await ui.sync(id)
    expect(ui.activity.value[id].events).toContainEqual(approval)
    expect(uploads()).toBe(1)
    expect(ui.activity.value[id].refused).toContainEqual({
      path: 'oversized.bin',
      reason: 'This file is too large for the server. It stays on this device.',
    })
    expect(
      transport.mock.calls.some(([input]) => new URL(String(input)).pathname === '/v2/commit')
    ).toBe(false)
  } finally {
    await host.close()
  }
})

it('recovers interrupted installations before inspecting their bytes', async () => {
  const fixture = inspectionFixture()
  const { app, ui, host, registry, encoded, release, probe } = fixture
  const recover = vi.spyOn(ObsidianFileSystem.prototype, 'recover')
  try {
    await ui.connect(encoded)
    const id = registry.records()[0].id
    await vi.waitFor(() => expect(ui.activity.value[id]?.inspection?.total).toBe(1))
    release()
    await vi.waitFor(() => expect(ui.runtimes.has(id)).toBe(true))
    await host.close()
    await app.vault.adapter.write('Notes/inflight.tmp', '{"format":"abele.external", broken')
    app.saveLocalStorage(JOURNAL_KEY, [
      { owner: id, target: 'Notes/slow.txt', temp: 'Notes/inflight.tmp' },
    ])
    const next = new TokenEngines(app as unknown as App, ui, () => 'a'.repeat(43), {
      fetch: fixture.transport,
      indexedDB: fixture.factory,
    })
    recover.mockClear()
    try {
      next.start()
      // Recovery retires the interrupted entry; the restarted engine may already journal
      // its own fresh streaming write for the same file, so only the old entry must go.
      await vi.waitFor(
        () =>
          expect(
            new WriteJournal(app).entries().filter((entry) => entry.temp === 'Notes/inflight.tmp')
          ).toEqual([]),
        { timeout: 10_000 }
      )
      expect(recover).toHaveBeenCalled()
      await vi.waitFor(() => expect(ui.runtimes.has(id)).toBe(true))
    } finally {
      await next.close()
    }
  } finally {
    release()
    await host.close()
    probe.mockRestore()
    recover.mockRestore()
  }
})

it('retries a failed inspection with fresh ownership', async () => {
  const { app, ui, host, registry, encoded, release, probe } = inspectionFixture(true)
  try {
    await ui.connect(encoded)
    const id = registry.records()[0].id
    release()
    await vi.waitFor(() => expect(registry.records()[0].status).toBe('error'))
    await app.vault.adapter.write('Notes/slow.txt', 'ordinary replacement note')
    await ui.sync(id)
    expect(ui.runtimes.has(id)).toBe(true)
    expect(ui.activity.value[id].error).toBeUndefined()
  } finally {
    release()
    await host.close()
    probe.mockRestore()
  }
})

it('leaves inspection running when disconnect is refused', async () => {
  const { app, ui, host, registry, encoded, release, probe } = inspectionFixture()
  try {
    await ui.connect(encoded)
    const id = registry.records()[0].id
    await vi.waitFor(() => expect(ui.activity.value[id]?.inspection?.total).toBe(1))
    const activity = ui.activity.value[id]
    app.saveLocalStorage('abele-sync-external-connection-switch-v1', {})
    await expect(ui.disconnect(id)).rejects.toThrow()
    expect(ui.activity.value[id]).toEqual(activity)
    app.saveLocalStorage('abele-sync-external-connection-switch-v1', null)
    release()
    await vi.waitFor(() => expect(ui.runtimes.has(id)).toBe(true))
  } finally {
    release()
    await host.close()
    probe.mockRestore()
  }
})

it('cancels a joining inspection before manager reset drains the host', async () => {
  const { host, ui, registry, encoded, release, probe } = inspectionFixture()
  try {
    await ui.connect(encoded)
    const id = registry.records()[0].id
    await vi.waitFor(() => expect(ui.activity.value[id]?.inspection?.total).toBe(1))
    host.cancelStartup()
    expect(ui.activity.value[id]?.startupTimings?.at(-1)?.outcome).toBe('cancelled')
    expect(registry.records()).toHaveLength(1)
    await host.close()
  } finally {
    release()
    probe.mockRestore()
    await host.close()
  }
})

function inspectionFixture(
  marker = false,
  folder = '/',
  extra: Array<{ path: string; content: string }> = []
) {
  const app = buildFakeVault([
    {
      path: 'Notes/slow.txt',
      content: marker ? '{"format":"abele.external", broken' : 'ordinary note',
    },
    ...extra,
  ])
  const registry = TokenConnectionRegistry.open(app)
  const keys = new Map<string, string>()
  const secrets = {
    get: (id: string) => keys.get(id) ?? null,
    set: (id: string, key: string) => {
      keys.set(id, key)
    },
    remove: (id: string) => {
      keys.delete(id)
    },
  }
  const metadata = new MemoryStateStore()
  const scope = { kind: 'folder' as const, id: 'root', path: folder }
  let cursor = 1
  const transport = vi.fn<typeof fetch>(async (input, init) => {
    const path = new URL(String(input)).pathname
    if (path === '/v2/connection')
      return Response.json({
        protocol: 2,
        token_id: 'token',
        space_id: 'space',
        scope,
        status: 'active',
        limits: { max_file_bytes: 1000, quota_bytes: null },
      })
    if (path === '/v2/commit') {
      const { ops } = JSON.parse(String(init?.body)) as {
        ops: Array<{ path: string; sha?: string; size?: number; mtime?: number }>
      }
      cursor++
      return Response.json({
        cursor,
        results: ops.map((op) => ({
          status: 'applied',
          file_id: crypto.randomUUID(),
          version_id: crypto.randomUUID(),
          seq: cursor,
          path: op.path,
          sha: op.sha ?? null,
          size: op.size ?? 0,
          mtime: op.mtime ?? 0,
        })),
      })
    }
    if (path.startsWith('/v2/uploads/')) return new Response(null, { status: 201 })
    return Response.json({ items: [], cursor, next: null })
  })
  const ui = new TokenUi(registry, secrets, transport, {
    executables: new ExecutableReview(metadata),
    attachments: new AttachmentConsent(metadata),
    close: () => {},
  })
  const factory = new IDBFactory()
  const makeHost = () =>
    new TokenEngines(app as unknown as App, ui, secrets.get, {
      fetch: transport,
      indexedDB: factory,
      WebSocket: class {
        constructor() {
          throw new Error('No test socket')
        }
      } as unknown as typeof WebSocket,
    })
  const host = makeHost()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const read = app.vault.adapter.readBinary.bind(app.vault.adapter)
  const probe = vi.spyOn(app.vault.adapter, 'readBinary').mockImplementation(async (path) => {
    await gate
    return read(path)
  })
  const encoded = encodeAccessToken({
    v: 1,
    address: 'https://sync.example',
    key: 'a'.repeat(43),
    scope,
  })
  return { app, registry, ui, host, transport, probe, release, encoded, factory, scope, makeHost }
}

for (const action of ['pass', 'refuse', 'disconnect', 'unload']) {
  it(`keeps a slow full inspection outside Connect and handles ${action} safely`, async () => {
    const fixture = inspectionFixture(action === 'refuse')
    const { ui, host, registry, transport, release, encoded } = fixture
    let connected = false
    const connecting = ui.connect(encoded).then(() => {
      connected = true
    })
    try {
      await vi.waitFor(() => expect(connected).toBe(true), { timeout: 300 })
      await connecting
      const id = registry.records()[0].id
      await vi.waitFor(() =>
        expect(ui.activity.value[id]?.inspection).toEqual({ completed: 0, total: 1 })
      )
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(ui.runtimes.has(id)).toBe(false)
      expect(
        transport.mock.calls.every(
          ([input]) => new URL(String(input)).pathname === '/v2/connection'
        )
      ).toBe(true)
      vi.useFakeTimers()
      await vi.advanceTimersByTimeAsync(60000)
      expect(registry.records()[0].status).toBe('joining')
      expect(ui.activity.value[id].error).toBeUndefined()
      vi.useRealTimers()
      if (action === 'disconnect') {
        await ui.disconnect(id)
        expect(registry.records()).toEqual([])
      } else if (action === 'unload') {
        await host.close()
      }
      release()
      if (action === 'pass') {
        await vi.waitFor(() => expect(ui.runtimes.has(id)).toBe(true))
        expect(
          ui.activity.value[id].startupTimings?.filter((one) => one.stage === 'Listing the vault')
        ).toHaveLength(1)
        expect(
          ui.activity.value[id].startupTimings?.filter((one) => one.stage === 'Checking the vault')
        ).toHaveLength(1)
      } else if (action === 'refuse') {
        await vi.waitFor(() => expect(registry.records()[0].status).toBe('error'))
        expect(ui.activity.value[id].error).toContain('recovery')
      }
      if (action !== 'pass') {
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(ui.runtimes.has(id)).toBe(false)
        expect(
          transport.mock.calls.every(
            ([input]) => new URL(String(input)).pathname === '/v2/connection'
          )
        ).toBe(true)
      }
    } finally {
      vi.useRealTimers()
      release()
      await connecting.catch(() => {})
      await host.close()
      fixture.probe.mockRestore()
    }
  })
}

it('names and bounds a stalled inspection and retains its startup timings', async () => {
  const original = ObsidianFileSystem.prototype.recover
  const recover = vi
    .spyOn(ObsidianFileSystem.prototype, 'recover')
    .mockImplementationOnce(async function () {
      await original.call(this)
      vi.useFakeTimers()
    })
  const { ui, host, registry, encoded, release, probe } = inspectionFixture()
  try {
    await ui.connect(encoded)
    const id = registry.records()[0].id
    await vi.waitFor(() => expect(ui.activity.value[id]?.inspection?.total).toBe(1))
    expect(ui.activity.value[id].startup).toMatchObject({
      stage: 'Checking the vault',
      completed: 0,
      total: 1,
    })
    await vi.advanceTimersByTimeAsync(120001)
    expect(registry.records()[0].status).toBe('error')
    expect(ui.activity.value[id].error).toContain('Checking the vault')
    expect(ui.activity.value[id].startupTimings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: 'Checking the vault', outcome: 'failed' }),
      ])
    )
    vi.useRealTimers()
    release()
    await ui.sync(id)
    expect(ui.runtimes.has(id)).toBe(true)
  } finally {
    vi.useRealTimers()
    release()
    await host.close()
    probe.mockRestore()
    recover.mockRestore()
  }
})

it('revokes a timed-out engine start and permits a later explicit retry', async () => {
  vi.useFakeTimers()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const inspection = vi
    .spyOn(safety, 'activeExternalDocuments')
    .mockImplementationOnce(async () => {
      await gate
      return []
    })
  const app = buildFakeVault([])
  const registry = TokenConnectionRegistry.open(app)
  const metadata = new MemoryStateStore()
  const keys = new Map<string, string>()
  const secrets = {
    get: (ref: string) => keys.get(ref) ?? null,
    set: (ref: string, key: string) => {
      keys.set(ref, key)
    },
    remove: (ref: string) => {
      keys.delete(ref)
    },
  }
  const scope = { kind: 'folder' as const, id: 'root', path: '/' }
  const transport: typeof fetch = async (input) =>
    new URL(String(input)).pathname === '/v2/connection'
      ? Response.json({
          protocol: 2,
          token_id: 'token',
          space_id: 'space',
          scope,
          status: 'active',
          limits: { max_file_bytes: 1000, quota_bytes: null },
        })
      : Response.json({ items: [], cursor: 1, next: null })
  const ui = new TokenUi(registry, secrets, transport, {
    executables: new ExecutableReview(metadata),
    attachments: new AttachmentConsent(metadata),
    close: () => {},
  })
  const host = new TokenEngines(app as unknown as App, ui, secrets.get, {
    fetch: transport,
    indexedDB: new IDBFactory(),
    WebSocket: class {
      constructor() {
        throw new Error('No test socket')
      }
    } as unknown as typeof WebSocket,
  })
  try {
    await ui.connect(
      encodeAccessToken({ v: 1, address: 'https://sync.example', key: 'a'.repeat(43), scope })
    )
    const id = registry.records()[0].id
    await vi.advanceTimersByTimeAsync(10001)
    expect(registry.records()[0].status).toBe('error')
    expect(ui.activity.value[id].error).toContain('starting sync')
    const retry = ui.sync(id).catch((error) => error)
    await vi.advanceTimersByTimeAsync(10001)
    expect(connectionError(await retry)).toContain('starting sync')
    release()
    await vi.advanceTimersByTimeAsync(1)
    expect(ui.runtimes.has(id)).toBe(false)
    vi.useRealTimers()
    await ui.sync(id)
    expect(ui.runtimes.has(id)).toBe(true)
  } finally {
    release()
    vi.useRealTimers()
    inspection.mockRestore()
    await host.close()
  }
})

it.each(['revoked', 'forbidden', '503', 'network'] as const)(
  'keeps %s classification across reload without deleting local files',
  async (failure) => {
    const revoked = failure === 'revoked' || failure === 'forbidden'
    const app = buildFakeVault([{ path: 'Private/keep.md', content: 'local retained file' }])
    const registry = TokenConnectionRegistry.open(app),
      keys = new Map<string, string>(),
      metadata = new MemoryStateStore()
    const secrets = {
      get: (id: string) => keys.get(id) ?? null,
      set: (id: string, value: string) => {
        keys.set(id, value)
      },
      remove: (id: string) => {
        keys.delete(id)
      },
    }
    const scope = { kind: 'folder' as const, id: 'root', path: '/' }
    let failing = false
    const transport = vi.fn<typeof fetch>(async (input) => {
      if (failing) {
        if (failure === 'network') throw new TypeError('Network unavailable')
        if (failure === 'forbidden')
          return Response.json(
            { error: { code: 'forbidden', message: 'Access closed' } },
            { status: 403 }
          )
        return Response.json(
          {
            error: {
              code: failure === 'revoked' ? 'unauthorized' : 'internal',
              message: 'sample failure',
            },
          },
          { status: failure === 'revoked' ? 401 : 503 }
        )
      }
      if (new URL(String(input)).pathname === '/v2/connection')
        return Response.json({
          protocol: 2,
          token_id: 'token',
          space_id: 'space',
          scope,
          status: 'active',
          limits: { max_file_bytes: 1000000, quota_bytes: null },
        })
      return Response.json({ items: [], cursor: 0, next: null })
    })
    const reviews = {
      executables: new ExecutableReview(metadata),
      attachments: new AttachmentConsent(metadata),
      close: () => {},
    }
    let ui = new TokenUi(registry, secrets, transport, reviews)
    await ui.connect(
      encodeAccessToken({ v: 1, address: 'https://sample.example', key: 'a'.repeat(43), scope })
    )
    failing = true
    const deps = {
      fetch: transport,
      indexedDB: new IDBFactory(),
      WebSocket: class {
        constructor() {
          throw new Error('No socket')
        }
      } as unknown as typeof WebSocket,
    }
    let host = new TokenEngines(app as unknown as App, ui, secrets.get, deps)
    try {
      host.start()
      await vi.waitFor(() =>
        expect(registry.records()[0].status).toBe(revoked ? 'needs-token' : 'offline')
      )
      // The friendly text hides the cause; diagnostics keep the code and the original message.
      if (revoked)
        expect(ui.activity.value[registry.records()[0].id]?.failure).toMatchObject({
          code: failure === 'forbidden' ? 'forbidden' : 'unauthorized',
          message: expect.any(String),
        })
      let stopped = transport.mock.calls.length
      if (!revoked) {
        await vi.waitFor(() =>
          expect(ui.activity.value[registry.records()[0].id]?.refused).toContainEqual({
            path: 'Private/keep.md',
            reason: connectionError({ code: 'offline' }),
          })
        )
        // A retry blocked on the connection check has not sent these bytes.
        const id = registry.records()[0].id
        await (
          host as unknown as {
            changed: (id: string, status: EngineStatus) => Promise<void>
          }
        ).changed(id, {
          state: 'syncing',
          pending: 0,
          lastSyncAt: null,
          lastError: 'Network unavailable',
          cursor: 0,
          headSeq: null,
        })
        expect(ui.activity.value[id]?.refused).toContainEqual({
          path: 'Private/keep.md',
          reason: connectionError({ code: 'offline' }),
        })
        expect(ui.activity.value[id]?.pending).toBeGreaterThan(0)
        const runtime = host as unknown as {
          live: Map<
            string,
            { pendingLocalDetails: () => Promise<{ count: number; paths: string[] }> }
          >
          changed: (id: string, status: EngineStatus, report?: SyncReport) => Promise<void>
        }
        let finish!: (value: { count: number; paths: string[] }) => void
        vi.spyOn(runtime.live.get(id)!, 'pendingLocalDetails').mockReturnValueOnce(
          new Promise((resolve) => {
            finish = resolve
          })
        )
        // On a large vault the failed attempt's pending scan can outlive the backoff.
        ui.publish(id, { refused: [], pending: 0 })
        const failed = runtime.changed(id, {
          state: 'offline',
          pending: 0,
          lastSyncAt: null,
          lastError: 'Network unavailable',
          cursor: 0,
          headSeq: null,
        })
        await runtime.changed(id, {
          state: 'syncing',
          pending: 0,
          lastSyncAt: null,
          lastError: 'Network unavailable',
          cursor: 0,
          headSeq: null,
        })
        finish({ count: 1, paths: ['Private/keep.md'] })
        await failed
        expect(ui.activity.value[id]?.refused).toContainEqual({
          path: 'Private/keep.md',
          reason: connectionError({ code: 'offline' }),
        })
        expect(registry.records()[0].status).toBe('syncing')
        vi.spyOn(runtime.live.get(id)!, 'pendingLocalDetails').mockReturnValueOnce(
          new Promise((resolve) => {
            finish = resolve
          })
        )
        const olderFailure = runtime.changed(id, {
          state: 'offline',
          pending: 0,
          lastSyncAt: null,
          lastError: 'Network unavailable',
          cursor: 0,
          headSeq: null,
        })
        const report: SyncReport = {
          pull: { applied: 0, held: [], skipped: 0, cursor: 1, deferred: 0, bootstrapped: false },
          push: {
            committed: null,
            applied: 1,
            merged: 0,
            conflicts: 0,
            rejected: [],
            replayed: false,
            kept: [],
          },
          secondPull: null,
          collisions: [],
          deferred: 0,
          joined: false,
        }
        await runtime.changed(
          id,
          {
            state: 'idle',
            pending: 0,
            lastSyncAt: new Date().toISOString(),
            lastError: null,
            cursor: 1,
            headSeq: 1,
          },
          report
        )
        finish({ count: 1, paths: ['Private/keep.md'] })
        await olderFailure
        expect(ui.activity.value[id]?.refused).toEqual([])
        expect(ui.activity.value[id]?.pending).toBe(0)
        await vi.waitFor(() => expect(transport.mock.calls.length).toBeGreaterThan(stopped), {
          timeout: 4000,
        })
        stopped = transport.mock.calls.length
      }
      await host.close()
      ui = new TokenUi(TokenConnectionRegistry.open(app), secrets, transport, reviews)
      host = new TokenEngines(app as unknown as App, ui, secrets.get, deps)
      host.announce()
      host.start()
      if (revoked) {
        await new Promise((resolve) => setTimeout(resolve, 50))
        expect(transport).toHaveBeenCalledTimes(stopped)
        expect(registry.records()[0].status).toBe('needs-token')
      } else {
        await vi.waitFor(() => expect(transport.mock.calls.length).toBeGreaterThan(stopped))
        expect(registry.records()[0].status).not.toBe('needs-token')
      }
      expect(await app.vault.adapter.read('Private/keep.md')).toBe('local retained file')
    } finally {
      await host.close()
    }
  }
)

it('binds saved token rows to independent native production runtimes and drains disconnect', async () => {
  const app = buildFakeVault([]),
    registry = TokenConnectionRegistry.open(app),
    keys = new Map<string, string>(),
    metadata = new MemoryStateStore()
  const secrets = {
    get: (ref: string) => keys.get(ref) ?? null,
    set: (ref: string, key: string) => {
      keys.set(ref, key)
    },
    remove: (ref: string) => {
      keys.delete(ref)
    },
  }
  const scope = { kind: 'folder' as const, id: 'sample-root', path: '/' }
  const transport: typeof fetch = async (input) => {
    const url = new URL(String(input))
    if (url.pathname === '/v2/connection')
      return Response.json({
        protocol: 2,
        token_id: 'sample-token',
        space_id: 'sample-space',
        scope,
        status: 'active',
        limits: { max_file_bytes: 1000000, quota_bytes: null },
      })
    if (url.pathname === '/v2/manifest' || url.pathname === '/v2/changes')
      return Response.json({ items: [], cursor: 1, next: null })
    throw new Error('Unexpected route: ' + url.pathname)
  }
  const reviews = {
    executables: new ExecutableReview(metadata),
    attachments: new AttachmentConsent(metadata),
    close: () => {},
  }
  const ui = new TokenUi(registry, secrets, transport, reviews)
  const host = new TokenEngines(app as unknown as App, ui, secrets.get, {
    fetch: transport,
    indexedDB: new IDBFactory(),
    WebSocket: class {
      constructor() {
        throw new Error('No test socket')
      }
    } as unknown as typeof WebSocket,
  })
  try {
    await ui.connect(
      encodeAccessToken({ v: 1, address: 'https://first.example', key: 'a'.repeat(43), scope })
    )
    await ui.connect(
      encodeAccessToken({ v: 1, address: 'https://second.example', key: 'b'.repeat(43), scope })
    )
    await vi.waitFor(() => expect(ui.runtimes.size).toBe(2))
    const [first, second] = registry.records()
    await Promise.all([ui.sync(first.id), ui.sync(second.id)])
    expect(ui.activity.value[first.id].lastSync).toBeGreaterThan(0)
    await ui.pause(first.id, true)
    expect(registry.records().find((one) => one.id === second.id)?.paused).toBe(false)
    await ui.disconnect(first.id)
    expect(ui.runtimes.has(first.id)).toBe(false)
    expect(keys.size).toBe(1)
    // Count the host's retained owners, not just the visible connection rows.
    const retained = host as unknown as {
      engines: { runtimes: Map<string, unknown> }
      retries: Map<string, unknown>
      activityEpoch: Map<string, unknown>
      activityReports: Map<string, unknown>
    }
    for (let cycle = 0; cycle < 6; cycle++) {
      await ui.connect(
        encodeAccessToken({
          v: 1,
          address: `https://cycle${cycle}.example`,
          key: 'c'.repeat(43),
          scope,
        })
      )
      const added = registry.records().find((one) => one.id !== second.id)!
      await vi.waitFor(() => expect(ui.runtimes.has(added.id)).toBe(true))
      await ui.disconnect(added.id)
    }
    expect(retained.engines.runtimes.size).toBe(1)
    expect(retained.retries.size).toBe(1)
    const ports = TokenSettingsPort as unknown as {
      instances: WeakMap<TokenUi, Map<string, unknown>>
    }
    expect(ports.instances.get(ui)?.size).toBe(1)
    expect(retained.activityEpoch.size).toBeLessThanOrEqual(1)
    expect(retained.activityReports.size).toBeLessThanOrEqual(1)
    expect(Object.keys(ui.activity.value)).toEqual([second.id])
    await ui.sync(second.id)
    expect(registry.records().map((one) => one.id)).toEqual([second.id])
  } finally {
    await host.close()
  }
})

it('stops a server rename without discovering its private local namesake and permits disconnect', async () => {
  const { app, registry, ui, host, transport, probe, release, encoded, scope } = inspectionFixture(
    false,
    'Notes'
  )
  const list = vi.spyOn(app.vault.adapter, 'list')
  try {
    release()
    await ui.connect(encoded)
    const id = registry.records()[0].id
    await vi.waitFor(() => expect(ui.runtimes.has(id)).toBe(true))
    await ui.sync(id)
    await app.vault.create('Private/secret.md', 'private bytes')
    scope.path = 'Private'
    list.mockClear()
    probe.mockClear()
    transport.mockClear()
    await expect(ui.sync(id)).rejects.toThrow(/renamed on the server/)
    expect(registry.records()[0].localRoot).toBe('Notes')
    expect(
      list.mock.calls.some(([path]) => path === 'Private' || path.startsWith('Private/'))
    ).toBe(false)
    expect(probe.mock.calls.some(([path]) => path.startsWith('Private/'))).toBe(false)
    expect(
      transport.mock.calls.some(([url]) => new URL(String(url)).pathname === '/v2/commit')
    ).toBe(false)
    expect(ui.activity.value[id].error).toContain('Notes → Private')
    await ui.disconnect(id)
    expect(registry.records()).toEqual([])
    expect(await app.vault.adapter.read('Private/secret.md')).toBe('private bytes')
  } finally {
    release()
    list.mockRestore()
    probe.mockRestore()
    await host.close()
  }
})

it('confines full folder startup, recovery and first exchange before any adapter access', async () => {
  const { app, ui, host, registry, encoded, release, probe, transport } = inspectionFixture(
    false,
    'Notes',
    [{ path: 'Notes/excluded.txt', content: 'excluded bytes' }]
  )
  const bytes = new TextEncoder().encode('downloaded bytes')
  const item = {
    file_id: 'remote-file',
    version_id: 'remote-version',
    path: 'Notes/remote.md',
    kind: 'note',
    mtime: 1000,
    size: bytes.length,
    sha: await sha256(bytes),
  }
  const send = transport.getMockImplementation()!
  transport.mockImplementation(async (input, init) => {
    const url = new URL(String(input))
    if (url.pathname === '/v2/manifest')
      return Response.json({ items: [item], cursor: 1, next: null })
    if (url.pathname.endsWith('/content')) {
      const range = /^bytes=(\d+)-(\d+)$/.exec(new Headers(init?.headers).get('range') ?? '')
      return range
        ? new Response(bytes.slice(Number(range[1]), Number(range[2]) + 1), {
            status: 206,
            headers: {
              'content-range': `bytes ${range[1]}-${range[2]}/${bytes.length}`,
              'content-length': String(Number(range[2]) - Number(range[1]) + 1),
            },
          })
        : new Response(bytes)
    }
    return send(input, init)
  })
  await app.vault.create('Private/secret.md', 'private uncached bytes')
  await app.vault.adapter.write('.abele-sync-ignore', 'Notes/excluded.txt\n')
  const calls: string[] = []
  for (const method of [
    'list',
    'stat',
    'read',
    'readBinary',
    'exists',
    'write',
    'writeBinary',
    'appendBinary',
    'mkdir',
    'remove',
    'rmdir',
    'rename',
  ] as const) {
    if (typeof app.vault.adapter[method] !== 'function') continue
    const port = app.vault.adapter[method]
    const original = (vi.isMockFunction(port) ? port.getMockImplementation()! : port).bind(
      app.vault.adapter
    )
    vi.spyOn(app.vault.adapter, method).mockImplementation(
      async (path: string, ...args: never[]) => {
        calls.push(path)
        if (method === 'rename') calls.push(String(args[0]))
        return original(path, ...args)
      }
    )
  }
  try {
    release()
    await ui.connect(encoded)
    const id = registry.records()[0].id
    await vi.waitFor(() => expect(ui.runtimes.has(id)).toBe(true))
    await ui.sync(id)
    const published = transport.mock.calls
      .filter(([url]) => new URL(String(url)).pathname === '/v2/commit')
      .flatMap(([, init]) => JSON.parse(String(init?.body)).ops as Array<{ path: string }>)
    expect(published.map((op) => op.path)).toContain('Notes/slow.txt')
    expect(published.map((op) => op.path)).not.toContain('Notes/excluded.txt')
    expect(published.map((op) => op.path)).not.toContain('.abele-sync-ignore')
    expect(probe.mock.calls.some(([path]) => path === '.abele-sync-ignore')).toBe(true)
    expect(
      calls.filter(
        (path) =>
          path !== 'Notes' &&
          path !== '.abele-sync-ignore' &&
          !path.startsWith('Notes/') &&
          !path.startsWith('.abele-sync/connections/' + id + '/') &&
          path !== '.abele-sync/connections/' + id &&
          !['.abele-sync', '.abele-sync/connections'].includes(path)
      )
    ).toEqual([])
    expect(calls.some((path) => path.startsWith('Private'))).toBe(false)
    expect(await app.vault.adapter.read('Notes/remote.md')).toBe('downloaded bytes')
  } finally {
    release()
    await host.close()
    probe.mockRestore()
    vi.restoreAllMocks()
  }
})

it.each(['owned', 'legacy'])(
  'restarts after an interrupted %s private placement download without treating it as a foreign folder',
  async (kind) => {
    const { app, ui, host, registry, encoded, release, probe, makeHost } = inspectionFixture(
      false,
      'Notes'
    )
    let restarted: TokenEngines | undefined
    try {
      release()
      await ui.connect(encoded)
      const id = registry.records()[0].id
      await vi.waitFor(() => expect(ui.runtimes.has(id)).toBe(true))
      await ui.sync(id)
      const fs = Reflect.get(Reflect.get(host, 'live').get(id), 'options').fs
      const stages = Reflect.get(fs, Symbol.for('abele.sync.private-placement-stages-v1'))
      const pending =
        kind === 'owned'
          ? await stages.beginAtomicWrite('.abele-sync/placement-inbox/aaaaaaaa-bbbb', 0, null)
          : await new ObsidianFileSystem(app as never).beginAtomicWrite(
              '.abele-sync/placement-inbox/aaaaaaaa-bbbb',
              0,
              null
            )
      await pending.append(0, new Uint8Array([1, 2]))
      expect(new WriteJournal(app).entries().some((entry) => entry.temp === pending.id)).toBe(true)
      await host.close()
      restarted = makeHost()
      restarted.start()
      await vi.waitFor(() => expect(ui.runtimes.has(id)).toBe(true))
      await ui.sync(id)
      expect(registry.records()[0].status).not.toBe('error')
      expect(new WriteJournal(app).entries().some((entry) => entry.temp === pending.id)).toBe(
        kind === 'legacy'
      )
    } finally {
      release()
      await restarted?.close()
      await host.close()
      probe.mockRestore()
    }
  }
)

it.each(['before-create', 'after-remove', 'other-connection'])(
  'starts a folder connection after interrupted private work: %s',
  async (gap) => {
    const { app, ui, host, registry, encoded, release, probe, makeHost } = inspectionFixture(
      false,
      'Notes'
    )
    let restarted: TokenEngines | undefined
    let restore: (() => void) | undefined
    try {
      release()
      await ui.connect(encoded)
      const id = registry.records()[0].id
      await vi.waitFor(() => expect(ui.runtimes.has(id)).toBe(true))
      await ui.sync(id)
      const { connectionAdapter } = await import('@/sync/connectionScope')
      const { connectionPrivateRoot } = await import('@/sync/connectionPaths')
      const { privatePlacementStages } = await import('@/sync/privatePlacementStages')
      const owner = gap === 'other-connection' ? 'another-connection' : id
      const root = connectionPrivateRoot(owner)
      const fs = new ObsidianFileSystem(app as unknown as App, {
        adapter: connectionAdapter(
          app.vault.adapter,
          gap === 'other-connection' ? 'Private' : 'Notes',
          root
        ),
        connectionId: owner,
        fileScope: gap === 'other-connection' ? 'Private' : 'Notes',
      })
      const stages = privatePlacementStages(fs, root)
      const path = '.abele-sync/placement-inbox/aaaaaaaa-bbbb'
      let temp: string
      if (gap === 'before-create') {
        const create = vi
          .spyOn(Reflect.get(fs, 'io'), 'create')
          .mockRejectedValueOnce(new Error('simulated termination'))
        restore = () => create.mockRestore()
        await expect(stages.beginAtomicWrite(path, 0, null)).rejects.toThrow(
          'simulated termination'
        )
        temp = new WriteJournal(app)
          .entries()
          .find((entry) => entry.target === root + '/placement-inbox/aaaaaaaa-bbbb')!.temp!
      } else {
        const stage = await stages.beginAtomicWrite(path, 0, null)
        temp = stage.id
        await stage.append(0, new Uint8Array([1, 2]))
        if (gap === 'after-remove') {
          const original = app.saveLocalStorage.bind(app)
          app.saveLocalStorage = (key, value) => {
            if (key === JOURNAL_KEY) throw new Error('simulated termination')
            original(key, value)
          }
          restore = () => {
            app.saveLocalStorage = original
          }
          await expect(stage.discard()).rejects.toThrow('cannot save the write journal')
        }
      }
      restore?.()
      restore = undefined
      expect(new WriteJournal(app).entries().some((entry) => entry.temp === temp)).toBe(true)
      await host.close()
      const stat = vi.spyOn(app.vault.adapter, 'stat')
      restarted = makeHost()
      restarted.start()
      await vi.waitFor(() =>
        expect(ui.runtimes.has(id) || registry.records()[0].status === 'error').toBe(true)
      )
      expect(ui.activity.value[id]?.error).toBeUndefined()
      expect(ui.runtimes.has(id)).toBe(true)
      await ui.sync(id)
      expect(new WriteJournal(app).entries().some((entry) => entry.temp === temp)).toBe(
        gap === 'other-connection'
      )
      if (gap === 'other-connection')
        expect(stat.mock.calls.some(([path]) => path.startsWith(root))).toBe(false)
      stat.mockRestore()
    } finally {
      restore?.()
      release()
      await restarted?.close()
      await host.close()
      probe.mockRestore()
    }
  }
)
