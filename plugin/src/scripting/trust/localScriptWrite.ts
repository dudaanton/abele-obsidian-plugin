import type { App } from 'obsidian'
import { sha256 } from '@abele/sync-core'
import { newStateId } from '@/sync/ids'
import { scriptTrustFor } from './scriptTrustStorage'
import { localScriptVersions, LOCAL_SCRIPT_UPGRADE_KEY } from './localScriptUpgrade'

/** Called by explicit local authoring sites, NEVER by native modify/create or sync receipts. */
export async function noteManagedLocalScriptWrite(
  app: App,
  path: string,
  source: string
): Promise<void> {
  const trust = await scriptTrustFor(app)
  if (!trust) return
  try {
    if (trust.provenance.binding.facet !== 'personal') return
    const sha = await sha256(new TextEncoder().encode(source))
    let identity = await trust.provenance.lookup(path)
    // A pending remote mutation is not a local-authoring receipt.
    if (identity && !identity.fileId) return
    if (!identity) {
      await trust.provenance.record(path, `local:${newStateId()}`)
      identity = await trust.provenance.lookup(path)
    }
    await trust.provenance.approve(path, identity!, sha)
    await trust.provenance.preserveLocalVersion(path, sha)
    const versions = [...localScriptVersions(app).filter((v) => v.path !== path), { path, sha }]
    app.saveLocalStorage(LOCAL_SCRIPT_UPGRADE_KEY, versions)
    if (JSON.stringify(app.loadLocalStorage(LOCAL_SCRIPT_UPGRADE_KEY)) !== JSON.stringify(versions))
      throw new Error('Local script authoring approval was not persisted')
  } finally {
    trust.store.close()
  }
}
