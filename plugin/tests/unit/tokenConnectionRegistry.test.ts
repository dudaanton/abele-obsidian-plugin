import { expect, it } from 'vitest'
import { TokenConnectionRegistry, TOKEN_REGISTRY_KEY } from '@/sync/tokenConnectionRegistry'
import { SecretStore } from '@/secrets/SecretStore'
import { deviceKeyId, readEntries, type SecretStoreFile } from '@/secrets/storeFile'
import { fromBase64 } from '@/secrets/crypto'
import { buildPayload } from '@/transfer/entries'

function local() {
  const data = new Map<string, unknown>()
  return {
    data,
    loadLocalStorage: (key: string) => structuredClone(data.get(key) ?? null),
    saveLocalStorage: (key: string, value: unknown) => {
      data.set(key, structuredClone(value))
    },
  }
}
const token = {
  v: 1 as const,
  address: 'https://sync.example',
  key: 'a'.repeat(43),
  scope: { kind: 'folder' as const, id: 'root', path: '/' },
}
const receipt = {
  protocol: 2 as const,
  token_id: 'token-one',
  space_id: 'space-one',
  scope: token.scope,
  status: 'active' as const,
}

it('repairs an interrupted item document and selection write on reopen', () => {
  const store = local(),
    registry = TokenConnectionRegistry.open(store)
  const mainId = registry.add()
  const itemId = registry.add(true)
  registry.select(mainId)
  const save = store.saveLocalStorage
  store.saveLocalStorage = (key, value) => {
    if (key === 'abele-sync-item-selection-v1') throw new Error('interrupted selection')
    save(key, value)
  }
  expect(() => registry.select(itemId)).toThrow('interrupted selection')
  store.saveLocalStorage = save
  const restarted = TokenConnectionRegistry.open(store)
  expect(restarted.selectedId).toBe(itemId)
  expect(restarted.records()).toHaveLength(2)
})

it('pins the original local root on attach even if the server already renamed the scope', () => {
  const store = local(),
    registry = TokenConnectionRegistry.open(store),
    keys = secrets()
  const id = registry.add()
  registry.attach(
    id,
    { ...token, scope: { ...token.scope, path: 'Shared' } },
    { ...receipt, scope: { ...token.scope, path: 'Private' } },
    keys
  )
  expect(registry.records()[0].localRoot).toBe('Shared')
  registry.setScopePath(id, 'Elsewhere')
  expect(TokenConnectionRegistry.open(store).records()[0].localRoot).toBe('Shared')
})

it('pins legacy folder placement before a later server scope update', () => {
  const store = local(),
    registry = TokenConnectionRegistry.open(store),
    keys = secrets()
  const id = registry.add(),
    scope = { ...token.scope, path: 'Shared' }
  registry.attach(id, { ...token, scope }, { ...receipt, scope }, keys)
  const document = store.loadLocalStorage(TOKEN_REGISTRY_KEY) as {
    records: { localRoot?: string }[]
  }
  delete document.records[0].localRoot
  store.saveLocalStorage(TOKEN_REGISTRY_KEY, document)
  const reopened = TokenConnectionRegistry.open(store)
  expect(reopened.pinLocalRoot(id)).toBe('Shared')
  reopened.setScopePath(id, 'Private')
  expect(reopened.records()[0].localRoot).toBe('Shared')
})
function secrets() {
  const data = new Map<string, string>()
  return {
    data,
    get: (id: string) => data.get(id) ?? null,
    set: (id: string, key: string) => {
      data.set(id, key)
    },
  }
}

it('persists local placement without changing server scope or transferring it in a token', () => {
  const store = local(),
    registry = TokenConnectionRegistry.open(store),
    id = registry.add()
  const folder = { ...token, scope: { ...token.scope, path: 'Shared' } }
  registry.attach(id, folder, { ...receipt, scope: folder.scope }, secrets())
  registry.setLocalRoot(id, 'Moved')
  expect(TokenConnectionRegistry.open(store).records()[0]).toMatchObject({
    localRoot: 'Moved',
    scope: { path: 'Shared' },
  })
  expect(folder.scope.path).toBe('Shared')
  expect(() => registry.setLocalRoot(id, '../outside')).toThrow()
})

