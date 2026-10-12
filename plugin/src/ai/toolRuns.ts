import type { ChatMessage } from './types'

/** What a tool does, in the words and glyph a run of the agent's work is told by. */
export type ToolKind = 'search' | 'read' | 'write' | 'delete' | 'run' | 'ask' | 'other'

const KINDS: [RegExp, ToolKind][] = [
  [/delete|remove|trash|^rm(_|$)/i, 'delete'],
  [/search|grep|find|glob|query|list/i, 'search'],
  [/write|edit|create|append|save|apply|patch|move|rename|^mv(_|$)/i, 'write'],
  [/read|fetch|open|view|get|calculate/i, 'read'],
  [/command|bash|shell|exec|run/i, 'run'],
  [/ask|question/i, 'ask'],
]

export function toolKind(name: string | undefined): ToolKind {
  return KINDS.find(([test]) => test.test(name ?? ''))?.[1] ?? 'other'
}

export const KIND_ICON: Record<ToolKind, string> = {
  search: 'search',
  read: 'file-text',
  write: 'pencil',
  delete: 'trash-2',
  run: 'square-terminal',
  ask: 'message-circle-question',
  other: 'wrench',
}

const KIND_WORDS: Record<ToolKind, [string, string]> = {
  search: ['Searched', 'Searching'],
  read: ['Read', 'Reading'],
  write: ['Wrote', 'Writing'],
  delete: ['Deleted', 'Deleting'],
  run: ['Ran', 'Running'],
  ask: ['Asked', 'Asking'],
  other: ['Used a tool', 'Using a tool'],
}

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
  const order: ToolKind[] = []
  const counts = new Map<ToolKind, number>()
  for (const c of calls) {
    const kind = toolKind(c.toolName)
    if (!counts.has(kind)) order.push(kind)
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  const running = calls.find((c) => callState(c) === 'running')
  const going = running ? toolKind(running.toolName) : null
  return order
    .map((kind) => {
      const n = counts.get(kind)
      const word = KIND_WORDS[kind][kind === going ? 1 : 0]
      return n > 1 ? `${word} ${n}` : word
    })
    .join(' · ')
}

/** A chat's messages as drawn: each on its own, and the agent's calls in a row as one run. */
export type ChatBlock =
  | { kind: 'message'; message: ChatMessage }
  /** `calls` are the tool calls it is told by; `messages` all it draws when open. */
  | { kind: 'run'; id: string; calls: ChatMessage[]; messages: ChatMessage[] }

export function chatBlocks(messages: readonly ChatMessage[]): ChatBlock[] {
  const out: ChatBlock[] = []
  for (const message of messages) {
    const last = out.at(-1)
    if (message.role === 'tool-call') {
      if (last?.kind === 'run') {
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
