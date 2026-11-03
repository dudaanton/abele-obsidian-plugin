import { expect, it } from 'vitest'
import { targets, onPhone } from './helpers/target'
import { PHONE_VAULT } from './helpers/phone'
import { SyncDriver } from './helpers/syncDriver'
import { vaultCli } from './helpers/obsidianCli'

targets('desktop', 'phone')
it.skipIf(
  process.env.ABELE_SYNC_WIPE_CONFIRM !== 'wipe-sync-pool' ||
    process.env.ABELE_SYNC_EXPLICIT_POOL_WIPE !== 'syncWipePool'
)(
  'wipes only independently identified leased vaults and proves enrollment safety',
  async () => {
    const phone = onPhone()
    const names = phone
      ? [process.env.ABELE_PHONE_VAULT]
      : [process.env.OBSIDIAN_TEST_VAULT, process.env.ABELE_SYNC_PEER_VAULT]
    if (phone && (!process.env.IPHONE_LOCK_OWNER || names[0] !== PHONE_VAULT))
      throw new Error('Allocated phone vault lease required')
    if (names.some((name) => !name) || new Set(names).size !== names.length)
      throw new Error('Distinct allocator vault names required')
    const identities: unknown = phone
      ? { [names[0]!]: process.env.ABELE_PHONE_VAULT_ID }
      : JSON.parse(process.env.ABELE_SYNC_WIPE_IDENTITIES ?? 'null')
    if (
      !identities ||
      typeof identities !== 'object' ||
      Array.isArray(identities) ||
      Object.keys(identities).length !== names.length
    )
      throw new Error('Independent vault registry identities required')
    // Validate the whole pair before the first effect.
    const selected = names.map((vault) => {
      const appId: unknown = Reflect.get(identities, vault!)
      if (typeof appId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(appId))
        throw new Error('Independent registered vault identity required')
      return { vault: vault!, appId, confirm: 'wipe-sync-pool', operation: 'syncWipePool' }
    })
    for (const request of selected) {
      const observed = vaultCli(request.vault).evalAwait<{ vault: string; appId: string }>(
        `({vault:app.vault.getName(),appId:app.appId})`
      )
      expect(observed).toEqual({ vault: request.vault, appId: request.appId })
    }
    const failures: unknown[] = []
    for (const request of selected) {
      const device = new SyncDriver(() => vaultCli(request.vault))
      try {
        const result = await device.long<{ paths: string[] }>(
          'wipe explicitly identified vault under test',
          `return await window.__abeleTest.wipePool(${JSON.stringify(request)})`,
          false,
          90000,
          true
        )
        expect(result.paths).toEqual(['.abele-sync'])
        expect(device.rows()).toEqual([])
        expect(device.candidates()).toEqual([])
        expect(device.questions()).toEqual([])
      } catch (error) {
        failures.push(error)
      }
    }
    if (failures.length) throw new AggregateError(failures, 'Scoped pool wipe failed')
  },
  240000
)