it('retains a missing root decision when reopened and clears it only explicitly', () => {
  const store = local(),
    registry = TokenConnectionRegistry.open(store),
    id = registry.add()
  registry.attach(id, token, receipt, secrets())
  registry.setRootIssue(id, { kind: 'moved', path: 'Moved' })
  const reopened = TokenConnectionRegistry.open(store)
  expect(reopened.records()[0]).toMatchObject({
    status: 'scope_unavailable',
    rootIssue: { kind: 'moved', path: 'Moved' },
  })
  reopened.setRootIssue(id, undefined)
  expect(TokenConnectionRegistry.open(store).records()[0].rootIssue).toBeUndefined()
})

it.each(['Other/Shared', 'Other', 'Parent'])(
  'refuses overlapping local placement at %s',
  (path) => {
    const store = local(),
      registry = TokenConnectionRegistry.open(store),
      a = registry.add(),
      b = registry.add()
    const attach = (id: string, root: string) => {
      const scoped = { ...token, scope: { ...token.scope, id: root, path: root } }
      registry.attach(id, scoped, { ...receipt, scope: scoped.scope, token_id: id }, secrets())
    }
    attach(a, 'Shared')
    attach(b, path === 'Parent' ? 'Parent/Other' : 'Other')
    registry.setRootIssue(a, { kind: 'moved', path })
    expect(() => registry.setLocalRoot(a, path)).toThrow(/overlap/i)
    expect(registry.records().find((row) => row.id === a)).toMatchObject({
      rootIssue: { kind: 'moved', path },
    })
    expect(registry.records().find((row) => row.id === a)?.localRoot).toBe('Shared')
  }
)

it.each(['attach', 'scope', 'restore'])(
  'permits explicitly chosen overlap through %s',
  (action) => {
    const registry = TokenConnectionRegistry.open(local()),
      first = registry.add(),
      second = registry.add(),
      keys = secrets()
    const attach = (id: string, path: string) => {
      const value = { ...token, scope: { ...token.scope, id: path, path } }
      registry.attach(id, value, { ...receipt, token_id: id, scope: value.scope }, keys)
    }
    attach(first, 'Shared')
    if (action === 'attach') expect(() => attach(second, 'Shared/nested')).not.toThrow()
    else {
      attach(second, 'Other')
      if (action === 'scope')
        expect(() => registry.setScopePath(second, 'Shared/nested')).not.toThrow()
      else {
        registry.setRootIssue(second, { kind: 'deleted' })
        const doc = registry.records()
        doc.find((row) => row.id === second)!.localRoot = 'Shared/nested'
        const store = Reflect.get(registry, 'local')
        store.saveLocalStorage(TOKEN_REGISTRY_KEY, {
          ...store.loadLocalStorage(TOKEN_REGISTRY_KEY),
          records: doc,
        })
        expect(() => registry.setRootIssue(second, undefined)).not.toThrow()
        expect(registry.records().find((row) => row.id === second)?.rootIssue).toBeUndefined()
      }
    }
  }
)

it('resumes interrupted provisioning after a folder rename using stable selector identity', () => {
  const store = local(),
    registry = TokenConnectionRegistry.open(store),
    id = registry.add(),
    keys = secrets()
  const set = keys.set
  keys.set = () => {
    throw new Error('interrupted keychain write')
  }
  expect(() => registry.attach(id, token, receipt, keys)).toThrow('interrupted keychain write')
  const before = registry.records()[0]
  keys.set = set
  const reopened = TokenConnectionRegistry.open(store),
    scope = { ...receipt.scope, path: 'Renamed' }
  reopened.attach(id, token, { ...receipt, scope }, keys)
  expect(reopened.records()[0]).toMatchObject({
    ledgerId: before.ledgerId,
    secretReference: before.pending!.secretReference,
    scope,
    status: 'idle',
  })
  expect(keys.data.size).toBe(1)
})

it('rejects lost registry writes and damaged active storage', () => {
  const store = local()
  store.saveLocalStorage = () => {}
  expect(() => TokenConnectionRegistry.open(store)).toThrow(/recovery/i)
  expect(store.loadLocalStorage(TOKEN_REGISTRY_KEY)).toBeNull()
  store.data.set(TOKEN_REGISTRY_KEY, { version: 2, records: [] })
  expect(() => TokenConnectionRegistry.open(store)).toThrow(/recovery/i)
})

