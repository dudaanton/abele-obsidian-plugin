import { expect, it } from 'vitest'
import { phonePoolWipePlan, type PhoneWipeRow } from '@/testing/phonePoolWipe'
import { readFileSync } from 'node:fs'
const own = '11111111-1111-4111-8111-111111111111'
const foreign = '22222222-2222-4222-8222-222222222222'
const expected = { vault: 'sample-pool', appId: 'sample-vault', confirm: 'wipe-sync-phone-pool' }
const actual = { vault: expected.vault, appId: expected.appId }
const row = (namespace: string, ledgerId: string): PhoneWipeRow => ({
  database: 'abele-sync-host-v1',
  store: 'host',
  key: [namespace, 'abele-sync-connections-v2'],
  namespace,
  value: { records: [{ ledgerId }] },
})
it('selects only exact namespace rows and explicitly referenced ledger databases', () => {
  const rows = [row(actual.appId, own), row('other-vault', foreign)]
  rows[0].value = { records: [{ ledgerId: own, path: '[Sample].md' }] }
  const plan = phonePoolWipePlan(
    expected,
    actual,
    [own, foreign, 'obsidian', 'abele-sync-host-v1'],
    rows,
    []
  )
  expect(plan.databases).toEqual([own])
  expect(plan.rows).toEqual([rows[0]])
  expect(plan.paths).toEqual(['.abele-sync'])
})
it.each(['vault', 'appId', 'confirm'] as const)(
  'refuses a mismatched %s before selecting any effects',
  (key) => {
    expect(() => phonePoolWipePlan({ ...expected, [key]: 'wrong' }, actual, [], [], [])).toThrow()
  }
)
it('refuses database references shared with a foreign namespace', () => {
  expect(() =>
    phonePoolWipePlan(expected, actual, [own], [row(actual.appId, own), row('foreign', own)], [])
  ).toThrow(/foreign/)
})
it('refuses malformed and non-plugin references', () => {
  for (const bad of ['obsidian', 'abele-sync-host-v1', '../sample', 'not-a-ledger'])
    expect(() => phonePoolWipePlan(expected, actual, [bad], [row(actual.appId, bad)], [])).toThrow()
})
it('keeps foreign and unrelated local keys, and recognizes this vault review reference', () => {
  const plan = phonePoolWipePlan(
    expected,
    actual,
    ['abele-sync-reviews-' + own],
    [],
    [
      { namespace: actual.appId, key: 'abele-sync-device-review-id-v1', value: own },
      { namespace: 'other', key: 'abele-sync-device-review-id-v1', value: foreign },
      { namespace: actual.appId, key: 'workspace', value: 'keep' },
    ]
  )
  expect(plan.databases).toEqual(['abele-sync-reviews-' + own])
  expect(plan.keys).toEqual(['abele-sync-device-review-id-v1'])
})
it('ordinary phone setup never removes retained recovery or staged bytes', () => {
  const source = readFileSync('tests/e2e/helpers/phoneHost.ts', 'utf8')
  expect(source).not.toContain('CLEAR_SYNC_RECOVERY')
  expect(source).not.toContain('adapter.rmdir(dir + name, true)')
})

it.each(['vault', 'appId', 'confirm'] as const)(
  'performs zero effects with wrong %s',
  async (key) => {
    const { executePhonePoolWipe } = await import('@/testing/phonePoolWipe')
    const { vi } = await import('vitest')
    const effect = vi.fn(async () => {
      throw new Error('Unexpected effect')
    })
    await expect(
      executePhonePoolWipe(
        { ...expected, [key]: 'wrong' },
        {
          identity: () => ({ ...actual, phone: true }),
          stop: effect,
          snapshot: effect,
          erase: effect,
          reload: effect,
          verify: effect,
        }
      )
    ).rejects.toThrow(/independently/)
    expect(effect).not.toHaveBeenCalled()
  }
)

it('orders stop, inspection, exact erasure, reload and enrollment proof', async () => {
  const { executePhonePoolWipe } = await import('@/testing/phonePoolWipe')
  const order: string[] = []
  await executePhonePoolWipe(expected, {
    identity: () => ({ ...actual, phone: true }),
    stop: async () => {
      order.push('stop')
    },
    snapshot: async () => {
      order.push('snapshot')
      return { databases: [own], rows: [row(actual.appId, own)], local: [] }
    },
    erase: async (plan) => {
      order.push('erase')
      expect(plan.databases).toEqual([own])
      expect(plan.paths).toEqual(['.abele-sync'])
    },
    reload: async () => {
      order.push('reload')
    },
    verify: async () => {
      order.push('verify')
    },
  })
  expect(order).toEqual(['stop', 'snapshot', 'erase', 'reload', 'verify'])
})

it('refuses mismatched namespace keys even in a known shared plugin store', () => {
  expect(() =>
    phonePoolWipePlan(
      expected,
      actual,
      [own],
      [{ ...row(actual.appId, own), key: ['foreign', 'sample'] }],
      []
    )
  ).toThrow(/Cross-vault/)
})

