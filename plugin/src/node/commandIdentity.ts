import type { AgentToolResult } from '@/ai/client'

/** Keep placement independent of the model-facing paged output. */
export function nodeCommandIdentity(name: string, result: AgentToolResult) {
  if (!['node_command_run', 'node_git_integrate'].includes(name)) return undefined
  try {
    const value: unknown = JSON.parse(
      result.stored?.text ?? result.content.map((part) => part.text).join('')
    )
    if (
      value &&
      typeof value === 'object' &&
      'session_id' in value &&
      typeof value.session_id === 'string' &&
      'run_id' in value &&
      typeof value.run_id === 'string'
    )
      return { session_id: value.session_id, run_id: value.run_id }
  } catch {
    // Refused commands can return plain text instead of a run.
  }
  return undefined
}
