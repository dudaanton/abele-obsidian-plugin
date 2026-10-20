import type { ChatMessage } from './types'
import { toolFilePaths } from './toolFiles'

interface ChatChange {
  path: string
  old: string
  new: string
  movedFrom?: string
}

export function chatChanges(messages: readonly ChatMessage[]): ChatChange[] {
  const changes: ChatChange[] = []
  for (const message of messages) {
    if (message.role !== 'tool-call' || message.toolStatus !== 'approved') continue
    if (message.toolName === 'mv' && message.toolResult) {
      let followed = false
      for (const change of changes)
        if (change.path === message.toolParams?.from && typeof message.toolParams.to === 'string') {
          change.path = message.toolParams.to
          followed = true
        }
      if (
        !followed &&
        typeof message.toolParams?.from === 'string' &&
        typeof message.toolParams.to === 'string'
      )
        changes.push({
          path: message.toolParams.to,
          old: '',
          new: '',
          movedFrom: message.toolParams.from,
        })
    }
    if (!message.toolDiff) continue
    const path = toolFilePaths(message)[0]
    if (!path || message.toolName?.startsWith('node_')) continue
    const diff = message.toolDiff
    const previous = changes.findLast((change) => change.path === path)
    // Edit tools may return only the replaced passage. Join only an exact chain;
    // independent passages remain separate diffs rather than inventing file content.
    if (previous && previous.new === diff.old) previous.new = diff.new
    else changes.push({ path, old: diff.old, new: diff.new })
  }
  return changes.filter((change) => change.movedFrom || change.old !== change.new)
}
