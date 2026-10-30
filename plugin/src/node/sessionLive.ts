/**
 * A long-lived session on a node, as its chat shows it: how it runs (model, effort, account,
 * permissions), how full its context is, what it keeps running between answers, where it came
 * from, and what it can be asked to do. The chat reads it; the node connection fills it.
 */

export type PermissionMode = 'manual' | 'acceptEdits' | 'auto' | 'plan' | 'dontAsk' | 'bypass'

export interface SessionSettings {
  model: string
  effort: string
  account: string
  mode: PermissionMode
}

export interface SessionChoice {
  id: string
  label: string
  /** Cannot be picked now, and why: an account out of its limit. */
  unavailable?: string
}

export interface SessionChoices {
  models: SessionChoice[]
  efforts: SessionChoice[]
  accounts: SessionChoice[]
  /** The node lets a session run with no questions; off, Bypass cannot be picked. */
  bypassAllowed: boolean
  /** The modes this agent takes, when fewer than Claude Code's: pi and ACP agents ask or not. */
  modes?: PermissionMode[]
}

/** Something the session left running that outlives its answer and wakes it when it ends. */
export interface BackgroundTask {
  id: string
  kind: 'command' | 'monitor' | 'agent'
  title: string
  /** When it started, ms. */
  since: number
}

export interface ContextUse {
  /** Tokens in the context now. */
  used: number
  limit: number
}

export type ChildState = 'running' | 'waiting' | 'failed' | 'done' | 'stopped'

/** A session another one started through the node, or a worker started in the background. */
export interface ChildSession {
  id: string
  title: string
  /** Who runs it: an agent's name, or the worker's. */
  agent: string
  /** Your own chat, an agent another session started, or a worker run in the background. */
  kind: 'chat' | 'agent' | 'worker'
  state: ChildState
  /** What it does now, while it works. */
  doing?: string
  /** What it waits on you for. */
  asks?: string
  /** Its last words, once done. */
  result?: string
  /** Why it stopped, when it failed. */
  error?: string
  /** ms */
  started: number
  ended?: number
  model?: string
  /** Spent so far, already in words: «$0.42». */
  cost?: string
  mode?: PermissionMode
  children?: ChildSession[]
}

/** A line the session itself puts in the conversation: compacting, compacted, woken. */
export interface SessionMark {
  kind: 'compacting' | 'compacted' | 'woke' | 'failed' | 'notice'
  /** How much a notice matters: a rate limit is a warning, a refused request an error. */
  level?: 'info' | 'warning' | 'error'
  /** Tokens before and after compacting. */
  before?: number
  after?: number
  /** What compacting was asked to keep. */
  focus?: string
  /** What woke it, in words: «npm test finished · 12 passed». */
  text?: string
  /** Diagnostic evidence shown on hover, separate from the plain notice text. */
  detail?: string
}

/** One step of the plan an agent keeps while it works. */
export interface SessionPlanEntry {
  content: string
  priority: 'high' | 'medium' | 'low'
  status: 'pending' | 'in_progress' | 'completed'
}

export interface NodeSessionLive {
  settings: SessionSettings
  choices: SessionChoices
  /** Unknown until the session has reported it, after its first turn. */
  context: ContextUse | null
  /** A compaction runs now. */
  compacting?: boolean
  background: BackgroundTask[]
  /** The sessions this one started through the node, listed with what runs in the background. */
  children: ChildSession[]
  /** The session that started this one. */
  parent?: { id: string; title: string }
  /** The node's own commands and the skills it has, for «/». */
  commands: { name: string; description: string; kind: 'command' | 'skill' }[]
  change: (patch: Partial<SessionSettings>) => void
  /** Stops one background task; unset while the node cannot stop one task alone. */
  stopTask?: (id: string) => void
  compact: (focus: string, then?: string) => void
  /** Stops the answer, every background task and the session's process. */
  stop: () => void
  rename: (title: string) => void
  open: (sessionId: string) => void
}
