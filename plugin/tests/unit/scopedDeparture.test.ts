import { afterEach, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { AbeleError } from '@abele/sync-protocol'
import { ScopedPluginHost } from '@/sync/scoped/scopedPluginHost'
import {
  SCOPED_CONNECTION_KEY,
  SCOPED_JOIN_KEY,
  type ScopedLocalConnection,
} from '@/sync/scoped/scopedJoin'
import { scopedSecretPort } from '@/sync/scoped/scopedSecretSlots'
import { AbeleConfig } from '@/services/AbeleConfig'
import { secrets, setSecrets } from '@/secrets/SecretStore'
import { useVault } from '../helpers/testEnv'

let host: ScopedPluginHost
const c: ScopedLocalConnection = {
  version: 4,
  facet: 'scoped',
  issuer: 'https://sync.example',
  vaultId: 'sample-vault',
  grantId: 'sample-grant',
  memberId: 'sample-member',
  principalId: 'sample-install',
  principalKind: 'installation',
  role: 'editor',
  rootFileId: 'sample-root',
  tokenId: 'abele-scoped-installation-sample',
  ledgerId: 'sample-ledger',
  scriptPolicy: 'refuse',
}
async function setup() {
  const app = useVault([{ path: 'Shared/sample-root.md', content: 'local files stay' }])
  setSecrets(null)
  AbeleConfig.getInstance().applySettings()
  const road = scopedSecretPort(secrets()),
    token = 'absi_' + 'a'.repeat(43)
  road.set(c.tokenId, token)
  road.set(c.tokenId + ':binding', JSON.stringify({ connection: c, token }))
  app.saveLocalStorage(SCOPED_CONNECTION_KEY, c)
  const factory = new IDBFactory(),
    status = vi.fn()
  host = new ScopedPluginHost(app as never, vi.fn() as never, factory, status)
  const r = await (host as any).open(c, true)
  vi.spyOn(r.state, 'getKnown').mockResolvedValue({ path: 'Shared/sample-root.md' })
  const state = vi
    .spyOn(r.client, 'state')
    .mockResolvedValue({
      state: 'preparing',
      role: 'editor',
      selector: { kind: 'group', root_file_id: c.rootFileId },
    })
  return { app, factory, status, r, state, road }
}
afterEach(async () => {
  await host?.close()
  setSecrets(null)
  vi.restoreAllMocks()
})

it('persists owner-removed access, tells the collaborator, and stops automatic polls across reload', async () => {
  const s = await setup()
  await host.start()
  expect((host as any).clock).not.toBeNull()
  s.state.mockRejectedValue(new AbeleError('unauthorized', 'scoped authority is unavailable'))
  await expect(host.sync()).rejects.toThrow('unavailable')
  expect(host.accessRemoved.value).toBe('Access to Shared/sample-root.md was removed by its owner.')
  expect(s.status).toHaveBeenLastCalledWith('error', host.accessRemoved.value)
  expect((host as any).clock).toBeNull()
  expect((host as any).unwatch).toBeNull()
  const calls = s.state.mock.calls.length
  await host.sync()
  expect(s.state).toHaveBeenCalledTimes(calls)
  await host.close()
  const fetcher = vi.fn()
  host = new ScopedPluginHost(s.app as never, fetcher as never, s.factory, s.status)
  await host.start()
  expect(host.accessRemoved.value).toContain('removed by its owner')
  expect(fetcher).not.toHaveBeenCalled()
})

it.each(['offline', 'scope_updating', 'scope_unavailable'] as const)(
  'does not call temporary %s evidence owner revocation',
  async (code) => {
    const s = await setup()
    s.state.mockRejectedValue(
      code === 'offline' ? new Error('offline') : new AbeleError(code, 'view not ready')
    )
    await expect(host.start()).rejects.toThrow()
    expect(host.accessRemoved.value).toBe('')
    expect((host as any).clock).not.toBeNull()
  }
)

it.each(['active', 'revoked', 'offline'] as const)(
  'leaves a %s connection, clearing only scoped keys/state and keeping local files',
  async (mode) => {
    const s = await setup()
    await host.start()
    const revoke = vi.spyOn(s.r.client, 'revokeSelf').mockImplementation(async () => {
      if (mode === 'offline') throw new Error('offline')
      return mode === 'revoked' ? 'already' : 'revoked'
    })
    if (mode === 'revoked') {
      s.state.mockRejectedValue(new AbeleError('unauthorized', 'scoped authority is unavailable'))
      await expect(host.sync()).rejects.toThrow()
    }
    const invitationId = 'abele-scoped-invitation-sample'
    for (const suffix of ['', ':binding', ':accepted'])
      s.road.set(invitationId + suffix, 'retained')
    s.app.saveLocalStorage(SCOPED_JOIN_KEY, { connection: c, invitationId })
    s.app.saveLocalStorage('abele-sync-ledger', { stateId: '', vaultId: '' })
    s.app.saveLocalStorage('abele-script-provenance', { keep: true })
    await host.leave()
    expect(revoke).toHaveBeenCalledOnce()
    expect(host.connection.value).toBeNull()
    expect(host.active).toBe(false)
    expect((host as any).clock).toBeNull()
    expect(s.app.loadLocalStorage(SCOPED_CONNECTION_KEY)).toBeNull()
    expect(s.app.loadLocalStorage(SCOPED_JOIN_KEY)).toBeNull()
    expect(s.road.get(c.tokenId)).toBe('')
    expect(s.road.get(c.tokenId + ':binding')).toBe('')
    for (const suffix of ['', ':binding', ':accepted'])
      expect(s.road.get(invitationId + suffix)).toBe('')
    expect(await s.factory.databases()).toEqual([])
    expect(s.app.loadLocalStorage('abele-sync-ledger')).toEqual({ stateId: '', vaultId: '' })
    expect(s.app.loadLocalStorage('abele-script-provenance')).toEqual({ keep: true })
    expect(await s.app.vault.adapter.read('Shared/sample-root.md')).toBe('local files stay')
    expect(s.status).toHaveBeenLastCalledWith('disconnected')
  }
)
