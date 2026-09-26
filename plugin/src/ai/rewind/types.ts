/**
 * What a chat remembers about the files its agent changed, so that a turn can be taken back.
 *
 * One entry per operation a tool made — a write, a rename, a folder sent to the trash — with,
 * for every path the operation touched, the state before it and a fingerprint of the state
 * after. The state before is what gets put back; the fingerprint after is how a restore tells
 * whether somebody changed the file since.
 */

/** A path as it was before an operation. */
export type Before =
  | { t: 'missing' }
  | { t: 'folder'; movedTo?: string }
  | { t: 'text'; hash: string; text: string; movedTo?: string }
  /**
   * `blob` names the copy kept beside the log; absent when the file was too large to keep, and
   * then the only way back is the move that `movedTo` names, if there was one.
   */
  | { t: 'binary'; hash: string; size: number; blob?: string; movedTo?: string }

/** A path's state after an operation: `null` for nothing there, `'folder'`, or a file's hash. */
export type After = string | null

export interface Change {
  path: string
  before: Before
  after: After
}

export interface RewindEntry {
  id: string
  /** The user message whose turn made the change. */
  turn: string
  /** When the operation finished. */
  at: number
  /** The tool the agent called; absent when it is not known. */
  tool?: string
  /** What the vault was asked to do: `modify`, `create`, `rename`, `trash`… */
  op: string
  changes: Change[]
}

export interface RewindLogFile {
  version: 1
  entries: RewindEntry[]
}

/** The state a path is in right now, read for a restore. */
export type Current =
  | { t: 'missing' }
  | { t: 'folder' }
  | { t: 'text'; hash: string; text: string }
  | { t: 'binary'; hash: string }

/** What a restore will do to one path. */
export type ItemAction =
  /** Written back with the content it had. */
  | 'rewrite'
  /** Made again: it was deleted, or moved away and its copy is what is left. */
  | 'recreate'
  /** Sent to the trash: the agent made it. */
  | 'remove'
  /** Moved back from where the agent put it. */
  | 'move-back'
  /** An empty folder the agent made, removed once everything in it has gone. */
  | 'remove-folder'
  /** A folder that was deleted, made again. */
  | 'recreate-folder'
  /** A large file whose content was not kept, and which cannot be moved back. */
  | 'unrestorable'

export interface RestoreItem {
  path: string
  action: ItemAction
  /** For `move-back`: where the file is now. */
  from?: string
  /** Changed since the agent's last change to it, by somebody else. */
  conflict: boolean
  /** Text now, and the text it will have — for the preview. Absent for binaries and folders. */
  diff?: { old: string; new: string }
  /** The state that will be put back. */
  target: Before
  /** Every change this item takes back, as `entryId:index`, so applied ones leave the log. */
  refs: string[]
}

export interface RestorePlan {
  items: RestoreItem[]
  /** Entries the plan covers. */
  entryIds: string[]
  /** Changes whose paths already are as they were: they leave the log with the restore. */
  settled: string[]
}

/** What the person chose for a file that changed since: leave it, or put it back regardless. */
export type ConflictChoice = 'skip' | 'overwrite'

export interface RestoreResult {
  restored: string[]
  skipped: string[]
  failed: { path: string; error: string }[]
}
