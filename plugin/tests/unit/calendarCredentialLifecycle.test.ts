import { afterEach, describe, expect, it, vi } from 'vitest'
afterEach(() => vi.restoreAllMocks())
import { SecretStore, type Keychain, type StoreHost } from '@/secrets/SecretStore'
import { CalendarService } from '@/calendars/CalendarService'
import { newFeed } from '@/calendars/settings'

const memory = () => {
  const values = new Map<string, string>()
  const keychain: Keychain = {
    getSecret: (id) => values.get(id) ?? null,
    setSecret: (id, value) => {
      values.set(id, value)
    },
    deleteSecret: (id) => values.delete(id),
  }
  let file: unknown = null
  const host: StoreHost = {
    keychain: () => keychain,
    read: () => file,
    write: async (next) => {
      file = next
    },
    ids: () => ['sample-calendar-key'],
    conflictCopies: async () => [],
    now: () => Date.now(),
  }
  return new SecretStore(host)
}

const ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n'
describe('calendar credential lifecycle through the secret store', () => {
  it('changes its clock on lock, unlock and removal, but not unrelated keys or identical writes', async () => {
    const store = memory()
    store.set('sample-calendar-key', 'sample-credential')
    const initial = store.credentialGeneration('sample-calendar-key')
    store.set('unrelated-key', 'other-value')
    store.set('sample-calendar-key', 'sample-credential')
    expect(store.credentialGeneration('sample-calendar-key')).toBe(initial)
    await store.enable('sample-passphrase', { iterations: 1000 })
    expect(store.credentialGeneration('sample-calendar-key')).toBe(initial)
    await store.lock()
    expect(store.get('sample-calendar-key')).toBe('')
    expect(store.credentialGeneration('sample-calendar-key')).toBe(initial + 1)
    await store.unlock('sample-passphrase')
    expect(store.get('sample-calendar-key')).toBe('sample-credential')
    expect(store.credentialGeneration('sample-calendar-key')).toBe(initial + 2)
    store.remove('sample-calendar-key')
    expect(store.credentialGeneration('sample-calendar-key')).toBe(initial + 3)
    await store.flush()
  })

  it('keeps a cosmetic feed rename cached but invalidates a different credential id and a copied cache', async () => {
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.1).mockReturnValueOnce(0.2).mockReturnValue(0.3)
    const first = memory(),
      second = memory()
    first.set('sample-calendar-key', 'https://sample.invalid/one.ics')
    second.set('sample-calendar-key', 'https://sample.invalid/two.ics')
    first.set('renamed-key', 'https://sample.invalid/one.ics')
    const feed = { ...newFeed([]), id: 'sample-feed', keyId: 'sample-calendar-key' }
    let kept = '',
      calls = 0
    const storage = {
      read: async () => kept,
      write: async (text: string) => {
        kept = text
      },
    }
    const make = (store: SecretStore) =>
      new CalendarService({
        storage,
        settings: () => ({ refreshMinutes: 30, feeds: [feed] }),
        secret: (id) => store.get(id),
        credentialGeneration: (id) => store.credentialGeneration(id),
        request: async () => {
          calls++
          return { status: 200, text: ics, headers: {} }
        },
      })
    const service = make(first)
    await service.refresh()
    feed.name = 'Renamed sample calendar'
    await service.refreshChanged()
    expect(calls).toBe(1)
    const copied = make(second)
    await copied.load()
    expect(copied.state.events[feed.id]).toBeUndefined()
    await copied.refreshChanged()
    expect(calls).toBe(2)
    feed.keyId = 'renamed-key'
    await service.refreshChanged()
    expect(calls).toBe(3)
    expect(kept).not.toMatch(/one\.ics|two\.ics|checksum|sample-credential/)
  })
})
