import type { ChatMessage } from './types'

/** The path in a known file tool's structured result line. */
export function extractResultPath(result?: string): string {
  if (!result) return ''
  const match = result.match(/^(?:Created|Saved|Edited):\s*(.+)$/m)
  return match?.[1]?.trim() || ''
}

/** Explicit file arguments and provider locations only; never infer files from prose. */
export function toolFilePaths(
  message: Pick<ChatMessage, 'toolName' | 'toolParams' | 'toolResult' | 'toolPath' | 'toolPaths'>
): string[] {
  const paths = (values: unknown[]) => [
    ...new Set(values.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)),
  ]
  if (message.toolPaths?.length) return paths(message.toolPaths)
  if (message.toolPath) return paths([message.toolPath])
  const name = message.toolName ?? ''
  const p = message.toolParams ?? {}
  if (name === 'apply_template') return paths([extractResultPath(message.toolResult) || p.path])
  if (['mv', 'cp', 'node_mv', 'node_cp'].includes(name)) return paths([p.to])
  if (
    !['rm', 'node_rm', 'read_image', 'look_at_drawing', 'node_replace'].includes(name) &&
    !/(^|[_-])(write|edit|create|read|append|patch|update|multiedit)([_-]|$)/i.test(name)
  )
    return []
  return paths([p.path ?? p.file_path ?? p.filePath ?? p.note_path ?? p.notePath])
}
