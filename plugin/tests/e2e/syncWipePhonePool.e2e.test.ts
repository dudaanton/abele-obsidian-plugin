import { expect, it } from 'vitest'
import { targets } from './helpers/target'
import { PHONE_VAULT } from './helpers/phone'
import { SyncDriver } from './helpers/syncDriver'
import { vaultCli } from './helpers/obsidianCli'

targets('phone')
it.skipIf(process.env.ABELE_SYNC_WIPE_CONFIRM !== 'wipe-sync-phone-pool')(
  'wipes only the independently identified sync phone pool and proves enrollment safety',
  async () => {
    const vault = process.env.ABELE_PHONE_VAULT
    const appId = process.env.ABELE_PHONE_VAULT_ID
    if (!process.env.IPHONE_LOCK_OWNER) throw new Error('Allocated phone lease required')
    if (!vault || vault !== PHONE_VAULT || !appId)
      throw new Error('Independent allocator phone vault name/appId required')
    const device = new SyncDriver(() => vaultCli(vault))
    const result = await device.long<{ paths: string[] }>(
      'wipe explicitly identified sync phone pool',
      `return await window.__abeleTest.wipePhonePool(${JSON.stringify({ vault, appId, confirm: 'wipe-sync-phone-pool' })})`,
      false,
      90000,
      true
    )
    expect(result.paths).toEqual(['.abele-sync'])
    expect(device.rows()).toEqual([])
    expect(device.candidates()).toEqual([])
    expect(device.questions()).toEqual([])
  },
  120000
)
