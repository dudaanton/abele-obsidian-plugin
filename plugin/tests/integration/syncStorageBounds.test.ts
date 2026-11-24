import { expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import type { App } from 'obsidian'
import { HostSyncStorage } from '@/sync/hostSyncStorage'
import { SectionSettings } from '@/sync/abeleSectionEngine'
import { recordExternalOpening } from '@/sync/external/fileAccess'
import type { AbeleSettings } from '@/services/settingsShape'

const sectionsKey = 'abele-sync-settings-sections-v1'
const openedKey = 'abele-external-last-opened-v1'
function local() {
  const data = new Map<string, unknown>()
  return {
    data,
    vault: {},
    loadLocalStorage: (key: string) => structuredClone(data.get(key) ?? null),
    saveLocalStorage: (key: string, value: unknown) => {
      data.set(key, structuredClone(value))
    },
  }
}

it('moves long-lived section recovery and opening history out of local storage without loss', async () => {
  const app = local()
  const engine = new SectionSettings({
    read: () => null,
    write: (value) => app.saveLocalStorage(sectionsKey, value),
  })
  const settings = (i: number) =>
    ({ reader: { theme: `sample-${i}-` + 'x'.repeat(10000) } }) as unknown as AbeleSettings
  for (let i = 0; i < 100; i++) engine.receive(settings(i + 1), settings(i))
  const sections = app.loadLocalStorage(sectionsKey)
  const history = Object.fromEntries(
    Array.from({ length: 5000 }, (_, i) => [`Media/sample-${i}.png`, i + 1])
  )
  app.saveLocalStorage(openedKey, history)
  const save = app.saveLocalStorage
  const quota = JSON.stringify([...app.data]).length
  app.saveLocalStorage = (key, value) => {
    const next = new Map(app.data).set(key, value)
    if (JSON.stringify([...next]).length > quota) throw new Error('local quota exceeded')
    save(key, value)
  }
  const before = JSON.stringify([sections, history]).length
  const factory = new IDBFactory()
  let host = await HostSyncStorage.open(factory, 'sample-bounds', app)
  try {
    expect(app.loadLocalStorage(sectionsKey)).toBeNull()
    expect(app.loadLocalStorage(openedKey)).toBeNull()
    expect(host.loadLocalStorage(sectionsKey)).toEqual(sections)
    expect(host.loadLocalStorage(openedKey)).toEqual(history)
    recordExternalOpening(app as unknown as App, 'Media/recent.png')
    const next = new SectionSettings({
      read: () => host.loadLocalStorage(sectionsKey),
      write: (value) => host.saveLocalStorage(sectionsKey, value),
    })
    next.receive(settings(102), settings(101))
    await host.flush()
    const saved = host.loadLocalStorage(sectionsKey)
    host.close()
    host = await HostSyncStorage.open(factory, 'sample-bounds', app)
    expect(host.loadLocalStorage(sectionsKey)).toEqual(saved)
    expect(host.loadLocalStorage(openedKey)).toMatchObject(history)
    expect(
      (host.loadLocalStorage(openedKey) as Record<string, number>)['Media/recent.png']
    ).toBeGreaterThan(0)
    expect(app.loadLocalStorage(sectionsKey)).toBeNull()
    expect(app.loadLocalStorage(openedKey)).toBeNull()
    console.info('storage migration chars', {
      before,
      sectionsBefore: JSON.stringify(sections).length,
      openingsBefore: JSON.stringify(history).length,
      after: JSON.stringify([app.loadLocalStorage(sectionsKey), app.loadLocalStorage(openedKey)])
        .length,
    })
  } finally {
    host.close()
  }
})

it.each(['transaction', 'legacy cleanup'])(
  'retries section migration interrupted during %s',
  async (phase) => {
    const app = local()
    const value = { v: 1, chosen: ['reader'], local: {}, remote: {}, base: {}, kept: [] }
    app.saveLocalStorage(sectionsKey, value)
    const factory = new IDBFactory()
    const put = IDBObjectStore.prototype.put
    const crash =
      phase === 'transaction'
        ? vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
            this: IDBObjectStore,
            row,
            key
          ) {
            if (row.key === sectionsKey) {
              this.transaction.abort()
              throw new Error('interrupted')
            }
            return put.call(this, row, key)
          })
        : vi.spyOn(app, 'saveLocalStorage').mockImplementation(() => {
            throw new Error('interrupted')
          })
    try {
      await expect(HostSyncStorage.open(factory, 'sample-interruption', app)).rejects.toThrow(
        'interrupted'
      )
      expect(app.loadLocalStorage(sectionsKey)).toEqual(value)
    } finally {
      crash.mockRestore()
    }
    const host = await HostSyncStorage.open(factory, 'sample-interruption', app)
    try {
      expect(host.loadLocalStorage(sectionsKey)).toEqual(value)
      expect(app.loadLocalStorage(sectionsKey)).toBeNull()
    } finally {
      host.close()
    }
  }
)
