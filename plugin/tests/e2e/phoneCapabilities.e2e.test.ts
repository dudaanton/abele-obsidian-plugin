import { describe, it } from 'vitest'
import { vaultCli } from './helpers/obsidianCli'
import { PHONE_VAULT } from './helpers/phone'
import { requested, targets } from './helpers/target'
import { phoneCapabilities } from './helpers/phoneCapabilities'

targets('phone')

/**
 * A record of what the phone's filesystem offers, with nothing to assert: it cannot fail, so it
 * runs only when asked for (`ABELE_E2E_DIAGNOSTICS=1`), not in every phone batch.
 */
describe.runIf(requested('ABELE_E2E_DIAGNOSTICS'))('phone capabilities', () => {
  it('records native filesystem and vault adapter capabilities without invoking them', () => {
    const findings = vaultCli(PHONE_VAULT).evalAwait<ReturnType<typeof phoneCapabilities>>(
      `(${phoneCapabilities.toString()})(window.Capacitor,app.vault.adapter)`
    )
    console.info('[phone-capabilities]', JSON.stringify(findings))
  })

  it('records the plugin filesystem probe with WebView ranges, native callbacks and cleanup', () => {
    const findings = vaultCli(PHONE_VAULT).evalAwait(
      'new window.__abeleTest.BoundedVaultIo(app.vault.adapter,undefined,undefined,undefined,app.vault.configDir).diagnoseMobile()',
      180000
    )
    console.info('[phone-filesystem-probe]', JSON.stringify(findings))
  })
})