it('preserves recovery bytes and their durable owner during ordinary readiness evaluation', async () => {
  const source = readFileSync('tests/e2e/helpers/phoneHost.ts', 'utf8')
  const start = source.indexOf('`(async () => {', source.indexOf('let matches = false'))
  const end = source.indexOf('`,', start)
  const body = source
    .slice(start + 1, end)
    .replace('${JSON.stringify(PHONE_VAULT)}', JSON.stringify('sample-pool'))
    .replace('${JSON.stringify(hashes)}', '{}')
  // Evaluate the real fast readiness body with a cut install's bytes and owner.
  const bytes = new Set(['.obsidian/plugins/abele/sync-staging/sample.incoming'])
  const owner = { target: 'Notes/sample.md', temp: [...bytes][0] }
  const app = {
    vault: {
      configDir: '.obsidian',
      getName: () => 'sample-pool',
      adapter: {
        exists: async (path: string) => [...bytes].some((one) => one.startsWith(path)),
        rmdir: async (path: string) => {
          for (const one of bytes) if (one.startsWith(path)) bytes.delete(one)
        },
      },
    },
    plugins: {},
  }
  const api = {}
  const page = { __abeleTest: api, __e2eInstalledBuild: { api, generation: 1, hashes: {} } }
  // The pre-fix deletion helper is intentionally supplied if still embedded.
  const helper = /const CLEAR_SYNC_RECOVERY = `([\s\S]*?)`/.exec(source)?.[1] ?? 'async () => false'
  const evaluate = new Function(
    'app',
    'window',
    'performance',
    `return ${body.replace('${CLEAR_SYNC_RECOVERY}', helper)}`
  )
  await evaluate(app, page, { timeOrigin: 1 })
  expect(bytes.has(owner.temp)).toBe(true)
  expect(owner.target).toBe('Notes/sample.md')
})

it.each([
  { valid: true, desktop: false },
  { valid: false, desktop: false },
  { valid: true, desktop: true },
  { valid: false, desktop: true },
])(
  'wipes real adapters only with a plugin ledger schema ($valid/$desktop)',
  async ({ valid, desktop }) => {
    const { IDBFactory } = await import('fake-indexeddb')
    const { HostSyncStorage } = await import('@/sync/hostSyncStorage')
    const { wipePhonePool, wipePool } = await import('@/testing/wipePhonePool')
    const wipe = desktop ? wipePool : wipePhonePool
    const request = desktop
      ? { ...expected, confirm: 'wipe-sync-pool', operation: 'syncWipePool' }
      : expected
    const { buildFakeVault } = await import('../helpers/fakeVault')
    const { Platform } = await import('obsidian')
    const platform = Platform as { isMobile: boolean; isDesktop: boolean }
    const prior = { isMobile: platform.isMobile, isDesktop: platform.isDesktop }
    const descriptor = Object.getOwnPropertyDescriptor(window, 'indexedDB')
    const factory = new IDBFactory()
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: factory })
    platform.isMobile = !desktop
    platform.isDesktop = desktop
    const base = buildFakeVault([
      { path: 'Notes/user.md', content: 'keep' },
      { path: '.abele-sync/private.bin', content: 'private' },
    ])
    const storage = (namespace: string) => ({
      loadLocalStorage: (key: string) =>
        JSON.parse(window.localStorage.getItem(namespace + '-' + key) ?? 'null') as unknown,
      saveLocalStorage: (key: string, value: unknown) =>
        window.localStorage.setItem(namespace + '-' + key, JSON.stringify(value)),
    })
    const { tokenOffloadsOf } = await import('@/sync/tokenOffloadCoordinator')
    const { pathCoordinatorOf } = await import('@/sync/pathCoordinator')
    const offloads = tokenOffloadsOf(base.vault, pathCoordinatorOf(base.vault))
    offloads.remember('sample-retired', [{ path: 'Media/sample.bin', size: 4, mtime: 1 }], [])
    const local = storage(actual.appId)
    const app = Object.assign(base, local, { appId: actual.appId })
    app.vault.getName = () => actual.vault
    let ownHost = await HostSyncStorage.open(factory, actual.appId, app)
    const other = await HostSyncStorage.open(factory, 'other-vault', storage('other-vault'))
    ownHost.saveLocalStorage('abele-sync-connections-v2', {
      records: [{ id: 'sample-own', ledgerId: own }],
    })
    other.saveLocalStorage('abele-sync-connections-v2', {
      records: [{ id: 'sample-foreign', ledgerId: foreign }],
    })
    await Promise.all([ownHost.flush(), other.flush()])
    const beforeForeign = await other.readValue('abele-sync-connections-v2')
    if (valid) {
      const { IndexedDbStateStore } = await import('@/sync/IndexedDbStateStore')
      const ledger = await IndexedDbStateStore.open(factory, own)
      ledger.close()
    }
    for (const name of [...(valid ? [] : [own]), foreign, 'obsidian']) {
      await new Promise<void>((resolve, reject) => {
        const open = factory.open(name, 1)
        open.onupgradeneeded = () => open.result.createObjectStore('sample')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          open.result.close()
          resolve()
        }
      })
    }
    Object.assign(app, {
      plugins: {
        plugins: { abele: { tokenHostStartup: { state: 'ready' }, tokenEngines: {} } },
        disablePlugin: async () => {},
        enablePlugin: async () => {
          ownHost = await HostSyncStorage.open(factory, actual.appId, app)
        },
      },
    })
    try {
      if (!valid) {
        await expect(wipe({ app } as never, request)).rejects.toThrow(
          'not a recognized plugin ledger'
        )
        // Reopen only for inspection: the failed wipe must leave namespace rows intact.
        ownHost = await HostSyncStorage.open(factory, actual.appId, app)
        expect(await ownHost.readValue('abele-sync-connections-v2')).toMatchObject({
          records: [{ ledgerId: own }],
        })
        expect(await app.vault.adapter.exists('.abele-sync/private.bin')).toBe(true)
        return
      }
      const result = await wipe({ app } as never, request)
      expect(result.databases).toEqual([own])
      expect(offloads.files()).toEqual([])
      const names = (await factory.databases()).map((db) => db.name)
      expect(names).toContain(foreign)
      expect(names).toContain('obsidian')
      expect(names).toContain('abele-sync-host-v1')
      expect(names).not.toContain(own)
      expect(await other.readValue('abele-sync-connections-v2')).toEqual(beforeForeign)
      expect(await app.vault.adapter.read('Notes/user.md')).toBe('keep')
      expect(await app.vault.adapter.exists('.abele-sync')).toBe(false)
    } finally {
      ownHost.close()
      other.close()
      Object.assign(platform, prior)
      if (descriptor) Object.defineProperty(window, 'indexedDB', descriptor)
      else Reflect.deleteProperty(window, 'indexedDB')
      for (const key of Object.keys(window.localStorage))
        if (key.startsWith(actual.appId + '-') || key.startsWith('other-vault-'))
          window.localStorage.removeItem(key)
    }
  }
)

