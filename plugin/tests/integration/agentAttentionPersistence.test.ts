import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { parseChat, parseChatMetadata, serializeMetadata } from '@/ai/ChatLog'
import { GlobalStore } from '@/stores/GlobalStore'
import { AgentsService } from '@/agents/AgentsService'
import { useVault } from '../helpers/testEnv'

let session: ChatSession
beforeEach(async () => {
  useVault([])
  AbeleConfig.getInstance().ai = structuredClone(DEFAULT_AI_SETTINGS)
  vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue(undefined)
  session = new ChatSession(ChatService.getInstance())
  await session.addUserNote('Invented sample conversation')
})
afterEach(() => {
  session.destroy()
  ChatService.getInstance().destroy()
  ChatStorage.destroy()
  AgentsService.destroyCurrent()
})

describe('persisted attention', () => {
  it('saves explicit questions and restores them as interrupted without a live resolver', async () => {
    void session.askQuestions([{ question: 'Which sample?', options: ['First', 'Second'] }])
    await session.save()
    const file = session.currentChatFile.value!
    const saved = await ChatStorage.getInstance().loadChat(file)
    expect(saved.metadata?.attention?.question).toMatchObject({
      status: 'waiting',
      currentIndex: 0,
      answers: [],
      questions: [{ question: 'Which sample?', options: ['First', 'Second'] }],
    })
    session.destroy()
    session = new ChatSession(ChatService.getInstance())
    await session.load(file)
    expect(session.pendingQuestions.value).toBeNull()
    expect(session.attention.value.question?.status).toBe('interrupted')
    expect(session.isStreaming.value).toBe(false)
  })
  it('keeps failures and seen identities through save, close and reload', async () => {
    session.recordAttentionError('Sample failure')
    const errorId = session.attention.value.errors![0].id
    await session.save()
    const file = session.currentChatFile.value!
    await session.markAttentionSeen(errorId)
    session.destroy()
    session = new ChatSession(ChatService.getInstance())
    await session.load(file)
    expect(session.attention.value.errors).toEqual([
      expect.objectContaining({ id: errorId, seen: true }),
    ])
    session.recordAttentionError('Next sample failure')
    await session.save()
    expect(session.attention.value.errors!.filter((e) => !e.seen)).toHaveLength(1)
    const content = await useContent(file.path)
    expect(parseChat(content).metadata?.attention?.errors).toHaveLength(2)
  })
  it('does not hide an error or lose a newer failure when acknowledgement storage fails', async () => {
    session.recordAttentionError('First sample failure')
    await session.save()
    const id = session.attention.value.errors![0].id
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(ChatStorage.getInstance(), 'saveChat').mockImplementation(async () => {
      session.recordAttentionError('Concurrent sample failure')
      throw new Error('Sample disk unavailable')
    })
    await expect(session.markAttentionSeen(id)).rejects.toThrow('Не удалось сохранить')
    expect(session.attention.value.errors).toHaveLength(2)
    expect(session.attention.value.errors![0].seen).not.toBe(true)
  })
  it('does not persist restored approvals during a read-only selection return', async () => {
    const file = session.currentChatFile.value!
    const app = GlobalStore.getInstance().app
    const metadata = parseChatMetadata(await app.vault.read(file))!
    await app.vault.append(
      file,
      serializeMetadata({
        ...metadata,
        pendingToolCalls: [
          { id: 'sample-request', name: 'edit', arguments: { path: 'Notes/sample.md' } },
        ],
      })
    )
    const write = vi.spyOn(ChatStorage.getInstance(), 'saveChat')
    vi.useFakeTimers()
    try {
      await session.reconcileForSelectionReturn()
      await vi.advanceTimersByTimeAsync(1000)
      expect(write).not.toHaveBeenCalled()
      expect(session.pendingToolCalls.value[0].id).toBe('sample-request')
    } finally {
      vi.useRealTimers()
    }
  })
  it('persists transitions to local work even before its first streamed token', async () => {
    await session.save()
    session.isStreaming.value = true
    await nextTick()
    await session.flush()
    const file = session.currentChatFile.value!
    expect((await ChatStorage.getInstance().loadChat(file)).metadata?.attention?.run?.status).toBe(
      'running'
    )
    session.destroy()
    session = new ChatSession(ChatService.getInstance())
    await session.load(file)
    expect(session.attention.value.run?.status).toBe('interrupted')
  })
})
async function useContent(path: string): Promise<string> {
  const { GlobalStore } = await import('@/stores/GlobalStore')
  return GlobalStore.getInstance().app.vault.adapter.read(path)
}
