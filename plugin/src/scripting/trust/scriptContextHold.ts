import type { LocalStorage } from '@/sync/ledgerId'
/** Independent execution fence survives temporary connection/provenance profile changes. */
export const SCRIPT_CONTEXT_HOLD_KEY = 'abele-script-execution-context-hold'
export const SCRIPT_CONTEXT_HOLD_FILE = '.abele-script-context-hold'
export function assertNoScriptContextHold(storage: LocalStorage | null): void {
  if (storage?.loadLocalStorage(SCRIPT_CONTEXT_HOLD_KEY) != null)
    throw new Error('Script execution blocked while a protected context is isolated')
}
