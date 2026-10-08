import type { App } from 'obsidian'
import { sha256 } from '@abele/sync-core'
import { newStateId } from '@/sync/ids'
import { scriptTrustFor, SCRIPT_TRUST_KEY } from './scriptTrustStorage'
import { rememberLocalScriptVersion } from './localScriptUpgrade'
import { scriptConnectionKey } from './scriptConnection'
import { assertNoScriptContextHold, SCRIPT_CONTEXT_HOLD_FILE } from './scriptContextHold'

/** Called by explicit local authoring sites, NEVER by native modify/create or sync receipts. */
export async function noteManagedLocalScriptWrite(
  app: App,
  path: string,
  source: string
): Promise<void> {
  const contextKey = () =>
    JSON.stringify([scriptConnectionKey(app), app.loadLocalStorage(SCRIPT_TRUST_KEY)])
  const before = contextKey()
  const assertContext = () => {
    assertNoScriptContextHold(app)
    if (before !== contextKey()) throw new Error('Script context changed during local authoring')
  }
  const trust = await scriptTrustFor(app)
  try {
    if (trust && trust.provenance.binding.facet !== 'personal') return
    const sha = await sha256(new TextEncoder().encode(source))
    if (await app.vault.adapter.exists(SCRIPT_CONTEXT_HOLD_FILE))
      throw new Error('Script execution blocked while a protected context is isolated')
    assertContext()
    if (!trust) {
      // Explicit authoring is already proof before the first sync connection. Do not wait
      // for an engine or resnapshot disk bytes, which could have arrived from elsewhere.
      rememberLocalScriptVersion(app, path, sha)
      return
    }
    let identity = await trust.provenance.lookup(path)
    // A pending remote mutation is not a local-authoring receipt.
    if (identity && !identity.fileId) return
    if (!identity) {
      await trust.provenance.record(path, `local:${newStateId()}`)
      identity = await trust.provenance.lookup(path)
    }
    await trust.provenance.approve(path, identity!, sha)
    await trust.provenance.preserveLocalVersion(path, sha)
    assertContext()
    rememberLocalScriptVersion(app, path, sha)
  } finally {
    trust?.store.close()
  }
}
