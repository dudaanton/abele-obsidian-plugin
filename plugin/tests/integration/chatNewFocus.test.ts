/**
 * A new chat opens with the cursor in its composer, however it was asked for.
 *
 * The sidebar puts the cursor there when it first mounts, and "Chat about this" asks for it
 * along with the text it brings. Everything else that makes a new chat did not: the + in the
 * tab bar, the "new chat" button and `/new`, and showing the panel again over the blank chat
 * that was already in it — the cursor stayed wherever the click had left it. Each of those
 * asks now, through the same request the chat answers for a new comment.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ChatService } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { CommentService } from '@/ai/CommentService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { AI_SIDEBAR_VIEW_TYPE } from '@/constants/views'
import { useVault } from '../helpers/testEnv'

vi.mock('@/editor/CommentPlugin', () => ({
  dispatchCommentsChanged: vi.fn(),
  setCommentInfoSource: vi.fn(),
}))

let chats: ChatService

beforeEach(() => {
  useVault([])
  AgentRegistry.destroy()
  ChatStorage.destroy()
  CommentService.getInstance().destroy()
  ChatService.getInstance().destroy()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    agents: [],
    defaultAgentId: '',
    chatHistory: [],
  }
  AbeleConfig.getInstance().saveSettings = vi.fn(async () => {})
  const registry = AgentRegistry.getInstance()
  registry.setDefault(registry.create({ name: 'Default' }).id)
  chats = ChatService.getInstance()
  vi.spyOn(chats, 'saveTabs').mockImplementation(() => {})
  // An open sidebar: its leaf is there, and showing it again is all revealing does.
  const leaf = { view: { containerEl: { isShown: () => true } } }
  ;(GlobalStore.getInstance().app as unknown as { workspace: unknown }).workspace = {
    getLeavesOfType: (type: string) => (type === AI_SIDEBAR_VIEW_TYPE ? [leaf] : []),
    revealLeaf: vi.fn(async () => {}),
  }
})

/** A tab with a conversation in it. */
function withConversation(id: string) {
  const session = chats.getSession(id)!
  session.allMessages.value = [{ id: 'm1', role: 'user', content: 'hi', timestamp: 1 }]
  return session
}

describe('a new chat asks for the cursor', () => {
  it('from the + in the tab bar', () => {
    chats.createTab()
    const before = chats.focusRequest.value

    const id = chats.newTab()

    expect(chats.activeTabId.value).toBe(id)
    expect(chats.focusRequest.value).toBe(before + 1)
  })

  it('from "new chat" over an ordinary chat', async () => {
    const id = chats.createTab()
    withConversation(id)
    const before = chats.focusRequest.value

    await chats.startNewChat(id)

    expect(chats.focusRequest.value).toBe(before + 1)
  })

  it('from "new chat" over a comment, which opens a tab of its own', async () => {
    const id = chats.createTab()
    chats.getSession(id)!.kind = 'comment'
    const before = chats.focusRequest.value

    await chats.startNewChat(id)

    expect(chats.activeTabId.value).not.toBe(id)
    expect(chats.focusRequest.value).toBe(before + 1)
  })

  it('when the panel is shown over a blank chat', async () => {
    chats.createTab()
    const before = chats.focusRequest.value

    await chats.revealSidebar()

    expect(chats.focusRequest.value).toBe(before + 1)
  })

  it('but not when the panel is shown over a conversation, which is there to be read', async () => {
    withConversation(chats.createTab())
    const before = chats.focusRequest.value

    await chats.revealSidebar()

    expect(chats.focusRequest.value).toBe(before)
  })

  it('and not for the tabs made while restoring the layout at startup', () => {
    const before = chats.focusRequest.value

    chats.createTab()

    expect(chats.focusRequest.value).toBe(before)
  })
})
