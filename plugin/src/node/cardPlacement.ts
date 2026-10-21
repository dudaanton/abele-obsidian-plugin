import type { ChatMessage } from '@/ai/types'

/** A retry updates the original card instead of appending it under the latest reply. */
export function nodeCardPlacement(
  blocks: readonly (
    | { kind: 'run'; id: string; calls: ChatMessage[] }
    | { kind: 'message'; message: ChatMessage }
  )[]
): Record<string, string[]> {
  const seen = new Set<string>()
  const placement: Record<string, string[]> = {}
  for (const block of blocks) {
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
    }
    if (keys.length) placement[block.kind === 'run' ? block.id : block.message.id] = keys
  }
  return placement
}
