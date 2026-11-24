import { expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { DeviceIntentStore } from '@/services/DeviceIntentStore'

const owner = 'abele-node-session-owner-mode:["sample-node","sample-session"]'
const slide = 'abele-slide-network:sample-deck.md'
const retired = 'abele-script-provenance-retired:sample-recovery'

it('migrates all intent families on startup, preserves false and evidence, and isolates vaults', async () => {
  window.localStorage.clear()
  const factory = new IDBFactory()
  const values = [
    JSON.stringify('allow-all'),
    'false',
    JSON.stringify({ id: 'old', damaged: ['evidence'] }),
  ]
  for (const [i, key] of [owner, slide, retired].entries())
    window.localStorage.setItem('sample-' + key, values[i]!)
  window.localStorage.setItem('other-' + slide, 'true')
  const store = new DeviceIntentStore({ appId: 'sample' }, factory, window.localStorage)
  await store.migrate()
  expect(window.localStorage.length).toBe(1)
  const reopened = new DeviceIntentStore({ appId: 'sample' }, factory, window.localStorage)
  expect(await reopened.read(owner)).toBe('allow-all')
  expect(await reopened.read(slide)).toBe(false)
  expect(await reopened.read(retired)).toEqual({ id: 'old', damaged: ['evidence'] })
  expect(
    await new DeviceIntentStore({ appId: 'other' }, factory, window.localStorage).read(slide)
  ).toBe(true)
})

it('retains legacy data on failure and retries interrupted cleanup without resurrecting stale intent', async () => {
  window.localStorage.clear()
  window.localStorage.setItem('sample-' + owner, JSON.stringify('allow-all'))
  const failing = {
    open() {
      throw new Error('unavailable')
    },
  } as unknown as IDBFactory
  await expect(
    new DeviceIntentStore({ appId: 'sample' }, failing, window.localStorage).migrate()
  ).rejects.toThrow()
  expect(window.localStorage.getItem('sample-' + owner)).not.toBeNull()
  const factory = new IDBFactory()
  const noCleanup = {
    get length() {
      return window.localStorage.length
    },
    key: (i: number) => window.localStorage.key(i),
    getItem: (key: string) => window.localStorage.getItem(key),
    removeItem() {
      throw new Error('interrupted cleanup')
    },
  }
  const first = new DeviceIntentStore({ appId: 'sample' }, factory, noCleanup)
  await first.migrate()
  await first.write(owner, 'confirm-all')
  const reopened = new DeviceIntentStore({ appId: 'sample' }, factory, window.localStorage)
  await reopened.migrate()
  expect(await reopened.read(owner)).toBe('confirm-all')
  expect(await reopened.legacyValues(owner)).toContain(JSON.stringify('allow-all'))
  expect(window.localStorage.length).toBe(0)
})

it('preserves malformed recovery evidence verbatim and does not allocate per-id memory caches', async () => {
  window.localStorage.clear()
  window.localStorage.setItem('sample-' + retired, '{damaged evidence')
  const store = new DeviceIntentStore({ appId: 'sample' }, new IDBFactory(), window.localStorage)
  await store.migrate()
  expect(await store.readRaw(retired)).toBe('{damaged evidence')
  for (let i = 0; i < 100; i++) await store.write('abele-slide-network:sample-' + i, false)
  expect(window.localStorage.length).toBe(0)
})

it('retains the legacy source if the import transaction aborts before commit', async () => {
  window.localStorage.clear()
  window.localStorage.setItem('sample-' + owner, JSON.stringify('allow-edit'))
  const factory = new IDBFactory()
  const request = factory.open('abele-device-intent:sample', 1)
  const db = await new Promise<IDBDatabase>((resolve) => {
    request.onupgradeneeded = () => {
      request.result.createObjectStore('values')
      request.result.createObjectStore('legacy')
    }
    request.onsuccess = () => resolve(request.result)
  })
  const transaction = db.transaction.bind(db)
  const spy = vi.spyOn(db, 'transaction').mockImplementation((...args) => {
    const tx = transaction(...args)
    queueMicrotask(() => tx.abort())
    return tx
  })
  const open = vi.spyOn(factory, 'open').mockImplementation(() => {
    const result = { result: db } as IDBOpenDBRequest
    queueMicrotask(() => result.onsuccess?.call(result, new Event('success')))
    return result
  })
  try {
    await expect(
      new DeviceIntentStore({ appId: 'sample' }, factory, window.localStorage).migrate()
    ).rejects.toThrow()
    expect(window.localStorage.getItem('sample-' + owner)).toBe(JSON.stringify('allow-edit'))
  } finally {
    spy.mockRestore()
    open.mockRestore()
    db.close()
  }
  const recovered = new DeviceIntentStore({ appId: 'sample' }, factory, window.localStorage)
  await recovered.migrate()
  expect(await recovered.read(owner)).toBe('allow-edit')
})
