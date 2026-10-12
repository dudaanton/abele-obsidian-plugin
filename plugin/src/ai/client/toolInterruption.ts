import type { ToolCallContent, ToolResultMessage } from './types'

export type ToolInterruption = 'interrupted' | 'not-run'

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
