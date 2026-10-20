import { expect, it } from 'vitest'
import { TokenConnectionRegistry } from '@/sync/tokenConnectionRegistry'
import { ConnectionEngines } from '@/sync/connectionEngines'
import { PathCoordinator } from '@/sync/pathCoordinator'
import { V2Client } from '@/sync/v2/client'
import {
  SyncEngine,
  V2EngineClient,
  MemoryFileSystem,
  MemoryStateStore,
  selectiveDefaults,
} from '@abele/sync-sdk/core'
import { encodeAccessToken } from '@abele/sync-sdk/protocol'

it('runs two token authorities over one host without a slow connection blocking the other', async () => {
  const data = new Map<string, unknown>(),
    keys = new Map<string, string>()
  const registry = TokenConnectionRegistry.open({
    loadLocalStorage: (key) => data.get(key),
    saveLocalStorage: (key, value) => {
      data.set(key, value)
    },
  })
  const secrets = {
    get: (ref: string) => keys.get(ref) ?? null,
    set: (ref: string, value: string) => {
      keys.set(ref, value)
    },
  }
  const scope = { kind: 'folder' as const, id: 'root', path: '/' }
  const ids = ['https://first.example', 'https://second.example'].map((address) => {
    const id = registry.add()
    registry.attach(
      id,
      { v: 1, address, key: 'a'.repeat(43), scope },
      { protocol: 2, token_id: 'token-a', space_id: 'space-a', scope, status: 'active' },
      secrets
    )
    return id
  })
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const locks = new PathCoordinator(),
    engines = new ConnectionEngines(),
    events: string[] = []
  const work = new Map<string, Promise<void>>()
  engines.start(
    ids,
    (id) => {
      const record = registry.records().find((item) => item.id === id)!
      const client = new V2Client(
        { v: 1, address: record.address, key: secrets.get(record.secretReference)!, scope },
        async () => {
          if (id === ids[0]) await gate
          return Response.json({
            protocol: 2,
            token_id: record.tokenId,
            space_id: record.spaceId,
            scope,
            status: 'active',
            limits: { max_file_bytes: 1000, quota_bytes: null },
          })
        }
      )
      let active = true
      return {
        start: () => {
          const pending = client.connection().then(() =>
            locks.run(['Shared/a.md'], async () => {
              if (!active) return
              registry.storage(id).saveLocalStorage('abele-sync-token-state:cursor', 7)
              events.push(id)
            })
          )
          work.set(id, pending)
          return pending
        },
        invalidate: () => {
          active = false
        },
        close: async () => {
          await work.get(id)
        },
      }
    },
    (_id, error) => {
      throw error
    }
  )
  await Promise.resolve()
  await work.get(ids[1])
  expect(events).toEqual([ids[1]])
  expect(registry.storage(ids[0]).loadLocalStorage('abele-sync-token-state:cursor')).toBeNull()
  release()
  await work.get(ids[0])
  expect(events).toEqual([ids[1], ids[0]])
  expect(registry.records()[0].ledgerId).not.toBe(registry.records()[1].ledgerId)
  await engines.close()
})

it('runs the production SyncEngine against a v2 connection without a legacy state route', async () => {
  const scope = { kind: 'folder' as const, id: 'root', path: '/' }
  const client = new V2EngineClient(
    encodeAccessToken({ v: 1, address: 'https://sync.example', key: 'a'.repeat(43), scope }),
    {
      fetch: async (url) => {
        if (new URL(String(url)).pathname !== '/v2/connection')
          return Response.json({ items: [], cursor: 1, next: null })
        return Response.json({
          protocol: 2,
          token_id: 'token-a',
          space_id: 'space-a',
          scope,
          status: 'active',
          limits: { max_file_bytes: 1000, quota_bytes: null },
        })
      },
    }
  )
  const engine = new SyncEngine({
    client,
    fs: new MemoryFileSystem(),
    state: new MemoryStateStore(),
    selective: selectiveDefaults(),
  })
  try {
    await expect(engine.sync()).resolves.toMatchObject({ pull: { applied: 0, cursor: 1 } })
  } finally {
    await engine.stop()
  }
})
