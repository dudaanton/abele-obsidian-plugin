import type { ChatMessage } from '@/ai/types'

const string = (value: unknown): string => (typeof value === 'string' ? value : '')
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
export const claudeMessageId = (run: string, parent: string, id: string): string =>
  JSON.stringify(['claude', run, parent, id])
export const claudeToolId = (run: string, id: string): string =>
  JSON.stringify(['claude-tool', run, id])
const resultText = (value: unknown): string =>
  typeof value === 'string'
    ? value
    : Array.isArray(value)
      ? value.map((v) => string(object(v).text) || JSON.stringify(v)).join('\n')
      : (JSON.stringify(value) ?? '')

/** Native blocks are replaceable snapshots, not more deltas. No provider tools execute here. */
export class ClaudeTranscript {
  private blocks = new Map<
    string,
    Map<number, { text: string; thinking: string; final: boolean }>
  >()
  constructor(private message: (id: string, role: ChatMessage['role']) => ChatMessage) {}
  apply(type: string, data: Record<string, unknown>): boolean {
    const run = string(data.run_id),
      parent = string(data.parent_tool_use_id)
    const id = claudeMessageId(run, parent, string(data.message_id))
    const assistant = () => {
      const m = this.message(id, 'assistant')
      if (parent) m.parentId = claudeToolId(run, parent)
      return m
    }
    const tool = () => {
      const m = this.message(claudeToolId(run, string(data.tool_use_id)), 'tool-call')
      if (parent) m.parentId = claudeToolId(run, parent)
      return m
    }
    const blocks = () => {
      let b = this.blocks.get(id)
      if (!b) this.blocks.set(id, (b = new Map()))
      return b
    }
    const render = () => {
      const m = assistant()
      const ordered = [...blocks()].sort(([a], [b]) => a - b).map(([, b]) => b)
      m.content = ordered.map((b) => b.text).join('')
      m.thinking =
        ordered
          .map((b) => b.thinking)
          .filter(Boolean)
          .join('\n') || undefined
    }
    if (type === 'claude.block.delta' || type === 'claude.thinking') {
      if (!Number.isSafeInteger(data.index)) return true
      const b = blocks(),
        index = data.index as number
      const current = b.get(index) ?? { text: '', thinking: '', final: false }
      if (!current.final) {
        if (type === 'claude.block.delta') current.text += string(data.text)
        else
          current.thinking = string(data.text)
            ? current.thinking + string(data.text)
            : 'Thinking was not exposed by the provider.'
        b.set(index, current)
        if (current.text || current.thinking) render()
      }
      return true
    }
    if (type === 'claude.message.final') {
      if (data.role !== 'assistant' || !Array.isArray(data.content)) return true
      const b = blocks(),
        indices = Array.isArray(data.block_indices) ? data.block_indices : []
      const finalized = Array.isArray(data.finalized_indices) ? data.finalized_indices : null
      data.content.forEach((raw, offset) => {
        const block = object(raw),
          index = typeof indices[offset] === 'number' ? (indices[offset] as number) : offset
        b.set(index, {
          text: block.type === 'text' ? string(block.text) : '',
          thinking:
            block.type === 'thinking'
              ? string(block.thinking) || 'Thinking was not exposed by the provider.'
              : '',
          final: !finalized || finalized.includes(index),
        })
      })
      if ([...b.values()].some((v) => v.text || v.thinking)) render()
      const usage = object(data.usage)
      if (typeof usage.input_tokens === 'number' && typeof usage.output_tokens === 'number')
        assistant().usage = {
          input: usage.input_tokens,
          output: usage.output_tokens,
          total: usage.input_tokens + usage.output_tokens,
        }
      return true
    }
    if (type === 'claude.tool.call') {
      const m = tool()
      m.toolName = string(data.name)
      m.toolParams = object(data.input)
      m.toolStatus ??= 'approved'
      this.diff(m)
      return true
    }
    if (type === 'claude.tool.result') {
      const m = tool()
      m.toolResult = resultText(data.content)
      m.toolStatus = data.is_error ? 'rejected' : 'approved'
      this.diff(m)
      return true
    }
    if (type === 'claude.tool.authorization') {
      tool().content = 'Allowed by your Claude settings'
      return true
    }
    if (type === 'claude.unsupported_tool') {
      this.message(`unsupported:${run}:${string(data.tool_use_id)}`, 'system').content =
        `${string(data.tool_name)} is not supported yet.`
      return true
    }
    return false
  }
  private diff(m: ChatMessage): void {
    if (!m.toolResult || m.toolStatus === 'rejected') return
    const p = m.toolParams ?? {}
    if (
      m.toolName === 'Edit' &&
      typeof p.old_string === 'string' &&
      typeof p.new_string === 'string'
    )
      m.toolDiff = { old: p.old_string, new: p.new_string }
    if (m.toolName === 'Write' && typeof p.content === 'string')
      m.toolDiff = { old: '', new: p.content }
  }
}
