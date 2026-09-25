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
