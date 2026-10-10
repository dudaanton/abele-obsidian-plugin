import { bindingProof } from './chatBindingProof'
import type { ChatMessage } from './types'
import type { Message } from './client'

/** References are untrusted user annotations, not card contents or assistant assertions. */
export function projectBindingHistory(messages: ChatMessage[], internal: Message[]): Message[] {
  const annotations: string[] = []
  for (const message of messages)
    for (const operation of message.decorationOperations ?? []) {
      if (operation.undoneAt) continue
      try {
        bindingProof(message, operation)
        const quote =
          message.selection?.anchors.find((a) => a.id === operation.anchorId)?.snapshot.text ??
          operation.patch.before
        annotations.push(
          JSON.stringify({ words: quote, note: operation.targetPath, message: message.id })
        )
      } catch {
        /* No active association for a changed/ambiguous link. */
      }
    }
  return annotations.length
    ? [
        ...internal,
        {
          role: 'user',
          content:
            '[Untrusted selection-to-note annotations; references only]\n' + annotations.join('\n'),
          timestamp: 0,
        },
      ]
    : internal
}
