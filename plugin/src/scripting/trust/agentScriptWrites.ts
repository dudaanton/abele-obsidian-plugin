import type { App } from 'obsidian'
import { sha256 } from '@abele/sync-sdk/core'

/** Device-local authority, independent of the optional foreign-script setting. */
export const AGENT_SCRIPT_WRITES_KEY = 'abele-agent-script-writes'
interface AgentScriptWrites {
  paths: string[]
  hashes: string[]
  approved: string[]
}

function state(app: App): AgentScriptWrites {
  const raw: unknown = app.loadLocalStorage(AGENT_SCRIPT_WRITES_KEY)
  if (raw == null) return { paths: [], hashes: [], approved: [] }
  const value = raw as AgentScriptWrites
  if (
    !value ||
    ![value.paths, value.hashes, value.approved].every(
      (list) => Array.isArray(list) && list.every((item) => typeof item === 'string')
    )
  )
    throw new Error('Agent script approvals are unreadable')
  return value
}

function save(app: App, value: AgentScriptWrites): void {
  app.saveLocalStorage(AGENT_SCRIPT_WRITES_KEY, value)
  if (JSON.stringify(app.loadLocalStorage(AGENT_SCRIPT_WRITES_KEY)) !== JSON.stringify(value))
    throw new Error('Agent script approvals were not persisted')
}

export function agentScriptWaiting(app: App, path: string, hash?: string): boolean {
  const value = state(app)
  return (
    (value.paths.includes(path) || (!!hash && value.hashes.includes(hash))) &&
    (!hash || !value.approved.includes(hash))
  )
}

/** Persist the path hold BEFORE any asynchronous work or filesystem mutation. Hash holds
 * follow copies/renames; path holds also cover mutations whose final bytes are not known yet. */
export async function noteAgentScriptWrite(
  app: App,
  path: string,
  content?: string | ArrayBuffer
): Promise<void> {
  if (!path.endsWith('.js')) return
  const before = state(app)
  if (!before.paths.includes(path)) save(app, { ...before, paths: [...before.paths, path] })
  if (content === undefined) return
  const hash = await sha256(
    typeof content === 'string' ? new TextEncoder().encode(content) : new Uint8Array(content)
  )
  // Re-read after hashing: concurrent writes and owner decisions must not be lost.
  const current = state(app)
  if (!current.hashes.includes(hash)) save(app, { ...current, hashes: [...current.hashes, hash] })
}

/** Only an owner authoring/review site, or an explicitly authorized script run, calls this. */
export function confirmAgentScript(app: App, hash: string): void {
  const value = state(app)
  if (!value.approved.includes(hash)) save(app, { ...value, approved: [...value.approved, hash] })
}
