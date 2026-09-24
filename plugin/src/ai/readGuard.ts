import { TFile } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import type { AgentTool, AgentToolResult, Message, ReadMark } from './client'
import type { ScopeResolver } from './ScopeResolver'

/**
 * An agent may only change a file it has seen as it is now.
 *
 * Every tool that rewrites a file already in the vault is refused unless this conversation read
 * that file, had it attached, or wrote it itself — and the file has not changed since. Otherwise
 * the agent would be writing over text it never saw: the person's edit made a minute ago, a
 * sub-agent's work, a sync from the phone. Claude Code's own write and edit tools work the same
 * way, and so does the wording of the refusal.
 *
 * What was seen is not kept in a table beside the chat. Each read travels as a `ReadMark` on the
 * message that carried the text to the model, so it counts exactly while the model can still see
 * that message: compacting the chat, switching to another branch or stopping a turn before it
 * was saved takes the read away with the text. Reopening a chat keeps it, because the messages
 * are in the file. Only the marks of the turn still running are held here, since the loop hands
 * its messages to the session when the turn ends, not as it goes.
 *
 * Decisions, for whoever changes this:
 * - `write` replaces the whole file, so it needs the whole file seen. `edit` and `replace` touch
 *   what they name, and any read counts for them — a window of lines included, as in Claude Code.
 * - Creating a file needs nothing: there is nothing there to overwrite. `mv` and `cp` do not
 *   change text, and carry what was seen of the source to the new path. `rm` sends the note to
 *   the trash, where it can be restored, and is not refused. `edit_selection` checks the passage
 *   it rewrites against its stored quote itself.
 * - A sub-agent is a conversation of its own and starts having seen nothing; what it writes is
 *   a change like any other to the chat that delegated it, which has to read the file again.
 * - Scripts call the tools directly, not through a session, and are never refused. An agent a
 *   script starts (`ctx.ai.agent`) is an agent, though, and gets a guard of its own for its run.
 */

/** How every refusal begins, so an agent — and a test — can tell this one from the rest. */
export const READ_FIRST = 'File must be read first'

/** A fast 53-bit hash of text, hex. Not for secrets: only to tell one version from another. */
export function contentHash(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16)
}

/** What a call has to have seen of a file before it may change it. */
export interface GuardedTarget {
  path: string
  /** `whole` for a call that replaces all of the text; `any` for one that changes a part. */
  need: 'any' | 'whole'
}

/** The existing file a call would change the text of, or null when it changes none. */
export function guardedTarget(
  toolName: string,
  params: Record<string, unknown> | undefined
): GuardedTarget | null {
  const path = params?.path
  if (typeof path !== 'string' || !path) return null
  if (toolName === 'write') return { path, need: 'whole' }
  if (toolName === 'edit') return { path, need: 'any' }
  if (toolName === 'replace') {
    // A replace that only moves the note is a rename, and a rename changes no text.
    const actions = params?.actions
    const onlyMoves =
      Array.isArray(actions) &&
      actions.length > 0 &&
      actions.every((a) => (a as { type?: string })?.type === 'move')
    return onlyMoves ? null : { path, need: 'any' }
  }
  return null
}

/** Every mark carried by these messages, in order. */
export function marksIn(messages: readonly Message[]): ReadMark[] {
  const out: ReadMark[] = []
  for (const m of messages) {
    if ((m.role === 'toolResult' || m.role === 'user') && m.reads?.length) out.push(...m.reads)
  }
  return out
}

/**
 * The agent's view of each file: the latest mark wins. A read of part of a text already seen
 * whole — the same text, by its hash — does not make it partial again.
 */
export function foldMarks(marks: Iterable<ReadMark>): Map<string, ReadMark> {
  const views = new Map<string, ReadMark>()
  for (const mark of marks) {
    const prior = views.get(mark.path)
    const stillWhole = mark.lines && prior && !prior.lines && prior.hash === mark.hash
    views.set(mark.path, stillWhole ? { ...mark, lines: undefined } : mark)
  }
  return views
}

