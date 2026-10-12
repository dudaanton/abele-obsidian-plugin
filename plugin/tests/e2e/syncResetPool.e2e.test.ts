import { expect, it } from 'vitest'
import { SyncDriver } from './helpers/syncDriver'
import { vaultCli } from './helpers/obsidianCli'

/** Explicit manager operation. Never automatically reset an unknown or dirty lease. */
it.skipIf(process.env.ABELE_SYNC_RESET_CONFIRM !== 'reset-sync-token-state')(
  'resets only token sync state in the two explicitly leased pool vaults',
  async () => {
    const names = [process.env.OBSIDIAN_TEST_VAULT, process.env.ABELE_SYNC_PEER_VAULT]
    if (names.some((name) => !name) || new Set(names).size !== 2)
      throw new Error('Two different exclusively leased pool vault names are required')
    const failures: unknown[] = []
    for (const name of names) {
      const device = new SyncDriver(() => vaultCli(name!))
      try {
        await device.long(
          'reset explicitly leased pool',
          `await window.__abeleTest.resetSyncTokenState({vault:${JSON.stringify(name)},confirm:'reset-sync-token-state'});return true`
        )
        device.assertTokenStateReset()
        expect(device.rows()).toEqual([])
        expect(device.candidates()).toEqual([])
        expect(device.questions()).toEqual([])
      } catch (error) {
        failures.push(error)
      }
    }
    if (failures.length) throw new AggregateError(failures, 'Pool reset failed')
  }
)
