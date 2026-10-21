import { t } from '@/i18n'
import { readableToolName, truncate } from './toolLine'
import type { ChatMessage } from './types'

/** What a tool does, in the words and glyph a run of the agent's work is told by. */
export type ToolKind =
  | 'start'
  | 'search'
  | 'read'
  | 'write'
  | 'move'
  | 'delete'
  | 'run'
  | 'ask'
  | 'other'

const KINDS: [RegExp, ToolKind][] = [
  // A node tool that starts another session or a worker; its name may carry its server's prefix.
  [/(^|__)start_(session|worker)$/, 'start'],
  [/move|rename|^mv(_|$)/i, 'move'],
  [/delete|remove|trash|^rm(_|$)/i, 'delete'],
  [/search|grep|find|glob|query|list|^ls$/i, 'search'],
  [/write|edit|create|append|save|apply|patch|move|rename|^mv(_|$)/i, 'write'],
  [/read|fetch|open|view|get|calculate/i, 'read'],
  [/command|bash|shell|exec|run/i, 'run'],
  [/ask|question/i, 'ask'],
]

export function toolKind(name: string | undefined): ToolKind {
  return KINDS.find(([test]) => test.test(name ?? ''))?.[1] ?? 'other'
}

export const KIND_ICON: Record<ToolKind, string> = {
  start: 'bot',
  search: 'search',
  read: 'file-text',
  write: 'pencil',
  move: 'file-symlink',
  delete: 'trash-2',
  run: 'square-terminal',
  ask: 'message-circle-question',
  other: 'wrench',
}

const KIND_WORDS = {
  move: [
    'streamB.runSummary.move.done',
    'streamB.runSummary.move.running',
    'streamB.runSummary.move.waiting',
  ],
  start: [
    'streamB.runSummary.start.done',
    'streamB.runSummary.start.running',
    'streamB.runSummary.start.waiting',
  ],
  search: [
    'streamB.runSummary.search.done',
    'streamB.runSummary.search.running',
    'streamB.runSummary.search.waiting',
  ],
  read: [
    'streamB.runSummary.read.done',
    'streamB.runSummary.read.running',
    'streamB.runSummary.read.waiting',
  ],
  write: [
    'streamB.runSummary.write.done',
    'streamB.runSummary.write.running',
    'streamB.runSummary.write.waiting',
  ],
  delete: [
    'streamB.runSummary.delete.done',
    'streamB.runSummary.delete.running',
    'streamB.runSummary.delete.waiting',
  ],
  run: [
    'streamB.runSummary.run.done',
    'streamB.runSummary.run.running',
    'streamB.runSummary.run.waiting',
  ],
  ask: [
    'streamB.runSummary.ask.done',
    'streamB.runSummary.ask.running',
    'streamB.runSummary.ask.waiting',
  ],
  other: [
    'streamB.runSummary.other.done',
    'streamB.runSummary.other.running',
    'streamB.runSummary.other.waiting',
  ],
} as const

/** Where a run stands: running, waiting for you, refused or failed somewhere in it, or done. */
export type RunState = 'running' | 'waiting' | 'failed' | 'done'

export function callState(call: ChatMessage): RunState {
  if (call.toolStatus === 'rejected' || call.subAgentRun?.status === 'error') return 'failed'
  if (call.toolStatus === 'pending') return 'waiting'
  if (call.toolStatus === 'approved' && call.toolResult === undefined) return 'running'
  return 'done'
}

export function runState(calls: readonly ChatMessage[]): RunState {
  const states = calls.map(callState)
  for (const s of ['failed', 'waiting', 'running'] as const) if (states.includes(s)) return s
  return 'done'
}

/** The kind most of the run is, for its glyph; the latest call's when they tie. */
export function runKind(calls: readonly ChatMessage[]): ToolKind {
  const counts = new Map<ToolKind, number>()
  for (const c of calls)
    counts.set(toolKind(c.toolName), (counts.get(toolKind(c.toolName)) ?? 0) + 1)
  let best: ToolKind = toolKind(calls.at(-1)?.toolName)
  for (const c of [...calls].reverse()) {
    const kind = toolKind(c.toolName)
    if ((counts.get(kind) ?? 0) > (counts.get(best) ?? 0)) best = kind
  }
  return best
}

