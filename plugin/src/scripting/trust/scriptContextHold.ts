import type { LocalStorage } from '@/sync/ledgerId'
import { SCOPED_JOIN_KEY, SCOPED_CONNECTION_KEY } from '@/sync/scoped/scopedJoin'
/** Independent execution fence survives temporary connection/provenance profile changes. */
export const SCRIPT_CONTEXT_HOLD_KEY = 'abele-script-execution-context-hold'
export const SCRIPT_CONTEXT_HOLD_FILE = '.abele-script-context-hold'
export function assertNoScriptContextHold(storage: LocalStorage | null): void {
  if (
    storage &&
    (storage.loadLocalStorage(SCOPED_JOIN_KEY) != null ||
      storage.loadLocalStorage(SCOPED_CONNECTION_KEY) != null)
  )
    throw new Error('Scoped installations refuse vault script execution')
  if (storage?.loadLocalStorage(SCRIPT_CONTEXT_HOLD_KEY) != null)
    throw new Error('Script execution blocked while a protected context is isolated')
}
