import type { ChatMessage } from '@/ai/types'
import { chatBlocks } from '@/ai/toolRuns'
import { nodeCommandIdentity } from './commandIdentity'

/** A retry updates the original card instead of appending it under the latest reply. */
export function nodeCardPlacement(
  blocks: readonly (
    | { kind: 'run'; id: string; calls: ChatMessage[] }
    | { kind: 'message'; message: ChatMessage }
  )[],
  history?: readonly ChatMessage[]
): Record<string, string[]> {
  const seen = new Set<string>()
  const placement: Record<string, string[]> = {}
  // Hidden older calls still own their cards; loading history reveals them in place.
  for (const block of history ? chatBlocks([...history]) : blocks) {
    const calls = block.kind === 'run' ? block.calls : [block.message]
    const keys: string[] = []
    for (const call of calls) {
      const params = call.toolParams
      const key =
        call.toolName === 'node_delegate' && typeof params?.task_key === 'string'
          ? `task:${params.task_key}`
          : ['node_command_run', 'node_git_integrate'].includes(call.toolName ?? '') &&
              typeof params?.operation_id === 'string'
            ? `operation:${params.operation_id}`
            : undefined
      if (key && !seen.has(key)) {
        seen.add(key)
        keys.push(key)
      }
      // The model's operation alias differs from the chat-scoped wire identity.
      // Receipts retain the run identity across reloads and command status updates.
      if (
        ['node_command_run', 'node_git_integrate'].includes(call.toolName ?? '') &&
        (call.nodeCommandRun || call.toolResult)
      ) {
        try {
          const receipt: unknown =
            call.nodeCommandRun ??
            nodeCommandIdentity(call.toolName ?? '', {
              content: [{ type: 'text', text: call.toolResult ?? '' }],
            })
          if (
            receipt &&
            typeof receipt === 'object' &&
            'run_id' in receipt &&
            typeof receipt.run_id === 'string' &&
            'session_id' in receipt &&
            typeof receipt.session_id === 'string'
          ) {
            const runKey = `run:${receipt.session_id}:${receipt.run_id}`
            if (!seen.has(runKey)) {
              seen.add(runKey)
              keys.push(runKey)
            }
          }
        } catch {
          // A refused call can have an ordinary text explanation instead of a receipt.
        }
      }
    }
    if (keys.length) placement[block.kind === 'run' ? block.id : block.message.id] = keys
  }
  return placement
}
