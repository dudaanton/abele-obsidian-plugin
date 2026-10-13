import { describe, expect, it } from 'vitest'
import { projectBranchCuts } from '@/ai/chatBranchCuts'
import type { ChatMessage } from '@/ai/types'
import { EMPTY_USAGE, type Message } from '@/ai/client'

const path: ChatMessage[] = [
  { id: 'sample-q', role: 'user', content: 'Read sample sources', timestamp: 1 },
  {
    id: 'sample-a',
    parentId: 'sample-q',
    role: 'assistant',
    content: 'Checking sources',
    timestamp: 2,
  },
  {
    id: 'sample-first',
    parentId: 'sample-a',
    role: 'tool-call',
    content: '',
    toolCallId: 'sample-call-one',
    toolStatus: 'approved',
    toolResult: 'First source',
    timestamp: 3,
  },
]
const history: Message[] = [
  { role: 'user', content: 'Read sample sources', timestamp: 1, chatMessageId: 'sample-q' },
  {
    role: 'assistant',
    content: [
      { type: 'text', text: 'Checking sources' },
      {
        type: 'toolCall',
        id: 'sample-call-one',
        name: 'read',
        arguments: { path: 'Sample/first.md' },
      },
      {
        type: 'toolCall',
        id: 'sample-call-two',
        name: 'read',
        arguments: { path: 'Sample/later.md' },
      },
    ],
    model: 'sample-model',
    usage: EMPTY_USAGE,
    stopReason: 'toolUse',
    timestamp: 2,
    chatMessageId: 'sample-a',
  },
  {
    role: 'toolResult',
    toolCallId: 'sample-call-one',
    toolName: 'read',
    content: [{ type: 'text', text: 'First source' }],
    stored: { key: 'sample-first-result', text: 'First source retained' },
    isError: false,
    timestamp: 3,
    chatMessageId: 'sample-first',
  },
  {
    role: 'toolResult',
    toolCallId: 'sample-call-two',
    toolName: 'read',
    content: [{ type: 'text', text: 'Later source' }],
    stored: { key: 'sample-later-result', text: 'Later source retained' },
    isError: false,
    timestamp: 4,
    chatMessageId: 'sample-later',
  },
  {
    role: 'user',
    content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,c2FtcGxl' } }],
    timestamp: 4,
    chatMessageId: 'sample-later',
  },
]

describe('explicit branch context boundaries', () => {
  it('cuts a bundled assistant turn at the selected real result without mutating the original', () => {
    const before = structuredClone(history)
    const cut = projectBranchCuts(path, history, 'sample-first')
    const assistant = cut.find((m) => m.role === 'assistant')!
    expect(
      assistant.role === 'assistant' &&
        assistant.content.map((part) => (part.type === 'toolCall' ? part.id : 'text'))
    ).toEqual(['text', 'sample-call-one'])
    expect(cut.filter((m) => m.role === 'toolResult').map((m) => m.toolCallId)).toEqual([
      'sample-call-one',
    ])
    expect(cut.some((m) => m.role === 'user' && Array.isArray(m.content))).toBe(false)
    expect(cut.find((m) => m.role === 'toolResult')?.stored?.key).toBe('sample-first-result')
    expect(history).toEqual(before)
  })
  it('retains the boundary after a new continuation is appended and can still select the original branch', () => {
    const next = {
      id: 'sample-follow-up',
      parentId: 'sample-first',
      role: 'user',
      content: 'Take another approach',
      timestamp: 5,
      branchCutAfter: 'sample-first',
    } as ChatMessage
    const all = [
      ...history,
      { role: 'user', content: next.content, timestamp: 5, chatMessageId: next.id } as Message,
    ]
    expect(
      projectBranchCuts([...path, next], all).filter((m) => m.role === 'toolResult')
    ).toHaveLength(1)
    expect(projectBranchCuts(path, history)).toEqual(history)
  })
  it('keeps later exchanges with reused provider call IDs independent of the cut turn', () => {
    const next = {
      id: 'sample-follow-up',
      parentId: 'sample-first',
      role: 'user',
      content: 'Continue',
      timestamp: 5,
      branchCutAfter: 'sample-first',
    } as ChatMessage
    const later: Message[] = [
      { role: 'user', content: next.content, timestamp: 5, chatMessageId: next.id },
      {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'sample-call-two', name: 'read', arguments: {} }],
        usage: EMPTY_USAGE,
        model: 'sample-model',
        timestamp: 6,
        stopReason: 'toolUse',
        chatMessageId: 'sample-new-assistant',
      },
      {
        role: 'toolResult',
        toolCallId: 'sample-call-two',
        toolName: 'read',
        content: [{ type: 'text', text: 'New branch result' }],
        isError: false,
        timestamp: 7,
        chatMessageId: 'sample-new-call',
      },
    ]
    const cut = projectBranchCuts([...path, next], [...history, ...later])
    expect(cut.filter((m) => m.role === 'toolResult').map((m) => m.content[0].text)).toEqual([
      'First source',
      'New branch result',
    ])
  })
  it('refuses a dangling or unresolved boundary rather than sending a different history', () => {
    expect(() => projectBranchCuts(path, history, 'sample-missing')).toThrow(/boundary/i)
    expect(() =>
      projectBranchCuts(
        path,
        history.filter((m) => m.role !== 'toolResult'),
        'sample-first'
      )
    ).toThrow(/result/i)
  })
})
