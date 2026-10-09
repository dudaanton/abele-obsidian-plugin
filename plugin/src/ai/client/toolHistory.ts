/** Last-line request repair. Never edits stored history or executes a missing tool. */
interface PairAdapter<T> {
  calls(message: T): string[]
  result(message: T): string | undefined
  unavailable(id: string): T
}

function repairPairs<T>(messages: T[], adapter: PairAdapter<T>): T[] {
  const output: T[] = []
  const pending = new Map<string, number>()
  const finish = (index: number) => {
    for (const [id, callIndex] of pending) {
      output.push(adapter.unavailable(id))
      console.debug('[Abele AI] tool history: missing result', { callIndex, index })
    }
    pending.clear()
  }
  messages.forEach((message, index) => {
    const id = adapter.result(message)
    if (id !== undefined) {
      if (pending.delete(id)) output.push(message)
      else console.debug('[Abele AI] tool history: orphan result', { index })
      return
    }
    finish(index)
    output.push(message)
    for (const call of adapter.calls(message)) pending.set(call, index)
  })
  finish(messages.length)
  return output
}

interface OpenAIHistoryMessage {
  role: string
  content: unknown
  tool_calls?: { id: string }[]
  tool_call_id?: string
}

export function repairOpenAIToolHistory<T extends OpenAIHistoryMessage>(messages: T[]): T[] {
  return repairPairs(messages, {
    calls: (m) => (m.role === 'assistant' ? (m.tool_calls ?? []).map((c) => c.id) : []),
    result: (m) => (m.role === 'tool' ? (m.tool_call_id ?? '') : undefined),
    unavailable: (id) =>
      ({ role: 'tool', content: 'Tool result unavailable', tool_call_id: id }) as T,
  })
}

export interface AnthropicHistoryMessage {
  role: 'user' | 'assistant'
  content:
    | string
    | Array<{ type: string; id?: string; tool_use_id?: string; [key: string]: unknown }>
}

/** Block-format counterpart; result blocks precede other content in the next user turn. */
export function repairAnthropicToolHistory(
  messages: AnthropicHistoryMessage[]
): AnthropicHistoryMessage[] {
  const split = messages.flatMap((m): AnthropicHistoryMessage[] => {
    if (m.role !== 'user' || !Array.isArray(m.content)) return [m]
    const results = m.content.filter((b) => b.type === 'tool_result')
    const other = m.content.filter((b) => b.type !== 'tool_result')
    return [
      ...results.map((b): AnthropicHistoryMessage => ({ role: 'user', content: [b] })),
      ...(other.length ? [{ ...m, content: other }] : []),
    ]
  })
  const repaired = repairPairs<AnthropicHistoryMessage>(split, {
    calls: (m) =>
      m.role === 'assistant' && Array.isArray(m.content)
        ? m.content.filter((b) => b.type === 'tool_use').map((b) => b.id ?? '')
        : [],
    result: (m) =>
      m.role === 'user' && Array.isArray(m.content) && m.content[0]?.type === 'tool_result'
        ? (m.content[0].tool_use_id ?? '')
        : undefined,
    unavailable: (id) => ({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: id,
          content: 'Tool result unavailable',
          is_error: true,
        },
      ],
    }),
  })
  const output: AnthropicHistoryMessage[] = []
  for (const m of repaired) {
    const previous = output.at(-1)
    if (m.role === 'user' && previous?.role === 'user') {
      const blocks = (content: AnthropicHistoryMessage['content']) =>
        typeof content === 'string' ? [{ type: 'text', text: content }] : content
      output[output.length - 1] = {
        ...previous,
        content: [...blocks(previous.content), ...blocks(m.content)],
      }
    } else output.push(m)
  }
  return output
}
