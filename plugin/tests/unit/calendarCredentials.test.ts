import { describe, expect, it, vi } from 'vitest'
import { CalendarService } from '@/calendars/CalendarService'
import { CredentialGenerations } from '@/secrets/credentialGenerations'
import { newFeed } from '@/calendars/settings'

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
    const first = new CredentialGenerations(keychain)
    expect(first.get('sample-key', 'sample-secret')).toBe(1)
    expect(first.get('sample-key', 'sample-secret')).toBe(1)
    expect(first.get('other-key', 'other-secret')).toBe(1)
    expect(new CredentialGenerations(keychain).get('sample-key', 'sample-secret')).toBe(1)
    expect(first.get('sample-key', 'changed-secret')).toBe(2)
    expect(first.get('sample-key', '')).toBe(3)
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
