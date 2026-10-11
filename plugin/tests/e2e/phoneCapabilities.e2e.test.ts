import { it } from 'vitest'
import { vaultCli } from './helpers/obsidianCli'
import { PHONE_VAULT } from './helpers/phone'
import { targets } from './helpers/target'
import { phoneCapabilities } from './helpers/phoneCapabilities'

targets('phone')

it('records native filesystem and vault adapter capabilities without invoking them', () => {
  const findings = vaultCli(PHONE_VAULT).evalAwait<ReturnType<typeof phoneCapabilities>>(
    `(${phoneCapabilities.toString()})(window.Capacitor,app.vault.adapter)`
  )
  console.info('[phone-capabilities]', JSON.stringify(findings))
})

it('records the plugin filesystem probe with native paths, callbacks and cleanup', () => {
  const findings = vaultCli(PHONE_VAULT).evalAwait(
    'new window.__abeleTest.BoundedVaultIo(app.vault.adapter).diagnoseMobile()',
    180000
  )
  console.info('[phone-filesystem-probe]', JSON.stringify(findings))
})
