import { expect, it } from 'vitest'
import { restoreChatLetters } from '@/ai/chatLetterRecovery'
import type { ChatMessage } from '@/ai/types'

const call = (extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'call',
  role: 'tool-call',
  content: '',
  timestamp: 1,
  toolCallId: 'letter',
  toolStatus: 'approved',
  chatLetter: { to: { id: 'target', title: 'Target' }, refusal: 'Target stopped' },
  ...extra,
})

it('settles a saved refusal even if the runtime had not yet recorded the failed result', () => {
  const recovered = restoreChatLetters([call()], [], 'Reload interrupted the request').messages[0]
  expect(recovered.toolExecution).toBe('interrupted')
  expect(recovered.toolStatus).toBe('rejected')
  expect(recovered.chatLetter?.refusal).toBe('Target stopped')
})

it('keeps an explicit stop separate from a retained answer', () => {
  const stopped = call({
    toolStatus: 'rejected',
    toolExecution: 'interrupted',
    chatLetter: { to: { id: 'target', title: 'Target' }, reply: 'Retained answer' },
  })
  const recovered = restoreChatLetters([stopped], [], 'Reload interrupted the request').messages[0]
  expect(recovered.toolResult).toBeUndefined()
  expect(recovered.chatLetter?.reply).toBe('Retained answer')
})

it('does not leave a stopped letter spinning after reload', () => {
  const stopped = call({
    toolStatus: 'rejected',
    toolExecution: 'interrupted',
    chatLetter: { to: { id: 'target', title: 'Target' } },
  })
  expect(
    restoreChatLetters([stopped], [], 'Reload interrupted the request').messages[0].chatLetter
      ?.refusal
  ).toBe('Reload interrupted the request')
})
