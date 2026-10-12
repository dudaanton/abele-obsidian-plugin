import type { Message, ToolCallContent, ToolResultMessage } from './types'

export type ToolInterruption = 'interrupted' | 'not-run'

/** Reopening a stopped chat need not wait for its old runtime to release a tool. */
export function projectInterruptedTools(
  messages: Message[],
  stopped: ReadonlyMap<string, ToolInterruption>
): Message[] {
  if (!stopped.size) return messages
  const output: Message[] = []
  const pending = new Map<string, { call: ToolCallContent; timestamp: number }>()
  const finish = () => {
    for (const [id, { call, timestamp }] of pending) {
      const phase = stopped.get(id)
      if (phase) output.push({ ...interruptedToolResult(call, phase), timestamp })
    }
    pending.clear()
  }
  for (const message of messages) {
    if (message.role === 'toolResult') pending.delete(message.toolCallId)
    else finish()
    output.push(message)
    if (message.role === 'assistant')
      for (const call of message.content)
        if (call.type === 'toolCall') pending.set(call.id, { call, timestamp: message.timestamp })
  }
  finish()
  return output
}

/** A history pairing, not a tool-produced result or permission to replay the call. */
export function interruptedToolResult(
  call: ToolCallContent,
  interruption: ToolInterruption
): ToolResultMessage {
  return {
    role: 'toolResult',
    toolCallId: call.id,
    toolName: call.name,
    content: [
      {
        type: 'text',
        text:
          interruption === 'interrupted'
            ? 'Tool execution interrupted by the user. No completed result was received; any effects already made remain.'
            : 'Tool call interrupted by the user before execution. This call was not run.',
      },
    ],
    isError: true,
    interruption,
    timestamp: Date.now(),
  }
}
