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
