import type { ChatMessage } from './types'
import type { Message } from './client'

/** Recover only recorded outcomes. An unfinished delivery is never sent a second time. */
export function restoreChatLetters(
  messages: ChatMessage[],
  history: Message[],
  interrupted: string
) {
  const restored = messages.map((message): ChatMessage => {
    const letter = message.chatLetter
    if (!letter) return message
    if (letter.reply !== undefined)
      return message.toolStatus === 'rejected'
        ? message
        : { ...message, toolResult: message.toolResult ?? letter.reply }
    if (message.toolResult !== undefined)
      return message.toolStatus === 'rejected' && !letter.refusal
        ? { ...message, chatLetter: { ...letter, refusal: message.toolResult } }
        : message
    return {
      ...message,
      chatLetter: { ...letter, refusal: letter.refusal || interrupted },
      toolStatus: 'rejected',
      toolExecution: message.toolExecution ?? 'interrupted',
    }
  })
  const completed = new Map(
    restored.flatMap((message) =>
      message.toolCallId &&
      message.chatLetter?.reply !== undefined &&
      message.toolStatus !== 'rejected'
        ? [[message.toolCallId, message] as const]
        : []
    )
  )
  const settled = new Set(
    history.flatMap((message) => (message.role === 'toolResult' ? [message.toolCallId] : []))
  )
  const recovered: Message[] = []
  for (let index = 0; index < history.length; index++) {
    const message = history[index]
    recovered.push(message)
    if (message.role !== 'assistant') continue
    // Results of sibling calls stay next to their assistant record, ahead of any later input.
    while (history[index + 1]?.role === 'toolResult') recovered.push(history[++index])
    for (const call of message.content) {
      if (call.type !== 'toolCall' || settled.has(call.id)) continue
      const saved = completed.get(call.id)
      const reply = saved?.chatLetter?.reply
      if (!saved || reply === undefined) continue
      recovered.push({
        role: 'toolResult',
        isError: false,
        toolCallId: call.id,
        toolName: call.name,
        content: [{ type: 'text', text: reply }],
        timestamp: saved.timestamp,
        chatMessageId: saved.id,
      })
      settled.add(call.id)
    }
  }
  return { messages: restored, history: recovered }
}
