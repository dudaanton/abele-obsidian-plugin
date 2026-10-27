import type { AgentToolResult } from '@/ai/client'

/** Keep placement independent of the model-facing paged output. */
export function nodeCommandIdentity(name: string, result: AgentToolResult) {
  if (!['node_command_run', 'node_git_integrate'].includes(name)) return undefined
  const text = result.stored?.text ?? result.content.map((part) => part.text).join('')
  try {
    const value: unknown = JSON.parse(text)
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
    // Older chats saved only the preview on the visible call. Read complete top-level
    // scalar fields before the cut, never matching identities inside command output.
    if (!text.trimStart().startsWith('{')) return undefined
    const field =
      /\s*("(?:[^"\\]|\\.)*")\s*:\s*("(?:[^"\\]|\\.)*"|null|true|false|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*([,}])/y
    field.lastIndex = text.indexOf('{') + 1
    const identity: Record<string, unknown> = {}
    let match: RegExpExecArray | null
    while ((match = field.exec(text))) {
      try {
        const key: unknown = JSON.parse(match[1])
        if (key === 'session_id' || key === 'run_id') identity[key] = JSON.parse(match[2])
      } catch {
        return undefined
      }
      if (typeof identity.session_id === 'string' && typeof identity.run_id === 'string')
        return { session_id: identity.session_id, run_id: identity.run_id }
      if (match[3] === '}') break
    }
  }
  return undefined
}