it('keeps disconnected/error status valid before a token is provided and never activates it', () => {
  const registry = TokenConnectionRegistry.open(local()),
    id = registry.add()
  registry.setStatus(id, 'disconnected')
  expect(registry.records()[0]).toMatchObject({ status: 'disconnected', secretReference: '' })
  registry.setStatus(id, 'error')
  expect(registry.records()[0]).toMatchObject({ status: 'error', secretReference: '' })
  expect(() => registry.setStatus(id, 'idle')).toThrow()
  expect(registry.records()[0].status).toBe('error')
})

it.each([1, 2, 3])(
  're-paste resumes after token provision write %s without losing pending state',
  (at) => {
    const store = local(),
      registry = TokenConnectionRegistry.open(store),
      id = registry.add(),
      keys = secrets()
    const save = store.saveLocalStorage,
      set = keys.set
    let writes = 0
    store.saveLocalStorage = (key, value) => {
      save(key, value)
      if (++writes === at) throw new Error('restart')
    }
    keys.set = (key, value) => {
      set(key, value)
      if (++writes === at) throw new Error('restart')
    }
    expect(() => registry.attach(id, token, receipt, keys)).toThrow('restart')
    store.saveLocalStorage = save
    keys.set = set
    const reopened = TokenConnectionRegistry.open(store)
    reopened.attach(id, token, receipt, keys)
    expect(reopened.records()[0]).toMatchObject({
      status: 'idle',
      kind: 'token',
      address: token.address,
      scope: token.scope,
    })
    expect(keys.data.size).toBe(1)
    expect(JSON.stringify(store.loadLocalStorage(TOKEN_REGISTRY_KEY))).not.toContain(token.key)
  }
)

it('isolates identical remote identities on separate endpoints and forgetting leaves the other intact', () => {
  const store = local(),
    registry = TokenConnectionRegistry.open(store),
    keys = secrets()
  const first = registry.add(),
    second = registry.add()
  registry.attach(first, token, receipt, keys)
  registry.attach(second, { ...token, address: 'https://other.example' }, receipt, keys)
  const [one, two] = registry.records()
  expect(one.ledgerId).not.toBe(two.ledgerId)
  expect(one.secretReference).not.toBe(two.secretReference)
  registry.forget(first)
  expect(TokenConnectionRegistry.open(store).records()).toEqual([two])
  expect(keys.get(two.secretReference)).toBe(token.key)
  // Settings are files; only this device-local port contains registry/ledger identity.
  expect(TokenConnectionRegistry.open(local()).records()).toEqual([])
})

it('cannot retarget a bound connection while carrying its pending engine state', () => {
  const registry = TokenConnectionRegistry.open(local()),
    id = registry.add(),
    keys = secrets()
  registry.attach(id, token, receipt, keys)
  registry
    .storage(id)
    .saveLocalStorage('abele-sync-token-state:journal', { pending: 'sample edit' })
  const before = registry.records()
  expect(() =>
    registry.attach(id, { ...token, address: 'https://other.example' }, receipt, keys)
  ).toThrow()
  expect(registry.records()).toEqual(before)
  expect(registry.storage(id).loadLocalStorage('abele-sync-token-state:journal')).toEqual({
    pending: 'sample edit',
  })
})

it('does not accept token hints as authority, insecure addresses, or legacy secret kinds', () => {
  const registry = TokenConnectionRegistry.open(local()),
    id = registry.add(),
    keys = secrets()
  expect(() =>
    registry.attach(id, token, { ...receipt, scope: { ...receipt.scope, id: 'other-root' } }, keys)
  ).toThrow()
  expect(() =>
    registry.attach(id, { ...token, address: 'http://sync.example' }, receipt, keys)
  ).toThrow()
  expect(() => registry.attach(id, { ...token, key: 'legacy-token' }, receipt, keys)).toThrow()
  expect(keys.data.size).toBe(0)
})

