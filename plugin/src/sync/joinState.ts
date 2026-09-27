import { Notice } from 'obsidian'
import type { JoinPrefer } from '@abele/sync-protocol'
import type { DeviceConnection } from './connection'

/**
 * Joining a vault that already has files, from a vault that has files too (phase 3b, decision 7),
 * as the connection record keeps it: what a join in progress is, how it is read back, and what
 * the engine and the log make of it. The question the join dialog asks is `join.ts`.
 */

/**
 * A join in progress. Which side wins where both hold a file at one path with other bytes is the
 * person's to say, and the answer is kept with the connection until the join is done — across a
 * restart, so a join cut off half way finishes the way it was asked to. A transfer brings a
 * connection with the question still open (`ask`), and nothing is built until it is answered.
 */
export interface JoinState {
  /** The vault this join is to; a join to any other vault than the connection's is not in force. */
  vaultId: string
  /**
   * `mine`: this device's copy becomes the head everywhere; `theirs`: the server's stays, and is
   * written here. Null is "merge both", which the engine does when it is told nothing.
   */
  prefer: JoinPrefer | null
  /** The question is still to be answered: no engine is built until it is. */
  ask: boolean
}

/**
 * The join a record holds, taken only whole. One that is there and does not read is taken as the
 * question asked again, on the vault the connection names — never as "merge", which is a choice
 * somebody would then not have made — and as nothing on a device with no vault to join.
 */
export function joinFrom(
  raw: unknown,
  vaultId: string
): { join: JoinState | null; damaged: boolean } {
  if (raw === undefined || raw === null) return { join: null, damaged: false }
  const o = typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
  const prefer = o === null ? undefined : o.prefer === null ? null : preferOf(o.prefer)
  if (o !== null && typeof o.vaultId === 'string' && prefer !== undefined) {
    if (typeof o.ask === 'boolean') {
      return { join: { vaultId: o.vaultId, prefer, ask: o.ask }, damaged: false }
    }
  }
  return { join: vaultId === '' ? null : { vaultId, prefer: null, ask: true }, damaged: true }
}

/** A side the engine takes at a join, or undefined for anything that is not one. */
const preferOf = (raw: unknown): JoinPrefer | undefined =>
  raw === 'mine' || raw === 'theirs' ? raw : undefined

/**
 * The join the connection is in the middle of, or null. A join to another vault than the one the
 * connection names is not this connection's, and is not in force.
 *
 * So an agent that writes `sync.vaultId` builds an engine without the question being asked, and
 * writing the old id back brings the join back. Left so on purpose (task-8 review, #7): the
 * device token is bound to its own vault, and the server refuses it on any other, so that engine
 * syncs nothing.
 */
export function joinOf(connection: DeviceConnection): JoinState | null {
  const join = connection.join
  return join !== null && join.vaultId === connection.vaultId ? join : null
}

/**
 * What is added to the scope key while a join is in progress. The engine of a join leaves this
 * device's own `data.json` alone (`EngineRunner.build`), so the one built once it is done has
 * something to take up that the join's did not: filed under a key of its own, the next build
 * finds the scope moved and walks the manifest again — at the next start too, if the plugin
 * stopped in between.
 */
export const JOIN_SCOPE = ' joining'

/** A join's side in the log's words. */
export function sideOf(prefer: JoinPrefer | null): string {
  if (prefer === 'mine') return "where both sides hold a file, this device's copy wins"
  if (prefer === 'theirs') return "where both sides hold a file, the server's copy wins"
  return 'notes changed on both sides keep both texts, and other files go to the newer copy'
}

/** What the log says of the join an engine was just built for. */
export function joinLine(join: JoinState): string {
  return `joining: ${sideOf(join.prefer)}; the other copy is kept in the file's history`
}

/** What finishing a join needs of the service. */
export interface JoinHost {
  connection(): DeviceConnection
  save(patch: { join: null }): void
  note(text: string): void
  /** Queue a reconcile, so the next engine is built without the join. */
  reconcile(): void
}

/**
 * The engine finished the join it was built with: the choice is forgotten, so no later engine
 * is built with it, and the next one — no longer leaving this device's own `data.json` alone —
 * walks the manifest again to take that file up the way a first contact does. Only the join
 * still on file is cleared: one answered again since, or for another vault, is not this one.
 */
export function finishJoin(host: JoinHost, join: JoinState): void {
  const connection = host.connection()
  const now = connection.join
  if (now === null || now.ask || now.vaultId !== join.vaultId) return
  host.save({ join: null })
  const vault = connection.vaultName || join.vaultId
  host.note(`joined ${vault}; the choice of which side wins is done with`)
  new Notice(
    `This vault is now synced with ${vault}. Where both had a different copy of a file, the ` +
      "other copy is kept in that file's Version history."
  )
  host.reconcile()
}

/**
 * A join a transfer left open syncs nothing until it is answered, and only the status bar would
 * say so: said once at startup, where the person sees it.
 */
export function tellJoinWaiting(connection: DeviceConnection): void {
  if (joinOf(connection)?.ask !== true) return
  const vault = connection.vaultName || connection.vaultId
  new Notice(
    `Abele Sync is waiting: choose how this vault's files are joined with ${vault} on the ` +
      'Sync tab. Nothing syncs until then.'
  )
}