/** A time the agent can match against its own history: the clock, and the date if not today. */
function when(at: number): string {
  const d = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  const today = new Date()
  return d.toDateString() === today.toDateString()
    ? time
    : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}`
}

/** Why a call may not change `path`, or null when it may. */
export function refusal(
  target: GuardedTarget,
  view: ReadMark | undefined,
  currentHash: string
): string | null {
  const { path } = target
  if (!view) {
    return `${READ_FIRST}: ${path} has not been read in this conversation. Read it, then make the change.`
  }
  if (view.hash !== currentHash) {
    const how =
      view.via === 'write'
        ? 'you last wrote it'
        : view.via === 'attachment'
          ? 'it was attached'
          : 'you read it'
    return `${READ_FIRST}: ${path} has changed since ${how} at ${when(view.at)}. Read it again, then make the change.`
  }
  if (target.need === 'whole' && view.lines) {
    const [from, to] = view.lines
    return `${READ_FIRST}: you have seen only lines ${from}–${to} of ${path}, and write replaces the whole file. Read all of it first, or change just that part with edit.`
  }
  return null
}

/** Tools that move text from one path to another without changing it. */
const CARRIERS = ['mv', 'cp', 'replace']

export interface ReadGuardHost {
  /** The messages the model is sent now — the reads it can still see. */
  history(): Message[]
  scope(): ScopeResolver
}

/** One conversation's guard. See the top of this file. */
export class ReadGuard {
  /** Marks of the turn still running, not yet in the session's history. */
  private live: ReadMark[] = []

  constructor(private readonly host: ReadGuardHost) {}

  /** The running turn's messages are in the history now, or were dropped with it. */
  settle(): void {
    this.live = []
  }

  /** Marks carried by a message the model is about to be sent, before it is in the history. */
  note(marks: ReadMark[]): void {
    this.live.push(...marks)
  }

  /** What the agent last saw of `path`, if it can still see it. */
  view(path: string): ReadMark | undefined {
    return foldMarks([...marksIn(this.host.history()), ...this.live]).get(path)
  }

  /** Why this call may not run, or null when it may — or when it is not this guard's to judge. */
  async check(
    toolName: string,
    params: Record<string, unknown> | undefined
  ): Promise<string | null> {
    const target = guardedTarget(toolName, params)
    if (!target) return null
    // Out of scope, or not there: the tool says so itself, and better than this could.
    if (!this.host.scope().isInScope(target.path)) return null
    const { app } = GlobalStore.getInstance()
    const file = app.vault.getAbstractFileByPath(target.path)
    if (!(file instanceof TFile)) return null
    const current = contentHash(await app.vault.read(file))
    return refusal({ ...target, path: file.path }, this.view(file.path), current)
  }

  /**
   * Turns what a successful call saw or wrote into marks, puts them on its result for the
   * result message to carry, and holds them until the turn ends.
   */
  async record(
    toolName: string,
    params: Record<string, unknown> | undefined,
    result: AgentToolResult
  ): Promise<void> {
    const marks: ReadMark[] = []
    const seen = result.seen
    if (seen) {
      const via = toolName === 'read' ? 'read' : 'write'
      // An edit leaves the agent knowing as much of the file as it knew before; a write or a
      // new file it knows whole, since every word of it is the agent's.
      const partial =
        via === 'read'
          ? seen.lines
          : toolName === 'write' || toolName === 'create'
            ? undefined
            : this.view(seen.path)?.lines
      marks.push({
        path: seen.path,
        hash: seen.hash,
        at: Date.now(),
        via,
        ...(partial ? { lines: partial } : {}),
      })
    } else if (CARRIERS.includes(toolName)) {
      const carried = await this.carry(params, result)
      if (carried) marks.push(carried)
    }
    if (!marks.length) return
    result.reads = marks
    this.live.push(...marks)
  }

  /** The source's mark at the new path, when the text there is the text that was seen. */
  private async carry(
    params: Record<string, unknown> | undefined,
    result: AgentToolResult
  ): Promise<ReadMark | null> {
    const from = (params?.from ?? params?.path) as string | undefined
    const to = (result.details as { path?: string } | undefined)?.path
    if (!from || !to || from === to) return null
    const prior = this.view(from)
    if (!prior) return null
    const { app } = GlobalStore.getInstance()
    const file = app.vault.getAbstractFileByPath(to)
    if (!(file instanceof TFile)) return null
    const hash = contentHash(await app.vault.read(file))
    return hash === prior.hash ? { ...prior, path: file.path } : null
  }
}

/**
 * The tools with `guard` in front of them, for an agent that runs without a session — one a
 * script starts. Its run is one turn, so its marks never need to leave the guard.
 */
export function withReadGuard(tools: AgentTool[], guard: ReadGuard): AgentTool[] {
  return tools.map((tool) => ({
    ...tool,
    execute: async (id, params, signal) => {
      const refused = await guard.check(tool.name, params)
      if (refused) throw new Error(refused)
      const result = await tool.execute(id, params, signal)
      await guard.record(tool.name, params, result)
      return result
    },
  }))
}