it('performs zero effects when invoked on a desktop host', async () => {
  const { executePhonePoolWipe } = await import('@/testing/phonePoolWipe')
  const { vi } = await import('vitest')
  const effect = vi.fn(async () => {
    throw new Error('Unexpected effect')
  })
  await expect(
    executePhonePoolWipe(expected, {
      identity: () => ({ ...actual, phone: false }),
      stop: effect,
      snapshot: effect,
      erase: effect,
      reload: effect,
      verify: effect,
    })
  ).rejects.toThrow('Real phone pool required')
  expect(effect).not.toHaveBeenCalled()
})

it('allows the explicit desktop operation with independent vault identity and exact confirmation', async () => {
  const { executePoolWipe } = await import('@/testing/phonePoolWipe')
  const calls: string[] = []
  const result = await executePoolWipe(
    { ...expected, confirm: 'wipe-sync-pool', operation: 'syncWipePool' } as typeof expected,
    {
      identity: () => ({ ...actual, phone: false }),
      stop: async () => {
        calls.push('stop')
      },
      snapshot: async () => ({ databases: [], rows: [], local: [] }),
      erase: async (plan) => {
        calls.push('erase')
        expect(plan.paths).toEqual(['.abele-sync'])
      },
      reload: async () => {
        calls.push('reload')
      },
      verify: async () => {
        calls.push('verify')
      },
    }
  )
  expect(result.paths).toEqual(['.abele-sync'])
  expect(calls).toEqual(['stop', 'erase', 'reload', 'verify'])
})

it.each(['vault', 'appId', 'confirm', 'operation'])(
  'performs zero desktop effects for invalid %s',
  async (key) => {
    const { executePoolWipe } = await import('@/testing/phonePoolWipe')
    const { vi } = await import('vitest')
    const effect = vi.fn(async () => {
      throw new Error('Unexpected effect')
    })
    await expect(
      executePoolWipe(
        {
          ...expected,
          confirm: 'wipe-sync-pool',
          operation: 'syncWipePool',
          [key]: 'wrong',
        },
        {
          identity: () => ({ ...actual, phone: false }),
          stop: effect,
          snapshot: effect,
          erase: effect,
          reload: effect,
          verify: effect,
        }
      )
    ).rejects.toThrow()
    expect(effect).not.toHaveBeenCalled()
  }
)

it('pins the approved identity across awaited stop even if the caller edits its request', async () => {
  const { executePoolWipe } = await import('@/testing/phonePoolWipe')
  const { vi } = await import('vitest')
  const request = { ...expected, confirm: 'wipe-sync-pool', operation: 'syncWipePool' }
  const identity = { ...actual, phone: false }
  const erase = vi.fn(async () => {})
  await expect(
    executePoolWipe(request, {
      identity: () => identity,
      stop: async () => {
        identity.appId = request.appId = 'foreign-vault'
      },
      snapshot: async () => ({ databases: [], rows: [], local: [] }),
      erase,
      reload: async () => {},
      verify: async () => {},
    })
  ).rejects.toThrow(/independently/)
  expect(erase).not.toHaveBeenCalled()
})
