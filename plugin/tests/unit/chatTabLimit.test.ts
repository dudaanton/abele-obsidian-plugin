/**
 * How many chats the sidebar holds open at once: twenty (it was eight until 2026-09-25).
 *
 * The service and its sessions are real, over an in-memory vault; only the save to Obsidian's
 * store is the fake one `useVault` provides.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Notice } from 'obsidian'
import { ChatService, MAX_TABS } from '@/ai/ChatService'
import { ChatSession } from '@/ai/ChatSession'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

const chatPath = (i: number) => `AI/Chats/chat-${i}.abchat`

let app: FakeApp
let service: ChatService

beforeEach(() => {
  app = useVault(Array.from({ length: 21 }, (_, i) => ({ path: chatPath(i), content: '' })))
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, enabled: true, agents: [] }
  ;(ChatService as unknown as { instance: ChatService | null }).instance = null
  service = ChatService.getInstance()
  Notice.shown.length = 0
})

afterEach(() => {
  service.destroy()
  vi.restoreAllMocks()
})

describe('the limit on open chat tabs', () => {
  it('is twenty', () => {
    expect(MAX_TABS).toBe(20)
    expect(ChatService.TABS_FULL).toContain('20 open tabs')
  })

  it('opens twenty tabs and no twenty-first', () => {
    for (let i = 0; i < 20; i++) service.createTab()
    expect(service.tabOrder.value).toHaveLength(20)
    expect(service.canCreateTab).toBe(false)

    service.createTab()
    expect(service.tabOrder.value).toHaveLength(20)
  })

  it('makes room for + while preserving current, recently selected and busy chats', async () => {
    const ids = Array.from({ length: MAX_TABS }, () => service.createTab())
    service.switchTab(ids[0])
    service.switchTab(ids[19])
    service.getSession(ids[1])!.isStreaming.value = true
    const next = await service.newTab()
    expect(next).not.toBe(ids[19])
    expect(service.activeTabId.value).toBe(next)
    expect(service.tabOrder.value).toHaveLength(MAX_TABS)
    expect(service.getSession(ids[0])).not.toBeNull()
    expect(service.getSession(ids[1])).not.toBeNull()
    expect(service.getSession(ids[2])).toBeNull()
  })

  it('refuses + out loud when every other chat is busy', async () => {
    const ids = Array.from({ length: MAX_TABS }, () => service.createTab())
    for (const id of ids.slice(0, -1)) service.getSession(id)!.isStreaming.value = true
    expect(await service.newTab()).toBeNull()
    expect(service.tabOrder.value).toEqual(ids)
    expect(Notice.shown).toContain('Cannot open a new chat: no other idle chat can be closed.')
  })

  it.each(['question', 'approval', 'retry', 'tool', 'comment'])(
    'does not evict a chat with a pending %s',
    async (state) => {
      const ids = Array.from({ length: MAX_TABS }, () => service.createTab())
      const protectedChat = service.getSession(ids[0])!
      if (state === 'question')
        protectedChat.pendingQuestions.value = {
          questions: [],
          currentIndex: 0,
          answers: [],
          resolve: () => {},
        }
      if (state === 'retry') protectedChat.retrying.value = { attempt: 1, of: 2, secondsLeft: 3 }
      if (state === 'approval')
        protectedChat.pendingToolCalls.value = [
          { type: 'toolCall', id: 'sample-tool', name: 'sample_action', arguments: {} },
        ]
      if (state === 'tool') protectedChat.isExecutingTool.value = true
      if (state === 'comment') protectedChat.kind = 'comment'
      await service.newTab()
      expect(service.getSession(ids[0])).toBe(protectedChat)
      expect(service.getSession(ids[1])).toBeNull()
    }
  )

  it('saves an evicted chat and reopens it from Closed', async () => {
    const ids = Array.from({ length: MAX_TABS }, () => service.createTab())
    const oldest = service.getSession(ids[0])!
    oldest.chatTitle.value = 'Sample retained conversation'
    await oldest.createInDirectory('AI/Chats')
    const path = oldest.currentChatFile.value!.path
    expect(await service.newTab()).toBeTruthy()
    expect(service.getSessionByFile(path)).toBeNull()
    await service.closeTab(service.activeTabId.value!)
    expect(await service.reopenClosedTab()).toBe(true)
    expect(service.activeSession.value?.currentChatFile.value?.path).toBe(path)
    expect(service.activeSession.value?.chatTitle.value).toBe('Sample retained conversation')
  })

  it('keeps the candidate when saving fails', async () => {
    const ids = Array.from({ length: MAX_TABS }, () => service.createTab())
    vi.spyOn(service.getSession(ids[0])!, 'saveForRelease').mockRejectedValue(
      new Error('Sample save failure')
    )
    expect(await service.newTab()).toBeNull()
    expect(service.tabOrder.value).toEqual(ids)
    expect(Notice.shown).toContain('Error: Sample save failure')
  })

  it('keeps unsent composer text in its open chat', async () => {
    const ids = Array.from({ length: MAX_TABS }, () => service.createTab())
    const oldest = service.getSession(ids[0])!
    oldest.draft.value.text = 'Sample unfinished message'
    await service.newTab()
    expect(service.getSession(ids[0])).toBe(oldest)
    expect(oldest.draft.value.text).toBe('Sample unfinished message')
    expect(service.getSession(ids[1])).toBeNull()
  })

  it('rechecks activity after saving yields', async () => {
    const ids = Array.from({ length: MAX_TABS }, () => service.createTab())
    const oldest = service.getSession(ids[0])!
    vi.spyOn(oldest, 'saveForRelease').mockImplementation(async () => {
      oldest.isStreaming.value = true
    })
    expect(await service.newTab()).toBeNull()
    expect(service.tabOrder.value).toEqual(ids)
  })

  it('takes a nineteenth and twentieth session handed over, and refuses the next out loud', () => {
    for (let i = 0; i < 18; i++) service.createTab()

    expect(service.adoptSession(new ChatSession(service))).toBe(true)
    expect(service.adoptSession(new ChatSession(service))).toBe(true)

    const extra = new ChatSession(service)
    expect(service.hasRoomFor(extra)).toBe(false)
    expect(service.adoptSession(extra)).toBe(false)
    expect(Notice.shown).toContain(ChatService.TABS_FULL)
  })

  it('brings all twenty back at startup, in order, with the one that was in front', async () => {
    app.saveLocalStorage('abele-agent-tabs', {
      tabs: Array.from({ length: 20 }, (_, i) => ({ chatFilePath: chatPath(i) })),
      activeIndex: 17,
    })

    await service.restoreTabs()

    const paths = service.tabOrder.value.map(
      (id) => service.getSession(id)?.currentChatFile.value?.path
    )
    expect(paths).toEqual(Array.from({ length: 20 }, (_, i) => chatPath(i)))
    expect(service.activeSession.value?.currentChatFile.value?.path).toBe(chatPath(17))
  })
})
