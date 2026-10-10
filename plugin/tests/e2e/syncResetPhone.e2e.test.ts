import { expect, it } from 'vitest'
import { targets } from './helpers/target'
import { PHONE_VAULT } from './helpers/phone'
import { SyncDriver } from './helpers/syncDriver'
import { vaultCli } from './helpers/obsidianCli'

targets('phone')

/** Explicit manager operation; the ordinary phone fixture never resets a dirty vault. */
it.skipIf(process.env.ABELE_SYNC_RESET_CONFIRM !== 'reset-sync-token-state')(
  'resets token sync state in the explicitly selected phone vault',
  async () => {
    const device = new SyncDriver(() => vaultCli(PHONE_VAULT))
    await device.long(
      'reset explicitly selected phone vault',
      `await window.__abeleTest.resetSyncTokenState({vault:${JSON.stringify(PHONE_VAULT)},confirm:'reset-sync-token-state'});return true`
    )
    expect(device.rows()).toEqual([])
    expect(device.candidates()).toEqual([])
    expect(device.questions()).toEqual([])
  }
)
