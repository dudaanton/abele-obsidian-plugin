import { expect, it } from 'vitest'
import { chatChanges } from '@/ai/chatChanges'
import type { ChatMessage } from '@/ai/types'

it('combines the first predecessor and last written content per file, ignoring denied calls', () => {
  const call = (old: string, next: string, toolStatus = 'approved') =>
    ({
      role: 'tool-call',
      toolName: 'edit',
      toolStatus,
      toolParams: { path: '.sample.md' },
      toolDiff: { old, new: next },
    }) as ChatMessage
  expect(chatChanges([call('a', 'b'), call('b', 'c'), call('c', 'denied', 'rejected')])).toEqual([
    { path: '.sample.md', old: 'a', new: 'c' },
  ])
})

it('follows a successful move when showing earlier edits', () => {
  expect(
    chatChanges([
      {
        role: 'tool-call',
        toolName: 'edit',
        toolStatus: 'approved',
        toolParams: { path: 'sample.md' },
        toolDiff: { old: 'Before', new: 'After' },
      },
      {
        role: 'tool-call',
        toolName: 'mv',
        toolStatus: 'approved',
        toolParams: { from: 'sample.md', to: 'Folder/sample.md' },
        toolResult: 'Moved',
      },
    ] as ChatMessage[])
  ).toEqual([{ path: 'Folder/sample.md', old: 'Before', new: 'After' }])
})

it('includes a move even when the chat did not edit the file', () => {
  expect(
    chatChanges([
      {
        role: 'tool-call',
        toolName: 'mv',
        toolStatus: 'approved',
        toolParams: { from: 'sample.md', to: 'Folder/sample.md' },
        toolResult: 'Moved',
      },
    ] as ChatMessage[])
  ).toEqual([{ path: 'Folder/sample.md', old: '', new: '', movedFrom: 'sample.md' }])
})
