import type { JournalEvent } from '@abele/channel-protocol'
import { PromptSchema, type Prompt } from '@abele/node-protocol'
import type { ChatMessage } from '@/ai/types'

export type NodeSessionState = 'idle' | 'queued' | 'accepted' | 'running' | 'needs-attention'
export interface NodeTranscript {
  messages: ChatMessage[]
  prompts: Prompt[]
  state: NodeSessionState
  artifacts: { messageId: string; artifactId: string; size: number }[]
  unknown: JournalEvent[]
}

/** The journal is canonical. Projection is disposable; replay never executes a plugin tool. */
export function reduceTranscript(events: readonly JournalEvent[]): NodeTranscript {
  const messages = new Map<string, ChatMessage>()
  const prompts = new Map<string, Prompt>()
  const inputs = new Map<string, string>()
  const runs = new Set<string>()
  const runInputs = new Map<string, string>()
  const artifacts: NodeTranscript['artifacts'] = []
  const unknown: JournalEvent[] = []
  const seen = new Set<number>()
  let failed = false
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    if (seen.has(event.seq)) continue
    seen.add(event.seq)
    const data =
      event.data && typeof event.data === 'object' ? (event.data as Record<string, unknown>) : {}
    const text = (key: string) => (typeof data[key] === 'string' ? (data[key] as string) : '')
    const message = (id: string, role: ChatMessage['role']): ChatMessage => {
      let current = messages.get(id)
      if (!current) {
        current = { id, role, content: '', timestamp: Date.parse(event.at) }
        messages.set(id, current)
      }
      return current
    }
    if (event.type === 'session.created') continue
    if (event.type.startsWith('input.')) {
      const state = text('state') || event.type.slice(6)
      inputs.set(text('input_id'), state)
      if (event.type === 'input.accepted')
        message(`input:${text('input_id')}`, 'user').content = text('text')
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
    } else if (event.type === 'content.delta') {
      const current = message(`run:${text('run_id')}`, 'assistant')
      if (text('artifact_id'))
        artifacts.push({
          messageId: current.id,
          artifactId: text('artifact_id'),
          size: Number(data.size),
        })
      else current.content += text('text')
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
    } else if (event.type === 'tool.completed' || event.type === 'tool.failed') {
      const current = message(`tool:${text('tool_call_id')}`, 'tool-call')
      current.toolResult =
        typeof data.result === 'string' ? data.result : JSON.stringify(data.result)
      current.toolStatus = event.type === 'tool.failed' ? 'rejected' : 'approved'
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
  return {
    messages: [...messages.values()],
    prompts: [...prompts.values()],
    state,
    artifacts,
    unknown,
  }
}
