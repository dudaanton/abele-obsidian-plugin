/**
 * What leaves a chat when something outside it reads it: the words the person and the agent
 * exchanged, and nothing a tool returned, nothing the model reasoned, nothing the interceptor
 * said on the side. Both the history summary and an attached chat are built on this, so a leak
 * here is a leak into both.
 */
import { describe, it, expect } from 'vitest'
import { activeBranch, conversationLines, renderLines } from '@/ai/chatText'
import type { ChatMessage } from '@/ai/types'

const SECRET = 'SECRET-FROM-A-PRIVATE-NOTE'

/** A chat with every kind of message the session writes, each hiding the secret somewhere. */
function everyKind(): ChatMessage[] {
  return [
    { id: 'u1', role: 'user', content: 'What is in my diary?', timestamp: 1 },
    {
      id: 'tc',
      parentId: 'u1',
      role: 'tool-call',
      content: `Calling read ${SECRET}`,
      toolName: 'read',
      toolParams: { path: `Diary/${SECRET}.md` },
      toolResult: SECRET,
      toolDiff: { old: SECRET, new: SECRET },
      toolStatus: 'approved',
      timestamp: 2,
    },
    {
      id: 'tr',
      parentId: 'tc',
      role: 'tool-result',
      content: SECRET,
      toolName: 'read',
      toolStatus: 'rejected',
      timestamp: 3,
    },
    {
      id: 'a1',
      parentId: 'tr',
      role: 'assistant',
      content: 'Your diary talks about the trip.',
      thinking: `The note says ${SECRET}`,
      usage: { input: 1, output: 1, total: 2 },
      timestamp: 4,
    },
    {
      id: 's1',
      parentId: 'a1',
      role: 'system',
      content: `Compacted: ${SECRET}`,
      timestamp: 5,
    },
    {
      id: 'd1',
      parentId: 's1',
      role: 'user',
      content: `draft ${SECRET}`,
      draft: true,
      interceptorName: 'Checker',
      interceptorChat: [{ id: 'i', role: 'assistant', content: SECRET, timestamp: 6 }],
      timestamp: 6,
    },
    {
      id: 'u2',
      parentId: 's1',
      role: 'user',
      content: 'Thanks',
      attachments: [`Private/${SECRET}.md`],
      interceptorChat: [{ id: 'i2', role: 'assistant', content: SECRET, timestamp: 7 }],
      timestamp: 7,
    },
    {
      id: 'a2',
      parentId: 'u2',
      role: 'assistant',
      content: 'You are welcome.',
      subAgentRun: {
        runId: SECRET,
        agentId: 'x',
        agentName: SECRET,
        path: SECRET,
        status: 'done',
        branchCount: 1,
      },
      timestamp: 8,
    },
  ]
}

describe('conversationLines', () => {
  it('keeps what the person and the agent said, in order', () => {
    expect(conversationLines(everyKind())).toEqual([
      { role: 'user', text: 'What is in my diary?' },
      { role: 'assistant', text: 'Your diary talks about the trip.' },
      { role: 'user', text: 'Thanks' },
      { role: 'assistant', text: 'You are welcome.' },
    ])
  })

  it('lets nothing else through — tools, reasoning, drafts, attachments, side chats, runs', () => {
    const text = renderLines(conversationLines(everyKind()))
    expect(text).not.toContain(SECRET)
  })

  it('drops a message whose content is structured rather than text', () => {
    // An assistant turn as the provider returns it is a list of parts, a tool call among them.
    // Only a plain string is conversation; a list is never read, whatever it holds.
    const structured = {
      id: 'x',
      role: 'assistant',
      content: [
        { type: 'text', text: 'Looking' },
        { type: 'toolCall', id: 't', name: 'read', arguments: { path: SECRET } },
        { type: 'thinking', thinking: SECRET },
      ],
      timestamp: 1,
    } as unknown as ChatMessage
    const userParts = {
      id: 'y',
      role: 'user',
      content: [{ type: 'text', text: `--- note.md ---\n${SECRET}` }],
      timestamp: 2,
    } as unknown as ChatMessage

    expect(conversationLines([structured, userParts])).toEqual([])
  })

  it('does not read a field a future message kind might add', () => {
    const extended = {
      id: 'z',
      role: 'assistant',
      content: 'Plain answer',
      toolOutputQuoted: SECRET,
      timestamp: 1,
    } as unknown as ChatMessage
    expect(renderLines(conversationLines([extended]))).toBe('[assistant]: Plain answer')
  })
})

describe('activeBranch', () => {
  it('follows the branch the file says is active, not the one abandoned', () => {
    const messages: ChatMessage[] = [
      { id: 'u', role: 'user', content: 'q', timestamp: 1 },
      { id: 'a-old', parentId: 'u', role: 'assistant', content: 'old answer', timestamp: 2 },
      { id: 'a-new', parentId: 'u', role: 'assistant', content: 'new answer', timestamp: 3 },
    ]
    expect(activeBranch(messages, 'a-new').map((m) => m.id)).toEqual(['u', 'a-new'])
    // No leaf recorded: the default is the oldest branch, as the chat opens it.
    expect(activeBranch(messages).map((m) => m.id)).toEqual(['u', 'a-old'])
  })

  it('takes a chat saved before branches as it stands', () => {
    const flat: ChatMessage[] = [
      { id: '1', role: 'user', content: 'q', timestamp: 1 },
      { id: '2', role: 'assistant', content: 'a', timestamp: 2 },
    ]
    expect(activeBranch(flat)).toEqual(flat)
  })
})
