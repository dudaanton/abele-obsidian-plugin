import { UiError, uiMessage } from '@/i18n/streamBErrors'
import type { ChatMessage } from './types'
import type { AssistantMessage, Message } from './client'

/** An explicit continuation boundary; it changes context, never transcript bytes or files. */
export function projectBranchCuts(
  path: readonly ChatMessage[],
  history: readonly Message[],
  pendingAfter?: string | null
): Message[] {
  const byId = new Map(path.map((message) => [message.id, message]))
  const boundaries = path.flatMap((message) =>
    message.branchCutAfter
      ? [{ after: message.branchCutAfter, root: message.id, parent: message.parentId }]
      : []
  )
  if (pendingAfter) boundaries.push({ after: pendingAfter, root: '', parent: pendingAfter })
  if (!boundaries.length) return [...history]

  const omitted = new Set<number>()
  const replacements = new Map<number, AssistantMessage>()
  for (const boundary of boundaries) {
    const target = byId.get(boundary.after)
    if (!target || (boundary.root && boundary.parent !== target.id))
      throw new UiError(uiMessage('streamBError.04fe344540'))
    const rootIndex = boundary.root
      ? history.findIndex((message) => message.chatMessageId === boundary.root)
      : history.length
    if (rootIndex < 0) throw new UiError(uiMessage('streamBError.fa7d4d15ec'))
    let assistantIndex = -1
    let partIndex = -1
    if (target.role === 'tool-call' && target.toolCallId) {
      const resultIndex = history.findIndex(
        (message, index) =>
          index < rootIndex &&
          message.role === 'toolResult' &&
          message.chatMessageId === target.id &&
          message.toolCallId === target.toolCallId
      )
      if (resultIndex < 0) throw new UiError(uiMessage('streamBError.9fdbe22680'))
      for (let index = resultIndex - 1; index >= 0; index--) {
        const message = history[index]
        if (message.role !== 'assistant') continue
        const found = Array.isArray(message.content)
          ? message.content.findIndex(
              (part) => part.type === 'toolCall' && part.id === target.toolCallId
            )
          : -1
        if (found >= 0) {
          assistantIndex = index
          partIndex = found
          break
        }
        // A result must belong to the immediately preceding assistant exchange.
        throw new UiError(uiMessage('streamBError.c66ba4f778'))
      }
      if (assistantIndex < 0) throw new UiError(uiMessage('streamBError.c321617b3f'))
    } else if (target.role === 'assistant') {
      assistantIndex = history.findIndex(
        (message, index) =>
          index < rootIndex && message.role === 'assistant' && message.chatMessageId === target.id
      )
      if (assistantIndex < 0) throw new UiError(uiMessage('streamBError.aba841b1a9'))
      const message = history[assistantIndex] as AssistantMessage
      if (!Array.isArray(message.content)) continue
      const firstCall = message.content.findIndex((part) => part.type === 'toolCall')
      if (firstCall < 0) continue
      partIndex = firstCall - 1
    } else {
      throw new UiError(uiMessage('streamBError.2791c36446'))
    }

    const original = history[assistantIndex] as AssistantMessage
    const content = original.content.slice(0, partIndex + 1)
    const calls = new Set(content.flatMap((part) => (part.type === 'toolCall' ? [part.id] : [])))
    const nextAssistant = history.findIndex(
      (message, index) =>
        index > assistantIndex && index < rootIndex && message.role === 'assistant'
    )
    const exchangeEnd = nextAssistant < 0 ? rootIndex : nextAssistant
    const results = history
      .slice(assistantIndex + 1, exchangeEnd)
      .filter((message) => message.role === 'toolResult' && calls.has(message.toolCallId))
    if (
      [...calls].some(
        (id) =>
          !results.some((message) => message.role === 'toolResult' && message.toolCallId === id)
      )
    )
      throw new UiError(uiMessage('streamBError.2a38171bba'))
    const owners = new Set(
      results.flatMap((message) => (message.chatMessageId ? [message.chatMessageId] : []))
    )
    replacements.set(assistantIndex, {
      ...original,
      content,
      stopReason: original.stopReason === 'toolUse' && !calls.size ? 'stop' : original.stopReason,
    })
    // Keep real prefix results and their positively linked injections. All the old tail,
    // including compaction markers and image injections, stays only in the original branch.
    for (let index = assistantIndex + 1; index < rootIndex; index++) {
      const message = history[index]
      const keep =
        index < exchangeEnd &&
        ((message.role === 'toolResult' && calls.has(message.toolCallId)) ||
          ((message.role === 'user' || message.role === 'system') &&
            !!message.chatMessageId &&
            owners.has(message.chatMessageId)))
      if (!keep) omitted.add(index)
    }
  }
  return history.flatMap((message, index) =>
    omitted.has(index) ? [] : [replacements.get(index) ?? message]
  )
}
