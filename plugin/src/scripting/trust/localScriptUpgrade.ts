import type { App } from 'obsidian'
import { sha256 } from '@abele/sync-core'
import { AbeleConfig } from '@/services/AbeleConfig'
import { TRUST_KEY } from '../ScriptTrust'
import { trustStateFrom, verdictOf } from '../trustState'
import { assertNoScriptContextHold, SCRIPT_CONTEXT_HOLD_FILE } from './scriptContextHold'
import { SCRIPT_SENTINEL, SCRIPT_TRUST_KEY } from './scriptTrustStorage'

/** Exact versions already allowed here before the first managed sync. Never a vault file. */
export const LOCAL_SCRIPT_UPGRADE_KEY = 'abele-script-local-upgrade'
export interface LocalScriptVersion {
  path: string
  sha: string
}

export function localScriptVersions(app: App): LocalScriptVersion[] {
  const raw = app.loadLocalStorage(LOCAL_SCRIPT_UPGRADE_KEY)
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (v): v is LocalScriptVersion =>
      !!v && typeof v.path === 'string' && typeof v.sha === 'string' && /^[a-f0-9]{64}$/.test(v.sha)
  )
}

/** Run before starting ANY sync host. Once managed, disk bytes cannot bootstrap authority. */
export async function preserveLocalScriptVersions(app: App): Promise<void> {
  assertNoScriptContextHold(app)
  if (
    app.loadLocalStorage(SCRIPT_TRUST_KEY) != null ||
    (await app.vault.adapter.exists(SCRIPT_SENTINEL)) ||
    (await app.vault.adapter.exists(SCRIPT_CONTEXT_HOLD_FILE))
  )
    return
  const before = JSON.stringify(app.loadLocalStorage(TRUST_KEY))
  const state = trustStateFrom(app.loadLocalStorage(TRUST_KEY))
  const versions: LocalScriptVersion[] = []
  const folder = AbeleConfig.getInstance().ai.scriptsFolder
  const visit = async (path: string): Promise<void> => {
    const listing = await app.vault.adapter.list(path)
    for (const child of listing.folders) await visit(child)
    for (const file of listing.files) {
      if (!file.endsWith('.js')) continue
      const sha = await sha256(new Uint8Array(await app.vault.adapter.readBinary(file)))
      // When checking was off these local versions were executable already. When on,
      // only the exact approved 1.x versions survive; unknown bytes are not grandfathered.
      if (verdictOf(state, file, sha) === 'confirmed') versions.push({ path: file, sha })
    }
  }
  if (folder && (await app.vault.adapter.exists(folder))) await visit(folder)
  assertNoScriptContextHold(app)
  if (
    app.loadLocalStorage(SCRIPT_TRUST_KEY) != null ||
    (await app.vault.adapter.exists(SCRIPT_SENTINEL)) ||
    before !== JSON.stringify(app.loadLocalStorage(TRUST_KEY))
  )
    throw new Error('Script trust changed during upgrade; run the script manually to review it')
  app.saveLocalStorage(LOCAL_SCRIPT_UPGRADE_KEY, versions)
  if (JSON.stringify(app.loadLocalStorage(LOCAL_SCRIPT_UPGRADE_KEY)) !== JSON.stringify(versions))
    throw new Error('Local script upgrade approvals were not persisted')
}
