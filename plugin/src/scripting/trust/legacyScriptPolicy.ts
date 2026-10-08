import type { App } from 'obsidian'
import { TRUST_KEY } from '../ScriptTrust'
import { trustStateFrom, verdictOf } from '../trustState'

/** Read only device-local 1.x policy. A checking-off verdict is NOT a receipt or an exact
 * approval of managed bytes; it applies only to positively unmanaged offline paths. */
export function legacyScriptPolicy(app: App, path: string, sha: string) {
  const raw = app.loadLocalStorage(TRUST_KEY)
  const state = trustStateFrom(raw)
  const verdict = verdictOf(state, path, sha)
  return {
    key: JSON.stringify(raw) ?? 'null',
    verdict,
    exact: state.armed && verdict === 'confirmed',
  }
}
