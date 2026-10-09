import { expect, it } from 'vitest'
import type { App } from 'obsidian'
import { prepareTokenConnections } from '@/sync/tokenRegistryPreparation'
import { TOKEN_REGISTRY_KEY } from '@/sync/tokenConnectionRegistry'
import { recordTeardown } from '@/sync/teardownBarrier'

function local() {
  const data = new Map<string, unknown>()
  const app = {
    loadLocalStorage: (key: string) => structuredClone(data.get(key) ?? null),
    saveLocalStorage: (key: string, value: unknown) => {
      data.set(key, structuredClone(value))
    },
  } as unknown as App
  return { app, data }
}

it('journals settings-only retired credentials and server proofs before settings can be rewritten', async () => {
  const { app } = local(),
    values = new Map([
      ['abele-sync-device-settings-only', 'old-key'],
      ['abele-sync-device-settings-only-server', 'old-proof'],
      ['provider-sample', 'provider-key'],
    ])
  let fail = true
  const secrets = {
    get: (id: string) => values.get(id) ?? '',
    remove: (id: string) => {
      if (fail) throw new Error('keychain unavailable')
      values.delete(id)
    },
  }
  // Settings are the only reference: no legacy local-storage record exists.
  await expect(
    prepareTokenConnections(app, secrets, {
      deviceTokenId: 'abele-sync-device-settings-only',
    })
  ).rejects.toThrow('keychain unavailable')
  expect(app.loadLocalStorage('abele-sync-retired-access-cleanup-v1')).toEqual([
    'abele-sync-device-settings-only',
    'abele-sync-device-settings-only-server',
  ])
  fail = false
  await prepareTokenConnections(app, secrets) // Settings reference may now be absent.
  expect([...values]).toEqual([['provider-sample', 'provider-key']])
  expect(app.loadLocalStorage('abele-sync-retired-access-cleanup-v1')).toBeNull()
})
it('waits for the previous runtime before discarding its connection state', async () => {
  const { app } = local()
  let finish!: () => void
  recordTeardown(
    app,
    new Promise<void>((resolve) => {
      finish = resolve
    })
  )
  const preparing = prepareTokenConnections(app, { get: () => '', remove: () => {} })
  try {
    await Promise.resolve()
    expect(app.loadLocalStorage(TOKEN_REGISTRY_KEY)).toBeNull()
  } finally {
    finish()
    await preparing
  }
})
it('discards legacy records, credentials and journals without importing them or touching files', async () => {
  const { app } = local(),
    values = new Map([
      ['abele-sync-device-old', 'old-key'],
      ['provider-sample', 'provider-key'],
    ])
  app.saveLocalStorage('abele-sync-connections-v1', {
    records: [
      {
        id: 'old',
        kind: 'personal',
        slots: {
          'abele-sync-connection': { deviceTokenId: 'abele-sync-device-old', paused: true },
          'abele-sync-writes': [{ sha: 'old', file: 'sample.md' }],
        },
      },
    ],
  })
  app.saveLocalStorage('abele-sync-connection', { deviceTokenId: 'provider-sample' })
  app.saveLocalStorage('abele-sync-ledger', { stateId: 'old-ledger', vaultId: 'old-space' })
  app.saveLocalStorage('unrelated-setting', { retained: true })
  const registry = await prepareTokenConnections(app, {
    get: (id) => values.get(id) ?? '',
    remove: (id) => {
      values.delete(id)
    },
  })
  expect(registry.records()).toEqual([])
  for (const key of ['abele-sync-connections-v1', 'abele-sync-connection', 'abele-sync-ledger'])
    expect(app.loadLocalStorage(key)).toBeNull()
  expect(values.has('abele-sync-device-old')).toBe(false)
  expect(values.get('provider-sample')).toBe('provider-key')
  expect(app.loadLocalStorage('unrelated-setting')).toEqual({ retained: true })
  expect(app.loadLocalStorage(TOKEN_REGISTRY_KEY)).toMatchObject({ version: 2, records: [] })
})
it('resumes credential cleanup after restart and never deletes active token credentials', async () => {
  const { app } = local(),
    values = new Map([
      ['abele-sync-device-old', 'old-key'],
      ['abele-sync-device-token-live', 'new-key'],
    ])
  app.saveLocalStorage('abele-sync-connection', { deviceTokenId: 'abele-sync-device-old' })
  let fail = true
  const secrets = {
    get: (id: string) => values.get(id) ?? '',
    remove: (id: string) => {
      if (fail) throw new Error('keychain unavailable')
      values.delete(id)
    },
  }
  await expect(prepareTokenConnections(app, secrets)).rejects.toThrow('keychain unavailable')
  fail = false
  const registry = await prepareTokenConnections(app, secrets),
    id = registry.add()
  const token = {
    v: 1 as const,
    address: 'https://sync.example',
    key: 'a'.repeat(43),
    scope: { kind: 'folder' as const, id: 'root', path: '/' },
  }
  registry.attach(
    id,
    token,
    { protocol: 2, token_id: 'sample', space_id: 'sample', scope: token.scope, status: 'active' },
    {
      get: (ref) => values.get(ref) ?? null,
      set: (ref, key) => {
        values.set(ref, key)
      },
    }
  )
  app.saveLocalStorage('abele-sync-connection', {
    deviceTokenId: registry.records()[0].secretReference,
  })
  const before = registry.records()
  await prepareTokenConnections(app, secrets)
  expect(registry.records()).toEqual(before)
  expect(values.get(before[0].secretReference)).toBe(token.key)
  expect(values.get('abele-sync-device-token-live')).toBe('new-key')
})

it.each([1, 2, 3, 4, 5, 6, 7])(
  'finishes safe discard after interruption at write %s',
  async (at) => {
    const { app } = local(),
      values = new Map([['abele-sync-device-old', 'old-key']])
    for (const key of ['abele-sync-connection', 'abele-sync-ledger', 'abele-sync-writes'])
      app.saveLocalStorage(key, { deviceTokenId: 'abele-sync-device-old' })
    const save = app.saveLocalStorage.bind(app)
    let writes = 0,
      failed = false
    const interrupt = () => {
      if (++writes === at) {
        failed = true
        throw new Error('restart')
      }
    }
    app.saveLocalStorage = (key, value) => {
      save(key, value)
      interrupt()
    }
    const secrets = {
      get: (ref: string) => values.get(ref) ?? '',
      remove: (ref: string) => {
        values.delete(ref)
        interrupt()
      },
    }
    await expect(prepareTokenConnections(app, secrets)).rejects.toThrow('restart')
    expect(failed).toBe(true)
    app.saveLocalStorage = save
    secrets.remove = (ref) => {
      values.delete(ref)
    }
    expect((await prepareTokenConnections(app, secrets)).records()).toEqual([])
    expect(values.size).toBe(0)
    for (const key of [
      'abele-sync-connection',
      'abele-sync-ledger',
      'abele-sync-writes',
      'abele-sync-retired-access-cleanup-v1',
    ])
      expect(app.loadLocalStorage(key)).toBeNull()
  }
)
