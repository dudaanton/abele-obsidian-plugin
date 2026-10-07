import { describe, expect, it } from 'vitest'
import { cloneChatPath } from '@/ai/chatClone'
import type { ChatSnapshot } from '@/ai/ChatLog'
import { EMPTY_USAGE } from '@/ai/client'

function sample(): ChatSnapshot {
  return {
    metadata: {
      type: 'abele-chat',
      title: 'Sample conversation',
      created: '2025-01-01',
      providerId: 'sample-provider',
      modelId: 'sample-model',
      agentId: 'sample-agent',
      overrides: { permissionMode: 'confirm-all', scope: [{ type: 'folder', path: 'Notes' }] },
      chatId: 'original-identity',
      activeLeafId: 'later',
      comments: [{ id: 'discussion', message: 'answer' }],
      touched: [
        { path: 'Notes/copied.md', at: '2025-01-03' },
        { path: 'Notes/sibling.md', at: '2025-01-04' },
      ],
      pendingToolCalls: [{ id: 'pending', name: 'write', arguments: {} }],
      queuedMessages: [{ id: 'queued', content: 'Do more' }],
      anchor: { note: 'Notes/source.md' },
      recap: 'Includes later work',
      summary: 'Includes later turns',
      customSystemPrompt: 'Sample instructions',
      interceptorScript: 'Sample review',
    },
    messages: [
      {
        id: 'root',
        role: 'user',
        content: 'Question',
        timestamp: 1,
        attachments: ['Attachments/sample.png'],
      },
      { id: 'sibling', parentId: 'root', role: 'assistant', content: 'Other branch', timestamp: 2 },
      {
        id: 'answer',
        parentId: 'root',
        role: 'assistant',
        content: 'Answer',
        thinking: 'Reasoning',
        timestamp: 3,
      },
      {
        id: 'tool',
        parentId: 'answer',
        role: 'tool-call',
        content: '',
        toolCallId: 'call',
        toolName: 'write',
        toolStatus: 'approved',
        toolResult: 'Saved',
        toolDiff: { old: 'before', new: 'after' },
        timestamp: 4,
      },
      { id: 'later', parentId: 'tool', role: 'user', content: 'Later question', timestamp: 5 },
    ],
    internalMessages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Question' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,sample' } },
        ],
        timestamp: 1,
        chatMessageId: 'root',
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Other branch' }],
        model: 'sample-model',
        usage: EMPTY_USAGE,
        stopReason: 'stop',
        timestamp: 2,
        chatMessageId: 'sibling',
      },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Answer' },
          { type: 'thinking', thinking: 'Reasoning' },
          { type: 'toolCall', id: 'call', name: 'write', arguments: { path: 'Notes/copied.md' } },
        ],
        model: 'sample-model',
        usage: EMPTY_USAGE,
        stopReason: 'toolUse',
        timestamp: 3,
        chatMessageId: 'answer',
      },
      {
        role: 'toolResult',
        toolCallId: 'call',
        toolName: 'write',
        content: [{ type: 'text', text: 'Saved' }],
        isError: false,
        timestamp: 4,
        chatMessageId: 'tool',
        reads: [{ path: 'Notes/copied.md', hash: 'sample-hash', at: 4, via: 'write' }],
        stored: { key: 'sample-result', text: 'Full output' },
      },
      { role: 'user', content: 'Later question', timestamp: 5, chatMessageId: 'later' },
    ],
  }
}

describe('a new conversation from a message', () => {
  it('copies only the ancestry through the chosen message, with independent identities and all parts', () => {
    const source = sample()
    const before = JSON.stringify(source)
    const clone = cloneChatPath(source, 'tool')!
    expect(clone.messages.map((m) => m.content)).toEqual(['Question', 'Answer', ''])
    expect(clone.messages[0].attachments).toEqual(['Attachments/sample.png'])
    expect(clone.messages[1].thinking).toBe('Reasoning')
    expect(clone.messages[2].toolDiff).toEqual({ old: 'before', new: 'after' })
    expect(clone.messages.every((m) => !source.messages.some((s) => s.id === m.id))).toBe(true)
    expect(clone.messages[0].parentId).toBeUndefined()
    expect(clone.messages[1].parentId).toBe(clone.messages[0].id)
    expect(clone.metadata.activeLeafId).toBe(clone.messages[2].id)
    expect(clone.internalMessages?.map((m) => m.chatMessageId)).toEqual(
      clone.messages.map((m) => m.id)
    )
    expect(clone.internalMessages?.[0].content).toEqual(source.internalMessages?.[0].content)
    expect(clone.internalMessages?.[2]).toMatchObject({
      stored: { key: 'sample-result', text: 'Full output' },
    })
    expect(JSON.stringify(source)).toBe(before)
    clone.messages[0].attachments!.push('Attachments/another.png')
    expect(JSON.stringify(source)).toBe(before)
  })

  it('keeps chat setup, but drops original discussion, queue, approvals, selection identity and summaries', () => {
    const clone = cloneChatPath(sample(), 'tool')!
    expect(clone.metadata).toMatchObject({
      title: 'Sample conversation (копия)',
      providerId: 'sample-provider',
      modelId: 'sample-model',
      agentId: 'sample-agent',
      overrides: { permissionMode: 'confirm-all' },
      customSystemPrompt: 'Sample instructions',
      interceptorScript: 'Sample review',
    })
    for (const key of [
      'chatId',
      'comments',
      'anchor',
      'pendingToolCalls',
      'queuedMessages',
      'summary',
      'recap',
      'bindingRecovery',
    ])
      expect(clone.metadata).not.toHaveProperty(key)
    expect(clone.metadata.touched).toEqual([
      { path: 'Notes/copied.md', at: new Date(4).toISOString() },
    ])
  })

  it('does not carry later tool calls bundled with an earlier assistant reply', () => {
    const clone = cloneChatPath(sample(), 'answer')!
    expect(clone.internalMessages).toHaveLength(2)
    expect(clone.internalMessages?.[1]).toMatchObject({
      role: 'assistant',
      stopReason: 'stop',
      content: [
        { type: 'text', text: 'Answer' },
        { type: 'thinking', thinking: 'Reasoning' },
      ],
    })
    expect(clone.metadata.touched).toBeUndefined()
  })

  it('retains model context from an old single-message chat without internal links', () => {
    const source = sample()
    source.messages = [source.messages[0]]
    source.internalMessages = [{ role: 'user', content: 'Question', timestamp: 1 }]
    const clone = cloneChatPath(source, 'root')!
    expect(clone.internalMessages).toEqual([
      { role: 'user', content: 'Question', timestamp: 1, chatMessageId: clone.messages[0].id },
    ])
  })

  it('refuses absent messages and unsent drafts', () => {
    expect(cloneChatPath(sample(), 'missing')).toBeNull()
    const source = sample()
    source.messages[0].draft = true
    expect(cloneChatPath(source, 'root')).toBeNull()
  })
})
