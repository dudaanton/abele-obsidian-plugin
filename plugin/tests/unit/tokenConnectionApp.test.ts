import { expect, it } from 'vitest'
import type { App } from 'obsidian'
import { connectionApp, connectionAppFor } from '@/sync/connectionApp'
import { ConnectionRegistry, selectedConnectionStorage } from '@/sync/connectionRegistry'
import { pendingTeardown, recordTeardown } from '@/sync/teardownBarrier'

it('binds token state to its stable ID across selection changes and shares the reload barrier', async () => {
  const data = new Map<string, unknown>()
  const app = {
    vault: {},
    loadLocalStorage: (key: string) => structuredClone(data.get(key) ?? null),
    saveLocalStorage: (key: string, value: unknown) => {
      data.set(key, structuredClone(value))
    },
  } as unknown as App
  const registry = ConnectionRegistry.open(app),
    first = registry.add(),
    second = registry.add()
  const one = connectionApp(app),
    two = connectionAppFor(app, second)
  one.saveLocalStorage('abele-sync-token-state:checkpoint', 11)
  two.saveLocalStorage('abele-sync-token-state:checkpoint', 22)
  registry.select(second)
  expect(one.loadLocalStorage('abele-sync-token-state:checkpoint')).toBe(11)
  expect(selectedConnectionStorage(app).loadLocalStorage('abele-sync-token-state:checkpoint')).toBe(
    22
  )
  expect(one.vault).toBe(app.vault)
  expect(registry.records().map((record) => record.kind)).toEqual(['token', 'token'])
  expect(registry.records().map((record) => record.id)).toEqual([first, second])
  let finish!: () => void
  recordTeardown(
    one,
    new Promise<void>((resolve) => {
      finish = resolve
    })
  )
  expect(pendingTeardown(app)).toBe(pendingTeardown(one))
  finish()
  await pendingTeardown(app)
})
it('cannot resurrect retired access slots through a new token context', () => {
  const data = new Map<string, unknown>([['abele-sync-connection', { deviceTokenId: 'old-key' }]])
  const app = {
    vault: {},
    loadLocalStorage: (key: string) => data.get(key) ?? null,
    saveLocalStorage: (key: string, value: unknown) => {
      data.set(key, value)
    },
  } as unknown as App
  const view = connectionApp(app)
  expect(view.loadLocalStorage('abele-sync-connection')).toBeNull()
  expect(() =>
    view.saveLocalStorage('abele-sync-connection', { deviceTokenId: 'old-key' })
  ).toThrow(/retired/i)
})