it('keeps the ledger and credential through selector rename while applying authoritative availability', () => {
  const registry = TokenConnectionRegistry.open(local()),
    connection = registry.add(),
    keys = secrets()
  registry.attach(connection, token, receipt, keys)
  const before = registry.records()[0]
  const scope = { ...token.scope, path: 'Renamed' }
  registry.attach(
    connection,
    { ...token, scope },
    { ...receipt, scope, status: 'scope_unavailable' },
    keys
  )
  expect(registry.records()[0]).toMatchObject({
    ledgerId: before.ledgerId,
    secretReference: before.secretReference,
    status: 'scope_unavailable',
    scope,
  })
})

it('provisions through the real device-only secret road and excludes keys from the synced store', async () => {
  const values = new Map<string, string>(),
    registry = TokenConnectionRegistry.open(local()),
    connection = registry.add()
  let file: unknown = null
  const store = new SecretStore({
    keychain: () => ({
      getSecret: (id) => values.get(id) ?? null,
      setSecret: (id, value) => {
        values.set(id, value)
      },
    }),
    read: () => file,
    write: async (value) => {
      file = value
    },
    ids: () => [...values.keys()],
    conflictCopies: async () => [],
    now: () => 1000,
  })
  registry.attach(connection, token, receipt, {
    get: (id) => store.device.get(id) || null,
    set: (id, value) => store.device.set(id, value),
  })
  const reference = registry.records()[0].secretReference
  expect(store.device.get(reference)).toBe(token.key)
  expect(store.get(reference)).toBe('')
  await store.enable('sample-passphrase', { iterations: 1000 })
  const written = file as SecretStoreFile
  expect(await readEntries(written, fromBase64(values.get(deviceKeyId(written.id))!))).toEqual({})
  expect(
    buildPayload(
      [
        {
          section: 'ai-providers',
          id: 'sample',
          label: 'Sample',
          data: {},
          secretIds: [reference],
        },
      ],
      () => token.key
    ).secrets
  ).toEqual({})
})

it('persists first-connect placement across a later authoritative rename and restart', () => {
  const store = local(),
    registry = TokenConnectionRegistry.open(store),
    keys = secrets()
  const connection = registry.add()
  const shared = { ...token.scope, path: 'Shared' }
  registry.attach(connection, { ...token, scope: shared }, { ...receipt, scope: shared }, keys)
  expect(registry.records()[0].localRoot).toBe('Shared')
  registry.attach(
    connection,
    { ...token, scope: shared },
    { ...receipt, scope: { ...shared, path: 'Private' } },
    keys
  )
  expect(TokenConnectionRegistry.open(store).pinLocalRoot(connection)).toBe('Shared')
})

it('pins an existing connection from its current scope on first start', () => {
  const store = local(),
    registry = TokenConnectionRegistry.open(store),
    keys = secrets()
  const connection = registry.add(),
    shared = { ...token.scope, path: 'Shared' }
  registry.attach(connection, { ...token, scope: shared }, { ...receipt, scope: shared }, keys)
  const doc = store.loadLocalStorage(TOKEN_REGISTRY_KEY) as { records: { localRoot?: string }[] }
  delete doc.records[0].localRoot
  store.saveLocalStorage(TOKEN_REGISTRY_KEY, doc)
  const reopened = TokenConnectionRegistry.open(store)
  expect(reopened.pinLocalRoot(connection)).toBe('Shared')
  expect(TokenConnectionRegistry.open(store).records()[0].localRoot).toBe('Shared')
})

it('retains server rename acknowledgement separately from local placement across restart', () => {
  const store = local(),
    registry = TokenConnectionRegistry.open(store),
    id = registry.add(),
    keys = secrets(),
    scope = { ...token.scope, path: 'Shared' }
  registry.attach(id, { ...token, scope }, { ...receipt, scope }, keys)
  const before = registry.records()[0]
  registry.setRootIssue(id, { kind: 'server-renamed', from: 'Shared', to: 'Renamed' })
  expect(TokenConnectionRegistry.open(store).records()[0].rootIssue).toEqual({
    kind: 'server-renamed',
    from: 'Shared',
    to: 'Renamed',
  })
  registry.setServerRoot(id, 'Renamed')
  registry.setRootIssue(id, undefined)
  expect(TokenConnectionRegistry.open(store).records()[0]).toMatchObject({
    scope: before.scope,
    localRoot: 'Shared',
    serverRoot: 'Renamed',
    ledgerId: before.ledgerId,
  })
})
