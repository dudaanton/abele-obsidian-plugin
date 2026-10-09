import { afterEach, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { ScopedPluginHost } from '@/sync/scoped/scopedPluginHost'
import { SCOPED_CONNECTION_KEY, type ScopedLocalConnection } from '@/sync/scoped/scopedJoin'
import { scopedSecretPort } from '@/sync/scoped/scopedSecretSlots'
import { AbeleConfig } from '@/services/AbeleConfig'
import { secrets, setSecrets } from '@/secrets/SecretStore'
import { ExternalState } from '@/sync/external/state'
import { EXTERNAL_GENERATION_KEY } from '@/sync/external/recovery'
import { useVault } from '../helpers/testEnv'

const hosts: ScopedPluginHost[] = []
afterEach(async () => {
  for (const host of hosts.splice(0).reverse()) await host.close()
  vi.restoreAllMocks()
  setSecrets(null)
})
async function fixture() {
  const app = useVault([{ path: 'Shared/sample.bin', content: 'sample bytes' }])
  AbeleConfig.getInstance().applySettings()
  setSecrets(null)
  const c: ScopedLocalConnection = {
    version: 4,
    facet: 'scoped',
    issuer: 'https://sync.example.invalid',
    vaultId: 'sample-vault',
    grantId: 'sample-grant',
    memberId: 'sample-member',
    principalId: 'sample-installation',
    principalKind: 'installation',
    role: 'editor',
    rootFileId: 'sample-root',
    tokenId: 'abele-scoped-installation-sample',
    ledgerId: 'sample-ledger',
    scriptPolicy: 'refuse',
  }
  const road = scopedSecretPort(secrets()),
    token = 'absi_' + 'a'.repeat(43)
  road.set(c.tokenId, token)
  road.set(c.tokenId + ':binding', JSON.stringify({ connection: c, token }))
  app.saveLocalStorage(SCOPED_CONNECTION_KEY, c)
  const factory = new IDBFactory(),
    fetcher = vi.fn()
  const open = () => {
    const host = new ScopedPluginHost(app as never, fetcher as never, factory)
    hosts.push(host)
    return host
  }
  const host = open(),
    r = await (host as any).open(c, true)
  return { app, c, road, host, r, open, fetcher }
}
it('a validated replacement scoped credential does not leave the old runtime authorized to mutate local bytes', async () => {
  const s = await fixture()
  const token = 'absi_' + 'b'.repeat(43)
  s.road.set(s.c.tokenId, token)
  s.road.set(s.c.tokenId + ':binding', JSON.stringify({ connection: s.c, token }))
  await expect(s.r.fs.remove('Shared/sample.bin')).rejects.toThrow(/ownership|held|recovery/i)
  expect(await s.app.vault.adapter.read('Shared/sample.bin')).toBe('sample bytes')
  expect(s.fetcher).not.toHaveBeenCalled()
})
it('a new scoped runtime claim fences its predecessor even with a still-open raw ledger', async () => {
  const s = await fixture()
  await (s.open() as any).open(s.c, false)
  await expect(s.r.fs.remove('Shared/sample.bin')).rejects.toThrow(/ownership|held|recovery/i)
  expect(await s.app.vault.adapter.read('Shared/sample.bin')).toBe('sample bytes')
})
it('a stale scoped host cannot revoke or forget a successor connection through Leave', async () => {
  const s = await fixture()
  await (s.open() as any).open(s.c, false)
  await expect(s.host.leave()).rejects.toThrow(/ownership|held|recovery/i)
  expect(s.app.loadLocalStorage(SCOPED_CONNECTION_KEY)).toEqual(s.c)
  expect(s.road.get(s.c.tokenId)).toBe('absi_' + 'a'.repeat(43))
  expect(s.fetcher).not.toHaveBeenCalled()
})

it('a queued Leave rechecks the original claim after a successor opens while its queue is blocked', async () => {
  const s = await fixture()
  let unblock = () => {},
    entered = () => {}
  const blocker = new Promise<void>((resolve) => {
      unblock = resolve
    }),
    started = new Promise<void>((resolve) => {
      entered = resolve
    })
  const occupying = (s.host as any).serial(async () => {
    entered()
    await blocker
  })
  await started
  const leaving = s.host.leave()
  const successor = s.open()
  const next = await (successor as any).open(s.c, false)
  unblock()
  await occupying
  await expect(leaving).rejects.toThrow(/ownership|held|recovery/i)
  expect(next.fence.claimHeld()).toBe(true)
  expect(s.app.loadLocalStorage(SCOPED_CONNECTION_KEY)).toEqual(s.c)
  expect(s.road.get(s.c.tokenId)).toBe('absi_' + 'a'.repeat(43))
  expect(s.fetcher).not.toHaveBeenCalled()
})

it('a refused Leave preserves its runtime claim so both start and Leave are retryable', async () => {
  const s = await fixture()
  await s.app.vault.adapter.write(
    'Shared/sample.bin',
    'changed ordinary candidate requiring inspection'
  )
  const state = vi
    .spyOn(s.r.client, 'state')
    .mockResolvedValue({
      state: 'preparing',
      role: 'editor',
      selector: { kind: 'group', root_file_id: s.c.rootFileId },
    })
  const read = vi
    .spyOn(s.app.vault.adapter, 'readBinary')
    .mockRejectedValueOnce(new Error('sample transient read failure'))
  await expect(s.host.leave()).rejects.toThrow('sample transient read failure')
  expect(s.r.fence.claimHeld()).toBe(true)
  expect(s.host.active).toBe(true)
  read.mockRestore()
  await s.host.start()
  expect(state).toHaveBeenCalled()
  const revoke = vi.spyOn(s.r.client, 'revokeSelf').mockResolvedValue('revoked')
  await s.host.leave()
  expect(revoke).toHaveBeenCalledOnce()
  expect(s.host.connection.value).toBeNull()
})

it('does not refuse Leave solely because an ordinary candidate vanishes between listing and reading', async () => {
  const s = await fixture()
  await s.app.vault.adapter.write(
    'Shared/sample.bin',
    'changed ordinary candidate requiring inspection'
  )
  const read = s.app.vault.adapter.readBinary.bind(s.app.vault.adapter)
  vi.spyOn(s.app.vault.adapter, 'readBinary').mockImplementation(async (path) => {
    if (path === 'Shared/sample.bin') {
      await s.app.vault.adapter.remove(path)
      throw Object.assign(new Error('sample file vanished'), { code: 'ENOENT' })
    }
    return read(path)
  })
  const revoke = vi.spyOn(s.r.client, 'revokeSelf').mockResolvedValue('revoked')
  await expect(s.host.leave()).resolves.toBeUndefined()
  expect(revoke).toHaveBeenCalledOnce()
  expect(s.host.connection.value).toBeNull()
})

it('cold scoped recovery holds pending downloads before watcher activation or scoped publication replay', async () => {
  const s = await fixture()
  const generation = s.app.loadLocalStorage(EXTERNAL_GENERATION_KEY) as {
    key: string
    generation: number
  }
  const binding = { ...JSON.parse(generation.key), generation: generation.generation }
  const state = await ExternalState.open(s.r.raw, s.c.ledgerId, binding)
  await state.commit({
    expectedRevision: 0,
    files: [
      {
        expectedRevision: null,
        next: {
          schema: 1,
          ledgerId: s.c.ledgerId,
          binding,
          fileId: 'sample-file',
          representation: 'pending-download',
          preference: 'keep-local',
          pinned: true,
          projectionPath: 'Shared/sample.bin.abele-ref',
          projectionSha: 'a'.repeat(64),
          localRevision: 0,
          pendingOperationId: null,
          availability: 'active',
          blockingReason: 'recovery-required',
          lastProvenLocalBase: null,
          retained: [],
        },
      },
    ],
  })
  await s.host.close()
  const cold = s.open()
  await expect(cold.start()).rejects.toThrow(/external|recovery/i)
  expect((cold as any).clock).toBeNull()
  expect((cold as any).unwatch).toBeNull()
  expect(s.fetcher).not.toHaveBeenCalled()
})
