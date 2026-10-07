import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TFile } from 'obsidian'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { serializeChat } from '@/ai/ChatLog'
import { useVault } from '../helpers/testEnv'
let session: ChatSession
beforeEach(async () => {
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  const content = serializeChat({
    metadata: {
      type: 'abele-chat',
      created: '2030-01-01',
      providerId: '',
      modelId: '',
      activeLeafId: 'a2',
    },
    messages: [
      { id: 'q', role: 'user', content: 'Sample question', timestamp: 1 },
      { id: 'a', parentId: 'q', role: 'assistant', content: 'First answer', timestamp: 2 },
      { id: 'a2', parentId: 'a', role: 'user', content: 'First follow-up', timestamp: 3 },
      { id: 'b', parentId: 'q', role: 'assistant', content: 'Other answer', timestamp: 4 },
      { id: 'b1', parentId: 'b', role: 'user', content: 'Earliest follow-up', timestamp: 5 },
      { id: 'b2', parentId: 'b', role: 'user', content: 'Later follow-up', timestamp: 6 },
    ],
    internalMessages: [],
  })
  const app = useVault([{ path: 'Chats/sample-branches.abchat', raw: content }])
  vi.spyOn(ChatService.getInstance(), 'saveTabs').mockImplementation(() => {})
  session = new ChatSession(ChatService.getInstance())
  vi.spyOn(session, 'save').mockResolvedValue(undefined)
  await session.load(app.vault.getAbstractFileByPath('Chats/sample-branches.abchat') as TFile)
})
afterEach(() => {
  session.destroy()
  vi.restoreAllMocks()
})

describe('navigation branch selection', () => {
  it('selects the earliest later continuation for the next send and restores an exact saved leaf', () => {
    const draft = session.draft.value
    draft.text = 'An unsent sample follow-up'
    expect(session.branchLeafId).toBe('a2')
    expect(session.switchBranch('b')).toBe(true)
    expect(session.messages.value.map((m) => m.id)).toEqual(['q', 'b', 'b1'])
    expect(session.branchLeafId).toBe('b1')
    expect(session.switchBranch('a', false)).toBe(true)
    expect(session.messages.value.map((m) => m.id)).toEqual(['q', 'a'])
    expect(session.draft.value).toBe(draft)
    expect(session.draft.value.text).toBe('An unsent sample follow-up')
  })

  it.each([
    'approval',
    'question',
    'action',
    'compaction',
    'streaming',
    'interceptor',
    'retry',
    'moving',
  ])('refuses to change the conversation during %s', (state) => {
    if (state === 'approval')
      session.pendingToolCalls.value = [
        { id: 'call', name: 'read', arguments: {}, type: 'toolCall' },
      ] as never
    if (state === 'question')
      session.pendingQuestions.value = {
        questions: [{ question: 'Sample question', options: ['Yes'] }],
        currentIndex: 0,
        resolve: () => {},
      } as never
    if (state === 'action') session.isExecutingTool.value = true
    if (state === 'compaction') session.isCompacting.value = true
    if (state === 'streaming') session.isStreaming.value = true
    if (state === 'interceptor') session.interceptor.streaming.value = true
    if (state === 'retry') session.retrying.value = { secondsLeft: 1, attempt: 1, of: 1 }
    if (state === 'moving') session.moving.value = true
    const selected = session.switchBranch('b')
    expect(session.messages.value.map((m) => m.id)).toEqual(['q', 'a', 'a2'])
    expect(selected).toBe(false)
  })
})
