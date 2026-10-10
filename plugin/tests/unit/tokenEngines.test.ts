import { expect, it, vi } from 'vitest'
import type { App } from 'obsidian'
import { IDBFactory } from 'fake-indexeddb'
import { MemoryStateStore } from '@abele/sync-core'
import { encodeAccessToken } from '@abele/sync-protocol'
import { TokenEngines } from '@/sync/tokenEngines'
import { TokenUi } from '@/sync/tokenUi'
import { TokenConnectionRegistry } from '@/sync/tokenConnectionRegistry'
import { ExecutableReview } from '@/sync/executableReview'
import { AttachmentConsent } from '@/sync/attachmentConsent'
import { buildFakeVault } from '../helpers/fakeVault'

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
      let stopped = transport.mock.calls.length
      if (!revoked) {
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
    await ui.sync(second.id)
    expect(registry.records().map((one) => one.id)).toEqual([second.id])
  } finally {
    await host.close()
  }
})
