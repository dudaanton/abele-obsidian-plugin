import { expect, it, vi } from 'vitest'
import { phonePoolWipePlan, type PhoneWipeRow } from '@/testing/phonePoolWipe'
import { readFileSync } from 'node:fs'
const own = '11111111-1111-4111-8111-111111111111'
const foreign = '22222222-2222-4222-8222-222222222222'
const expected = { vault: 'sample-pool', appId: 'sample-vault', confirm: 'wipe-sync-phone-pool' }
const actual = { vault: expected.vault, appId: expected.appId }
it('accepts the mobile documents namespace only on a phone', async () => {
  const { validPoolAppId } = await import('@/testing/phonePoolWipe')
  expect(validPoolAppId('documents/sample-pool', true)).toBe(true)
  expect(validPoolAppId('documents/sample-pool', false)).toBe(false)
  expect(validPoolAppId('sample-vault', false)).toBe(true)
})
it.each([
  'documents/../sample',
  'documents//sample',
  '/documents/sample',
  'documents/sample/',
  'documents/sample/nested',
  'documents/.',
  'documents/..',
  'documents/',
  'other/sample',
  'documents/sample.name',
  'documents/' + 'x'.repeat(128),
])('rejects malformed mobile identity %s without effects', async (appId) => {
  const { executePoolWipe } = await import('@/testing/phonePoolWipe')
  const { vi } = await import('vitest')
  const effect = vi.fn(async () => {
    throw new Error('Unexpected effect')
  })
  await expect(
    executePoolWipe(
      { ...expected, appId, confirm: 'wipe-sync-pool', operation: 'syncWipePool' },
      {
        identity: () => ({ ...actual, appId, phone: true }),
        stop: effect,
        snapshot: effect,
        erase: effect,
        reload: effect,
        verify: effect,
      }
    )
  ).rejects.toThrow()
  expect(effect).not.toHaveBeenCalled()
})
it('refuses a different loaded mobile namespace with zero effects', async () => {
  const { executePoolWipe } = await import('@/testing/phonePoolWipe')
  const { vi } = await import('vitest')
  const effect = vi.fn(async () => {
    throw new Error('Unexpected effect')
  })
  await expect(
    executePoolWipe(
      {
        ...expected,
        appId: 'documents/sample-pool',
        confirm: 'wipe-sync-pool',
        operation: 'syncWipePool',
      },
      {
        identity: () => ({ ...actual, appId: 'documents/other-pool', phone: true }),
        stop: effect,
        snapshot: effect,
        erase: effect,
        reload: effect,
        verify: effect,
      }
    )
  ).rejects.toThrow()
  expect(effect).not.toHaveBeenCalled()
})
const row = (namespace: string, ledgerId: string): PhoneWipeRow => ({
  database: 'abele-sync-host-v1',
  store: 'host',
  key: [namespace, 'abele-sync-connections-v2'],
  namespace,
  value: { records: [{ ledgerId }] },
})
it('selects only the exact mobile namespace, including local keys', () => {
  const appId = 'documents/sample-pool'
  const adjacent = appId + '-other'
  const rows = [row(appId, own), row(adjacent, foreign)]
  const plan = phonePoolWipePlan(
    { ...expected, appId, confirm: 'wipe-sync-pool', operation: 'syncWipePool' },
    { ...actual, appId, phone: true },
    [own, foreign],
    rows,
    [
      { namespace: appId, key: 'abele-sync-test-pool-ledgers-v1', value: [own] },
      { namespace: adjacent, key: 'abele-sync-test-pool-ledgers-v1', value: [foreign] },
    ]
  )
  expect(plan.databases).toEqual([own])
  expect(plan.rows).toEqual([rows[0]])
  expect(plan.keys).toEqual(['abele-sync-test-pool-ledgers-v1'])
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
  { valid: true, desktop: false, partial: false },
  { valid: true, desktop: false, partial: true },
  { valid: true, desktop: false, stale: true },
  { valid: true, desktop: false, stale: true, recreate: true },
  { valid: false, desktop: false },
  { valid: true, desktop: true, partial: false },
  { valid: true, desktop: true, concurrent: true },
  { valid: true, desktop: true, partial: true },
  { valid: false, desktop: true },
])(
  'wipes real adapters only with a plugin ledger schema ($valid/$desktop/$partial/$stale/$recreate)',
  async ({ valid, desktop, partial, concurrent, stale, recreate }) => {
    const identity = { ...actual, appId: desktop ? actual.appId : 'documents/sample-pool' }
    const { IDBFactory } = await import('fake-indexeddb')
    const { HostSyncStorage } = await import('@/sync/hostSyncStorage')
    const { wipePhonePool, wipePool } = await import('@/testing/wipePhonePool')
    const wipe = desktop ? wipePool : wipePhonePool
    const request = desktop
      ? { ...expected, confirm: 'wipe-sync-pool', operation: 'syncWipePool' }
      : { ...expected, appId: identity.appId }
    const { buildFakeVault } = await import('../helpers/fakeVault')
    const { Platform } = await import('obsidian')
    const platform = Platform as { isMobile: boolean; isDesktop: boolean }
    const prior = { isMobile: platform.isMobile, isDesktop: platform.isDesktop }
    const apiDescriptor = Object.getOwnPropertyDescriptor(window, '__abeleTest')
    const descriptor = Object.getOwnPropertyDescriptor(window, 'indexedDB')
    const factory = new IDBFactory()
    let shutdownPending = false
    let recreateAfterProbe = false
    const openDatabase = factory.open.bind(factory)
    factory.open = (name, version) => {
      const request = openDatabase(name, version)
      request.addEventListener('error', () => {
        if (name !== own || !recreateAfterProbe) return
        recreateAfterProbe = false
        // Another writer creates the very name just proven absent. It must not
        // inherit the old ledger's deletion authorization, even with a stale catalog.
        const replacement = openDatabase(own, 3)
        replacement.onsuccess = () => replacement.result.close()
      })
      return request
    }
    const removed: string[] = []
    const deleteDatabase = factory.deleteDatabase.bind(factory)
    factory.deleteDatabase = (name) => {
      if (!shutdownPending) removed.push(name)
      return deleteDatabase(name)
    }
    const enumerate = factory.databases.bind(factory)
    factory.databases = async () => {
      if (shutdownPending) throw new Error('Database inventory changed during shutdown')
      const inventory = await enumerate()
      // A catalog entry is not proof that open() will find a committed database.
      // Model a stale WebKit catalog row after the owned ledger has disappeared.
      if (stale && !inventory.some((db) => db.name === own))
        inventory.push({ name: own, version: 3 })
      if (concurrent && !inventory.some((db) => db.name === 'sample-concurrent')) {
        await new Promise<void>((resolve, reject) => {
          const open = factory.open('sample-concurrent')
          open.onerror = () => reject(open.error)
          open.onsuccess = () => {
            open.result.close()
            resolve()
          }
        })
      }
      return inventory
    }
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
    const local = storage(identity.appId)
    const app = Object.assign(base, local, { appId: identity.appId })
    app.vault.getName = () => identity.vault
    let ownHost = await HostSyncStorage.open(factory, identity.appId, app)
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
    for (const name of [...(valid ? [] : [own]), foreign, 'obsidian', 'sample-shutdown-database']) {
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
        disablePlugin: async () => {
          ownHost.close()
          shutdownPending = true
          const { recordTeardown } = await import('@/sync/teardownBarrier')
          recordTeardown(
            app,
            new Promise<void>((resolve, reject) => {
              setTimeout(() => {
                // Model a late shutdown task recreating a private database.
                const remove = factory.deleteDatabase('sample-shutdown-database')
                remove.onerror = () => reject(remove.error)
                remove.onsuccess = () => {
                  const open = factory.open('sample-shutdown-database')
                  open.onerror = () => reject(open.error)
                  open.onsuccess = () => {
                    open.result.close()
                    if (stale) {
                      const missing = factory.deleteDatabase(own)
                      missing.onerror = () => reject(missing.error)
                      missing.onsuccess = () => {
                        shutdownPending = false
                        recreateAfterProbe = !!recreate
                        resolve()
                      }
                    } else {
                      shutdownPending = false
                      resolve()
                    }
                  }
                }
              }, 5)
            })
          )
        },
        enablePlugin: async () => {
          await (await import('vitest')).vi.resetModules()
          const fresh = await import('@/sync/hostSyncStorage')
          ownHost = await fresh.HostSyncStorage.open(factory, identity.appId, app)
          const verification = await import('@/testing/wipePhonePool')
          Object.assign(window, {
            __abeleTest: { verifyPoolWipe: () => verification.verifyPoolWipe(app as never) },
          })
        },
      },
    })
    const logs = vi.spyOn(console, 'debug')
    try {
      if (recreate) {
        await expect(wipe({ app } as never, request)).rejects.toThrow(
          'Database appeared during wipe: ' + own
        )
        expect(removed).not.toContain(own)
        expect((await enumerate()).some((db) => db.name === own)).toBe(true)
        expect(await app.vault.adapter.exists('.abele-sync/private.bin')).toBe(true)
        return
      }
      if (concurrent) {
        const attempt = wipe({ app } as never, request)
        await expect(attempt).rejects.toThrow('Database inventory changed')
        await expect(attempt).rejects.toThrow(/database inventories snapshot=\[.* erase=\[/)
        expect((await enumerate()).some((db) => db.name === own)).toBe(true)
        expect(await app.vault.adapter.exists('.abele-sync/private.bin')).toBe(true)
        return
      }
      if (!valid) {
        await expect(wipe({ app } as never, request)).rejects.toThrow(
          'not a recognized plugin ledger'
        )
        // Reopen only for inspection: the failed wipe must leave namespace rows intact.
        ownHost = await HostSyncStorage.open(factory, identity.appId, app)
        expect(await ownHost.readValue('abele-sync-connections-v2')).toMatchObject({
          records: [{ ledgerId: own }],
        })
        expect(await app.vault.adapter.exists('.abele-sync/private.bin')).toBe(true)
        return
      }
      if (partial) {
        const remove = app.vault.adapter.rmdir.bind(app.vault.adapter)
        app.vault.adapter.rmdir = async () => {
          throw new Error('sample interrupted private removal')
        }
        await expect(wipe({ app } as never, request)).rejects.toThrow(
          'sample interrupted private removal'
        )
        const retained = await new Promise<unknown[]>((resolve, reject) => {
          const open = factory.open('abele-sync-host-v1')
          open.onerror = () => reject(open.error)
          open.onsuccess = () => {
            const db = open.result
            const tx = db.transaction('host-records-v3', 'readonly')
            const rows = tx.objectStore('host-records-v3').getAll()
            rows.onerror = () => reject(rows.error)
            rows.onsuccess = () => resolve(rows.result)
            tx.oncomplete = () => db.close()
          }
        })
        expect(JSON.stringify(retained)).toContain(own)
        app.vault.adapter.rmdir = remove
      }
      const result = await wipe({ app } as never, request)
      expect(result.databases).toEqual(partial ? [] : [own])
      expect(logs).toHaveBeenCalledWith(
        '[e2e sync wipe] database inventory',
        'snapshot',
        expect.arrayContaining(['obsidian'])
      )
      expect(logs).toHaveBeenCalledWith(
        '[e2e sync wipe] database inventory',
        'erase',
        expect.arrayContaining(['obsidian'])
      )
      if (stale) expect(removed).not.toContain(own)
      expect(offloads.files()).toEqual([])
      const names = (await enumerate()).map((db) => db.name)
      expect(names).toContain(foreign)
      expect(names).toContain('obsidian')
      expect(names).toContain('abele-sync-host-v1')
      expect(names).not.toContain(own)
      expect(await other.readValue('abele-sync-connections-v2')).toEqual(beforeForeign)
      expect(await app.vault.adapter.read('Notes/user.md')).toBe('keep')
      expect(await app.vault.adapter.exists('.abele-sync')).toBe(false)
      const repeated = await wipe({ app } as never, request)
      expect(repeated.databases).toEqual([])
    } finally {
      logs.mockRestore()
      ownHost.close()
      other.close()
      if (apiDescriptor) Object.defineProperty(window, '__abeleTest', apiDescriptor)
      else Reflect.deleteProperty(window, '__abeleTest')
      Object.assign(platform, prior)
      if (descriptor) Object.defineProperty(window, 'indexedDB', descriptor)
      else Reflect.deleteProperty(window, 'indexedDB')
      for (const key of Object.keys(window.localStorage))
        if (key.startsWith(identity.appId + '-') || key.startsWith('other-vault-'))
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
