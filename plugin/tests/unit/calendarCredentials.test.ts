import { describe, expect, it, vi } from 'vitest'
import { CalendarService } from '@/calendars/CalendarService'
import { CredentialGenerations } from '@/secrets/credentialGenerations'
import { newFeed } from '@/calendars/settings'
import { isKeychainId } from '@/secrets/keychainId'

const ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n'
describe('calendar cache credential generations', () => {
  it('keeps generations in the keychain, survives restart and changes only with that credential', () => {
    const values = new Map<string, string>()
    const keychain = {
      getSecret: (id: string) => values.get(id) ?? null,
      setSecret: (id: string, v: string) => {
        values.set(id, v)
      },
    }
    const first = new CredentialGenerations(keychain, () => 0)
    expect(first.get('sample-key', 'sample-secret')).toBe(1)
    expect(first.get('sample-key', 'sample-secret')).toBe(1)
    expect(first.get('other-key', 'other-secret')).toBe(1)
    expect(new CredentialGenerations(keychain, () => 0).get('sample-key', 'sample-secret')).toBe(1)
    expect(first.get('sample-key', 'changed-secret')).toBe(2)
    expect(first.get('sample-key', '')).toBe(3)
  })

  it('uses bounded, stable and distinct generation slots for every accepted credential id length', () => {
    const values = new Map<string, string>()
    const written: string[] = []
    const keychain = {
      getSecret: (id: string) => values.get(id) ?? null,
      setSecret: (id: string, value: string) => {
        expect(isKeychainId(id)).toBe(true)
        written.push(id)
        values.set(id, value)
      },
    }
    const ids = [
      ...Array.from({ length: 64 }, (_, i) => 'x'.repeat(i + 1)),
      'sample-'.padEnd(64, 'a'),
      'sample-'.padEnd(63, 'a') + 'b',
      '0-'.repeat(32),
    ]
    expect(ids.every(isKeychainId)).toBe(true)
    for (const id of ids)
      expect(new CredentialGenerations(keychain, () => 0).get(id, 'first')).toBe(1)
    const firstSlots = [...written]
    expect(new Set(firstSlots).size).toBe(ids.length)
    written.length = 0
    for (const id of ids)
      expect(new CredentialGenerations(keychain, () => 0).get(id, 'second')).toBe(2)
    expect(written).toEqual(firstSlots)
    expect(firstSlots[0]).toBe('abele-calendar-generation-x')
  })

  it.each(['getSecret', 'setSecret'] as const)(
    'continues refreshing and detects credential edits when generation %s fails',
    async (failure) => {
      const feed = { ...newFeed([]), id: 'sample-failure', keyId: 'sample-key' }
      let secret = 'https://sample.invalid/first.ics',
        seed = 0,
        kept = ''
      const keychain = {
        getSecret: () => null,
        setSecret: () => {},
      }
      vi.spyOn(keychain, failure).mockImplementation(() => {
        throw new Error('Sample keychain unavailable')
      })
      const request = vi.fn(async () => ({ status: 200, text: ics, headers: {} }))
      const service = new CalendarService({
        storage: {
          read: async () => kept,
          write: async (text) => {
            kept = text
          },
        },
        settings: () => ({ refreshMinutes: 30, feeds: [feed] }),
        secret: () => secret,
        credentialGeneration: (id) =>
          new CredentialGenerations(keychain, () => ++seed * 100).get(id, secret),
        request,
      })
      await expect(service.refresh()).resolves.toBeUndefined()
      expect(request).toHaveBeenCalledOnce()
      expect(service.state.events[feed.id]).toEqual([])
      expect(service.state.status[feed.id]).toMatchObject({ reading: false, error: null })
      const first = JSON.parse(kept).feeds[feed.id].fingerprint
      await service.refreshChanged()
      expect(request).toHaveBeenCalledOnce()
      secret = 'https://sample.invalid/second.ics'
      await service.refreshChanged()
      expect(request).toHaveBeenCalledTimes(2)
      expect(JSON.parse(kept).feeds[feed.id].fingerprint).not.toBe(first)
      expect(kept).not.toMatch(/first\.ics|second\.ics|checksum/)
    }
  )

  it('reports an unavailable credential per feed without blocking other feeds or later refreshes', async () => {
    const feeds = ['sample-key', 'other-key'].map((keyId) => ({ ...newFeed([]), id: keyId, keyId }))
    let unavailable = true
    const secret = (id: string) => {
      if (id === 'sample-key' && unavailable) throw new Error('Sample keychain unavailable')
      return `https://sample.invalid/${id}.ics`
    }
    const request = vi.fn(async () => ({ status: 200, text: ics, headers: {} }))
    const service = new CalendarService({
      storage: null,
      settings: () => ({ refreshMinutes: 30, feeds }),
      secret,
      credentialGeneration: (id) => {
        secret(id)
        return 100
      },
      request,
    })
    await expect(service.refresh()).resolves.toBeUndefined()
    expect(service.state.status['sample-key']).toMatchObject({
      reading: false,
      error: 'Sample keychain unavailable',
    })
    expect(service.state.events['other-key']).toEqual([])
    expect(request).toHaveBeenCalledOnce()
    unavailable = false
    await service.refreshChanged()
    expect(service.state.events['sample-key']).toEqual([])
    expect(service.state.status['sample-key'].error).toBeNull()
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('does not reuse a copied cache clock when generation metadata is absent on another device', () => {
    const keychain = () => {
      const values = new Map<string, string>()
      return {
        getSecret: (id: string) => values.get(id) ?? null,
        setSecret: (id: string, value: string) => {
          values.set(id, value)
        },
      }
    }
    const original = new CredentialGenerations(keychain(), () => 100)
    const replacement = new CredentialGenerations(keychain(), () => 200)
    expect(original.get('sample-key', 'sample-secret')).toBe(101)
    expect(replacement.get('sample-key', 'different-secret')).toBe(201)
    expect(replacement.get('sample-key', 'different-secret')).toBe(201)
  })

  it('discards an old in-flight response and retries with the changed generation', async () => {
    const feed = { ...newFeed([]), id: 'sample-flight', keyId: 'sample-key' }
    let revision = 1
    let kept = ''
    let finish!: (response: { status: number; text: string; headers: {} }) => void
    const pending = new Promise<{ status: number; text: string; headers: {} }>((resolve) => {
      finish = resolve
    })
    const request = vi
      .fn()
      .mockImplementationOnce(() => pending)
      .mockResolvedValue({ status: 200, text: ics, headers: {} })
    const service = new CalendarService({
      storage: {
        read: async () => null,
        write: async (text) => {
          kept = text
        },
      },
      settings: () => ({ refreshMinutes: 30, feeds: [feed] }),
      secret: () => 'https://sample.invalid/calendar.ics',
      credentialGeneration: () => revision,
      request,
    })
    const first = service.refresh()
    while (!request.mock.calls.length) await Promise.resolve()
    revision++
    const second = service.refreshChanged()
    finish({ status: 200, text: ics, headers: {} })
    await Promise.all([first, second])
    expect(request).toHaveBeenCalledTimes(2)
    expect(JSON.parse(kept).version).toBe(2)
  })

  it('never makes cache fingerprints a verifier for guessed passwords, and rejects legacy caches', async () => {
    const feed = { ...newFeed([]), id: 'sample-calendar', keyId: 'sample-key' }
    let kept = ''
    let revision = 1
    const request = vi.fn(async () => ({ status: 200, text: ics, headers: {} }))
    const make = (password: string) =>
      new CalendarService({
        storage: {
          read: async () => kept,
          write: async (text) => {
            kept = text
          },
        },
        settings: () => ({ refreshMinutes: 30, feeds: [feed] }),
        secret: () => password,
        credentialGeneration: () => revision,
        request,
        now: () => Date.UTC(2024, 0, 1),
      })
    await make('https://sample.invalid/first-secret.ics').refresh()
    const first = JSON.parse(kept).feeds[feed.id].fingerprint
    kept = ''
    await make('https://sample.invalid/second-secret.ics').refresh()
    expect(JSON.parse(kept).feeds[feed.id].fingerprint).toBe(first)
    expect(kept).not.toMatch(/first-secret|second-secret/)
    revision++
    await make('https://sample.invalid/second-secret.ics').refreshChanged()
    expect(JSON.parse(kept).feeds[feed.id].fingerprint).not.toBe(first)
    kept = JSON.stringify({
      version: 1,
      feeds: { [feed.id]: { fingerprint: first, at: 1, events: [] } },
    })
    const migrated = make('https://sample.invalid/second-secret.ics')
    await migrated.load()
    expect(migrated.state.events[feed.id]).toBeUndefined()
    await migrated.refreshChanged()
    expect(JSON.parse(kept).version).toBe(2)
  })
})
