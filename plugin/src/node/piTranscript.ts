import type { ChatMessage } from '@/ai/types'
const text = (v: unknown) => (typeof v === 'string' ? v : '')
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
export const piFailure = (data: Record<string, unknown>): string => {
  const snapshot = object(data.message)
  if (snapshot.role !== 'assistant' || snapshot.stopReason !== 'error') return ''
  const raw = text(snapshot.errorMessage).trim()
  const status = raw.match(/\b(?:HTTP\s*)?([45]\d{2})\b/i)?.[1]
  const reason = status
    ? `the model service returned an error (HTTP ${status})`
    : raw.split(/\r?\n/)[0].slice(0, 240) || 'the model service returned an error'
  return `The agent could not answer: ${reason}.`
}
const blocksText = (v: unknown): string =>
  Array.isArray(v)
    ? v
        .map((b) => text(object(b).text))
        .filter(Boolean)
        .join('\n')
    : text(v)

/** Provider IDs are scoped to a run and runtime generation, never new node sessions. */
export class PiTranscript {
  private blocks = new Map<string, Map<number, { text: string; thinking: string }>>()
  private finals = new Set<string>()
  constructor(private message: (id: string, role: ChatMessage['role']) => ChatMessage) {}
  apply(type: string, data: Record<string, unknown>, inputId?: string): boolean {
    const scope = [text(data.run_id), data.runtime_generation ?? 0]
    const id = JSON.stringify(['pi', ...scope, text(data.message_id)])
    const toolId = (native: unknown) => JSON.stringify(['pi-tool', ...scope, text(native)])
    const tool = (native: unknown) => this.message(toolId(native), 'tool-call')
    const render = () => {
      const m = this.message(id, 'assistant')
      const ordered = [...(this.blocks.get(id) ?? new Map())]
        .sort(([a], [b]) => a - b)
        .map(([, b]) => b)
      m.content = ordered.map((b) => b.text).join('')
      m.thinking =
        ordered
          .map((b) => b.thinking)
          .filter(Boolean)
          .join('\n') || undefined
    }
    if (type === 'pi.message.start' || type === 'pi.message.final') {
      const snapshot = object(data.message)
      if (snapshot.role !== 'assistant' || !Array.isArray(snapshot.content)) return true
      const blocks = new Map<number, { text: string; thinking: string }>()
      snapshot.content.forEach((value, index) => {
        const b = object(value)
        blocks.set(index, {
          text: b.type === 'text' ? text(b.text) : '',
          thinking: b.type === 'thinking' ? text(b.thinking) : '',
        })
        if (b.type === 'toolCall') {
          const m = tool(b.id)
          m.toolName = text(b.name)
          m.toolParams = object(b.arguments)
          m.toolStatus ??= 'approved'
        }
      })
      const hadPartial = [...(this.blocks.get(id)?.values() ?? [])].some(
        (b) => b.text || b.thinking
      )
      this.blocks.set(id, blocks)
      if (hadPartial || [...blocks.values()].some((b) => b.text || b.thinking)) render()
      const error = type === 'pi.message.final' ? piFailure(data) : ''
      if (error) {
        render()
        this.message(id, 'assistant').error = error
        if (inputId) this.message(id, 'assistant').retryInputId = `input:${inputId}`
      }
      if (type === 'pi.message.final') this.finals.add(id)
      return true
    }
    if (type === 'pi.message.delta') {
      if (this.finals.has(id)) return true
      const d = object(data.delta),
        index = d.contentIndex
      if (!Number.isSafeInteger(index)) return true
      const blocks = this.blocks.get(id) ?? new Map<number, { text: string; thinking: string }>()
      const b = blocks.get(index as number) ?? { text: '', thinking: '' }
      if (d.type === 'text_delta') b.text += text(d.delta)
      else if (d.type === 'thinking_delta') b.thinking += text(d.delta)
      else return false
      blocks.set(index as number, b)
      this.blocks.set(id, blocks)
      render()
      return true
    }
    if (['pi.tool.call', 'pi.tool.update', 'pi.tool.result'].includes(type)) {
      const m = tool(data.tool_use_id)
      if (data.parent_tool_use_id) m.parentId = toolId(data.parent_tool_use_id)
      if (data.name) m.toolName = text(data.name)
      if (data.input) m.toolParams = object(data.input)
      if (data.result !== undefined) {
        const result = object(data.result)
        m.toolResult =
          blocksText(result.content) || text(data.result) || JSON.stringify(data.result)
      }
      m.toolStatus = data.is_error ? 'rejected' : 'approved'
      return true
    }
    return false
  }
}
