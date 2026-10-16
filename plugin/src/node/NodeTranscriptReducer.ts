import type { JournalEvent } from '@abele/channel-protocol'
import { PromptSchema, SessionSchema, type Prompt } from '@abele/node-protocol'
import type { ChatMessage } from '@/ai/types'
import { readAgentReplyText } from '@/ai/replyLinks'
import { ClaudeTranscript } from './claudeTranscript'
import { PiTranscript, piFailure } from './piTranscript'
import { LiveTranscript, type LiveProjection } from './liveTranscript'

export type NodeSessionState = 'idle' | 'queued' | 'accepted' | 'running' | 'needs-attention'
export interface NodeTranscript {
  messages: ChatMessage[]
  /** Creation sequence binds messages to journal worktree transitions, including equal timestamps. */
  messageSequences: Record<string, number>
  children: Record<string, ChatMessage[]>
  activeRuns: string[]
  queuedInputs: { id: string; text: string }[]
  session?: ReturnType<typeof SessionSchema.parse>
  prompts: Prompt[]
  state: NodeSessionState
  artifacts: { messageId: string; artifactId: string; size: number }[]
  unknown: JournalEvent[]
  /** A long-lived session's process, background work, context and compacting. */
  live: LiveProjection
}

/** The journal is canonical. Projection is disposable; replay never executes a plugin tool. */
export function reduceTranscript(events: readonly JournalEvent[]): NodeTranscript {
  const messages = new Map<string, ChatMessage>()
  const messageSequences: Record<string, number> = {}
  let sequence = 0
  const prompts = new Map<string, Prompt>()
  const inputs = new Map<string, string>()
  const runs = new Set<string>()
  const runInputs = new Map<string, string>()
  const artifacts: NodeTranscript['artifacts'] = []
  const unknown: JournalEvent[] = []
  const seen = new Set<number>()
  let session: NodeTranscript['session']
  let at = 0
  let currentRun = ''
  const toolRuns = new Map<string, string>()
  const startedTools = new Set<string>()
  const completedTools = new Set<string>()
  let touchedTools: string[] = []
  const message = (id: string, role: ChatMessage['role']): ChatMessage => {
    let current = messages.get(id)
    if (!current) {
      current = { id, role, content: '', timestamp: at }
      messages.set(id, current)
      messageSequences[id] = sequence
    }
    if (role === 'tool-call' && currentRun) {
      toolRuns.set(id, currentRun)
      touchedTools.push(id)
    }
    return current
  }
  const claude = new ClaudeTranscript(message)
  const pi = new PiTranscript(message)
  let failed = false
  const live = new LiveTranscript(message, runs, (ids, outcome) => {
    for (const id of ids)
      inputs.set(id, outcome === 'success' ? 'completed' : outcome || 'completed')
    failed = outcome !== 'success'
  })
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    if (seen.has(event.seq)) continue
    seen.add(event.seq)
    sequence = event.seq
    const data =
      event.data && typeof event.data === 'object' ? (event.data as Record<string, unknown>) : {}
    const text = (key: string) => (typeof data[key] === 'string' ? data[key] : '')
    at = Date.parse(event.at)
    currentRun = text('run_id')
    touchedTools = []
    if (event.type === 'session.created' || event.type === 'session.updated') {
      const parsed = SessionSchema.safeParse(data)
      if (parsed.success) session = parsed.data
      else unknown.push(event)
      continue
    }
    if (
      (event.type.startsWith('claude.') || event.type.startsWith('pi.')) &&
      (data.artifact_id || data.late)
    ) {
      unknown.push(event)
      if (text('artifact_id') && !['claude.raw', 'claude.unknown'].includes(event.type))
        artifacts.push({
          messageId: `event:${event.seq}`,
          artifactId: text('artifact_id'),
          size: Number(data.size),
        })
      continue
    }
    const native =
      (event.type.startsWith('claude.') && claude.apply(event.type, data)) ||
      (event.type.startsWith('pi.') && pi.apply(event.type, data, runInputs.get(currentRun)))
    if (!native && live.apply(event.type, data, at)) continue
    if (native) {
      for (const id of touchedTools) {
        if (event.type.endsWith('.tool.call')) startedTools.add(id)
        if (event.type.endsWith('.tool.result')) {
          completedTools.add(id)
          const tool = messages.get(id)
          if (tool) delete tool.toolExecution
        }
      }
      if (event.type === 'pi.message.final' && piFailure(data)) unknown.unshift(event)
      continue
    }
    if (event.type.startsWith('input.')) {
      const state = text('state') || event.type.slice(6)
      inputs.set(text('input_id'), state)
      if (event.type === 'input.accepted') {
        const input = message(`input:${text('input_id')}`, 'user')
        // A reply was sent as links over the words: shown again as the words and its places.
        const replied = readAgentReplyText(text('text'))
        input.content = replied?.content ?? text('text')
        if (replied) input.replyTo = replied.replyTo
        const from = data.from_session as { session_id?: unknown; title?: unknown } | undefined
        if (from && typeof from.session_id === 'string')
          input.fromSession = {
            id: from.session_id,
            title: typeof from.title === 'string' ? from.title : '',
          }
      }
    } else if (event.type === 'run.started') {
      runs.add(text('run_id'))
      if (text('input_id')) {
        runInputs.set(text('run_id'), text('input_id'))
        inputs.set(text('input_id'), 'delivered')
      }
      failed = false
    } else if (['run.completed', 'run.failed', 'run.interrupted'].includes(event.type)) {
      runs.delete(text('run_id'))
      const input = runInputs.get(text('run_id'))
      if (input) inputs.set(input, event.type.slice(4))
      failed = event.type !== 'run.completed'
      if (event.type === 'run.interrupted') {
        for (const [id, run] of toolRuns) {
          if (run !== currentRun || completedTools.has(id)) continue
          const tool = messages.get(id)
          if (!tool) continue
          tool.toolExecution = startedTools.has(id) ? 'interrupted' : 'not-run'
          tool.toolStatus = 'rejected'
        }
      }
    } else if (event.type === 'content.delta') {
      const current = message(`run:${text('run_id')}`, 'assistant')
      if (text('artifact_id'))
        artifacts.push({
          messageId: current.id,
          artifactId: text('artifact_id'),
          size: Number(data.size),
        })
      else current.content += text('text')
    } else if (event.type === 'prompt.delivered') {
      const current = prompts.get(text('prompt_id'))
      // Delivery is a separate committed, identity-bound fact, not a full prompt snapshot.
      if (
        current &&
        current.state !== 'pending' &&
        current.run_id === text('run_id') &&
        current.choice === text('choice')
      )
        prompts.set(current.prompt_id, { ...current, delivered: true })
      else unknown.push(event)
    } else if (event.type.startsWith('prompt.')) {
      const parsed = PromptSchema.safeParse(event.data)
      if (parsed.success) prompts.set(parsed.data.prompt_id, parsed.data)
      else unknown.push(event)
    } else if (event.type === 'tool.started') {
      const current = message(`tool:${text('tool_call_id')}`, 'tool-call')
      current.toolName = text('name')
      current.toolParams =
        data.params && typeof data.params === 'object'
          ? (data.params as Record<string, unknown>)
          : {}
      current.toolStatus = 'approved'
      startedTools.add(current.id)
    } else if (event.type === 'tool.completed' || event.type === 'tool.failed') {
      const current = message(`tool:${text('tool_call_id')}`, 'tool-call')
      current.toolResult =
        typeof data.result === 'string' ? data.result : JSON.stringify(data.result)
      current.toolStatus = event.type === 'tool.failed' ? 'rejected' : 'approved'
      completedTools.add(current.id)
      delete current.toolExecution
    } else unknown.push(event)
  }
  const attention =
    failed ||
    [...inputs.values()].some((state) =>
      ['delivery_unknown', 'failed', 'interrupted'].includes(state)
    ) ||
    [...prompts.values()].some((p) => p.state === 'pending')
  const state: NodeSessionState = attention
    ? 'needs-attention'
    : runs.size
      ? 'running'
      : [...inputs.values()].includes('queued')
        ? 'queued'
        : [...inputs.values()].includes('accepted')
          ? 'accepted'
          : 'idle'
  const children: NodeTranscript['children'] = {}
  for (const m of messages.values())
    if (m.parentId && messages.has(m.parentId)) (children[m.parentId] ??= []).push(m)
  return {
    messages: [...messages.values()].filter((m) => !m.parentId || !messages.has(m.parentId)),
    children,
    messageSequences,
    activeRuns: [...runs],
    queuedInputs: [...inputs]
      .filter(([, state]) => ['accepted', 'queued'].includes(state))
      .map(([id]) => ({ id, text: messages.get(`input:${id}`)?.content ?? '' })),
    session,
    prompts: [...prompts.values()],
    state,
    artifacts,
    unknown,
    live: live.projection(),
  }
}