/**
 * The run told in a line, kinds in the order they first came: «Searched 2 · Read 3 · Wrote 1».
 * The kind still under way is said as going on.
 */
export function runSummary(calls: readonly ChatMessage[]): string {
  if (
    calls.length === 1 &&
    calls[0].toolName === 'list_chats' &&
    calls[0].toolStatus === 'approved' &&
    calls[0].toolResult !== undefined
  ) {
    try {
      const chats: unknown = JSON.parse(calls[0].toolResult)
      if (Array.isArray(chats)) return t('chat.chatsListed', { count: chats.length })
    } catch {
      /* The ordinary tool line still describes malformed or failed results. */
    }
  }
  if (calls.some((call) => call.toolStatus === 'rejected')) {
    const parts: string[] = []
    let adjacent: ChatMessage[] = []
    const flush = () => {
      if (adjacent.length) parts.push(runSummary(adjacent))
      adjacent = []
    }
    for (const call of calls) {
      if (call.toolStatus !== 'rejected') adjacent.push(call)
      else {
        flush()
        if (
          call.toolExecution === 'interrupted' ||
          (call.toolExecution === 'not-run' && call.toolResult === undefined)
        ) {
          const label = t(
            call.toolExecution === 'interrupted'
              ? 'streamB.interrupted.d512d9'
              : 'streamB.notRun.b4a984'
          )
          parts.push(
            `${label.charAt(0).toUpperCase()}${label.slice(1)}: ${readableToolName(call.toolName)}`
          )
          continue
        }
        // Older default refusals have the standard result but no execution marker.
        const denied =
          call.toolExecution === 'not-run' ||
          (call.toolExecution === undefined && call.toolResult === 'User rejected this action')
        parts.push(
          t(denied ? 'streamB.actionDenied' : 'streamB.actionFailed', {
            action: readableToolName(call.toolName),
            reason: truncate(call.toolResult ?? '', 160),
          })
        )
      }
    }
    flush()
    return parts.join(' · ')
  }
  const order: ToolKind[] = []
  const counts = new Map<ToolKind, number>()
  for (const c of calls) {
    const kind = toolKind(c.toolName)
    if (!counts.has(kind)) order.push(kind)
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  const running = calls.find((c) => callState(c) === 'running')
  const going = running ? toolKind(running.toolName) : null
  const waiting = new Set(
    calls.filter((call) => callState(call) === 'waiting').map((call) => toolKind(call.toolName))
  )
  return order
    .map((kind) => {
      const n = counts.get(kind)
      const word = t(KIND_WORDS[kind][kind === going ? 1 : waiting.has(kind) ? 2 : 0])
      return n > 1 ? `${word} ${n}` : word
    })
    .join(' · ')
}

/** Helper transcripts and reply decisions remain visible instead of being folded into a run. */
export const ownLine = (message: ChatMessage): boolean =>
  message.role === 'tool-call' &&
  !!(
    message.subAgentRun ||
    message.replyProposal ||
    message.chatLetter ||
    (message.toolName === 'delegate' && message.id.startsWith('obsidian:'))
  )

/** A chat's messages as drawn: each on its own, and the agent's calls in a row as one run. */
export type ChatBlock =
  | { kind: 'message'; message: ChatMessage }
  /** `calls` are the tool calls it is told by; `messages` all it draws when open. */
  | { kind: 'run'; id: string; calls: ChatMessage[]; messages: ChatMessage[] }

export function chatBlocks(messages: readonly ChatMessage[]): ChatBlock[] {
  const out: ChatBlock[] = []
  for (const message of messages) {
    const last = out.at(-1)
    if (ownLine(message)) out.push({ kind: 'message', message })
    else if (message.role === 'tool-call') {
      if (last?.kind === 'run' && last.calls[0]?.nodeTurnId === message.nodeTurnId) {
        last.calls.push(message)
        last.messages.push(message)
      } else out.push({ kind: 'run', id: message.id, calls: [message], messages: [message] })
    } else if (message.role === 'tool-result' && last?.kind === 'run') {
      // A result drawn on its own belongs to the run it answers.
      last.messages.push(message)
    } else out.push({ kind: 'message', message })
  }
  return out
}
