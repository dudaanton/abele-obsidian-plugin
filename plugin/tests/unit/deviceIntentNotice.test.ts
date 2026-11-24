import { afterEach, expect, it, vi } from 'vitest'
import { Notice } from 'obsidian'
import { IDBFactory, IDBDatabase as FakeDatabase } from 'fake-indexeddb'
import { DeviceIntentStore } from '@/services/DeviceIntentStore'
import { initializeLocale } from '@/i18n'
import { catalogs } from '@/i18n/catalogs'

const key = 'abele-node-session-owner-mode:["sample-node","sample-session"]'
const message =
  'Saved permission choices are unavailable. Actions remain restricted. Abele will retry on next use.'
const notices = () => (Notice as unknown as { shown: string[] }).shown
afterEach(() => {
  vi.restoreAllMocks()
  initializeLocale('en')
  window.localStorage.clear()
})

it('reports a startup outage even without legacy keys', async () => {
  notices().length = 0
  window.localStorage.clear()
  const factory = new IDBFactory()
  vi.spyOn(factory, 'open').mockImplementation(() => {
    throw new Error('unavailable')
  })
  await expect(
    new DeviceIntentStore({ appId: 'sample-startup' }, factory).migrate()
  ).rejects.toThrow('unavailable')
  expect(notices()).toEqual([message])
})

it('reports first-use failures once per outage, retries on next use and reports a later outage', async () => {
  notices().length = 0
  const app = { appId: 'sample-first-use' }
  const factory = new IDBFactory()
  const open = factory.open.bind(factory)
  let failed = false
  vi.spyOn(factory, 'open').mockImplementation((...args) => {
    if (failed) throw new Error('unavailable')
    return open(...args)
  })
  await new DeviceIntentStore(app, factory).write(key, 'confirm-all')
  failed = true
  await expect(new DeviceIntentStore(app, factory).read(key)).rejects.toThrow('unavailable')
  await expect(new DeviceIntentStore(app, factory).write(key, 'allow-all')).rejects.toThrow(
    'unavailable'
  )
  expect(notices()).toEqual([message])
  failed = false
  expect(await new DeviceIntentStore(app, factory).read(key)).toBe('confirm-all')
  failed = true
  await expect(new DeviceIntentStore(app, factory).read(key)).rejects.toThrow('unavailable')
  expect(notices()).toEqual([message, message])
})

it('localizes transaction-failure notices and propagates the failure', async () => {
  notices().length = 0
  initializeLocale('ru', catalogs.ru)
  const transaction = FakeDatabase.prototype.transaction
  vi.spyOn(FakeDatabase.prototype, 'transaction').mockImplementation(function (...args) {
    if (args[1] === 'readonly') throw new Error('transaction unavailable')
    return transaction.apply(this, args)
  })
  await expect(
    new DeviceIntentStore({ appId: 'sample-transaction' }, new IDBFactory()).read(key)
  ).rejects.toThrow('transaction unavailable')
  expect(notices()).toEqual([
    'Сохранённые разрешения недоступны. Действия ограничены. Повторим попытку при следующем обращении.',
  ])
})

it.each(['{broken', 'null', '"unknown-mode"', '{"mode":"allow-all"}'])(
  'treats malformed choice %s as missing, retains evidence through replacement and notifies once',
  async (raw) => {
    notices().length = 0
    const app = { appId: 'sample-malformed' }
    const factory = new IDBFactory()
    window.localStorage.setItem('sample-malformed-' + key, raw)
    await new DeviceIntentStore(app, factory).migrate()
    await expect(new DeviceIntentStore(app, factory).read(key)).resolves.toBeUndefined()
    expect(await new DeviceIntentStore(app, factory).readRaw(key)).toBe(raw)
    await expect(new DeviceIntentStore(app, factory).read(key)).resolves.toBeUndefined()
    expect(notices()).toEqual([message])
    expect(await new DeviceIntentStore(app, factory).legacyValues(key)).toContain(raw)
    await new DeviceIntentStore(app, factory).write(key, 'allow-edit')
    expect(await new DeviceIntentStore(app, factory).read(key)).toBe('allow-edit')
    expect(await new DeviceIntentStore(app, factory).legacyValues(key)).toContain(raw)
  }
)
