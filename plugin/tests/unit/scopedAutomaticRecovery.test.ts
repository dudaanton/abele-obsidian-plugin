import { afterEach, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { ScopedPluginHost } from '@/sync/scoped/scopedPluginHost'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { SCOPED_CONNECTION_KEY, type ScopedLocalConnection } from '@/sync/scoped/scopedJoin'
import { AbeleConfig } from '@/services/AbeleConfig'
import { secrets, setSecrets } from '@/secrets/SecretStore'
import { useVault } from '../helpers/testEnv'

let host: ScopedPluginHost
const closes: Array<() => void> = []
afterEach(async () => {
  await host?.close()
  for (const close of closes.splice(0)) close()
  setSecrets(null)
  vi.restoreAllMocks()
})

it('arms automatic triggers before the first offline run and re-arms after manual recovery', async () => {
  const app = useVault([])
  setSecrets(null)
  AbeleConfig.getInstance().applySettings()
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
  const token = 'absi_' + 'a'.repeat(43)
  secrets().setLocal(c.tokenId, token)
  secrets().setLocal(c.tokenId + '-binding', JSON.stringify({ connection: c, token }))
  app.saveLocalStorage(SCOPED_CONNECTION_KEY, c)
  const factory = new IDBFactory()
  const fetcher = vi.fn(async () => {
    throw new Error('sample offline connection')
  })
  host = new ScopedPluginHost(app as never, fetcher as never, factory)
  await (host as any).open(c, true)
  await host.close()
  host = new ScopedPluginHost(app as never, fetcher as never, factory)
  const watch = vi.spyOn(ObsidianFileSystem.prototype, 'watch')
  await expect(host.start()).rejects.toThrow(/server|offline|reach/i)
  expect(watch).toHaveBeenCalledOnce()
  expect((host as any).clock).not.toBeNull()
  const r = (host as any).runtime
  // A reachable but preparing view is a successful poll with no content effects.
  vi.spyOn(r.client, 'state').mockResolvedValue({
    state: 'preparing',
    role: 'editor',
    selector: { kind: 'group', root_file_id: 'sample-root' },
  })
  await host.sync()
  expect(watch).toHaveBeenCalledOnce()
  ;(host as any).unwatch()
  ;(host as any).unwatch = null
  window.clearInterval((host as any).clock)
  ;(host as any).clock = null
  await host.sync()
  expect(watch).toHaveBeenCalledTimes(2)
  expect((host as any).clock).not.toBeNull()
})
