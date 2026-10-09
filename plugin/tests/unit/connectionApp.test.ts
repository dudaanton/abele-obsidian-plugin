import { expect, it } from 'vitest'
import type { App } from 'obsidian'
import { connectionApp, prepareConnectionApp } from '@/sync/connectionApp'
import { ConnectionRegistry } from '@/sync/connectionRegistry'
import { pendingTeardown, recordTeardown } from '@/sync/teardownBarrier'
import { IDBFactory } from 'fake-indexeddb'
import { retirePublicationStores } from '@/sync/publication/publicationRetirement'
import { connectionAppFor } from '@/sync/connectionApp'

function app(): App {
  const values = new Map<string, unknown>()
  return {
    vault: {
      adapter: {
        list: async () => ({ files: ['.abele-owner-publication-' + 'a'.repeat(64)], folders: [] }),
      },
    },
    loadLocalStorage: (key: string) => structuredClone(values.get(key) ?? null),
    saveLocalStorage: (key: string, value: unknown) => {
      values.set(key, structuredClone(value))
    },
  } as unknown as App
}

it('uses one stable app view, retains the vault and reload teardown barrier', async () => {
  const original = app()
  const adapted = await prepareConnectionApp(original)
  expect(connectionApp(original)).toBe(adapted)
  expect(connectionApp(adapted)).toBe(adapted)
  expect(adapted.vault).toBe(original.vault)
  let finish!: () => void
  recordTeardown(
    adapted,
    new Promise<void>((resolve) => {
      finish = resolve
    })
  )
  expect(pendingTeardown(original)).toBe(pendingTeardown(adapted))
  finish()
  await pendingTeardown(original)
})

it('migrates descriptors discovered through recovery sentinels before opening the view', async () => {
  const original = app()
  const key = 'abele-owner-publication:' + 'a'.repeat(64)
  original.saveLocalStorage(key, { id: 'original-publication' })
  const adapted = await prepareConnectionApp(original)
  expect(adapted.loadLocalStorage(key)).toEqual({ id: 'original-publication' })
  adapted.saveLocalStorage(key, { id: 'current-publication' })
  expect(original.loadLocalStorage(key)).toEqual({ id: 'original-publication' })
  expect(ConnectionRegistry.open(original).records()).toHaveLength(1)
})

it('leaves another connection publication sentinel and descriptor intact during Forget', async () => {
  const original = app()
  const adapted = await prepareConnectionApp(original)
  const registry = ConnectionRegistry.open(original)
  const second = registry.add('personal')
  const other = connectionAppFor(original, second)
  const key = 'abele-owner-publication:' + 'a'.repeat(64)
  other.saveLocalStorage(key, { id: 'other-publication-ledger' })
  await expect(
    retirePublicationStores(adapted, new IDBFactory(), null, true)
  ).resolves.toBeUndefined()
  expect(other.loadLocalStorage(key)).toEqual({ id: 'other-publication-ledger' })
  expect(adapted.loadLocalStorage(key)).toBeNull()
})
