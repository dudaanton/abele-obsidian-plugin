import type { App } from 'obsidian'
import { sha256 } from '@abele/sync-sdk/core'
import { AbeleConfig } from '@/services/AbeleConfig'
import { TRUST_KEY } from '../ScriptTrust'
import { trustStateFrom, hasExplicitReceipt } from '../trustState'
import { assertNoScriptContextHold, SCRIPT_CONTEXT_HOLD_FILE } from './scriptContextHold'
import { SCRIPT_SENTINEL, SCRIPT_TRUST_KEY } from './scriptTrustStorage'
import { agentScriptWaiting } from './agentScriptWrites'

/** Explicit local receipts before the first managed sync. Never a vault file. */
export const LOCAL_SCRIPT_UPGRADE_KEY = 'abele-script-local-upgrade'
export interface LocalScriptVersion {
  path: string
  sha: string
  explicit: true
}

export function localScriptVersions(app: App): LocalScriptVersion[] {
  const raw = app.loadLocalStorage(LOCAL_SCRIPT_UPGRADE_KEY)
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (v): v is LocalScriptVersion =>
      !!v &&
      v.explicit === true &&
      typeof v.path === 'string' &&
      typeof v.sha === 'string' &&
      /^[a-f0-9]{64}$/.test(v.sha)
  )
}

/** Exact versions explicitly authored/reviewed here, or already approved in a local managed store. */
export function rememberLocalScriptVersion(app: App, path: string, sha: string): void {
  const current = localScriptVersions(app)
  if (current.some((v) => v.path === path && v.sha === sha)) return
  const versions = [...current.filter((v) => v.path !== path), { path, sha, explicit: true }]
  app.saveLocalStorage(LOCAL_SCRIPT_UPGRADE_KEY, versions)
  if (JSON.stringify(app.loadLocalStorage(LOCAL_SCRIPT_UPGRADE_KEY)) !== JSON.stringify(versions))
    throw new Error('Local script approval was not persisted')
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
  const receiptsBefore = JSON.stringify(app.loadLocalStorage(LOCAL_SCRIPT_UPGRADE_KEY))
  const receipts = localScriptVersions(app)
  const versions: LocalScriptVersion[] = []
  const folder = AbeleConfig.getInstance().ai.scriptsFolder
  const visit = async (path: string): Promise<void> => {
    const listing = await app.vault.adapter.list(path)
    for (const child of listing.folders) await visit(child)
    for (const file of listing.files) {
      if (!file.endsWith('.js')) continue
      const sha = await sha256(new Uint8Array(await app.vault.adapter.readBinary(file)))
      // Being executable under optional policy is not proof of explicit consent.
      const explicitlyReviewed = receipts.some((v) => v.path === file && v.sha === sha)
      if (
        (hasExplicitReceipt(state, sha) || explicitlyReviewed) &&
        !agentScriptWaiting(app, file, sha)
      )
        versions.push({ path: file, sha, explicit: true })
    }
  }
  if (folder && (await app.vault.adapter.exists(folder))) await visit(folder)
  assertNoScriptContextHold(app)
  if (
    app.loadLocalStorage(SCRIPT_TRUST_KEY) != null ||
    (await app.vault.adapter.exists(SCRIPT_SENTINEL)) ||
    before !== JSON.stringify(app.loadLocalStorage(TRUST_KEY)) ||
    receiptsBefore !== JSON.stringify(app.loadLocalStorage(LOCAL_SCRIPT_UPGRADE_KEY))
  )
    throw new Error('Script trust changed during upgrade; run the script manually to review it')
  app.saveLocalStorage(LOCAL_SCRIPT_UPGRADE_KEY, versions)
  if (JSON.stringify(app.loadLocalStorage(LOCAL_SCRIPT_UPGRADE_KEY)) !== JSON.stringify(versions))
    throw new Error('Local script upgrade approvals were not persisted')
}
