import { expect, it, vi } from 'vitest'
import { SyncService } from '@/sync/SyncService'
import { EngineRunner } from '@/sync/engineRunner'
import { ConnectionRegistry } from '@/sync/connectionRegistry'
import { emptyConnection, writeConnection } from '@/sync/connection'
import { writeLedgerId } from '@/sync/ledgerId'
import { useVault } from '../helpers/testEnv'
import { deferred } from '../helpers/deferred'
import { pendingTeardown } from '@/sync/teardownBarrier'

it('composes two independent personal queues with separate endpoint-bound contexts over one vault', async () => {
  const app = useVault([]),
    registry = ConnectionRegistry.open(app)
  for (const name of ['one', 'two']) {
    const id = registry.add('personal'),
      storage = registry.storage(id)
    writeConnection(storage, {
      ...emptyConnection(),
      serverUrl: `https://${name}.example.invalid`,
      enrolledUrl: `https://${name}.example.invalid`,
      vaultId: 'same-vault-id',
      deviceId: 'sample-' + name,
      deviceTokenId: 'abele-sync-device-sample-' + name,
    })
    writeLedgerId(storage, { stateId: 'sample-ledger-' + name, vaultId: 'same-vault-id' })
    if (name === 'one') registry.select(id)
  }
  const gate = deferred<void>(),
    events: string[] = []
  const reconcile = vi
    .spyOn(EngineRunner.prototype, 'reconcile')
    .mockImplementation(async function () {
      const host = (this as any).host
      expect(host.app().vault).toBe(app.vault)
      const url = host.connection().serverUrl
      events.push(url)
      if (url === 'https://one.example.invalid') await gate.promise
    })
  const service = SyncService.getInstance()
  try {
    service.init(app as never, { registerDomEvent: vi.fn(), register: vi.fn() } as never)
    await vi.waitFor(() =>
      expect(events.sort()).toEqual(['https://one.example.invalid', 'https://two.example.invalid'])
    )
    const stopping = service.destroy()
    let stopped = false
    void pendingTeardown(app).then(() => {
      stopped = true
    })
    await Promise.resolve()
    expect(stopped).toBe(false)
    gate.resolve()
    await stopping
    await pendingTeardown(app)
    expect(stopped).toBe(true)
  } finally {
    gate.resolve()
    await service.destroy()
    reconcile.mockRestore()
  }
})
