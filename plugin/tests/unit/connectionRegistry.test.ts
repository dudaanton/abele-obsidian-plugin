import { describe, expect, it } from 'vitest'
import { ConnectionRegistry, REGISTRY_KEY } from '@/sync/connectionRegistry'
import { emptyConnection, readConnection, writeConnection } from '@/sync/connection'
import { readLedgerId, writeLedgerId, type LocalStorage } from '@/sync/ledgerId'
import { migrateSyncSettings } from '@/sync/settings'
import { RestoreKeys } from '@/sync/restoreKeys'
import type { ScopedLocalConnection } from '@/sync/scoped/scopedJoin'

function local(initial: Record<string, unknown> = {}): LocalStorage {
  const values = new Map(Object.entries(initial))
  return {
    loadLocalStorage: (key) => structuredClone(values.get(key) ?? null),
    saveLocalStorage: (key, value) => {
      values.set(key, structuredClone(value))
    },
  }
}
const personal = (serverUrl = 'https://one.example.test') => ({
  ...emptyConnection(),
  serverUrl,
  enrolledUrl: serverUrl,
  vaultId: 'sample-vault',
  deviceId: 'sample-device',
  deviceTokenId: 'abele-sync-device-sample',
})

describe('device-local connection registry', () => {
  it('retains separate scoped identity, secret reference, pause and unfinished join', () => {
    const state: ScopedLocalConnection = {
      version: 4,
      facet: 'scoped',
      issuer: 'https://shared.example.test',
      vaultId: 'sample-vault',
      grantId: 'sample-grant',
      memberId: 'sample-member',
      principalId: 'sample-installation',
      principalKind: 'installation',
      role: 'editor',
      rootFileId: 'sample-root',
      tokenId: 'abele-scoped-installation-sample',
      ledgerId: 'original-scoped-ledger',
      scriptPolicy: 'refuse',
    }
    const join = {
      phase: 'collision-hold',
      connection: state,
      invitationId: 'abele-scoped-invitation-sample',
    }
    const localStorage = local({
      'abele-sync-scoped-connection': state,
      'abele-sync-scoped-join': join,
      'abele-scoped-paused': true,
      'abele-scoped-access-removed': { connection: state, message: 'sample-revocation' },
    })
    const registry = ConnectionRegistry.open(localStorage)
    expect(registry.records()[0]).toMatchObject({
      kind: 'scoped',
      state,
      endpoint: state.issuer,
      principalId: state.principalId,
      secretReference: state.tokenId,
      ledger: state.ledgerId,
      paused: true,
      scope: { grantId: state.grantId, rootFileId: state.rootFileId, role: state.role },
    })
    const resumed = ConnectionRegistry.open(localStorage).storage(registry.selectedId)
    expect(resumed.loadLocalStorage('abele-sync-scoped-join')).toEqual(join)
    expect(resumed.loadLocalStorage('abele-scoped-access-removed')).toEqual({
      connection: state,
      message: 'sample-revocation',
    })
    expect(readLedgerId(resumed).stateId).toBe('')
  })
  it('adopts identity and unfinished work without touching ledger databases', () => {
    const initial = {
      'abele-sync-connection': personal(),
      'abele-sync-ledger': { stateId: 'original-ledger', vaultId: 'sample-vault' },
      'abele-sync-ledger-proof': { stateId: 'original-ledger', vaultId: 'sample-vault' },
      'abele-sync-external-connection-switch-v1': { unfinished: true },
      'abele-sync-scoped-join': { phase: 'enrolling', invitationId: 'sample-secret-reference' },
      'scoped-creation-journal-v1': { requestId: 'sample-request' },
      'abele-sync-writes': [{ target: 'sample.md', temp: 'sample.tmp', installed: true }],
      'abele-sync-recovered-writes': [{ target: 'sample.md', backup: 'sample.backup' }],
      'abele-owner-publication-stores-v1': [{ key: 'abele-owner-publication:sample' }],
      'abele-owner-publication:sample': { id: 'sample-store' },
    }
    const storage = local(initial)
    const registry = ConnectionRegistry.open(storage)
    const view = registry.storage(registry.selectedId)
    for (const [key, value] of Object.entries(initial))
      expect(view.loadLocalStorage(key)).toEqual(value)
    expect(readLedgerId(view).stateId).toBe('original-ledger')
    expect(ConnectionRegistry.open(storage).selectedId).toBe(registry.selectedId)
  })
  it.each(['before', 'after', 'silent'] as const)('restarts at migration write: %s', (failure) => {
    const original = local({ 'abele-sync-connection': personal() })
    const crashing: LocalStorage = {
      loadLocalStorage: (key) => original.loadLocalStorage(key),
      saveLocalStorage: (key, value) => {
        if (failure === 'after') original.saveLocalStorage(key, value)
        if (failure !== 'silent') throw new Error('interrupted')
      },
    }
    expect(() => ConnectionRegistry.open(crashing)).toThrow()
    const resumed = ConnectionRegistry.open(original)
    expect(resumed.storage(resumed.selectedId).loadLocalStorage('abele-sync-connection')).toEqual(
      personal()
    )
  })
  it('isolates identical vault ids on different endpoints and forgets only one record', () => {
    const storage = local()
    const registry = ConnectionRegistry.open(storage)
    const first = registry.selectedId
    const second = registry.add('personal')
    const a = registry.storage(first)
    const b = registry.storage(second)
    writeConnection(a, personal())
    writeConnection(b, {
      ...personal('https://two.example.test'),
      deviceTokenId: 'abele-sync-device-second',
    })
    writeLedgerId(a, { stateId: 'ledger-one', vaultId: 'sample-vault' })
    writeLedgerId(b, { stateId: 'ledger-two', vaultId: 'sample-vault' })
    b.saveLocalStorage('abele-sync-external-generation-v1', { generation: 3 })
    expect(readConnection(a).serverUrl).toBe('https://one.example.test')
    expect(readConnection(b).serverUrl).toBe('https://two.example.test')
    expect(readLedgerId(a).stateId).toBe('ledger-one')
    registry.forget(first)
    expect(() => a.loadLocalStorage('abele-sync-connection')).toThrow(/forgotten/)
    expect(readLedgerId(b).stateId).toBe('ledger-two')
    expect(b.loadLocalStorage('abele-sync-external-generation-v1')).toEqual({ generation: 3 })
    expect(ConnectionRegistry.open(storage).records()).toHaveLength(1)
  })
  it('does not export live identity through settings or copy the local ledger', () => {
    const storage = local()
    const registry = ConnectionRegistry.open(storage)
    const view = registry.storage(registry.selectedId)
    writeConnection(view, personal())
    writeLedgerId(view, { stateId: 'private-ledger', vaultId: 'sample-vault' })
    expect(
      migrateSyncSettings({ ...personal(), connections: storage.loadLocalStorage(REGISTRY_KEY) })
    ).toEqual({ keySignature: null })
    const copied = ConnectionRegistry.open(local())
    expect(readLedgerId(copied.storage(copied.selectedId)).stateId).toBe('')
  })
  it('rejects damage instead of falling back to stale singleton credentials', () => {
    expect(() =>
      ConnectionRegistry.open(
        local({
          [REGISTRY_KEY]: { version: 7 },
          'abele-sync-connection': personal(),
        })
      )
    ).toThrow(/recovery/)
  })
  it('keeps restore request keys per connection even through an original app dialog port', () => {
    const storage = local()
    const registry = ConnectionRegistry.open(storage)
    const first = registry.selectedId
    const second = registry.add('personal')
    const original = new RestoreKeys(storage, 'sample-vault', () => 'request-one')
    expect(original.keyOf(['sample-file'])).toBe('request-one')
    registry.select(second)
    const other = new RestoreKeys(storage, 'sample-vault', () => 'request-two')
    expect(other.keyOf(['sample-file'])).toBe('request-two')
    expect(original.keyOf(['sample-file'])).toBe('request-one')
    expect(
      new RestoreKeys(registry.storage(first), 'sample-vault', () => 'unexpected').keyOf([
        'sample-file',
      ])
    ).toBe('request-one')
  })
  it('refuses ledger or credential aliases across records before writing them', () => {
    const registry = ConnectionRegistry.open(local())
    const a = registry.storage(registry.selectedId)
    const b = registry.storage(registry.add('personal'))
    writeLedgerId(a, { stateId: 'owned-ledger', vaultId: 'sample-vault' })
    expect(() => writeLedgerId(b, { stateId: 'owned-ledger', vaultId: 'sample-vault' })).toThrow(
      /identity/
    )
    expect(readLedgerId(b).stateId).toBe('')
    writeConnection(a, personal())
    expect(() => writeConnection(b, personal('https://two.example.test'))).toThrow(/identity/)
    expect(readConnection(b).deviceTokenId).toBe('')
  })
})
