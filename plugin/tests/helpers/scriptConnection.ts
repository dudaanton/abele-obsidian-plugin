import { CONNECTION_KEY } from '@/sync/connection'
import type { LocalStorage } from '@/sync/ledgerId'
import type { ScriptBinding } from '@/scripting/trust/ScriptProvenance'

/** A coherent real connection in script-trust fixtures, not an engine-descriptor shortcut. */
export function setScriptConnection(
  storage: LocalStorage,
  binding: Omit<ScriptBinding, 'localVault'>
): void {
  storage.saveLocalStorage(CONNECTION_KEY, {
    serverUrl: binding.endpoint,
    enrolledUrl: binding.endpoint,
    vaultId: binding.vaultId,
    deviceId: binding.principal,
    facet: binding.facet,
    grantId: binding.grantId,
  })
}
