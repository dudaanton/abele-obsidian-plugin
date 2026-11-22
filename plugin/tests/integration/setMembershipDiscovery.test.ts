import { expect, it, vi } from 'vitest'
import { TokenUi } from '@/sync/tokenUi'
import { TokenConnectionRegistry } from '@/sync/tokenConnectionRegistry'
import { encodeAccessToken } from '@/sync/v2/contract'

it('discovers C automatically after connecting A+B, removing first item A, and restarting', async () => {
  const values = new Map<string, unknown>(),
    keys = new Map<string, string>()
  const storage = {
    loadLocalStorage: (key: string) => structuredClone(values.get(key) ?? null),
    saveLocalStorage: (key: string, value: unknown) => {
      values.set(key, structuredClone(value))
    },
  }
  const secrets = {
    get: (id: string) => keys.get(id) ?? null,
    set: (id: string, key: string) => {
      keys.set(id, key)
    },
    remove: (id: string) => {
      keys.delete(id)
    },
  }
  const items = ['A', 'B', 'C'].map((name) => ({
    id: 'item-' + name,
    scope_id: 'scope-' + name,
    scope: { kind: 'folder' as const, id: 'scope-' + name, path: name },
    added_at: '2025-01-01T00:00:00Z',
    removed_at: null,
  }))
  let current = items.slice(0, 2)
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const path = new URL(String(input)).pathname
    if (path === '/v2/connection/items') return Response.json({ items: current })
    if (path === '/v2/connection') {
      const item = items.find(
        (one) => one.id === new Headers(init?.headers).get('abele-scope-item')
      )!
      return Response.json({
        protocol: 2,
        token_id: 'sample-token',
        space_id: 'sample-space',
        scope: item.scope,
        status: 'active',
        limits: { max_file_bytes: 100000, quota_bytes: null },
      })
    }
    throw new Error('Unexpected request: ' + path)
  })
  const open = () => new TokenUi(TokenConnectionRegistry.open(storage), secrets, fetcher)
  let ui = open()
  await ui.connect(
    encodeAccessToken({
      v: 2,
      address: 'https://sync.example',
      key: 'a'.repeat(43),
      items: current.map((item) => ({
        id: item.id,
        kind: item.scope.kind,
        scope_id: item.scope_id,
        path: item.scope.path,
      })),
    })
  )
  const id = ui.rows.value[0].id
  const live = () =>
    new Set(
      ui.itemSets.store
        .get(id)!
        .items.filter((item) => !item.detached)
        .map((item) => item.recordId)
    )
  current = [items[1]]
  let running = live()
  expect(await ui.itemSets.refreshAll((id) => running.has(id))).toBe(true)
  expect(ui.itemSets.store.get(id)!.items[0]).toMatchObject({ recordId: id, detached: true })
  await ui.registry.flush()
  ui = open()
  running = live()
  expect(running.has(id)).toBe(false)
  current = items.slice(1)
  fetcher.mockClear()
  // Recovery/inspection must still gate discovery even though membership belongs to the set.
  expect(await ui.itemSets.refreshAll(() => false)).toBe(false)
  expect(fetcher).not.toHaveBeenCalled()
  expect(await ui.itemSets.refreshAll((id) => running.has(id))).toBe(true)
  const saved = ui.itemSets.store.get(id)!
  expect(saved.items.map((item) => [item.path, item.detached])).toEqual([
    ['A', true],
    ['B', false],
    ['C', false],
  ])
  expect(
    ui.registry
      .records()
      .some((record) => record.id === saved.items[2].recordId && record.scope?.path === 'C')
  ).toBe(true)
  expect(ui.rows.value.map((row) => row.id)).toEqual([id])
})
