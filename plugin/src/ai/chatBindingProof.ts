import { ownedBindingRange } from '@/selection/bindingEdits'
import type { SelectionBindingOperation } from '@/selection/bindings'
import { sameRevision } from '@/selection/revisionMapping'
import type { ChatMessage } from './types'

export function bindingProof(message: ChatMessage, operation: SelectionBindingOperation) {
  const reference = operation.ownership?.revision ?? operation.resulting
  const content =
    message.selection?.versions.find((v) => sameRevision(v.reference, reference))?.content ??
    operation.publishedContent
  if (content === undefined) throw new Error('The link ownership revision is unavailable.')
  const start = operation.ownership?.start ?? operation.patch.range.start
  const after = operation.ownership?.after ?? operation.patch.after
  const patch = { ...operation.patch, range: { ...operation.patch.range, start }, after }
  const at = ownedBindingRange(message.content, content, patch)
  return { content, patch, at }
}

/** The publication itself proves how an outside source patch translates other owned links. */
export function transferBindingOwnership(
  message: ChatMessage,
  result: ChatMessage,
  from: number,
  oldLength: number,
  newLength: number,
  excluding?: string
): SelectionBindingOperation[] {
  const reference = result.selection!.versions.find(
    (v) => v.reference.revisionId === result.selection!.revisionId
  )!.reference
  return (message.decorationOperations ?? []).map((operation) => {
    if (operation.undoneAt || operation.id === excluding) return operation
    try {
      const proof = bindingProof(message, operation)
      if (proof.at < from + oldLength && proof.at + proof.patch.after.length > from)
        return operation
      const start = proof.at >= from + oldLength ? proof.at + newLength - oldLength : proof.at
      return { ...operation, ownership: { revision: reference, start, after: proof.patch.after } }
    } catch {
      return operation
    }
  })
}

export function undecoratedMessage(message: ChatMessage, includeUndone = false): ChatMessage {
  const patches = (message.decorationOperations ?? [])
    .filter((op) => includeUndone || !op.undoneAt)
    .flatMap((op) => {
      try {
        const proof = bindingProof(message, op)
        return [{ from: proof.at, old: proof.patch.after, text: op.patch.before }]
      } catch {
        return []
      }
    })
    .sort((a, b) => b.from - a.from)
  let content = message.content
  for (const patch of patches)
    content =
      content.slice(0, patch.from) + patch.text + content.slice(patch.from + patch.old.length)
  return { ...message, content }
}
