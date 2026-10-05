import { afterEach, expect, it, vi } from 'vitest'
import { manualKeyConsentProbe } from '../helpers/manualKeyConsentProbe'

const KEYS = ['abele-key-destinations-v1', 'abele-key-http-origins-v1']
afterEach(() => {
  delete (window as any).__sampleManualConsent
  vi.useRealTimers()
})

/** Executes the actual factory's snapshot and cleanup closures, without any app or live vault. */
it.each(['absent', 'null', 'object'])(
  'restores only owned entries with %s snapshot semantics and leaves foreign interleavings intact',
  async (kind) => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    const raw: Record<string, string> = {}
    const storage = {
      getItem: (key: string) => raw[key] ?? null,
      setItem: (key: string, value: string) => {
        raw[key] = value
      },
      removeItem: (key: string) => {
        delete raw[key]
      },
    }
    const globalStorage = new Proxy(storage, {
      ownKeys: () => Object.keys(raw),
      getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
    })
    const original = kind === 'object' ? { sample: ['original'] } : null
    const namespace = (vault: string, key: string) => `${vault}:${key}`
    if (kind !== 'absent') raw[namespace('sample-owned', KEYS[0])] = JSON.stringify(original)
    raw[namespace('sample-foreign', KEYS[0])] = JSON.stringify({ sample: ['foreign-before'] })
    const loaded: Record<string, any> = {}
    const app = {
      vault: { getName: () => 'sample-owned', getConfig: () => 'sample-theme' },
      loadLocalStorage: vi.fn((key: string) => {
        const value = raw[namespace('sample-owned', key)]
        return loaded[key] ?? (loaded[key] = value === undefined ? null : JSON.parse(value))
      }),
      saveLocalStorage: vi.fn((key: string, value: any) => {
        if (value == null) delete raw[namespace('sample-owned', key)]
        else raw[namespace('sample-owned', key)] = JSON.stringify(value)
        loaded[key] = value
      }),
      workspace: {
        activeLeaf: { id: 'sample-leaf' },
        getLayout: () => ({ active: 'sample-leaf' }),
        getLeavesOfType: () => [],
        iterateAllLeaves: (visit: any) => visit({ id: 'sample-leaf' }),
        setActiveLeaf: () => {},
      },
    }
    const config = { ai: { secrets: [] }, saveSettings: async () => {} }
    const api = {
      AbeleConfig: { getInstance: () => config },
      secrets: () => ({ get: () => '', remove: () => {}, flush: async () => {} }),
      networkSecurity: { setRequestTransport: () => {} },
    }
    const win = { __abeleTest: api, __sampleManualConsent: undefined }
    const doc = {
      activeElement: { blur: () => {}, matches: () => false },
      documentElement: {},
      addEventListener: () => {},
      removeEventListener: () => {},
    }
    const code = manualKeyConsentProbe('/sample', 'sample-token', false)
    const boundary = code.indexOf('    const field=')
    expect(boundary).toBeGreaterThan(0)
    const prefix = code.slice(0, boundary) + 'return s\n})()'
    const probe = await new Function(
      'app',
      'window',
      'document',
      'localStorage',
      'screen',
      'innerHeight',
      'innerWidth',
      'visualViewport',
      'getComputedStyle',
      'setTimeout',
      `return ${prefix}`
    )(
      app,
      win,
      doc,
      globalStorage,
      { width: 1280, height: 800 },
      800,
      1280,
      { height: 800, offsetTop: 0 },
      () => ({ getPropertyValue: () => '0' }),
      setTimeout
    )
    // Mutate returned owned objects too: a retained API object must not mutate the detached snapshot.
    if (kind === 'object') app.loadLocalStorage(KEYS[0]).sample.push('mutated-live-object')
    app.saveLocalStorage(KEYS[0], { sample: ['fixture'] })
    app.saveLocalStorage(KEYS[1], ['fixture'])
    raw[namespace('sample-foreign', KEYS[0])] = JSON.stringify({ sample: ['foreign-updated'] })
    raw[namespace('sample-foreign', KEYS[1])] = JSON.stringify(['foreign-created'])
    const done = probe.cleanup()
    await vi.runAllTimersAsync()
    await done
    expect(raw[namespace('sample-foreign', KEYS[0])]).toBe(
      JSON.stringify({ sample: ['foreign-updated'] })
    )
    expect(raw[namespace('sample-foreign', KEYS[1])]).toBe(JSON.stringify(['foreign-created']))
    expect(app.loadLocalStorage(KEYS[0])).toEqual(original)
    expect(app.loadLocalStorage(KEYS[1])).toBeNull()
    expect(app.saveLocalStorage.mock.calls.every(([key]) => KEYS.includes(key))).toBe(true)
  }
)
