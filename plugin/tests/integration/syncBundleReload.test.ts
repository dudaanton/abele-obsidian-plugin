// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import type { App } from 'obsidian'
import * as obsidianExternal from 'obsidian'
import { v2Server } from '@abele/sync-server/tests/helpers/v2Server.js'
import { createUser } from '@abele/sync-server/src/access/tokens.js'
import { MemoryStateStore } from '@abele/sync-sdk/core'
import { TokenEngines } from '@/sync/tokenEngines'
import { TokenUi } from '@/sync/tokenUi'
import { TokenConnectionRegistry } from '@/sync/tokenConnectionRegistry'
import { ExecutableReview } from '@/sync/executableReview'
import { AttachmentConsent } from '@/sync/attachmentConsent'
import { buildFakeVault } from '../helpers/fakeVault'

it('opens no second ledger until an old token commit answer and bundle teardown have finished', async () => {
  vi.stubGlobal('window', globalThis)
  vi.stubGlobal('document', { visibilityState: 'visible' })
  const server = await v2Server()
  const user = await createUser(
    { db: server.db, pepper: server.config.tokenPepper },
    'Sample user',
    server.address
  )
  const app = buildFakeVault([{ path: 'Existing.md', content: 'existing', mtime: 1000 }])
  const keys = new Map<string, string>(),
    factory = new IDBFactory(),
    meta = new MemoryStateStore()
  const secrets = {
    get: (id: string) => keys.get(id) ?? null,
    set: (id: string, value: string) => {
      keys.set(id, value)
    },
    remove: (id: string) => {
      keys.delete(id)
    },
  }
  const reviews = {
    executables: new ExecutableReview(meta),
    attachments: new AttachmentConsent(meta),
    close: () => {},
  }
  let release!: () => void,
    entered!: () => void,
    armed = false
  const enteredPromise = new Promise<void>((resolve) => {
    entered = resolve
  })
  const hold = new Promise<void>((resolve) => {
    release = resolve
  })
  const fetcher: typeof fetch = async (input, init) => {
    const response = await globalThis.fetch(input, init)
    if (
      armed &&
      String(input).endsWith('/v2/commit') &&
      String(init?.body).includes('Pending.md')
    ) {
      entered()
      await hold
    }
    return response
  }
  const registry = TokenConnectionRegistry.open(app)
  const ui = new TokenUi(registry, secrets, fetcher, reviews)
  const socket = class {
    constructor() {
      throw Error('No test socket')
    }
  } as unknown as typeof WebSocket
  const old = new TokenEngines(app as unknown as App, ui, secrets.get, {
    indexedDB: factory,
    fetch: fetcher,
    WebSocket: socket,
  })
  const failed = vi.spyOn(old as any, 'failed')
  let fresh: TokenEngines | undefined
  let writing: Promise<unknown> | undefined
  try {
    await ui.connect(user.token)
    expect(failed.mock.calls.map((one) => (one[1] as Error).message)).toEqual([])
    const id = registry.records()[0].id
    await ui.sync(id)
    armed = true
    await app.vault.adapter.writeBinary(
      'Pending.md',
      new TextEncoder().encode('pending').buffer as ArrayBuffer,
      { mtime: 2000 }
    )
    writing = ui.sync(id).catch((error) => error)
    await enteredPromise
    const stopping = old.close()
    vi.resetModules()
    vi.doMock('obsidian', () => obsidianExternal)
    const next = await import('@/sync/tokenEngines')
    const nextUi = await import('@/sync/tokenUi')
    const nextRegistry = await import('@/sync/tokenConnectionRegistry')
    const nextRecords = nextRegistry.TokenConnectionRegistry.open(app)
    const controller = new nextUi.TokenUi(nextRecords, secrets, globalThis.fetch, reviews)
    const opening = vi.spyOn(factory, 'open')
    fresh = new next.TokenEngines(app as unknown as App, controller, secrets.get, {
      indexedDB: factory,
      fetch: globalThis.fetch,
      WebSocket: socket,
    })
    fresh.start()
    await new Promise<void>((resolve) => setImmediate(resolve))
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(opening).not.toHaveBeenCalled()
    release()
    await Promise.all([writing, stopping])
    await controller.connectionsChanged()
    await controller.sync(id)
    expect(opening).toHaveBeenCalled()
    expect(await app.vault.adapter.exists('Pending.md')).toBe(true)
  } finally {
    release()
    await writing
    await fresh?.close()
    await old.close()
    await server.close()
    vi.restoreAllMocks()
    vi.doUnmock('obsidian')
    vi.unstubAllGlobals()
  }
})
