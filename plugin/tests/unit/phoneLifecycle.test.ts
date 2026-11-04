import { expect, it } from 'vitest'
import { phoneLifecycle } from '../e2e/helpers/phoneLifecycle'

function page(storage = new Map<string, string>(), origin = 100) {
  const win = new EventTarget() as EventTarget & Record<string, unknown>
  const doc = new EventTarget() as EventTarget & Record<string, unknown>
  doc.visibilityState = 'visible'
  Object.assign(win, {
    document: doc,
    performance: {
      timeOrigin: origin,
      getEntriesByType: () => [{ type: 'reload', name: 'private-url' }],
    },
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  })
  return win as unknown as Window
}

it('preserves the previous load action and lifecycle events when the page is replaced', () => {
  const storage = new Map<string, string>()
  const old = page(storage)
  phoneLifecycle(old, 'open group server-delete preview')
  old.dispatchEvent(new Event('beforeunload'))
  old.dispatchEvent(new Event('pagehide'))
  const next = page(storage, 200)
  const evidence = phoneLifecycle(next).snapshot()
  expect(evidence.current).toMatchObject({ timeOrigin: 200, navigation: 'reload' })
  expect(evidence.previous).toMatchObject({
    timeOrigin: 100,
    action: 'open group server-delete preview',
  })
  expect(evidence.previous?.events.map((one) => one.kind)).toEqual(['beforeunload', 'pagehide'])
  phoneLifecycle(next, 'case-start')
  expect(phoneLifecycle(next).snapshot().previous).toEqual(evidence.previous)
})

it('records visibility and navigation intent without private text or URLs and installs once', () => {
  const win = page()
  const first = phoneLifecycle(win, 'private filename and token')
  expect(phoneLifecycle(win)).toBe(first)
  for (let n = 0; n < 30; n++) win.document.dispatchEvent(new Event('visibilitychange'))
  win.document.dispatchEvent(new Event('submit'))
  const json = JSON.stringify(first.snapshot())
  expect(first.snapshot().current.events).toHaveLength(16)
  expect(first.snapshot().current.events.at(-1)?.kind).toBe('submit')
  expect(json).not.toMatch(/private|token|filename|url/i)
  expect(first.snapshot().current.action).toBe('sync-action')
})

it('survives denied storage and malformed persisted data without changing the action', () => {
  const win = page()
  Object.defineProperty(win, 'sessionStorage', {
    get() {
      throw new Error('denied')
    },
  })
  expect(() => phoneLifecycle(win, 'type-focus')).not.toThrow()
  expect(phoneLifecycle(win).snapshot().storageAvailable).toBe(false)
  const bad = new Map([['abele-e2e-phone-lifecycle-v1', '{bad']])
  expect(phoneLifecycle(page(bad)).snapshot().previous).toBeNull()
})

it('rejects untrusted persisted fields and works when serialized into the page', () => {
  const win = page(
    new Map([
      [
        'abele-e2e-phone-lifecycle-v1',
        JSON.stringify({
          timeOrigin: 10,
          action: 'secret',
          navigation: 'private-url',
          events: [{ kind: 'secret', text: 'secret' }],
          token: 'secret',
        }),
      ],
    ])
  )
  const injected = new Function(
    'return (' + phoneLifecycle.toString() + ')'
  )() as typeof phoneLifecycle
  const result = injected(win).snapshot()
  expect(JSON.stringify(result)).not.toContain('secret')
  expect(JSON.stringify(result)).not.toContain('private-url')
})
