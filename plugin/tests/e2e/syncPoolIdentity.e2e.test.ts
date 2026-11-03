import { expect, it } from 'vitest'
import { targets } from './helpers/target'
import { PHONE_VAULT } from './helpers/phone'
import { vaultCli } from './helpers/obsidianCli'
import { loadedVaultIdentity, poolVaultRegistry } from './helpers/poolVaultRegistry'

targets('phone')
it.skipIf(process.env.ABELE_SYNC_IDENTITY_PROBE_CONFIRM !== 'read-sync-pool-vault-registry')(
  'reports only read-only host vault-registry evidence',
  async () => {
    if (
      !process.env.IPHONE_LOCK_OWNER ||
      !process.env.ABELE_PHONE_VAULT ||
      process.env.ABELE_PHONE_VAULT !== PHONE_VAULT
    )
      throw new Error('Allocated phone vault required')
    const result = vaultCli(PHONE_VAULT).evalAwait<
      ReturnType<typeof poolVaultRegistry> & { loadedVault: ReturnType<typeof loadedVaultIdentity> }
    >(
      `({...(${poolVaultRegistry.toString()})(app),loadedVault:(${loadedVaultIdentity.toString()})(app)})`
    )
    expect(result.loadedVault.name).toBe(PHONE_VAULT)
    expect(result.loadedVault.independent).toBe(false)
    expect(result.loadedVault.appId).toBeTypeOf('string')
    expect(result.loadedVault.appId.length).toBeGreaterThan(0)
    console.log('[sync pool vault registry]', JSON.stringify(result))
    expect(typeof result.available).toBe('boolean')
    // An unavailable registry is a useful executed probe, not authority to wipe.
    if (result.available) expect(result.vaults.length).toBeGreaterThan(0)
    else expect(result.reason).toContain('not independent registry evidence')
  }
)
