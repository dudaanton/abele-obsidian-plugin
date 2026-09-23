/**
 * Choosing an agent chat to attach to another: the history's chats, by title, without the chat
 * doing the attaching and without entries whose file is gone.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { FuzzySuggestModal, type App } from 'obsidian'
import { pickChat } from '@/helpers/suggesters/ChatPicker'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type AiChatHistoryEntry } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

let app: FakeApp
let openSpy: ReturnType<typeof vi.spyOn>

const opened = () =>
  openSpy.mock.contexts[openSpy.mock.contexts.length - 1] as FuzzySuggestModal<AiChatHistoryEntry>

beforeEach(() => {
  app = useVault([
    { path: 'AI/Chats/Here.abchat', content: '' },
    { path: 'AI/Chats/Trip.abchat', content: '' },
  ])
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    chatHistory: [
      { path: 'AI/Chats/Here.abchat', title: 'Here', created: '' },
      { path: 'AI/Chats/Trip.abchat', title: 'Trip planning', created: '' },
      { path: 'AI/Chats/Gone.abchat', title: 'Deleted since', created: '' },
    ],
  }
  openSpy = vi.spyOn(FuzzySuggestModal.prototype, 'open').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the chat picker', () => {
  it('offers the other chats that still exist, by title', () => {
    void pickChat(app as unknown as App, 'AI/Chats/Here.abchat')
    const modal = opened()

    expect(modal.getItems().map((e) => modal.getItemText(e))).toEqual(['Trip planning'])
  })

  it('hands back the chosen chat’s file, and null when closed without a choice', async () => {
    const chosen = pickChat(app as unknown as App)
    const modal = opened()
    modal.onChooseItem(modal.getItems()[1], new MouseEvent('click'))
    expect((await chosen)?.path).toBe('AI/Chats/Trip.abchat')

    const none = pickChat(app as unknown as App)
    opened().onClose()
    expect(await none).toBeNull()
  })
})
